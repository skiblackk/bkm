create extension if not exists pgcrypto;

create table if not exists public.roles (id uuid primary key default gen_random_uuid(), name text not null unique, description text not null, created_at timestamptz not null default now());
insert into public.roles (name, description) values
  ('System Administrator', 'Full BKM workspace administration and governance.'),
  ('Team Member', 'Access granted by the administrator for assigned work.')
on conflict (name) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  full_name text not null,
  email text not null unique,
  initials text not null,
  is_demo boolean not null default false,
  is_admin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists active boolean not null default true;

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (user_id, permission_key)
);

create table if not exists public.admin_transfers (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles(id),
  to_user_id uuid not null references public.profiles(id),
  transferred_at timestamptz not null default now(),
  reason text not null,
  check (from_user_id <> to_user_id)
);

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;
alter table public.admin_transfers enable row level security;

create or replace function public.current_user_is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and p.active and (p.is_admin or r.name in ('CEO', 'Administrator', 'System Administrator')));
$$;

create or replace function public.current_user_has_permission(permission_key text)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_is_admin() or exists (select 1 from public.user_permissions up join public.profiles p on p.id = up.user_id where up.user_id = auth.uid() and p.active and up.permission_key = current_user_has_permission.permission_key);
$$;

create or replace function public.bootstrap_first_admin(target_user_id uuid, target_full_name text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare result public.profiles;
begin
  if exists (select 1 from public.profiles) then raise exception 'The first administrator has already been established.'; end if;
  if target_user_id <> auth.uid() then raise exception 'The first administrator must establish their own account.'; end if;
  insert into public.profiles (id, role_id, full_name, email, initials, is_demo, is_admin, active)
  select u.id, r.id, target_full_name, coalesce(u.email, ''), upper(left(regexp_replace(target_full_name, '[^A-Za-z ]', '', 'g'), 1) || left(split_part(regexp_replace(target_full_name, '[^A-Za-z ]', '', 'g'), ' ', 2), 1)), false, true, true
  from auth.users u cross join public.roles r where u.id = target_user_id and r.name = 'System Administrator'
  returning * into result;
  if result.id is null then raise exception 'Authenticated Supabase user was not found or System Administrator role is unavailable.'; end if;
  return result;
end;
$$;

create or replace function public.transfer_administrator(target_user_id uuid, transfer_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare admin_role uuid; member_role uuid; old_admin uuid;
begin
  if not public.current_user_is_admin() then raise exception 'Administrator permission is required.'; end if;
  old_admin := auth.uid();
  if not exists (select 1 from public.profiles where id = target_user_id and active) then raise exception 'Target user must have an active profile.'; end if;
  select id into admin_role from public.roles where name = 'System Administrator';
  select id into member_role from public.roles where name = 'Team Member';
  insert into public.admin_transfers (from_user_id, to_user_id, reason) values (old_admin, target_user_id, transfer_reason);
  update public.profiles set is_admin = false, role_id = coalesce(member_role, role_id), updated_at = now() where id = old_admin;
  update public.profiles set is_admin = true, role_id = coalesce(admin_role, role_id), updated_at = now() where id = target_user_id;
end;
$$;

revoke all on function public.bootstrap_first_admin(uuid, text) from public;
grant execute on function public.bootstrap_first_admin(uuid, text) to authenticated;
revoke all on function public.transfer_administrator(uuid, text) from public;
grant execute on function public.transfer_administrator(uuid, text) to authenticated;

drop policy if exists "users can read own profile" on public.profiles;
drop policy if exists "administrators can manage profiles" on public.profiles;
create policy "users can read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.current_user_is_admin());
create policy "administrators can manage profiles" on public.profiles for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

drop policy if exists "users can read own permissions" on public.user_permissions;
drop policy if exists "administrators can manage permissions" on public.user_permissions;
create policy "users can read own permissions" on public.user_permissions for select to authenticated using (user_id = auth.uid() or public.current_user_is_admin());
create policy "administrators can manage permissions" on public.user_permissions for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

drop policy if exists "administrators can read admin transfers" on public.admin_transfers;
create policy "administrators can read admin transfers" on public.admin_transfers for select to authenticated using (public.current_user_is_admin() or from_user_id = auth.uid() or to_user_id = auth.uid());
