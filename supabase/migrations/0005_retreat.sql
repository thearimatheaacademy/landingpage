-- End of Year Retreat bookings: one booker can pay for several attendees, in full or with a £50-per-person
-- deposit, and pay the balance later (emailed payment link or a Stripe invoice sent from the dashboard).
-- Bootcamp registrants (public.registrants) and the student portal are not affected.

create table public.retreat_bookings (
  id                  uuid primary key default gen_random_uuid(),
  -- short human reference shown on emails, invoices and the dashboard
  reference           text not null unique default ('RT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  first_name          text not null check (char_length(first_name) between 1 and 100),
  last_name           text not null check (char_length(last_name) between 1 and 100),
  email               extensions.citext not null check (char_length(email) <= 254),
  phone               text check (char_length(phone) <= 40),
  special_requests    text check (char_length(special_requests) <= 2000),
  marketing_consent   boolean not null default false,
  payment_option      text not null check (payment_option in ('full', 'deposit')),
  -- all amounts in pence (GBP)
  total_amount        integer not null check (total_amount > 0),
  deposit_amount      integer not null check (deposit_amount >= 0),
  amount_paid         integer not null default 0,
  currency            text not null default 'gbp',
  status              text not null default 'pending'
                      check (status in ('pending', 'deposit_paid', 'paid', 'refunded', 'cancelled')),
  -- unguessable token used in "pay your balance" links
  pay_token           uuid not null default gen_random_uuid(),
  stripe_customer_id  text,
  stripe_session_id   text,              -- latest Checkout Session
  stripe_invoice_id   text,              -- latest invoice sent from the dashboard
  invoice_status      text,              -- draft | open | paid | void | uncollectible
  deposit_paid_at     timestamptz,
  paid_at             timestamptz,
  notes               text,              -- admin notes
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index retreat_bookings_status_idx on public.retreat_bookings (status);
create index retreat_bookings_email_idx on public.retreat_bookings (email);
create trigger retreat_bookings_touch before update on public.retreat_bookings
  for each row execute function public.touch_updated_at();

create table public.retreat_attendees (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.retreat_bookings (id) on delete cascade,
  position    integer not null,
  first_name  text not null check (char_length(first_name) between 1 and 100),
  last_name   text not null check (char_length(last_name) between 1 and 100),
  room        text not null check (room in ('double', 'single')),
  unit_price  integer not null check (unit_price > 0),
  dietary     text check (char_length(dietary) <= 500),
  created_at  timestamptz not null default now(),
  unique (booking_id, position)
);

-- Every payment against a booking. amount_paid on the booking is always recalculated from this table.
create table public.retreat_payments (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references public.retreat_bookings (id) on delete cascade,
  kind                  text not null check (kind in ('deposit', 'full', 'balance', 'invoice', 'manual')),
  amount                integer not null check (amount > 0),
  currency              text not null default 'gbp',
  status                text not null default 'succeeded' check (status in ('succeeded', 'refunded')),
  stripe_session_id     text unique,
  stripe_invoice_id     text unique,
  stripe_payment_intent text,
  note                  text,
  recorded_by           text,             -- admin email for manual payments
  created_at            timestamptz not null default now()
);
create index retreat_payments_booking_idx on public.retreat_payments (booking_id);
create index retreat_payments_intent_idx on public.retreat_payments (stripe_payment_intent);

-- Recalculate amount_paid and status from the payments table. Called after every payment or refund.
create or replace function private.recalc_retreat_booking(p_booking uuid)
returns public.retreat_bookings
language plpgsql security definer
set search_path = ''
as $$
declare
  paid integer;
  refunded integer;
  b public.retreat_bookings;
begin
  select coalesce(sum(amount) filter (where status = 'succeeded'), 0),
         count(*) filter (where status = 'refunded')
    into paid, refunded
    from public.retreat_payments where booking_id = p_booking;

  update public.retreat_bookings bk set
    amount_paid = paid,
    status = case
      when paid >= bk.total_amount then 'paid'
      when paid > 0 then 'deposit_paid'
      when refunded > 0 then 'refunded'
      when bk.status in ('deposit_paid', 'paid') then 'pending'
      else bk.status end,
    deposit_paid_at = case when paid > 0 then coalesce(bk.deposit_paid_at, now()) else bk.deposit_paid_at end,
    paid_at = case when paid >= bk.total_amount then coalesce(bk.paid_at, now()) else null end
  where bk.id = p_booking
  returning * into b;
  return b;
end; $$;

-- Record one payment idempotently (a Checkout Session or invoice is only ever counted once).
-- Returns the booking and whether this call added the payment.
create or replace function private.record_retreat_payment(
  p_booking uuid, p_kind text, p_amount integer, p_currency text,
  p_session text, p_invoice text, p_intent text, p_note text, p_recorded_by text
)
returns table (booking public.retreat_bookings, inserted boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  -- serialise payments for the same booking
  perform 1 from public.retreat_bookings where id = p_booking for update;
  if not found then raise exception 'retreat booking % not found', p_booking; end if;

  insert into public.retreat_payments (booking_id, kind, amount, currency, stripe_session_id, stripe_invoice_id, stripe_payment_intent, note, recorded_by)
  values (p_booking, p_kind, p_amount, coalesce(p_currency, 'gbp'), p_session, p_invoice, p_intent, p_note, p_recorded_by)
  on conflict do nothing
  returning id into new_id;

  return query select private.recalc_retreat_booking(p_booking), new_id is not null;
end; $$;

-- Mark every payment with this payment intent as refunded and recalculate the affected bookings.
create or replace function private.refund_retreat_payment(p_intent text)
returns setof public.retreat_bookings
language plpgsql security definer
set search_path = ''
as $$
declare
  bid uuid;
begin
  for bid in
    update public.retreat_payments set status = 'refunded'
    where stripe_payment_intent = p_intent and status = 'succeeded'
    returning booking_id
  loop
    return next private.recalc_retreat_booking(bid);
  end loop;
end; $$;

-- Only the Worker (service role) calls these.
revoke all on function private.recalc_retreat_booking(uuid) from public, anon, authenticated;
revoke all on function private.record_retreat_payment(uuid, text, integer, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.refund_retreat_payment(text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.recalc_retreat_booking(uuid) to service_role;
grant execute on function private.record_retreat_payment(uuid, text, integer, text, text, text, text, text, text) to service_role;
grant execute on function private.refund_retreat_payment(text) to service_role;

-- Public wrappers so supabase-js (.rpc) can reach them; still service-role only.
create or replace function public.record_retreat_payment(
  p_booking uuid, p_kind text, p_amount integer, p_currency text default 'gbp',
  p_session text default null, p_invoice text default null, p_intent text default null,
  p_note text default null, p_recorded_by text default null
)
returns table (booking public.retreat_bookings, inserted boolean)
language sql security definer
set search_path = ''
as $$ select * from private.record_retreat_payment(p_booking, p_kind, p_amount, p_currency, p_session, p_invoice, p_intent, p_note, p_recorded_by); $$;

create or replace function public.refund_retreat_payment(p_intent text)
returns setof public.retreat_bookings
language sql security definer
set search_path = ''
as $$ select * from private.refund_retreat_payment(p_intent); $$;

revoke all on function public.record_retreat_payment(uuid, text, integer, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.refund_retreat_payment(text) from public, anon, authenticated;
grant execute on function public.record_retreat_payment(uuid, text, integer, text, text, text, text, text, text) to service_role;
grant execute on function public.refund_retreat_payment(text) to service_role;

-- ── Email log: retreat emails are logged against the booking ──
alter table public.email_log add column booking_id uuid references public.retreat_bookings (id) on delete cascade;
alter table public.email_log add column template text;
alter table public.email_log drop constraint email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('sequence', 'campaign', 'manual', 'login', 'retreat'));
create index email_log_booking_idx on public.email_log (booking_id);
-- automatic retreat emails go out once per booking
create unique index email_log_retreat_once on public.email_log (booking_id, template)
  where kind = 'retreat' and status = 'sent'
    and template in ('deposit_confirmation', 'paid_confirmation', 'balance_reminder_1', 'balance_reminder_2');

-- ── RLS: admins only (the Worker uses the service role) ──
alter table public.retreat_bookings  enable row level security;
alter table public.retreat_attendees enable row level security;
alter table public.retreat_payments  enable row level security;
create policy "admin all" on public.retreat_bookings  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin all" on public.retreat_attendees for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin read" on public.retreat_payments for select to authenticated
  using ((select private.is_admin()));
