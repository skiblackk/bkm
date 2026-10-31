create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  permission_key text not null,
  granted_by uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, permission_key)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_name text not null,
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id text,
  detail text not null,
  severity text not null default 'info' check (severity in ('info','security','change')),
  created_at timestamptz not null default now()
);
create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events (actor_id);
create index if not exists audit_events_action_idx on public.audit_events (action);

alter table public.user_permissions enable row level security;
alter table public.audit_events enable row level security;
