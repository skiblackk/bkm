-- Atomic signup provisioning for real Supabase authentication.
-- The first signup becomes the administrator. Every later signup is pending
-- until an administrator explicitly approves the profile.

alter table public.profiles add column if not exists approval_status text not null default 'pending';
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid references public.profiles(id);
alter table public.profiles drop constraint if exists profiles_approval_status_check;
alter table public.profiles add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));
alter table public.roles add column if not exists is_active boolean not null default true;
alter table public.roles add column if not exists is_system_role boolean not null default false;
alter table public.user_permissions add column if not exists effect text not null default 'allow';
alter table public.user_permissions add column if not exists reason text;
alter table public.user_permissions add column if not exists starts_at timestamptz;
alter table public.user_permissions add column if not exists expires_at timestamptz;

-- The earlier trigger could create a profile before the API had selected a role.
-- Signup is now provisioned by the service-role API through the locked function
-- below, so the trigger must not create duplicate profiles.
drop trigger if exists on_auth_user_created_bkm on auth.users;
drop function if exists public.provision_bkm_profile_on_signup();

create or replace function public.provision_bkm_signup_profile(
  target_user_id uuid,
  target_full_name text,
  target_email text,
  target_role_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  is_first boolean;
  selected_role uuid;
  normalized_name text;
  generated_initials text;
begin
  -- Serialise the first-admin decision so two simultaneous signups cannot both
  -- observe an empty administrator set and claim ownership.
  perform pg_advisory_xact_lock(hashtext('bkm-first-user-bootstrap'));
  is_first := not exists (select 1 from public.profiles where is_admin = true);

  if is_first then
    select id into selected_role from public.roles where name = 'System Administrator' limit 1;
  else
    selected_role := target_role_id;
  end if;
  if selected_role is null then
    raise exception 'BKM role configuration is incomplete.';
  end if;

  normalized_name := regexp_replace(coalesce(nullif(trim(target_full_name), ''), 'BKM User'), '[^A-Za-z ]', '', 'g');
  generated_initials := upper(left(coalesce(nullif(trim(normalized_name), ''), 'BU'), 1) || left(split_part(coalesce(nullif(trim(normalized_name), ''), 'BU'), ' ', 2), 1));

  insert into public.profiles (
    id, role_id, full_name, email, initials, is_demo, is_admin, active,
    approval_status, approved_at
  ) values (
    target_user_id, selected_role, coalesce(nullif(trim(target_full_name), ''), 'BKM User'), lower(trim(target_email)),
    generated_initials, false, is_first, true,
    case when is_first then 'approved' else 'pending' end,
    case when is_first then now() else null end
  );

  if not is_first then
    insert into public.user_permissions (user_id, permission_key)
    values (target_user_id, 'view_dashboard'), (target_user_id, 'use_assistant'), (target_user_id, 'send_messages')
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'profile_id', target_user_id,
    'is_first', is_first,
    'approval_status', case when is_first then 'approved' else 'pending' end
  );
end;
$function$;

revoke all on function public.provision_bkm_signup_profile(uuid, text, text, uuid) from public;
grant execute on function public.provision_bkm_signup_profile(uuid, text, text, uuid) to service_role;
