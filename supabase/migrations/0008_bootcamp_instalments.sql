-- Bootcamp instalments: £50 now, £50 a month later, £50 two months later (12 Nov 2026).
-- Paying in full is unchanged. Instalment payers become "paid" (Zoom + portal access) after the first £50;
-- amount_paid is recalculated from bootcamp_payments, and the dashboard shows what is still owed.

alter table public.registrants
  add column payment_plan text not null default 'full' check (payment_plan in ('full', 'instalments')),
  add column amount_due integer not null default 15000 check (amount_due > 0);

create table public.bootcamp_payments (
  id                    uuid primary key default gen_random_uuid(),
  registrant_id         uuid not null references public.registrants (id) on delete cascade,
  instalment            integer not null,
  amount                integer not null check (amount > 0),
  currency              text not null default 'gbp',
  status                text not null default 'succeeded' check (status in ('succeeded', 'refunded')),
  stripe_session_id     text unique,
  stripe_payment_intent text,
  note                  text,
  recorded_by           text,
  created_at            timestamptz not null default now()
);
create index bootcamp_payments_registrant_idx on public.bootcamp_payments (registrant_id);
create index bootcamp_payments_intent_idx on public.bootcamp_payments (stripe_payment_intent);
alter table public.bootcamp_payments enable row level security;
create policy "admin read" on public.bootcamp_payments for select to authenticated using ((select private.is_admin()));

-- Record one instalment idempotently. Returns the registrant, whether this call added the payment, and
-- whether it just became paid (first instalment: send the confirmation with the Zoom link).
create or replace function private.record_bootcamp_payment(
  p_registrant uuid, p_amount integer, p_currency text, p_session text, p_intent text, p_note text, p_recorded_by text
)
returns table (registrant public.registrants, inserted boolean, became_paid boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  before_status public.registrant_status;
  new_id uuid;
  paid integer;
  r public.registrants;
begin
  select status into before_status from public.registrants where id = p_registrant for update;
  if not found then raise exception 'registrant % not found', p_registrant; end if;

  insert into public.bootcamp_payments (registrant_id, instalment, amount, currency, stripe_session_id, stripe_payment_intent, note, recorded_by)
  values (p_registrant,
          (select count(*) + 1 from public.bootcamp_payments where registrant_id = p_registrant and status = 'succeeded'),
          p_amount, coalesce(p_currency, 'gbp'), p_session, p_intent, p_note, p_recorded_by)
  on conflict do nothing
  returning id into new_id;

  select coalesce(sum(amount), 0) into paid from public.bootcamp_payments where registrant_id = p_registrant and status = 'succeeded';

  update public.registrants rg set
    amount_paid = paid,
    currency = coalesce(p_currency, rg.currency, 'gbp'),
    stripe_session_id = coalesce(p_session, rg.stripe_session_id),
    stripe_payment_intent = coalesce(p_intent, rg.stripe_payment_intent),
    status = case when rg.status in ('pending', 'cancelled') and paid > 0 then 'paid'::public.registrant_status else rg.status end,
    paid_at = case when rg.status in ('pending', 'cancelled') and paid > 0 then now() else rg.paid_at end
  where rg.id = p_registrant
  returning * into r;

  return query select r, new_id is not null, (before_status in ('pending', 'cancelled') and r.status = 'paid');
end; $$;

-- Refund every instalment with this payment intent; a registrant with nothing left paid becomes "refunded".
create or replace function private.refund_bootcamp_payment(p_intent text)
returns setof public.registrants
language plpgsql security definer
set search_path = ''
as $$
declare
  rid uuid;
  paid integer;
  r public.registrants;
begin
  for rid in
    update public.bootcamp_payments set status = 'refunded'
    where stripe_payment_intent = p_intent and status = 'succeeded'
    returning registrant_id
  loop
    select coalesce(sum(amount), 0) into paid from public.bootcamp_payments where registrant_id = rid and status = 'succeeded';
    update public.registrants rg set
      amount_paid = paid,
      status = case when paid = 0 then 'refunded'::public.registrant_status else rg.status end
    where rg.id = rid returning * into r;
    return next r;
  end loop;
end; $$;

create or replace function public.record_bootcamp_payment(
  p_registrant uuid, p_amount integer, p_currency text default 'gbp', p_session text default null,
  p_intent text default null, p_note text default null, p_recorded_by text default null
)
returns table (registrant public.registrants, inserted boolean, became_paid boolean)
language sql security definer set search_path = ''
as $$ select * from private.record_bootcamp_payment(p_registrant, p_amount, p_currency, p_session, p_intent, p_note, p_recorded_by); $$;

create or replace function public.refund_bootcamp_payment(p_intent text)
returns setof public.registrants
language sql security definer set search_path = ''
as $$ select * from private.refund_bootcamp_payment(p_intent); $$;

revoke all on function private.record_bootcamp_payment(uuid, integer, text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.refund_bootcamp_payment(text) from public, anon, authenticated;
revoke all on function public.record_bootcamp_payment(uuid, integer, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.refund_bootcamp_payment(text) from public, anon, authenticated;
grant execute on function private.record_bootcamp_payment(uuid, integer, text, text, text, text, text) to service_role;
grant execute on function private.refund_bootcamp_payment(text) to service_role;
grant execute on function public.record_bootcamp_payment(uuid, integer, text, text, text, text, text) to service_role;
grant execute on function public.refund_bootcamp_payment(text) to service_role;

-- Instalment emails (due, reminder, receipt) are logged against the registrant, once each.
alter table public.email_log drop constraint email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('sequence', 'campaign', 'manual', 'login', 'retreat', 'instalment'));
create unique index email_log_instalment_once on public.email_log (registrant_id, template)
  where kind = 'instalment' and status = 'sent';
