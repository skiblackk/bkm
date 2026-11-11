/**
 * Attendance alerting — application side.
 *
 * The exclusion rules themselves live in SQL (public.bkm_attendance_alert_candidates)
 * so the cron job, the safety net and this module can never disagree about who is
 * expected at work. Everything here is read-only except the two explicit
 * "raise an alert" calls, which are idempotent at the database level.
 */
import { businessDate, minutesFromClock } from './business-clock';
import { createSupabaseAdminClient } from './supabase/admin';

export type ComplianceStatus = 'On time' | 'Late' | 'Not checked in by 9:30 AM' | 'On approved leave' | 'Not scheduled';

export type ComplianceRow = {
  staffId: string;
  name: string;
  role: string;
  status: ComplianceStatus;
  checkIn: string | null;
  checkOut: string | null;
  reportingDeadline: string;
  note: string | null;
  recordId: string | null;
  alerted: boolean;
};

export type ComplianceSummary = {
  date: string;
  reportingDeadline: string;
  expected: number;
  onTime: number;
  late: number;
  notCheckedIn: number;
  onLeave: number;
  notScheduled: number;
  compliancePercentage: number;
  /** False before the reporting deadline: an unfinished day is not a compliance failure. */
  deadlinePassed: boolean;
  rows: ComplianceRow[];
  alertsSent: number;
};

type CandidateRow = { profile_id: string; full_name: string; skip_reason: string | null };

function admin() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error('Attendance monitoring requires the Supabase service key.');
  return client;
}

/** Who is expected today, and why anyone is excluded. Single source of truth. */
export async function getAttendanceCandidates(date: string = businessDate()): Promise<CandidateRow[]> {
  const { data, error } = await admin().rpc('bkm_attendance_alert_candidates', { p_date: date });
  if (error) throw new Error(error.message);
  return (data ?? []) as CandidateRow[];
}

/**
 * Company-wide attendance compliance for a date.
 * Only employees the company expects to work are counted in the percentage.
 */
