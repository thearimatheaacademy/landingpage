-- Admins can use the student portal too (to see what students see), without a fake "paid" registration.
-- Before: a student was only someone whose email matches a paid registrant.
create or replace function private.is_student()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.registrants r
    where r.status = 'paid'
      and (r.user_id = (select auth.uid()) or r.email = (select auth.jwt() ->> 'email')::extensions.citext)
  ) or exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;
