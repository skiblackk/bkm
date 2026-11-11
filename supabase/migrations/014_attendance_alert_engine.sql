-- 014_attendance_alert_engine.sql
--
-- Server-side attendance alert engine.
--
-- The exclusion rules (leave, holidays, working days, per-employee schedules,
-- schedule changes, inactive staff) are expressed exactly once, in
-- bkm_attendance_alert_candidates(), so the SQL cron job, the safety-net job
-- and the application all agree on who is expected to work.
--
-- Notifications are written with `on conflict (dedupe_key) do nothing`. The
-- unique index on notifications.dedupe_key is the real duplicate guard, so a
-- retried or overlapping cron run cannot produce a second alert.

begin;

-- ------------------------------------------------- whitelist configuration ---
create table if not exists public.attendance_alert_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.attendance_alert_admins is
  'Administrators who receive automated attendance alerts. Falls back to every profile.is_admin row when empty.';

alter table public.attendance_alert_admins enable row level security;
-- no policies: only the definer functions below read this table

-- ------------------------------------------------------- settings accessor ---
create or replace function public.bkm_attendance_settings()
returns table (reporting_deadline time, working_days text[], expected_check_in time)
language sql stable security definer set search_path = public as $$
  select coalesce(s.reporting_deadline, '09:30'::time),
         coalesce(
           (select array_agg(value) from jsonb_array_elements_text(coalesce(s.working_days, '[]'::jsonb)) as value),
           array['Mon','Tue','Wed','Thu','Fri']
         ),
         coalesce(s.expected_check_in, '08:00'::time)
  from (select 1) as anchor
  left join lateral (select * from public.attendance_settings limit 1) s on true;
$$;

-- ------------------------------------------------------------- recipients ---
create or replace function public.bkm_attendance_alert_recipients()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select a.profile_id
  from public.attendance_alert_admins a
  join public.profiles p on p.id = a.profile_id
  where p.active and coalesce(p.approval_status, 'approved') = 'approved'
  union
  select p.id
  from public.profiles p
  where p.is_admin
    and p.active
    and coalesce(p.approval_status, 'approved') = 'approved'
    and not exists (select 1 from public.attendance_alert_admins);
$$;

-- ------------------------------------------------- candidate / exclusion ---
/**
 * Employees expected to work on p_date (Africa/Nairobi) who have not checked in.
 * `skip_reason` is non-null when the employee qualifies for an exclusion.
 */
