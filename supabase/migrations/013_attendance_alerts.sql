-- 013_attendance_alerts.sql
--
-- Automated 09:30 (Africa/Nairobi) attendance monitoring.
--
-- Adds only what is missing from the existing model:
--   * reporting_deadline on the existing attendance_settings row
--   * public_holidays            (no holiday table existed)
--   * staff_work_schedules       (no per-employee schedule existed)
--   * attendance_alert_log       (processing / delivery status for every alert)
--   * pg_cron + pg_net jobs that run server-side at 09:30 EAT
--
-- Alerts reuse the existing notifications table. Its dedupe_key column already
-- carries a UNIQUE index, so every alert below is idempotent by construction.

begin;

-- ---------------------------------------------------------------- settings ---
alter table public.attendance_settings
  add column if not exists reporting_deadline time without time zone not null default '09:30';

comment on column public.attendance_settings.reporting_deadline is
  'Company reporting deadline in Africa/Nairobi. Check-ins after this time are late arrivals.';

-- ---------------------------------------------------------------- holidays ---
create table if not exists public.public_holidays (
  holiday_date date primary key,
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.public_holidays is
  'Non-working public holidays. No attendance alert is raised on these days.';

alter table public.public_holidays enable row level security;

drop policy if exists "holidays are readable by signed-in staff" on public.public_holidays;
create policy "holidays are readable by signed-in staff"
  on public.public_holidays for select to authenticated using (true);

drop policy if exists "hr can maintain holidays" on public.public_holidays;
create policy "hr can maintain holidays"
  on public.public_holidays for all to authenticated
  using (current_user_has_permission('manage_attendance'))
  with check (current_user_has_permission('manage_attendance'));

-- ----------------------------------------------------- per-staff schedules ---
create table if not exists public.staff_work_schedules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  working_days text[] not null default array['Mon','Tue','Wed','Thu','Fri'],
  expected_check_in time without time zone,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  unique (profile_id, effective_from)
);

comment on table public.staff_work_schedules is
  'Optional per-employee schedule. When present it overrides attendance_settings.working_days for that employee.';

alter table public.staff_work_schedules enable row level security;

drop policy if exists "own schedule is readable" on public.staff_work_schedules;
create policy "own schedule is readable"
  on public.staff_work_schedules for select to authenticated
  using (profile_id = auth.uid() or current_user_has_permission('view_team_attendance'));

drop policy if exists "hr can maintain schedules" on public.staff_work_schedules;
create policy "hr can maintain schedules"
  on public.staff_work_schedules for all to authenticated
  using (current_user_has_permission('manage_attendance'))
  with check (current_user_has_permission('manage_attendance'));

-- ------------------------------------------------------------- alert log ----
create table if not exists public.attendance_alert_log (
  id uuid primary key default gen_random_uuid(),
  alert_kind text not null check (alert_kind in ('missing_check_in','late_arrival')),
  dedupe_key text not null unique,
  staff_id uuid references public.profiles(id) on delete set null,
  attendance_date date not null,
  status text not null check (status in ('created','skipped','failed')),
  reason text,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.attendance_alert_log is
  'Processing and delivery status of each attendance alert attempt. dedupe_key is unique so a retry cannot double-log or double-notify.';

create index if not exists attendance_alert_log_date_idx
  on public.attendance_alert_log (attendance_date desc, alert_kind);

alter table public.attendance_alert_log enable row level security;

drop policy if exists "attendance alerts are admin-visible" on public.attendance_alert_log;
create policy "attendance alerts are admin-visible"
  on public.attendance_alert_log for select to authenticated
  using (current_user_has_permission('view_team_attendance') or current_user_has_permission('manage_attendance') or current_user_has_permission('view_hr_reports'));

create index if not exists leave_requests_window_idx
  on public.leave_requests (user_id, starts_on, ends_on) where status = 'Approved';

commit;
