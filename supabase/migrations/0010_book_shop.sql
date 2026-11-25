-- Book shop: "Running on Bended Knees" paperback, £15 including UK delivery, posted to UK addresses only.
-- Limited stock (10 copies). A copy is held while the buyer is on the payment page (until their Stripe
-- Checkout Session expires), so two people can never pay for the last copy.

create table public.book_stock (
  id          text primary key,
  title       text not null,
  unit_price  integer not null check (unit_price > 0),   -- pence
  stock_total integer not null check (stock_total >= 0), -- copies ever available to sell (raise it when more arrive)
  updated_at  timestamptz not null default now()
);
insert into public.book_stock (id, title, unit_price, stock_total)
values ('running-on-bended-knees', 'Running on Bended Knees', 1500, 10);
create trigger book_stock_touch before update on public.book_stock
  for each row execute function public.touch_updated_at();

create table public.book_orders (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default ('BK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  product_id            text not null references public.book_stock (id),
  first_name            text not null check (char_length(first_name) between 1 and 60),
  last_name             text not null check (char_length(last_name) between 1 and 60),
  email                 extensions.citext not null check (char_length(email) <= 254),
  phone                 text check (char_length(phone) <= 40),
  address_line1         text not null check (char_length(address_line1) between 1 and 120),
  address_line2         text check (char_length(address_line2) <= 120),
  city                  text not null check (char_length(city) between 1 and 80),
  postcode              text not null check (char_length(postcode) between 5 and 8),
  quantity              integer not null check (quantity between 1 and 10),
  unit_price            integer not null,
  total_amount          integer not null,
  status                text not null default 'pending'
                        check (status in ('pending', 'paid', 'posted', 'expired', 'cancelled', 'refunded')),
  hold_expires_at       timestamptz not null,
  pay_token             uuid not null default gen_random_uuid(),
  marketing_consent     boolean not null default false,
  stripe_session_id     text unique,
  stripe_payment_intent text,
  paid_at               timestamptz,
  posted_at             timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index book_orders_status_idx on public.book_orders (status);
create index book_orders_intent_idx on public.book_orders (stripe_payment_intent);
create trigger book_orders_touch before update on public.book_orders
  for each row execute function public.touch_updated_at();

-- Copies still for sale: stock minus paid/posted orders minus unexpired holds.
create or replace function private.book_available(p_product text)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select greatest(0, s.stock_total - coalesce((
    select sum(o.quantity) from public.book_orders o
    where o.product_id = s.id
      and (o.status in ('paid', 'posted') or (o.status = 'pending' and o.hold_expires_at > now()))
  ), 0))::integer
  from public.book_stock s where s.id = p_product;
$$;

-- Reserve copies and create a pending order, or fail with 'sold_out' if there aren't enough.
-- The stock row is locked so concurrent buyers are served one at a time.
create or replace function private.reserve_book_order(
  p_product text, p_quantity integer, p_hold_minutes integer,
  p_first_name text, p_last_name text, p_email text, p_phone text,
  p_line1 text, p_line2 text, p_city text, p_postcode text, p_marketing boolean,
  p_replace_order uuid, p_replace_token uuid
)
returns public.book_orders
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.book_stock;
  avail integer;
  o public.book_orders;
begin
  select * into s from public.book_stock where id = p_product for update;
  if not found then raise exception 'unknown product %', p_product; end if;

  -- Going back to edit details releases the buyer's own earlier hold first.
  if p_replace_order is not null then
    update public.book_orders set status = 'cancelled'
    where id = p_replace_order and pay_token = p_replace_token and status = 'pending';
  end if;

  avail := private.book_available(p_product);
  if avail < p_quantity then
    raise exception 'sold_out:%', avail using errcode = 'P0001';
  end if;

  insert into public.book_orders (product_id, first_name, last_name, email, phone, address_line1, address_line2,
    city, postcode, quantity, unit_price, total_amount, hold_expires_at, marketing_consent)
  values (p_product, p_first_name, p_last_name, p_email, p_phone, p_line1, p_line2, p_city, p_postcode,
    p_quantity, s.unit_price, s.unit_price * p_quantity, now() + make_interval(mins => p_hold_minutes), p_marketing)
  returning * into o;
  return o;
end; $$;

create or replace function public.book_available(p_product text)
returns integer language sql stable security definer set search_path = ''
as $$ select private.book_available(p_product); $$;

create or replace function public.reserve_book_order(
  p_product text, p_quantity integer, p_hold_minutes integer,
  p_first_name text, p_last_name text, p_email text, p_phone text,
  p_line1 text, p_line2 text, p_city text, p_postcode text, p_marketing boolean,
  p_replace_order uuid default null, p_replace_token uuid default null
)
returns public.book_orders language sql security definer set search_path = ''
as $$ select private.reserve_book_order(p_product, p_quantity, p_hold_minutes, p_first_name, p_last_name, p_email, p_phone,
  p_line1, p_line2, p_city, p_postcode, p_marketing, p_replace_order, p_replace_token); $$;

revoke all on function private.book_available(text) from public, anon, authenticated;
grant execute on function private.book_available(text) to service_role;
revoke all on function private.reserve_book_order(text, integer, integer, text, text, text, text, text, text, text, text, boolean, uuid, uuid) from public, anon, authenticated;
grant execute on function private.reserve_book_order(text, integer, integer, text, text, text, text, text, text, text, text, boolean, uuid, uuid) to service_role;
revoke all on function public.book_available(text) from public, anon, authenticated;
grant execute on function public.book_available(text) to service_role;
revoke all on function public.reserve_book_order(text, integer, integer, text, text, text, text, text, text, text, text, boolean, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_book_order(text, integer, integer, text, text, text, text, text, text, text, text, boolean, uuid, uuid) to service_role;

-- Book emails (order confirmation, posted) are logged against the order.
alter table public.email_log add column book_order_id uuid references public.book_orders (id) on delete cascade;
alter table public.email_log drop constraint email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('sequence', 'campaign', 'manual', 'login', 'retreat', 'instalment', 'book'));
create index email_log_book_order_idx on public.email_log (book_order_id);
create unique index email_log_book_once on public.email_log (book_order_id, template)
  where kind = 'book' and status = 'sent';

alter table public.book_stock  enable row level security;
alter table public.book_orders enable row level security;
create policy "admin all" on public.book_stock  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin all" on public.book_orders for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
