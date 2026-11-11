/**
 * Ten-scenario acceptance test for the 09:30 attendance alerts.
 * Runs against the real Supabase database using real functions and real rows.
 * Everything it creates is deleted at the end.
 */
const https = require('https');
// Credentials come from the environment; nothing secret is committed.
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { try { return require('/tmp/sb-keys.json').service_role; } catch { return ''; } })();
const AZ = process.env.SUPABASE_ACCESS_TOKEN || '';
if (!AZ || !SERVICE) {
  console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_SERVICE_ROLE_KEY before running this test.');
  process.exit(1);
}

function sql(query) {
  return new Promise((resolve, reject) => {
    const r = https.request('https://api.supabase.com/v1/projects/pdtcciudkolyegaianaa/database/query',
      { method: 'POST', headers: { Authorization: `Bearer ${AZ}`, 'Content-Type': 'application/json' } },
      (x) => { let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { resolve(JSON.parse(d || '[]')); } catch (e) { reject(new Error(d)); } }); });
    r.on('error', reject); r.write(JSON.stringify({ query })); r.end();
  });
}
const one = async (q) => (await sql(q))[0] ?? {};
let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  // Real employees already in the system (never mocks): reuse the two profiles.
  const staff = await sql(`select id, full_name, email from profiles where is_admin = false and active order by created_at limit 1`);
  if (!staff.length) { console.log('No active employee profile to test with.'); process.exit(1); }
  const emp = staff[0];

  // A clean, definitely-a-working-day date in the past that we control.
  const D = '2027-03-02'; // Tuesday
  await sql(`delete from notifications where dedupe_key like 'attendance:%:${emp.id}:${D}';
             delete from attendance_alert_log where attendance_date = '${D}' and staff_id = '${emp.id}';
             delete from attendance_records where attendance_date = '${D}' and staff_id = '${emp.id}';`);

  const deadline = (await one(`select reporting_deadline from attendance_settings`)).reporting_deadline;
  console.log(`Employee: ${emp.full_name} <${emp.email}> · deadline ${deadline} · date ${D}\n`);

  // ---- 1. 09:00 check-in -> no late alert
  await sql(`insert into attendance_records (staff_id, attendance_date, status, check_in) values ('${emp.id}','${D}','Present','09:00')`);
  const r1 = await one(`select public.bkm_attendance_late_alert('${emp.id}','${D}') as n`);
  check('1. 09:00 check-in produces no late alert', r1.n === null);
  check('1b. no late notification row exists', (await one(`select count(*) c from notifications where dedupe_key='attendance:late:${emp.id}:${D}'`)).c === 0);

  // ---- 2. exactly 09:30 -> on time (deadline inclusive)
  await sql(`update attendance_records set check_in='09:30' where staff_id='${emp.id}' and attendance_date='${D}'`);
  const r2 = await one(`select public.bkm_attendance_late_alert('${emp.id}','${D}') as n`);
  check('2. 09:30 check-in is on time', r2.n === null);
  const row2 = await one(`select public.bkm_attendance_missing_check_in_sweep('${D}') as s`);
  check('2b. employee with a check-in is not swept as missing', Number((await one(`select count(*) c from notifications where dedupe_key='attendance:missing:${emp.id}:${D}'`)).c) === 0);

  // ---- 3. 09:45 -> immediate late alert
  await sql(`update attendance_records set check_in='09:45', status='Late' where staff_id='${emp.id}' and attendance_date='${D}'`);
  const r3 = await one(`select public.bkm_attendance_late_alert('${emp.id}','${D}') as n`);
  const n3 = await one(`select title, body, link_path, category, priority from notifications where dedupe_key='attendance:late:${emp.id}:${D}'`);
  check('3. 09:45 check-in raises a late alert', r3.n !== null);
  check('3b. alert names the employee, time and deadline',
    /checked in at 09:45/.test(n3.body || '') && /09:30/.test(n3.body || '') && (n3.body || '').includes(emp.full_name), n3.body);
  check('3c. alert deep-links to the attendance record', (n3.link_path || '').includes('/admin/people') && (n3.link_path || '').includes(emp.id), n3.link_path);

  // ---- 4. no check-in at 09:30 -> missing alert
  await sql(`delete from attendance_records where staff_id='${emp.id}' and attendance_date='${D}';
             delete from notifications where dedupe_key like 'attendance:%:${emp.id}:${D}';
             delete from attendance_alert_log where attendance_date='${D}' and staff_id='${emp.id}';`);
  await one(`select public.bkm_attendance_missing_check_in_sweep('${D}') as s`);
  const n4 = await one(`select title, body, priority from notifications where dedupe_key='attendance:missing:${emp.id}:${D}'`);
  check('4. missing check-in raises an alert', Boolean(n4.title));
  check('4b. labelled "Not checked in by 09:30"', /Not checked in by 09:30/i.test(n4.title || '') || /Not checked in by 09:30/i.test(n4.body || ''), n4.title);
  check('4c. employee is NOT marked absent', (await one(`select count(*) c from attendance_records where staff_id='${emp.id}' and attendance_date='${D}'`)).c === 0);

  // ---- 5. checks in at 10:00 after the missing alert -> late alert too
  await sql(`insert into attendance_records (staff_id, attendance_date, status, check_in) values ('${emp.id}','${D}','Late','10:00')`);
  const r5 = await one(`select public.bkm_attendance_late_alert('${emp.id}','${D}') as n`);
  check('5. late check-in after a missing alert raises a second, distinct alert', r5.n !== null);
  check('5b. both alerts coexist (not a duplicate)', (await one(`select count(*) c from notifications where dedupe_key like 'attendance:%:${emp.id}:${D}'`)).c === 2);
  check('5c. attendance status updated to Late', (await one(`select status from attendance_records where staff_id='${emp.id}' and attendance_date='${D}'`)).status === 'Late');

  // ---- 6. approved leave -> no missing alert
  const D6 = '2027-03-03';
  await sql(`delete from notifications where dedupe_key like 'attendance:%:${emp.id}:${D6}';
             delete from attendance_alert_log where attendance_date='${D6}' and staff_id='${emp.id}';
             delete from attendance_records where attendance_date='${D6}' and staff_id='${emp.id}';
             insert into leave_requests (user_id, leave_type, starts_on, ends_on, status) values ('${emp.id}','Annual','${D6}','${D6}','Approved');`);
  await one(`select public.bkm_attendance_missing_check_in_sweep('${D6}') as s`);
  check('6. approved leave produces no missing alert', (await one(`select count(*) c from notifications where dedupe_key='attendance:missing:${emp.id}:${D6}'`)).c === 0);
  check('6b. the skip is recorded with a reason', (await one(`select reason from attendance_alert_log where dedupe_key='attendance:missing:${emp.id}:${D6}'`)).reason === 'approved_leave');
  await sql(`delete from leave_requests where user_id='${emp.id}' and starts_on='${D6}'`);

  // ---- 7. job runs twice -> no duplicates
  const before = (await one(`select count(*) c from notifications where dedupe_key like 'attendance:%:${emp.id}:${D}'`)).c;
  await one(`select public.bkm_attendance_missing_check_in_sweep('${D}') as s`);
  await one(`select public.bkm_attendance_missing_check_in_sweep('${D}') as s`);
  const after = (await one(`select count(*) c from notifications where dedupe_key like 'attendance:%:${emp.id}:${D}'`)).c;
  check('7. running the sweep twice creates no duplicates', before === after, `${before} -> ${after}`);

  // ---- 8. cron runs without any user session
  const jobs = await sql(`select jobname, schedule, active from cron.job order by jobid`);
  check('8. cron jobs exist and are active', jobs.length === 2 && jobs.every((j) => j.active), jobs.map((j) => `${j.jobname}@${j.schedule}`).join(', '));
  check('8b. primary job fires 09:30 Africa/Nairobi', jobs.some((j) => j.schedule === '30 6 * * 1-5'));
  const tz = await one(`select (now() at time zone 'Africa/Nairobi')::time as nairobi_time`);
  check('8c. database can resolve Africa/Nairobi correctly', Boolean(tz.nairobi_time), String(tz.nairobi_time));

  // ---- exceptions: holiday, weekend, inactive, schedule
  const D9 = '2027-03-04';
  await sql(`delete from notifications where dedupe_key like 'attendance:%:${emp.id}:${D9}';
             delete from attendance_alert_log where attendance_date='${D9}' and staff_id='${emp.id}';
             insert into public_holidays (holiday_date, name) values ('${D9}','Test Holiday') on conflict do nothing;`);
  await one(`select public.bkm_attendance_missing_check_in_sweep('${D9}') as s`);
  check('9. public holiday produces no alert', (await one(`select count(*) c from notifications where dedupe_key='attendance:missing:${emp.id}:${D9}'`)).c === 0);
  await sql(`delete from public_holidays where holiday_date='${D9}'`);

  const D10 = '2027-03-06'; // Saturday
  await sql(`delete from attendance_alert_log where attendance_date='${D10}' and staff_id='${emp.id}'`);
  await one(`select public.bkm_attendance_missing_check_in_sweep('${D10}') as s`);
  check('10. weekend produces no alert', (await one(`select count(*) c from notifications where dedupe_key='attendance:missing:${emp.id}:${D10}'`)).c === 0);

  const D11 = '2027-03-08';
  await sql(`delete from attendance_alert_log where attendance_date='${D11}' and staff_id='${emp.id}';
             insert into staff_work_schedules (profile_id, effective_from, working_days, is_active)
             values ('${emp.id}','${D11}', array['Tue'], true) on conflict (profile_id, effective_from) do nothing;`);
  await one(`select public.bkm_attendance_missing_check_in_sweep('${D11}') as s`);
  check('11. per-employee schedule excluded (Mon shift, not working)',
    (await one(`select reason from attendance_alert_log where dedupe_key='attendance:missing:${emp.id}:${D11}'`)).reason === 'personal_schedule_not_working');
  await sql(`delete from staff_work_schedules where profile_id='${emp.id}' and effective_from='${D11}'`);

  await sql(`update profiles set active=false where id='${emp.id}'`);
  const D12 = '2027-03-09';
  await sql(`delete from attendance_alert_log where attendance_date='${D12}' and staff_id='${emp.id}'`);
  await one(`select public.bkm_attendance_missing_check_in_sweep('${D12}') as s`);
  const inactive = await one(`select count(*) c from notifications where dedupe_key='attendance:missing:${emp.id}:${D12}'`);
  await sql(`update profiles set active=true where id='${emp.id}'`);
  check('12. inactive employee produces no alert', inactive.c === 0);

  // approval idempotency: retry of the late alert must not duplicate
  const dup = await one(`select public.bkm_attendance_late_alert('${emp.id}','${D}') as n`);
  check('13. retrying the late alert returns null (idempotent)', dup.n === null);
  check('14. first alert still delivered exactly once', (await one(`select count(*) c from notifications where dedupe_key='attendance:late:${emp.id}:${D}'`)).c === 1);
  check('15. delivery status recorded in the alert log', (await one(`select status from attendance_alert_log where dedupe_key='attendance:late:${emp.id}:${D}'`)).status === 'created');

  // ---- cleanup
  const cleanup = await sql(`delete from notifications where dedupe_key like 'attendance:%:${emp.id}:%';
    delete from attendance_alert_log where staff_id='${emp.id}';
    delete from attendance_records where staff_id='${emp.id}';
    delete from staff_work_schedules where profile_id='${emp.id}';
    delete from public_holidays where name='Test Holiday';
    delete from leave_requests where user_id='${emp.id}';`);
  const residue = await one(`select
    (select count(*) from notifications) notif,
    (select count(*) from attendance_alert_log) alog,
    (select count(*) from attendance_records) arec,
    (select count(*) from leave_requests) leave_rows`);
  console.log('\nresidue after cleanup:', JSON.stringify(residue));
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
