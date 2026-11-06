-- Repository runtime columns and the workspace internal-message feed.
-- Additive only: existing columns, policies and data are untouched.

alter table public.journal_entries
  add column if not exists status text not null default 'Posted',
  add column if not exists reversed_by text;

alter table public.clients
  add column if not exists services jsonb not null default '["Audit & Assurance"]'::jsonb,
  add column if not exists last_activity text not null default 'Just now';

alter table public.profiles
  add column if not exists color text not null default '#4e6982',
  add column if not exists availability integer not null default 100;

-- Tasks may be unassigned while work is being triaged.
alter table public.tasks alter column assigned_to drop not null;

alter table public.activity_logs
  add column if not exists actor_name text not null default 'BKM Operations Hub';

-- Activity record references carry application identifiers ('doc-003'), so
-- record_id must be text rather than uuid. audit_events.actor_id stays uuid
-- (it is a foreign key to profiles.id and is only ever written with real user ids).
alter table public.activity_logs alter column record_id type text using record_id::text;

create table if not exists public.internal_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null,
  sender_name text not null,
  recipient_id text not null,
  recipient_name text not null,
  body text not null,
  kind text not null default 'direct' check (kind in ('direct', 'broadcast', 'alert')),
  created_at timestamptz not null default now()
);

alter table public.internal_messages enable row level security;

drop policy if exists "authenticated users can read internal messages" on public.internal_messages;
create policy "authenticated users can read internal messages" on public.internal_messages
  for select to authenticated using (true);

drop policy if exists "authenticated users can send internal messages" on public.internal_messages;
create policy "authenticated users can send internal messages" on public.internal_messages
  for insert to authenticated with check (true);
