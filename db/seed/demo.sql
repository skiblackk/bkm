INSERT IGNORE INTO roles (id, name, description) VALUES
('role-manager', 'Audit Manager', 'Can manage engagements, assign tasks and review work.'),
('role-senior', 'Senior Auditor', 'Can manage assigned audit work and review tasks.'),
('role-auditor', 'Auditor', 'Can complete assigned engagement tasks.'),
('role-associate', 'Audit Associate', 'Can support evidence collection and task completion.'),
('role-tax', 'Tax Consultant', 'Can manage assigned tax and advisory work.');

INSERT IGNORE INTO profiles (id, role_id, full_name, email, initials, is_demo) VALUES
('staff-david', 'role-manager', 'David Kamau', 'david.kamau@demo.bkm', 'DK', TRUE),
('staff-mary', 'role-senior', 'Mary Wanjiku', 'mary.wanjiku@demo.bkm', 'MW', TRUE),
('staff-brian', 'role-auditor', 'Brian Otieno', 'brian.otieno@demo.bkm', 'BO', TRUE),
('staff-faith', 'role-associate', 'Faith Njeri', 'faith.njeri@demo.bkm', 'FN', TRUE),
('staff-joseph', 'role-tax', 'Joseph Mwangi', 'joseph.mwangi@demo.bkm', 'JM', TRUE);

INSERT IGNORE INTO clients (id, name, industry, status, location, description, primary_manager_id, document_count, outstanding_requests) VALUES
('client-abc', 'ABC Holdings Ltd', 'Real Estate & Construction', 'Active', 'Nairobi', 'A fictional property development and investment group used to demonstrate a multi-workstream statutory audit.', 'staff-david', 24, 3),
('client-health', 'Nairobi Health Partners', 'Healthcare', 'Active', 'Nairobi', 'A fictional outpatient healthcare network with a year-end financial reporting and advisory engagement.', 'staff-mary', 18, 1),
('client-green', 'Green Valley SACCO', 'SACCO / Cooperative', 'Active', 'Kiambu', 'A fictional cooperative society used to demonstrate outstanding evidence requests and review status.', 'staff-david', 12, 4),
('client-east', 'Eastland Logistics Ltd', 'Transport & Logistics', 'Active', 'Mombasa', 'A fictional transport and logistics operator with a focused statutory audit engagement.', 'staff-mary', 19, 0),
('client-summit', 'Summit Properties Ltd', 'Real Estate & Construction', 'On hold', 'Nakuru', 'A fictional property company used to demonstrate a paused tax compliance workstream.', 'staff-joseph', 7, 2);

INSERT IGNORE INTO client_contacts (id, client_id, full_name, email, phone, is_primary) VALUES
('contact-abc', 'client-abc', 'Lilian Kiplagat', 'lilian.kiplagat@abc-demo.co.ke', '+254 700 000 201', TRUE),
('contact-health', 'client-health', 'Dr. Peter Maina', 'peter.maina@health-demo.co.ke', '+254 700 000 202', TRUE),
('contact-green', 'client-green', 'Samuel Njuguna', 'samuel.njuguna@green-demo.co.ke', '+254 700 000 203', TRUE),
('contact-east', 'client-east', 'Grace Atieno', 'grace.atieno@east-demo.co.ke', '+254 700 000 204', TRUE),
('contact-summit', 'client-summit', 'Alex Wekesa', 'alex.wekesa@summit-demo.co.ke', '+254 700 000 205', TRUE);

INSERT IGNORE INTO engagements (id, client_id, name, service_type, period_label, status, manager_id, deadline, progress, document_count, outstanding_documents, review_note) VALUES
('eng-abc', 'client-abc', '2026 Statutory Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', 'staff-david', '2026-10-15', 68, 24, 3, 'Manager review scheduled after evidence completion.'),
('eng-health', 'client-health', '2026 Financial Reporting Advisory', 'Financial Advisory', 'FY 2026', 'Under Review', 'staff-mary', '2026-10-08', 81, 18, 1, 'Draft schedules are awaiting senior review.'),
('eng-green', 'client-green', '2026 Cooperative Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', 'staff-david', '2026-10-11', 54, 12, 4, 'Evidence request list has four open items.'),
('eng-east', 'client-east', '2026 Statutory Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', 'staff-mary', '2026-10-18', 72, 19, 0, 'Awaiting manager review of final analytical procedures.'),
('eng-summit', 'client-summit', '2026 Tax Compliance Review', 'Tax Consultation & Compliance', 'FY 2026', 'Planning', 'staff-joseph', '2026-10-28', 23, 7, 2, 'Engagement is paused pending client confirmation.');

