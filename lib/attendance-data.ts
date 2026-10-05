import type { AttendanceRecord } from './extended-types';
import { DEMO_DATE } from './demo-config';

export const attendanceSettings = { expectedCheckIn: '08:00', graceMinutes: 15, workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] };

export const attendanceSeed: AttendanceRecord[] = [
  { id: 'att-001', staffId: 'staff-david', date: DEMO_DATE, status: 'Present', checkIn: '07:52', checkOut: null, note: null, durationMinutes: null },
  { id: 'att-002', staffId: 'staff-mary', date: DEMO_DATE, status: 'Late', checkIn: '08:47', checkOut: null, note: 'Traffic delay', durationMinutes: null },
  { id: 'att-003', staffId: 'staff-brian', date: DEMO_DATE, status: 'Not Checked In', checkIn: null, checkOut: null, note: null, durationMinutes: null },
  { id: 'att-004', staffId: 'staff-faith', date: DEMO_DATE, status: 'Remote Work', checkIn: '08:04', checkOut: null, note: 'Approved remote work', durationMinutes: null },
  { id: 'att-005', staffId: 'staff-joseph', date: DEMO_DATE, status: 'Approved Leave', checkIn: null, checkOut: null, note: 'Approved leave', durationMinutes: null },
  { id: 'att-006', staffId: 'staff-david', date: '2026-09-30', status: 'Present', checkIn: '07:58', checkOut: '17:12', note: null, durationMinutes: 554 },
  { id: 'att-007', staffId: 'staff-mary', date: '2026-09-30', status: 'Late', checkIn: '08:32', checkOut: '17:05', note: null, durationMinutes: 513 },
  { id: 'att-008', staffId: 'staff-brian', date: '2026-09-30', status: 'Present', checkIn: '08:05', checkOut: null, note: null, durationMinutes: null },
  { id: 'att-009', staffId: 'staff-faith', date: '2026-09-30', status: 'Present', checkIn: '07:55', checkOut: '17:00', note: null, durationMinutes: 545 },
  { id: 'att-010', staffId: 'staff-joseph', date: '2026-09-30', status: 'Present', checkIn: '08:02', checkOut: '16:48', note: null, durationMinutes: 526 },
];
