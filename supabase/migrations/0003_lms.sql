-- Student portal (lms.thearimatheaacademy.com): programme sessions, recordings and progress.
-- Students are Supabase Auth users whose email matches a *paid* registrant.

alter table public.registrants add column user_id uuid references auth.users (id) on delete set null;
create index registrants_user_id_idx on public.registrants (user_id);

alter table public.email_log drop constraint email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check check (kind in ('sequence', 'campaign', 'manual', 'login'));

-- ── Student check ─────────────────────────────────────────────
create or replace function private.is_student()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.registrants r
    where r.status = 'paid'
      and (r.user_id = (select auth.uid()) or r.email = (select auth.jwt() ->> 'email')::extensions.citext)
  );
$$;
revoke all on function private.is_student() from public, anon;
grant execute on function private.is_student() to authenticated;

-- ── Programme sessions ────────────────────────────────────────
create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  week          integer not null,
  title         text not null,
  speaker       text,
  description   text,
  starts_at     timestamptz not null,
  recording_url text,
  resources     jsonb not null default '[]',   -- [{ "label": "...", "url": "..." }]
  published     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index sessions_starts_at_idx on public.sessions (starts_at);
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

create table public.session_progress (
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

alter table public.sessions         enable row level security;
alter table public.session_progress enable row level security;

create policy "admin all" on public.sessions for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "students read published" on public.sessions for select to authenticated
  using (published and (select private.is_student()));

create policy "own progress" on public.session_progress for all to authenticated
  using (user_id = (select auth.uid()) and (select private.is_student()))
  with check (user_id = (select auth.uid()) and (select private.is_student()));
create policy "admin read progress" on public.session_progress for select to authenticated
  using ((select private.is_admin()));

-- Students may read their own registrant row (name, status) but nothing else.
create policy "student reads own registration" on public.registrants for select to authenticated
  using (user_id = (select auth.uid()) or email = (select auth.jwt() ->> 'email')::extensions.citext);

-- Zoom details for students (settings itself stays admin-only).
create or replace function public.student_live_details()
returns table (zoom_link text, zoom_passcode text, session_time text)
language sql stable security definer
set search_path = ''
as $$
  select
    (select value from public.settings where key = 'zoom_link'),
    (select value from public.settings where key = 'zoom_passcode'),
    (select value from public.settings where key = 'session_time')
  where (select private.is_student());
$$;
revoke all on function public.student_live_details() from public, anon;
grant execute on function public.student_live_details() to authenticated;

-- 15 Fridays from 11 Dec 2026, 7pm UK. Titles/speakers are placeholders to edit in the dashboard.
insert into public.sessions (week, title, starts_at)
select w, 'Week ' || w || ' session', ('2026-12-11 19:00:00 Europe/London'::timestamptz + ((w - 1) * interval '7 days'))
from generate_series(1, 15) as w;

-- Confirmation email gains a link to the student portal.
update public.email_sequence_steps
set html = replace(html,
  '<p>Please save this email.',
  '<p><strong>Your student portal:</strong> session recordings, resources and the Zoom link are all at <a href="{{lms_link}}">{{lms_link}}</a>. Sign in with this email address.</p>
<p>Please save this email.')
where name = 'Payment confirmation + Zoom link';