export async function getAttendanceCompliance(date: string = businessDate()): Promise<ComplianceSummary> {
  const client = admin();
  const [{ data: settingsRow }, candidates, { data: records }, { data: profiles }] = await Promise.all([
    client.from('attendance_settings').select('expected_check_in, grace_minutes, reporting_deadline, working_days').maybeSingle(),
    getAttendanceCandidates(date),
    client.from('attendance_records').select('id, staff_id, status, check_in, check_out, note').eq('attendance_date', date),
    client.from('profiles').select('id, full_name, roles(name)').eq('is_admin', false).eq('active', true),
  ]);

  const deadline = String(settingsRow?.reporting_deadline ?? '09:30:00').slice(0, 5);
  const expectedCheckIn = String(settingsRow?.expected_check_in ?? '08:00:00').slice(0, 5);
  const grace = Number(settingsRow?.grace_minutes ?? 0);
  const lateThreshold = expectedCheckIn ? minutesFromClock(expectedCheckIn) + grace : minutesFromClock(deadline);

  // Is the 09:30 deadline already behind us in Nairobi?
  const nowClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const deadlinePassed = date < businessDate() || minutesFromClock(nowClock) >= minutesFromClock(deadline);

  const recordByStaff = new Map<string, { id: string; status: string; check_in: string | null; check_out: string | null; note: string | null }>();
  for (const row of records ?? []) recordByStaff.set(String(row.staff_id), row as never);
  const roleByStaff = new Map<string, string>();
  for (const row of profiles ?? []) roleByStaff.set(String(row.id), ((row.roles as { name?: string } | null)?.name) ?? 'Team member');

  const skipByStaff = new Map<string, string>();
  for (const candidate of candidates) if (candidate.skip_reason) skipByStaff.set(candidate.profile_id, candidate.skip_reason);

  // Every active non-admin profile appears, so the register never silently drops someone.
  const allStaff = new Map<string, string>();
  for (const candidate of candidates) allStaff.set(candidate.profile_id, candidate.full_name);
  for (const row of profiles ?? []) if (!allStaff.has(String(row.id))) allStaff.set(String(row.id), String(row.full_name));

  const rows: ComplianceRow[] = [];
  for (const staffId of Array.from(allStaff.keys())) {
    const name = allStaff.get(staffId) ?? 'Employee';
    const record = recordByStaff.get(staffId);
    const skip = skipByStaff.get(staffId);
    const checkIn = record?.check_in ? String(record.check_in).slice(0, 5) : null;
    let status: ComplianceStatus;
    if (skip?.startsWith('approved_leave')) status = 'On approved leave';
    else if (skip) status = 'Not scheduled';
    else if (checkIn) status = minutesFromClock(checkIn) > lateThreshold ? 'Late' : 'On time';
    else status = 'Not checked in by 9:30 AM';
    rows.push({
      staffId,
      name,
      role: roleByStaff.get(staffId) ?? 'Team member',
      status,
      checkIn,
      checkOut: record?.check_out ? String(record.check_out).slice(0, 5) : null,
      reportingDeadline: deadline,
      note: skip ?? record?.note ?? null,
      recordId: record?.id ?? null,
      alerted: false,
    });
  }

  // Which of these people already have an alert recorded today.
  const { data: logs } = await client.from('attendance_alert_log').select('staff_id, alert_kind, status').eq('attendance_date', date);
  const alerted = new Set((logs ?? []).filter((row) => row.status === 'created').map((row) => String(row.staff_id)));
  for (const row of rows) row.alerted = alerted.has(row.staffId);

  rows.sort((a, b) => a.name.localeCompare(b.name));
  const onTime = rows.filter((row) => row.status === 'On time').length;
  const late = rows.filter((row) => row.status === 'Late').length;
  const notCheckedIn = rows.filter((row) => row.status === 'Not checked in by 9:30 AM').length;
  const onLeave = rows.filter((row) => row.status === 'On approved leave').length;
  const notScheduled = rows.filter((row) => row.status === 'Not scheduled').length;
  const expected = onTime + late + notCheckedIn;

  return {
    date,
    reportingDeadline: deadline,
    expected,
    onTime,
    late,
    notCheckedIn,
    onLeave,
    notScheduled,
    // Percentage of employees who were due in and actually turned up. Days with
    // nobody due (holiday, weekend, whole team on leave) read as 100%, not 0%.
    compliancePercentage: expected ? Math.round(((onTime + late) / expected) * 100) : 100,
    deadlinePassed,
    rows,
    alertsSent: (logs ?? []).filter((row) => row.status === 'created').length,
  };
}

/**
 * Raise the late-arrival alert for one check-in, if it is past the deadline.
 * Never throws: a notification problem must not affect attendance recording.
 */
export async function notifyLateArrival(staffId: string, date: string = businessDate()): Promise<{ created: boolean; reason?: string }> {
  try {
    const { data, error } = await admin().rpc('bkm_attendance_late_alert', { p_staff_id: staffId, p_date: date });
    if (error) return { created: false, reason: error.message };
    return { created: Boolean(data), reason: data ? undefined : 'not_late_or_already_alerted' };
  } catch (error) {
    console.error('attendance late alert failed', error instanceof Error ? error.message : error);
    return { created: false, reason: 'notification_failure' };
  }
}

/** Run the 09:30 sweep on demand (cron does this automatically). Idempotent. */
export async function runMissingCheckInSweep(date: string = businessDate()): Promise<{ created: number; skipped: number }> {
  const { data, error } = await admin().rpc('bkm_attendance_missing_check_in_sweep', { p_date: date });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { created: Number(row?.created ?? 0), skipped: Number(row?.skipped ?? 0) };
}

/** Alert history for the administrator's notification history view. */
export async function listAttendanceAlerts(date?: string) {
  const client = admin();
  let query = client.from('attendance_alert_log').select('id, alert_kind, staff_id, attendance_date, status, reason, notification_id, created_at').order('created_at', { ascending: false }).limit(200);
  if (date) query = query.eq('attendance_date', date);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    kind: String(row.alert_kind) as 'missing_check_in' | 'late_arrival',
    staffId: row.staff_id ? String(row.staff_id) : null,
    date: String(row.attendance_date),
    status: String(row.status) as 'created' | 'skipped' | 'failed',
    reason: row.reason ? String(row.reason) : null,
    notificationId: row.notification_id ? String(row.notification_id) : null,
    createdAt: String(row.created_at),
  }));
}