create or replace function public.bkm_attendance_alert_candidates(p_date date)
returns table (profile_id uuid, full_name text, skip_reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_settings record;
  v_dow text;
begin
  select * into v_settings from public.bkm_attendance_settings();
  v_dow := to_char(p_date, 'Dy');

  return query
  with holiday as (
    select exists (select 1 from public.public_holidays h where h.holiday_date = p_date) as is_holiday,
           (select h.name from public.public_holidays h where h.holiday_date = p_date limit 1) as name
  ),
  staff as (
    select p.id, p.full_name
    from public.profiles p
    where coalesce(p.active, true)
      and coalesce(p.approval_status, 'approved') = 'approved'
      and p.is_admin = false
  ),
  sched as (
    select distinct on (s.profile_id) s.profile_id, s.working_days, s.is_active
    from public.staff_work_schedules s
    where s.effective_from <= p_date
      and (s.effective_to is null or s.effective_to >= p_date)
    order by s.profile_id, s.effective_from desc
  ),
  leave as (
    select distinct l.user_id
    from public.leave_requests l
    where l.status = 'Approved'
      and p_date between l.starts_on and l.ends_on
  ),
  change as (
    select distinct r.requested_by
    from public.approval_requests r
    where r.request_type in ('schedule_change', 'roster_change', 'working_pattern_change')
      and r.status = 'Approved'
      and (r.payload->>'date')::date = p_date
      and coalesce((r.payload->>'working')::boolean, true) = false
  )
  select s.id,
         s.full_name,
         case
           when (select is_holiday from holiday) then 'public_holiday: ' || coalesce((select name from holiday), 'non-working day')
           when s.id in (select user_id from leave) then 'approved_leave'
           when s.id in (select requested_by from change) then 'approved_schedule_change'
           when exists (select 1 from sched sc where sc.profile_id = s.id and sc.is_active = false) then 'personal_schedule_inactive'
           when exists (select 1 from sched sc where sc.profile_id = s.id and sc.is_active = true and not (v_dow = any(sc.working_days))) then 'personal_schedule_not_working'
           when not (v_dow = any(v_settings.working_days)) then 'non_working_day: ' || v_dow
           else null
         end as skip_reason
  from staff s
  where not exists (
    select 1 from public.attendance_records ar
    where ar.staff_id = s.id and ar.attendance_date = p_date and ar.check_in is not null
  );
end;
$$;

-- --------------------------------------------------------- the 09:30 sweep ---
/**
 * Raises "Not checked in by 09:30" for every expected employee without a check-in.
 * Safe to call any number of times: dedupe_key is unique.
 */
create or replace function public.bkm_attendance_missing_check_in_sweep(p_date date default null)
returns table (created int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Africa/Nairobi')::date);
  v_key text;
  v_notif uuid;
  v_created int := 0;
  v_skipped int := 0;
  r record;
begin
  for r in select * from public.bkm_attendance_alert_candidates(v_date) loop
    if r.skip_reason is null then
      v_key := 'attendance:missing:' || r.profile_id || ':' || v_date;
      insert into public.notifications (recipient_id, category, priority, title, body, link_path, related_type, related_id, dedupe_key)
      select admin_id, 'Attendance', 'High',
             'Not checked in by 09:30 AM',
             r.full_name || ' had not checked in by the 09:30 AM reporting deadline on ' ||
               to_char(v_date, 'DD Mon YYYY') || '. Status: Not checked in by 09:30 AM.',
             '/admin/people?date=' || to_char(v_date, 'YYYY-MM-DD') || '&staff=' || r.profile_id,
             'attendance', r.profile_id, v_key
      from public.bkm_attendance_alert_recipients() as admin_id
      on conflict (dedupe_key) do nothing
      returning id into v_notif;

      if v_notif is not null then
        v_created := v_created + 1;
        insert into public.attendance_alert_log (alert_kind, dedupe_key, staff_id, attendance_date, status, reason, notification_id)
        values ('missing_check_in', v_key, r.profile_id, v_date, 'created', null, v_notif)
        on conflict (dedupe_key) do nothing;
        v_notif := null;
      else
        v_skipped := v_skipped + 1;
        insert into public.attendance_alert_log (alert_kind, dedupe_key, staff_id, attendance_date, status, reason)
        values ('missing_check_in', v_key, r.profile_id, v_date, 'skipped', 'already_alerted')
        on conflict (dedupe_key) do nothing;
      end if;
    else
      v_key := 'attendance:missing:' || r.profile_id || ':' || v_date;
      insert into public.attendance_alert_log (alert_kind, dedupe_key, staff_id, attendance_date, status, reason)
      values ('missing_check_in', v_key, r.profile_id, v_date, 'skipped', r.skip_reason)
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
  return query select v_created, v_skipped;
end;
$$;

-- ------------------------------------------------------- late check-in alert --
/**
 * Raises the late-arrival alert for one attendance record, once per employee per
 * day. Returns the notification id, or null when nothing was created.
 */
create or replace function public.bkm_attendance_late_alert(p_staff_id uuid, p_date date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_notif uuid;
  v_name text;
  v_check_in time;
  v_deadline time;
begin
  select * into v_deadline from (select reporting_deadline from public.bkm_attendance_settings()) s;
  select p.full_name into v_name from public.profiles p where p.id = p_staff_id;
  select ar.check_in into v_check_in from public.attendance_records ar
   where ar.staff_id = p_staff_id and ar.attendance_date = p_date;
  if v_check_in is null or v_check_in <= v_deadline then
    return null;
  end if;

  v_key := 'attendance:late:' || p_staff_id || ':' || p_date;
  insert into public.notifications (recipient_id, category, priority, title, body, link_path, related_type, related_id, dedupe_key)
  select admin_id, 'Attendance', 'High',
         'Late arrival: ' || coalesce(v_name, 'Employee'),
         coalesce(v_name, 'Employee') || ' checked in at ' || to_char(v_check_in, 'HH24:MI') ||
           ', after the ' || to_char(v_deadline, 'HH24:MI') || ' reporting deadline on ' ||
           to_char(p_date, 'DD Mon YYYY') || '.',
         '/admin/people?date=' || to_char(p_date, 'YYYY-MM-DD') || '&staff=' || p_staff_id,
         'attendance', p_staff_id, v_key
  from public.bkm_attendance_alert_recipients() as admin_id
  on conflict (dedupe_key) do nothing
  returning id into v_notif;

  insert into public.attendance_alert_log (alert_kind, dedupe_key, staff_id, attendance_date, status, reason, notification_id)
  values ('late_arrival', v_key, p_staff_id, p_date,
          case when v_notif is null then 'skipped' else 'created' end,
          case when v_notif is null then 'already_alerted' else null end, v_notif)
  on conflict (dedupe_key) do nothing;

  return v_notif;
end;
$$;

-- --------------------------------------------- safety net: late + catch-up ---
/**
 * Runs every few minutes. Catches late check-ins recorded through any path and
 * performs the 09:30 sweep if the primary job was missed (paused project, etc).
 */
create or replace function public.bkm_attendance_alerts_tick()
returns table (late_created int, sweep_created int)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamp := now() at time zone 'Africa/Nairobi';
  v_date date := v_now::date;
  v_deadline time;
  v_created int := 0;
  v_sweep int := 0;
  v_ignored int;
  r record;
begin
  select reporting_deadline into v_deadline from public.bkm_attendance_settings();

  for r in
    select ar.staff_id, ar.attendance_date
    from public.attendance_records ar
    where ar.attendance_date = v_date
      and ar.check_in is not null
      and ar.check_in > v_deadline
      and not exists (
        select 1 from public.notifications n
        where n.dedupe_key = 'attendance:late:' || ar.staff_id || ':' || ar.attendance_date
      )
  loop
    if public.bkm_attendance_late_alert(r.staff_id, r.attendance_date) is not null then
      v_created := v_created + 1;
    end if;
  end loop;

  -- catch-up only: after the deadline, and only if the primary sweep never ran
  if v_now::time >= v_deadline
     and not exists (select 1 from public.attendance_alert_log l where l.attendance_date = v_date and l.alert_kind = 'missing_check_in')
  then
    select created, skipped into v_sweep, v_ignored from public.bkm_attendance_missing_check_in_sweep(v_date);
  end if;

  return query select v_created, coalesce(v_sweep, 0);
end;
$$;

revoke all on function public.bkm_attendance_missing_check_in_sweep(date) from public, anon, authenticated;
revoke all on function public.bkm_attendance_late_alert(uuid, date) from public, anon, authenticated;
revoke all on function public.bkm_attendance_alerts_tick() from public, anon, authenticated;

-- --------------------------------------------------------------- schedule ----
select cron.schedule(
  'bkm-attendance-0930-eat',
  '30 6 * * 1-5',              -- 06:30 UTC == 09:30 Africa/Nairobi, Mon-Fri
  $$select public.bkm_attendance_missing_check_in_sweep()$$
);

select cron.schedule(
  'bkm-attendance-late-safety-net',
  '*/5 * * * *',               -- every 5 minutes, idempotent
  $$select public.bkm_attendance_alerts_tick()$$
);

commit;
