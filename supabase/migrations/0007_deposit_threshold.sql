-- A booking is "deposit_paid" only once the deposit for all of its attendees is covered.
-- Before: any payment above zero counted, so an old cheaper checkout could hold many places (security audit, 4 Nov 2026).
-- A part-paid booking below the deposit stays "pending" and keeps its amount_paid.
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
      when paid >= bk.deposit_amount and paid > 0 then 'deposit_paid'
      when paid > 0 then 'pending'
      when refunded > 0 then 'refunded'
      when bk.status in ('deposit_paid', 'paid') then 'pending'
      else bk.status end,
    deposit_paid_at = case when paid >= bk.deposit_amount and paid > 0 then coalesce(bk.deposit_paid_at, now()) else bk.deposit_paid_at end,
    paid_at = case when paid >= bk.total_amount then coalesce(bk.paid_at, now()) else null end
  where bk.id = p_booking
  returning * into b;
  return b;
end; $$;

revoke all on function private.recalc_retreat_booking(uuid) from public, anon, authenticated;
grant execute on function private.recalc_retreat_booking(uuid) to service_role;
