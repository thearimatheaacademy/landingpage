-- Kingdom School: registrants, payments, admin access and email automation.
-- All tables have RLS on. The Cloudflare Worker uses the service-role key (bypasses RLS);
-- the admin dashboard uses a signed-in Supabase user who must be listed in public.admins.

create extension if not exists citext;

-- ── Admin access ──────────────────────────────────────────────
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ── Registrants ───────────────────────────────────────────────
create type public.registrant_status as enum ('pending', 'paid', 'refunded', 'cancelled');

create table public.registrants (
  id                    uuid primary key default gen_random_uuid(),
  first_name            text not null check (char_length(first_name) between 1 and 100),
  last_name             text not null check (char_length(last_name) between 1 and 100),
  email                 citext not null unique check (char_length(email) <= 254),
  phone                 text check (char_length(phone) <= 40),
  country               text check (char_length(country) <= 80),
  organisation          text check (char_length(organisation) <= 200),
  how_heard             text check (char_length(how_heard) <= 200),
  goals                 text check (char_length(goals) <= 2000),
  marketing_consent     boolean not null default false,
  status                public.registrant_status not null default 'pending',
  -- unguessable token used in "complete your payment" links
  pay_token             uuid not null default gen_random_uuid(),
  stripe_session_id     text,
  stripe_payment_intent text,
  amount_paid           integer,
  currency              text,
  paid_at               timestamptz,
  payment_method_note   text,          -- e.g. "marked paid manually (bank transfer)"
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index registrants_status_idx on public.registrants (status);
create index registrants_payment_intent_idx on public.registrants (stripe_payment_intent);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger registrants_touch before update on public.registrants
  for each row execute function public.touch_updated_at();

-- ── Settings (Zoom link, sender name, etc.) ───────────────────
create table public.settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- ── Automated email sequences ─────────────────────────────────
-- A step fires either `delay_hours` after the anchor (paid_at for 'paid', created_at for 'pending'),
-- or at a fixed `send_at` time (sent to everyone in the audience at that time, for up to 24h after).
create table public.email_sequence_steps (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  audience    text not null check (audience in ('paid', 'pending')),
  delay_hours numeric,
  send_at     timestamptz,
  subject     text not null,
  html        text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  check ((delay_hours is null) <> (send_at is null))
);

-- ── One-off / scheduled broadcasts ────────────────────────────
create table public.email_campaigns (
  id            uuid primary key default gen_random_uuid(),
  subject       text not null,
  html          text not null,
  audience      text not null check (audience in ('all', 'paid', 'pending')),
  scheduled_for timestamptz not null default now(),
  status        text not null default 'scheduled' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  sent_count    integer not null default 0,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

-- ── Every email sent (or failed), and the dedupe key for automation ──
create table public.email_log (
  id            bigint generated always as identity primary key,
  registrant_id uuid references public.registrants (id) on delete cascade,
  to_email      text not null,
  kind          text not null check (kind in ('sequence', 'campaign', 'manual')),
  ref_id        uuid,
  subject       text not null,
  status        text not null check (status in ('sent', 'failed')),
  error         text,
  provider_id   text,
  created_at    timestamptz not null default now()
);
create unique index email_log_once on public.email_log (registrant_id, kind, ref_id)
  where status = 'sent' and kind in ('sequence', 'campaign');
create index email_log_registrant_idx on public.email_log (registrant_id);

-- ── RLS ───────────────────────────────────────────────────────
alter table public.admins               enable row level security;
alter table public.registrants          enable row level security;
alter table public.settings             enable row level security;
alter table public.email_sequence_steps enable row level security;
alter table public.email_campaigns      enable row level security;
alter table public.email_log            enable row level security;

create policy "admins read own row" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

create policy "admin all" on public.registrants          for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin all" on public.settings             for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin all" on public.email_sequence_steps for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin all" on public.email_campaigns      for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin read" on public.email_log           for select to authenticated using ((select public.is_admin()));

-- ── Seed content ──────────────────────────────────────────────
insert into public.settings (key, value) values
  ('zoom_link', 'https://zoom.us/j/REPLACE_ME'),
  ('zoom_passcode', ''),
  ('start_date', 'Friday, 11 December 2026'),
  ('session_time', '7:00pm UK time');

insert into public.email_sequence_steps (name, audience, delay_hours, send_at, subject, sort_order, html) values
('Payment confirmation + Zoom link', 'paid', 0, null,
 'You''re in! Your Kingdom School place is confirmed', 10,
 '<p>Dear {{first_name}},</p>
<p>Thank you, your payment of £150 has been received and your place on the <strong>Kingdom School of Business &amp; Ministry Bootcamp</strong> is confirmed.</p>
<p><strong>Starts:</strong> {{start_date}}<br><strong>When:</strong> Every Friday for 15 weeks, {{session_time}}<br><strong>Where:</strong> Online via Zoom</p>
<p style="margin:24px 0"><a href="{{zoom_link}}" style="background:#23571F;color:#FBF5E3;padding:14px 26px;text-decoration:none;font-weight:600">JOIN ON ZOOM</a></p>
<p>Zoom link: <a href="{{zoom_link}}">{{zoom_link}}</a><br>{{zoom_passcode_line}}</p>
<p>Please save this email. We will also send you a reminder before the first session.</p>
<p>It is time to build with intention.<br>The Arimathea Academy</p>'),
('Reminder: starts tomorrow', 'paid', null, '2026-12-10 10:00:00+00',
 'Kingdom School starts tomorrow', 20,
 '<p>Dear {{first_name}},</p><p>The Kingdom School of Business &amp; Ministry Bootcamp starts <strong>tomorrow, {{start_date}}</strong> at {{session_time}}.</p><p><a href="{{zoom_link}}">Join on Zoom</a>{{zoom_passcode_line}}</p><p>See you there,<br>The Arimathea Academy</p>'),
('Reminder: first session today', 'paid', null, '2026-12-11 09:00:00+00',
 'Today: your first Kingdom School session', 30,
 '<p>Dear {{first_name}},</p><p>Today is the day! Our first session is at {{session_time}}.</p><p style="margin:24px 0"><a href="{{zoom_link}}" style="background:#23571F;color:#FBF5E3;padding:14px 26px;text-decoration:none;font-weight:600">JOIN ON ZOOM</a></p>{{zoom_passcode_line}}<p>The Arimathea Academy</p>'),
('Unpaid: complete your registration (24h)', 'pending', 24, null,
 'Complete your Kingdom School registration', 40,
 '<p>Dear {{first_name}},</p><p>You started registering for the Kingdom School of Business &amp; Ministry Bootcamp but your payment has not been completed yet. Your place is only confirmed once payment is received.</p><p style="margin:24px 0"><a href="{{payment_link}}" style="background:#23571F;color:#FBF5E3;padding:14px 26px;text-decoration:none;font-weight:600">COMPLETE PAYMENT (£150)</a></p><p>The Arimathea Academy</p>'),
('Unpaid: final reminder (72h)', 'pending', 72, null,
 'Last reminder: secure your Kingdom School place', 50,
 '<p>Dear {{first_name}},</p><p>This is a final reminder that your Kingdom School registration is still awaiting payment. We start on {{start_date}}.</p><p><a href="{{payment_link}}">Complete your payment here</a></p><p>The Arimathea Academy</p>');
