-- Move is_admin() out of the exposed API schema and citext out of public (Supabase security advisors).
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.is_admin() set schema private;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;
alter extension citext set schema extensions;
