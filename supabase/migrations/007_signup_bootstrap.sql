-- Automatic signup governance for real Supabase authentication.
-- The transaction lock makes the first-user decision deterministic even when signups race.
create or replace function public.provision_bkm_profile_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_profile boolean;
  selected_role uuid;
  display_name text;
  normalized_name text;
  generated_initials text;
begin
  perform pg_advisory_xact_lock(hashtext('bkm-first-user-bootstrap'));

  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  first_profile := not exists (select 1 from public.profiles limit 1);
  select id into selected_role
  from public.roles
  where name = case when first_profile then 'System Administrator' else 'Team Member' end
  limit 1;

  if selected_role is null then
    raise exception 'BKM role configuration is incomplete.';
  end if;

  display_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''), 'BKM User');
  normalized_name := regexp_replace(display_name, '[^A-Za-z ]', '', 'g');
  generated_initials := upper(left(coalesce(nullif(trim(normalized_name), ''), 'BU'), 1) || left(split_part(coalesce(nullif(trim(normalized_name), ''), 'BU'), ' ', 2), 1));

  insert into public.profiles (id, role_id, full_name, email, initials, is_demo, is_admin, active)
  values (
    new.id,
    selected_role,
    display_name,
    coalesce(new.email, ''),
    generated_initials,
    false,
    first_profile,
    first_profile
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_bkm on auth.users;
create trigger on_auth_user_created_bkm
after insert on auth.users
for each row execute function public.provision_bkm_profile_on_signup();

revoke all on function public.provision_bkm_profile_on_signup() from public;
