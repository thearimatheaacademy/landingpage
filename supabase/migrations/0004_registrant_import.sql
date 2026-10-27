-- Imported registrants: where they came from, and whether delay-based automations (welcome, payment reminders) skip them.
alter table public.registrants
  add column source text not null default 'form' check (source in ('form', 'import', 'manual')),
  add column skip_auto_emails boolean not null default false;
