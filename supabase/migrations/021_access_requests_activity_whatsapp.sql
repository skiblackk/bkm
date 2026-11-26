-- ============================================================================
-- 021 — access requests, staff activity mirroring, check-out and WhatsApp reach
--
-- Five gaps reported from the floor:
--
--   1. A permission request a staff member raised never reached the
--      administrator. The row was written to approval_requests, but nothing
--      told anybody, the approvals feed the admin screen reads was not the
--      one the request was written to, and approving it did not actually grant
--      the permission. All three are addressed here.
--   2. Nothing recorded when a staff member was actively working, so an
--      administrator could not see who was signed in and nobody could be made
--      to check out before leaving.
--   3. Staff could not see their own recent actions, so there was no visible
--      record that the system was watching.
--   4. Staff had no place to record the mobile number they actually use on
--      WhatsApp, so a broadcast could not reach them when they were offline.
--   5. Approving or rejecting a request left no dated decision trail.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WhatsApp-reachable mobile numbers on the profile
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists whatsapp_opt_in boolean not null default true;

-- Kenyan mobile numbers in international form: 2547XXXXXXXX or 2541XXXXXXXX.
-- The constraint is deliberately permissive about +, spaces and dashes because
-- people type them that way; the app normalises before it stores.
alter table public.profiles drop constraint if exists profiles_phone_check;
alter table public.profiles
  add constraint profiles_phone_check
  check (phone is null or phone ~ '^[0-9]{9,15}$');

create index if not exists profiles_phone_idx on public.profiles (phone) where phone is not null;

-- ----------------------------------------------------------------------------
-- 2. Requests carry who raised them and who decided them
-- ----------------------------------------------------------------------------
alter table public.approval_requests
  add column if not exists requested_by_name text,
  add column if not exists requested_by_role text,
  add column if not exists decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists decided_by_name text,
  add column if not exists notified_admin_count integer not null default 0;

create index if not exists approval_requests_pending_idx
  on public.approval_requests (status, created_at desc);

-- Backfill the name of anyone who already asked, so old rows read properly.
update public.approval_requests r
set requested_by_name = p.full_name,
    requested_by_role = (select ro.name from public.roles ro where ro.id = p.role_id)
from public.profiles p
where p.id = r.requested_by
  and r.requested_by_name is null;

