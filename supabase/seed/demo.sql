insert into public.roles (id, name, description) values
('00000000-0000-0000-0000-000000000001', 'Audit Manager', 'Can manage engagements, assign tasks and review work.'),
('00000000-0000-0000-0000-000000000002', 'Senior Auditor', 'Can manage assigned audit work and review tasks.'),
('00000000-0000-0000-0000-000000000003', 'Auditor', 'Can complete assigned engagement tasks.'),
('00000000-0000-0000-0000-000000000004', 'Audit Associate', 'Can support evidence collection and task completion.'),
('00000000-0000-0000-0000-000000000005', 'Tax Consultant', 'Can manage assigned tax and advisory work.')
on conflict (id) do nothing;

-- Demo profiles are intentionally not inserted here because Supabase Auth owns auth.users.
-- Create matching fictional Auth users first, then insert public.profiles with their UUIDs.

insert into public.clients (id, name, industry, status, location, description, document_count, outstanding_requests) values
('10000000-0000-0000-0000-000000000001', 'ABC Holdings Ltd', 'Real Estate & Construction', 'Active', 'Nairobi', 'A fictional property development and investment group used to demonstrate a multi-workstream statutory audit.', 24, 3),
('10000000-0000-0000-0000-000000000002', 'Nairobi Health Partners', 'Healthcare', 'Active', 'Nairobi', 'A fictional outpatient healthcare network with a year-end financial reporting and advisory engagement.', 18, 1),
('10000000-0000-0000-0000-000000000003', 'Green Valley SACCO', 'SACCO / Cooperative', 'Active', 'Kiambu', 'A fictional cooperative society used to demonstrate outstanding evidence requests and review status.', 12, 4),
('10000000-0000-0000-0000-000000000004', 'Eastland Logistics Ltd', 'Transport & Logistics', 'Active', 'Mombasa', 'A fictional transport and logistics operator with a focused statutory audit engagement.', 19, 0),
('10000000-0000-0000-0000-000000000005', 'Summit Properties Ltd', 'Real Estate & Construction', 'On hold', 'Nakuru', 'A fictional property company used to demonstrate a paused tax compliance workstream.', 7, 2)
on conflict (id) do nothing;

insert into public.engagements (id, client_id, name, service_type, period_label, status, deadline, progress, document_count, outstanding_documents, review_note) values
('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026 Statutory Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', '2026-10-15', 68, 24, 3, 'Manager review scheduled after evidence completion.'),
('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '2026 Financial Reporting Advisory', 'Financial Advisory', 'FY 2026', 'Under Review', '2026-10-08', 81, 18, 1, 'Draft schedules are awaiting senior review.'),
('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '2026 Cooperative Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', '2026-10-11', 54, 12, 4, 'Evidence request list has four open items.'),
('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', '2026 Statutory Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', '2026-10-18', 72, 19, 0, 'Awaiting manager review of final analytical procedures.'),
('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', '2026 Tax Compliance Review', 'Tax Consultation & Compliance', 'FY 2026', 'Planning', '2026-10-28', 23, 7, 2, 'Engagement is paused pending client confirmation.')
on conflict (id) do nothing;