INSERT IGNORE INTO engagement_members (engagement_id, profile_id) VALUES
('eng-abc', 'staff-mary'), ('eng-abc', 'staff-brian'), ('eng-abc', 'staff-faith'),
('eng-health', 'staff-faith'), ('eng-health', 'staff-joseph'),
('eng-green', 'staff-brian'), ('eng-green', 'staff-faith'),
('eng-east', 'staff-brian'), ('eng-summit', 'staff-faith');

INSERT IGNORE INTO tasks (id, engagement_id, title, description, assigned_to, priority, due_date, status) VALUES
('task-001', 'eng-abc', 'Obtain signed bank confirmations', 'Request and file confirmations for all operating and reserve accounts.', 'staff-brian', 'High', '2026-09-28', 'Blocked'),
('task-002', 'eng-abc', 'Review property valuation schedules', 'Tie valuation schedules to the fixed asset register and supporting reports.', 'staff-mary', 'High', '2026-10-03', 'In Progress'),
('task-003', 'eng-abc', 'Complete revenue cut-off testing', 'Select samples around year-end and document the cut-off conclusion.', 'staff-faith', 'Medium', '2026-10-06', 'Under Review'),
('task-004', 'eng-abc', 'Prepare management letter points', 'Summarize control observations for manager review.', 'staff-mary', 'Medium', '2026-10-10', 'Not Started'),
('task-005', 'eng-abc', 'Finalize audit completion checklist', 'Close out required sign-offs and completion documentation.', 'staff-david', 'Critical', '2026-10-14', 'Not Started'),
('task-006', 'eng-health', 'Reconcile patient receivables', 'Reconcile the aged receivables listing to the reporting pack.', 'staff-faith', 'Medium', '2026-09-27', 'Completed'),
('task-007', 'eng-health', 'Validate cash flow assumptions', 'Review the assumptions supporting the rolling cash flow model.', 'staff-joseph', 'High', '2026-10-04', 'Submitted'),
('task-008', 'eng-health', 'Review draft reporting pack', 'Complete senior review notes for the draft financial reporting pack.', 'staff-mary', 'High', '2026-10-05', 'Under Review'),
('task-009', 'eng-health', 'Document governance observations', 'Capture governance observations and suggested actions.', 'staff-joseph', 'Low', '2026-10-09', 'Not Started'),
('task-010', 'eng-green', 'Request SACCO loan portfolio listing', 'Follow up for the complete loan portfolio and aging analysis.', 'staff-brian', 'Critical', '2026-09-26', 'Blocked'),
('task-011', 'eng-green', 'Test member deposits', 'Perform sample testing over member deposit movements.', 'staff-faith', 'High', '2026-10-07', 'In Progress'),
('task-012', 'eng-green', 'Review liquidity disclosures', 'Tie liquidity disclosures to the supporting schedules.', 'staff-david', 'Medium', '2026-10-09', 'Not Started'),
('task-013', 'eng-green', 'Prepare SACCO review summary', 'Prepare the first draft of the manager review summary.', 'staff-david', 'High', '2026-10-10', 'Not Started'),
('task-014', 'eng-east', 'Complete fleet additions testing', 'Inspect additions and agree samples to supplier documentation.', 'staff-brian', 'Medium', '2026-10-02', 'Completed'),
('task-015', 'eng-east', 'Run analytical review', 'Document final analytical review procedures and exceptions.', 'staff-mary', 'High', '2026-10-08', 'Submitted'),
('task-016', 'eng-east', 'Manager review of Eastland file', 'Perform manager review and return clearance notes.', 'staff-mary', 'Critical', '2026-10-12', 'Not Started'),
('task-017', 'eng-summit', 'Confirm tax registration details', 'Confirm registration details before opening the compliance review.', 'staff-joseph', 'Medium', '2026-10-20', 'In Progress'),
('task-018', 'eng-summit', 'Issue outstanding information request', 'Prepare a concise request for the two remaining tax records.', 'staff-faith', 'Low', '2026-10-22', 'Not Started');

INSERT IGNORE INTO activity_logs (id, event_type, description, record_type, record_id, actor_id) VALUES
('activity-001', 'Document uploaded', 'Bank confirmation request uploaded to ABC Holdings Ltd', 'Document', 'doc-003', 'staff-mary'),
('activity-002', 'Status changed', 'Review status changed for Nairobi Health Partners', 'Engagement', 'eng-health', 'staff-mary'),
('activity-003', 'Task completed', 'Fleet additions testing completed', 'Task', 'task-014', 'staff-brian'),
('activity-004', 'Task assigned', 'Manager review assigned to Mary Wanjiku', 'Task', 'task-016', 'staff-david'),
('activity-005', 'Engagement created', '2026 Tax Compliance Review opened for Summit Properties Ltd', 'Engagement', 'eng-summit', 'staff-joseph'),
('activity-006', 'Client created', 'Summit Properties Ltd added to the demonstration environment', 'Client', 'client-summit', 'staff-david');
