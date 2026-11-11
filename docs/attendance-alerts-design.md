# BKMOPS — Automated 09:30 attendance alerts: implementation plan

## What already exists (do not rebuild)

| Concern | Existing implementation | Decision |
|---|---|---|
| Attendance recording | `attendance_records` (unique `staff_id, attendance_date`), `updateAttendance` in `lib/supabase-repository.ts` | **extend** |
| Attendance policy | `attendance_settings` (row: `expected_check_in 08:00`, `grace_minutes 15`, `working_days`) | **reuse**, plus new `reporting_deadline 09:30` |
| Notifications | `notifications` table + `createNotification()` in `lib/private-messaging.ts`, `notification-center.tsx` (30 s poll, unread badge, deep link via `link_path`) | **reuse** |
| Leave | `leave_requests` (`user_id, starts_on, ends_on, status, leave_type`) | **reuse** |
| Holidays | *nothing exists* | **add** `public_holidays` |
| Per-employee schedule | *nothing exists* | **add** `staff_work_schedules` |
| Scheduling | *no scheduler at all*; `pg_cron` + `pg_net` available but not yet installed | **add** pg_cron + pg_net |

## Idempotency (the critical part)

`notifications.dedupe_key` already has a **UNIQUE** index (`notifications_dedupe_key_key`),
and `createNotification()` already short-circuits on it. Every alert therefore gets
a deterministic key written into that existing unique column:

- `attendance:missing:{profile_id}:{date}` — at most one per employee per day
- `attendance:late:{profile_id}:{date}` — at most one late alert per attendance event

The DB unique index is the guarantee; the `insert ... on conflict do nothing`
path makes a cron retry a no-op. Processing/delivery status lives in a new
`attendance_alert_log` table (attempted / created / skipped / failed, with reason),
so "notification creation, processing and delivery status" are all recorded.

## Scheduler

`pg_cron` job at `30 6 * * 1-5` (06:30 UTC = **09:30 Africa/Nairobi**, and the
DB clock stays UTC which is safe for cron). It calls a plpgsql function that
computes the missing-check-in set inside the database — pure SQL, no HTTP, no
secrets — and inserts notifications idempotently.

A second job runs every 5 minutes (`*/5 * * * *`) as a safety net: it catches
late check-ins and picks up the 09:30 sweep if the primary run was missed
(e.g. project paused). Both are idempotent, so overlap is harmless.

Nothing runs in the browser. No Vercel Cron is needed (and the Hobby plan
limits cron to once per day anyway) — pg_cron is strictly better here because
it also survives the app being down.

## Exceptions applied before any alert

Not scheduled (no alert) when: profile `active = false`; `approval_status`
not approved; today is not one of `attendance_settings.working_days`; today is
in `public_holidays`; an **approved** `leave_requests` row covers today; an
approved `schedule_change` in `approval_requests` covers today; or the employee
has a `staff_work_schedules` row that is inactive or says not working.

## Late detection

`updateAttendance('check-in')` already classifies Present/Late with
`attendanceStatusFor()`. After the record is written it now fires an immediate
alert when the status is `Late` **and** the check-in time is past the 09:30
reporting deadline. Notification send is wrapped so a notification failure can
never fail or roll back the attendance write (rule 9).

## Admin overview

`getAttendanceCompliance()` returns on-time / late / not-checked-in / on-leave /
compliance %, with the underlying records. Rendered on the People & attendance
admin tab and `/admin/people`, gated by `view_team_attendance` (already in the
catalogue and role templates) — no new permission keys, so no RLS changes.

## Test scenarios (10) — how each is proven

1. 09:00 check-in → no alert (log row `skipped: not_late`)
2. 09:30 check-in → on time (deadline is inclusive)
3. 09:45 check-in → immediate late alert
4. No check-in at 09:30 → missing alert
5. 10:00 check-in after missing alert → late alert, different key, not a duplicate
6. Approved leave → no missing alert
7. Sweep executed twice → still one notification (unique index)
8. Admin logged out → job writes rows anyway (cron is server-side)
Plus: holiday, inactive employee, weekend — no alerts.
