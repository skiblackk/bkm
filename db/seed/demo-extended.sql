INSERT IGNORE INTO attendance_settings (id, expected_check_in, grace_minutes, working_days_json) VALUES ('attendance-settings-demo', '08:00:00', 15, '["Mon","Tue","Wed","Thu","Fri"]');
INSERT IGNORE INTO attendance_records (id, staff_id, attendance_date, status, check_in, check_out, note, duration_minutes) VALUES
('att-001','staff-david','2026-10-01','Present','07:52:00',NULL,NULL,NULL),
('att-002','staff-mary','2026-10-01','Late','08:47:00',NULL,'Traffic delay',NULL),
('att-003','staff-brian','2026-10-01','Not Checked In',NULL,NULL,NULL,NULL),
('att-004','staff-faith','2026-10-01','Remote Work','08:04:00',NULL,'Approved remote work',NULL),
('att-005','staff-joseph','2026-10-01','Approved Leave',NULL,NULL,'Approved leave',NULL);
INSERT IGNORE INTO accounting_accounts (id, code, name, account_type) VALUES
('acct-cash','1000','Cash and bank','Asset'),('acct-receivable','1100','Trade receivables','Asset'),('acct-equipment','1500','Office equipment','Asset'),('acct-payable','2000','Trade payables','Liability'),('acct-capital','3000','Partner capital','Equity'),('acct-revenue','4000','Professional fees','Revenue'),('acct-rent','5100','Office rent','Expense'),('acct-payroll','5200','Staff costs','Expense');
INSERT IGNORE INTO accounting_periods (id, name, starts_on, ends_on, status) VALUES ('period-2026-09','September 2026','2026-09-01','2026-09-30','Open');
INSERT IGNORE INTO notifications (id, category, priority, title, body, link_path) VALUES ('notif-attendance-demo','Attendance','High','Staff attendance alert','Brian Otieno has not checked in today.','/admin');
