-- User approval workflow.
-- New sign-ups wait for an administrator. Accounts not reviewed within four
-- hours of sign-up are approved automatically at the next sign-in attempt.
-- The bootstrap administrator (the first account) is approved immediately.

alter table public.profiles add column if not exists approval_status text not null default 'pending';
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid references public.profiles(id);

alter table public.profiles drop constraint if exists profiles_approval_status_check;
alter table public.profiles add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));

-- Grandfather accounts that already exist so the rollout never locks anyone out.
update public.profiles set approval_status = 'approved', approved_at = now()
 where approval_status = 'pending';

-- The bootstrap administrator approves themselves by definition.
create or replace function public.bootstrap_first_admin(target_user_id uuid, target_full_name text)
 returns profiles
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare result public.profiles;
begin
  if exists (select 1 from public.profiles) then raise exception 'The first administrator has already been established.'; end if;
  if target_user_id <> auth.uid() then raise exception 'The first administrator must establish their own account.'; end if;
  insert into public.profiles (id, role_id, full_name, email, initials, is_demo, is_admin, active, approval_status, approved_at)
  select u.id, r.id, target_full_name, coalesce(u.email, ''), upper(left(regexp_replace(target_full_name, '[^A-Za-z ]', '', 'g'), 1) || left(split_part(regexp_replace(target_full_name, '[^A-Za-z ]', '', 'g'), ' ', 2), 1)), false, true, true, 'approved', now()
  from auth.users u cross join public.roles r where u.id = target_user_id and r.name = 'System Administrator'
  returning * into result;
  if result.id is null then raise exception 'Authenticated Supabase user was not found or System Administrator role is unavailable.'; end if;
  return result;
end;
$function$;