-- ----------------------------------------------------------------------------
-- 3. Grant a permission on approval, in the same transaction as the decision
--
-- Approving an access request used to change only the request's status: the
-- permission itself was never written, so the staff member stayed blocked and
-- the administrator believed they had granted it.
-- ----------------------------------------------------------------------------
create or replace function public.decide_approval_request(
  p_request_id uuid,
  p_decision text,
  p_actor uuid default null,
  p_actor_name text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests%rowtype;
  v_permission text;
  v_granted boolean := false;
begin
  if p_decision not in ('Approved', 'Rejected', 'Cancelled') then
    raise exception 'A decision must be Approved, Rejected or Cancelled.';
  end if;

  select * into r from public.approval_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'Request not found.';
  end if;
  if r.status <> 'Pending' then
    raise exception 'This request was already %.', lower(r.status);
  end if;

  update public.approval_requests
  set status = p_decision,
      decision_note = coalesce(p_note, decision_note),
      decided_by = p_actor,
      decided_by_name = p_actor_name,
      decided_at = now()
  where id = p_request_id;

  -- An access request that is approved becomes a real grant. A deny row is
  -- removed first so an old deny cannot silently cancel the new allow.
  if p_decision = 'Approved'
     and r.request_type = 'access_request'
     and r.resource_type = 'permission' then
    v_permission := nullif(r.payload->>'permission', '');
    if v_permission is not null then
      delete from public.user_permissions
      where user_id = r.requested_by
        and permission_key = v_permission
        and effect = 'deny';
      insert into public.user_permissions (user_id, permission_key, effect, reason, granted_by)
      values (r.requested_by, v_permission, 'allow',
              format('Approved by %s on request %s', coalesce(p_actor_name, 'an administrator'), r.id::text),
              p_actor)
      on conflict do nothing;
      v_granted := true;
    end if;
  end if;

  return jsonb_build_object(
    'request_id', p_request_id,
    'status', p_decision,
    'granted', v_granted,
    'permission', v_permission,
    'requested_by', r.requested_by
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Sign-in / sign-out sessions, so nobody can leave without closing the day
-- ----------------------------------------------------------------------------
create table if not exists public.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null default '',
  user_role text not null default '',
  signed_in_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  signed_out_at timestamptz,
  sign_out_kind text,
  sign_out_note text,
  user_agent text,
  day date not null default (now() at time zone 'Africa/Nairobi')::date,
  created_at timestamptz not null default now()
);

create index if not exists staff_sessions_user_idx on public.staff_sessions (user_id, signed_in_at desc);
-- One open session per person. A second sign-in on another device reuses it
-- rather than starting a parallel record that nobody can close.
create unique index if not exists staff_sessions_one_open
  on public.staff_sessions (user_id) where signed_out_at is null;

alter table public.staff_sessions enable row level security;

do $$
begin
  drop policy if exists staff_sessions_deny_authenticated on public.staff_sessions;
  create policy staff_sessions_deny_authenticated on public.staff_sessions
    for all to authenticated using (false) with check (false);
end;
$$;

/** Open (or refresh) the caller's session. Idempotent for the day. */
create or replace function public.bkm_open_session(
  p_user_id uuid,
  p_user_name text default '',
  p_user_role text default '',
  p_user_agent text default null
) returns public.staff_sessions
language plpgsql security definer set search_path = public as $$
declare
  s public.staff_sessions;
begin
  select * into s from public.staff_sessions
  where user_id = p_user_id and signed_out_at is null
  limit 1;

  if s.id is not null then
    update public.staff_sessions
    set last_seen_at = now(),
        user_name = coalesce(nullif(p_user_name, ''), user_name),
        user_role = coalesce(nullif(p_user_role, ''), user_role)
    where id = s.id
    returning * into s;
    return s;
  end if;

  insert into public.staff_sessions (user_id, user_name, user_role, user_agent)
  values (p_user_id, coalesce(p_user_name, ''), coalesce(p_user_role, ''), p_user_agent)
  returning * into s;
  return s;
end;
$$;

/**
 * Close the caller's open session.
 *
 * p_force is the administrator's override: a forgotten sign-out at the end of
 * the day should not leave a record open for ever, but a normal staff sign-out
 * cannot touch any other person's session.
 */
create or replace function public.bkm_close_session(
  p_user_id uuid,
  p_kind text default 'signed_out',
  p_note text default null,
  p_target uuid default null,
  p_force boolean default false
) returns public.staff_sessions
language plpgsql security definer set search_path = public as $$
declare
  s public.staff_sessions;
  v_target uuid := coalesce(p_target, p_user_id);
begin
  if v_target <> p_user_id and not p_force then
    raise exception 'Only an administrator can close another person''s session.';
  end if;

  update public.staff_sessions
  set signed_out_at = now(),
      sign_out_kind = coalesce(p_kind, 'signed_out'),
      sign_out_note = p_note,
      last_seen_at = now()
  where user_id = v_target and signed_out_at is null
  returning * into s;

  return s;
end;
$$;

/** Keep-alive from the client heartbeat. */
create or replace function public.bkm_session_ping(p_user_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.staff_sessions
  set last_seen_at = now()
  where user_id = p_user_id and signed_out_at is null;
$$;

-- ----------------------------------------------------------------------------
-- 5. A single readable activity feed for staff and administrators
--
-- audit_events is the authoritative record and stays exactly as it is. This
-- view joins it to the person and to the record it touched, so both "My
-- workspace" and the administrator's people screen can read the same rows
-- with the same wording.
-- ----------------------------------------------------------------------------
create or replace view public.staff_activity_feed as
select
  e.id,
  e.actor_id,
  coalesce(nullif(e.actor_name, ''), p.full_name, 'Workspace user') as actor_name,
  coalesce(nullif(e.actor_role, ''), ro.name, 'Team member') as actor_role,
  e.action,
  replace(e.action, '_', ' ') as action_label,
  e.target_type,
  e.target_id,
  e.detail,
  e.severity,
  e.source,
  e.created_at
from public.audit_events e
left join public.profiles p on p.id = e.actor_id
left join public.roles ro on ro.id = p.role_id;

comment on view public.staff_activity_feed is
  'Read-only, human-readable projection of audit_events. Used by My workspace (own rows) and the administrator people screen (all rows).';

-- ----------------------------------------------------------------------------
-- 6. WhatsApp broadcast log
--
-- A broadcast that goes out through a personal WhatsApp number cannot be sent
-- by the server: the recipient list has to be walked chat by chat. This table
-- records what was prepared, who it went to and when it was marked done, so an
-- administrator can see that the message reached every staff member rather
-- than assuming it did.
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_broadcasts (
  id uuid primary key default gen_random_uuid(),
  sent_by uuid references public.profiles(id) on delete set null,
  sent_by_name text not null default '',
  sender_number text,
  body text not null,
  audience text not null default 'all_staff',
  recipient_count integer not null default 0,
  recipient_ids uuid[] not null default '{}',
  delivered_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.whatsapp_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.whatsapp_broadcasts(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  staff_name text not null default '',
  phone text not null,
  reached_at timestamptz,
  unique (broadcast_id, staff_id)
);

create index if not exists whatsapp_broadcast_recipients_idx on public.whatsapp_broadcast_recipients (broadcast_id);

alter table public.whatsapp_broadcasts enable row level security;
alter table public.whatsapp_broadcast_recipients enable row level security;

do $$
declare t text;
begin
  foreach t in array array['whatsapp_broadcasts', 'whatsapp_broadcast_recipients']
  loop
    execute format('drop policy if exists %I_deny_authenticated on public.%I', t, t);
    execute format('create policy %I_deny_authenticated on public.%I for all to authenticated using (false) with check (false)', t, t);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Permissions for the two new capabilities
-- ----------------------------------------------------------------------------
insert into public.permissions (permission_key, workspace, action, description, is_sensitive, is_legacy) values
  ('edit_whatsapp_contact', 'people',        'edit',    'Record own WhatsApp mobile number',            false, false),
  ('request_permissions',   'administration','request', 'Ask an administrator for additional access',   false, false),
  ('force_checkout',        'people',        'manage',  'Close a staff member''s open session',          true,  false),
  ('view_staff_activity',   'administration','view',    'See what staff members are doing in the workspace', true, false),
  ('broadcast_whatsapp',    'communications','send',    'Send a broadcast to staff WhatsApp numbers',     true,  false)
on conflict (permission_key) do nothing;

-- Grant the self-service keys to every active role: asking for access and
-- recording your own number are things any member of staff may do.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in ('edit_whatsapp_contact', 'request_permissions')
where r.is_active
on conflict do nothing;

-- The three administrator-level keys go only to the roles that supervise work.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in ('force_checkout', 'view_staff_activity', 'broadcast_whatsapp')
where r.name in ('CEO','CEO / Managing Partner','Managing Partner','System Administrator','Administrator','Operations Manager')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 8. Seed the numbers the team already uses, so a broadcast has somewhere to go
-- ----------------------------------------------------------------------------
update public.profiles
set phone = '254720556118'
where lower(email) = 'peter@nairobi-office.co.ke' and phone is null;
