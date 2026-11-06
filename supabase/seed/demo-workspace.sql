-- Generated seed: the canonical demonstration dataset mapped onto the Supabase schema.
-- Staff personas are Supabase Auth users (display identities); all other identifiers
-- are deterministic uuid5 values of the demonstration ids.

insert into public.roles (id, name, description) values
('02c736bb-0715-5e30-b329-fd4ca4ceb0fc', 'Audit Manager', 'Can manage engagements, assign tasks and review work.'),
('aa62a736-021c-5d01-b915-239294251262', 'Senior Auditor', 'Can manage assigned audit work and review tasks.'),
('b57a6882-0989-59b7-bcb0-69c18e6474b0', 'Auditor', 'Can complete assigned engagement tasks.'),
('faf814fc-5bcd-5434-81f7-47ae7e3b62d3', 'Audit Associate', 'Can support evidence collection and task completion.'),
('f96894a3-b0da-5ed5-99f8-40674294738c', 'Tax Consultant', 'Can manage assigned tax and advisory work.')
on conflict do nothing;

insert into public.profiles (id, role_id, full_name, email, initials, is_demo, is_admin, active, color, availability, created_at) values
('3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', '02c736bb-0715-5e30-b329-fd4ca4ceb0fc', 'David Kamau', 'david.kamau@demo.bkm', 'DK', true, false, true, '#165e56', 62, '2026-10-01T05:00:00Z'),
('1fb5b69a-d632-401f-ab83-85143118ad35', 'aa62a736-021c-5d01-b915-239294251262', 'Mary Wanjiku', 'mary.wanjiku@demo.bkm', 'MW', true, false, true, '#6c547f', 78, '2026-10-01T05:00:01Z'),
('3e872845-8d7c-484c-b74c-6c39cb8ddf95', 'b57a6882-0989-59b7-bcb0-69c18e6474b0', 'Brian Otieno', 'brian.otieno@demo.bkm', 'BO', true, false, true, '#a66b2d', 44, '2026-10-01T05:00:02Z'),
('3e15587e-7da0-4761-8d82-4d8971672550', 'faf814fc-5bcd-5434-81f7-47ae7e3b62d3', 'Faith Njeri', 'faith.njeri@demo.bkm', 'FN', true, false, true, '#4e6982', 86, '2026-10-01T05:00:03Z'),
('f13fb409-f2f9-4459-8116-9b0264ab9ac1', 'f96894a3-b0da-5ed5-99f8-40674294738c', 'Joseph Mwangi', 'joseph.mwangi@demo.bkm', 'JM', true, false, true, '#8a634e', 71, '2026-10-01T05:00:04Z')
on conflict do nothing;

insert into public.clients (id, name, industry, status, location, description, primary_manager_id, document_count, outstanding_requests, services, last_activity, created_at) values
('87eeb279-9094-5b92-b103-da847916f10c', 'ABC Holdings Ltd', 'Real Estate & Construction', 'Active', 'Nairobi', 'A fictional property development and investment group used to demonstrate a multi-workstream statutory audit.', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', 24, 3, '["Audit & Assurance", "Tax Consultation & Compliance"]', '2 hours ago', '2026-10-01T05:00:00Z'),
('2dd95a44-9dc8-51ec-882b-8a2c9acfa489', 'Nairobi Health Partners', 'Healthcare', 'Active', 'Nairobi', 'A fictional outpatient healthcare network with a year-end financial reporting and advisory engagement.', '1fb5b69a-d632-401f-ab83-85143118ad35', 18, 1, '["Accounting & Bookkeeping", "Financial Advisory"]', 'Yesterday', '2026-10-01T05:00:01Z'),
('139654a9-47a6-56e2-8546-9fc3b64b47e2', 'Green Valley SACCO', 'SACCO / Cooperative', 'Active', 'Kiambu', 'A fictional cooperative society used to demonstrate outstanding evidence requests and review status.', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', 12, 4, '["Audit & Assurance", "Financial Advisory"]', '3 days ago', '2026-10-01T05:00:02Z'),
('57f0bf8c-258b-55c3-bd7d-a9eef390385b', 'Eastland Logistics Ltd', 'Transport & Logistics', 'Active', 'Mombasa', 'A fictional transport and logistics operator with a focused statutory audit engagement.', '1fb5b69a-d632-401f-ab83-85143118ad35', 19, 0, '["Audit & Assurance", "Accounting & Bookkeeping"]', '4 days ago', '2026-10-01T05:00:03Z'),
('9f402230-0e78-5ac5-90f7-a51d91c63094', 'Summit Properties Ltd', 'Real Estate & Construction', 'On hold', 'Nakuru', 'A fictional property company used to demonstrate a paused tax compliance workstream.', 'f13fb409-f2f9-4459-8116-9b0264ab9ac1', 7, 2, '["Tax Consultation & Compliance"]', '18 Sep 2026', '2026-10-01T05:00:04Z')
on conflict do nothing;

insert into public.client_contacts (id, client_id, full_name, email, phone, is_primary) values
('9786a129-f548-549d-9ee7-b3227879d057', '87eeb279-9094-5b92-b103-da847916f10c', 'Lilian Kiplagat', 'lilian.kiplagat@abc-demo.co.ke', '+254 700 000 201', true),
('23187145-11d5-5e05-9c11-530fdd5b9490', '2dd95a44-9dc8-51ec-882b-8a2c9acfa489', 'Dr. Peter Maina', 'peter.maina@health-demo.co.ke', '+254 700 000 202', true),
('7ba41448-508f-59db-95f0-802c3bc17c5c', '139654a9-47a6-56e2-8546-9fc3b64b47e2', 'Samuel Njuguna', 'samuel.njuguna@green-demo.co.ke', '+254 700 000 203', true),
('4613dbb0-f6e4-5ff0-b407-5aacd175df2b', '57f0bf8c-258b-55c3-bd7d-a9eef390385b', 'Grace Atieno', 'grace.atieno@east-demo.co.ke', '+254 700 000 204', true),
('8f195200-e786-55d1-a5e2-0a99e16f866e', '9f402230-0e78-5ac5-90f7-a51d91c63094', 'Alex Wekesa', 'alex.wekesa@summit-demo.co.ke', '+254 700 000 205', true)
on conflict do nothing;

insert into public.engagements (id, client_id, name, service_type, period_label, status, manager_id, deadline, progress, document_count, outstanding_documents, review_note, created_at) values
('a58c3c36-9605-5820-ac27-6fb726e56c9a', '87eeb279-9094-5b92-b103-da847916f10c', '2026 Statutory Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', '2026-10-15', 68, 24, 3, 'Manager review scheduled after evidence completion.', '2026-10-01T05:00:00Z'),
('1928a2bb-1bdc-5d66-ab02-5ab44e724290', '2dd95a44-9dc8-51ec-882b-8a2c9acfa489', '2026 Financial Reporting Advisory', 'Financial Advisory', 'FY 2026', 'Under Review', '1fb5b69a-d632-401f-ab83-85143118ad35', '2026-10-08', 81, 18, 1, 'Draft schedules are awaiting senior review.', '2026-10-01T05:00:01Z'),
('53022efc-280b-55b2-862a-79dd8eac32f8', '139654a9-47a6-56e2-8546-9fc3b64b47e2', '2026 Cooperative Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', '2026-10-11', 54, 12, 4, 'Evidence request list has four open items.', '2026-10-01T05:00:02Z'),
('9fba9d91-bf5b-50cb-931c-937a18a56f3f', '57f0bf8c-258b-55c3-bd7d-a9eef390385b', '2026 Statutory Audit', 'Audit & Assurance', 'FY 2026', 'In Progress', '1fb5b69a-d632-401f-ab83-85143118ad35', '2026-10-18', 72, 19, 0, 'Awaiting manager review of final analytical procedures.', '2026-10-01T05:00:03Z'),
('a2d79f38-6a8c-5cc8-8446-b5132e9a06e5', '9f402230-0e78-5ac5-90f7-a51d91c63094', '2026 Tax Compliance Review', 'Tax Consultation & Compliance', 'FY 2026', 'Planning', 'f13fb409-f2f9-4459-8116-9b0264ab9ac1', '2026-10-28', 23, 7, 2, 'Engagement is paused pending client confirmation.', '2026-10-01T05:00:04Z')
on conflict do nothing;

insert into public.engagement_members (engagement_id, profile_id) values
('a58c3c36-9605-5820-ac27-6fb726e56c9a', '1fb5b69a-d632-401f-ab83-85143118ad35'),
('a58c3c36-9605-5820-ac27-6fb726e56c9a', '3e872845-8d7c-484c-b74c-6c39cb8ddf95'),
('a58c3c36-9605-5820-ac27-6fb726e56c9a', '3e15587e-7da0-4761-8d82-4d8971672550'),
('1928a2bb-1bdc-5d66-ab02-5ab44e724290', '3e15587e-7da0-4761-8d82-4d8971672550'),
('1928a2bb-1bdc-5d66-ab02-5ab44e724290', 'f13fb409-f2f9-4459-8116-9b0264ab9ac1'),
('53022efc-280b-55b2-862a-79dd8eac32f8', '3e872845-8d7c-484c-b74c-6c39cb8ddf95'),
('53022efc-280b-55b2-862a-79dd8eac32f8', '3e15587e-7da0-4761-8d82-4d8971672550'),
('9fba9d91-bf5b-50cb-931c-937a18a56f3f', '3e872845-8d7c-484c-b74c-6c39cb8ddf95'),
('a2d79f38-6a8c-5cc8-8446-b5132e9a06e5', '3e15587e-7da0-4761-8d82-4d8971672550')
on conflict do nothing;

insert into public.tasks (id, engagement_id, title, description, assigned_to, priority, due_date, status, created_at, updated_at) values
('af24b6c0-d2c5-545b-b5bd-17d07340abe5', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', 'Obtain signed bank confirmations', 'Request and file confirmations for all operating and reserve accounts.', '3e872845-8d7c-484c-b74c-6c39cb8ddf95', 'High', '2026-09-28', 'Blocked', '2026-10-01T05:00:00Z', '2026-09-30T17:00:00Z'),
('61d7ac14-27ac-5cc8-922f-80eed18ac433', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', 'Review property valuation schedules', 'Tie valuation schedules to the fixed asset register and supporting reports.', '1fb5b69a-d632-401f-ab83-85143118ad35', 'High', '2026-10-03', 'In Progress', '2026-10-01T05:00:01Z', '2026-10-01T17:00:00Z'),
('e6d03cc3-d8d7-5342-b4ba-1a5d9de6b247', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', 'Complete revenue cut-off testing', 'Select samples around year-end and document the cut-off conclusion.', '3e15587e-7da0-4761-8d82-4d8971672550', 'Medium', '2026-10-06', 'Under Review', '2026-10-01T05:00:02Z', '2026-09-30T17:00:00Z'),
('047102c6-79cd-561b-83cf-b2213f38e4cf', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', 'Prepare management letter points', 'Summarize control observations for manager review.', '1fb5b69a-d632-401f-ab83-85143118ad35', 'Medium', '2026-10-10', 'Not Started', '2026-10-01T05:00:03Z', '2026-09-29T17:00:00Z'),
('c4d674a8-36ab-5431-8ef8-1937f265c05c', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', 'Finalize audit completion checklist', 'Close out required sign-offs and completion documentation.', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', 'Critical', '2026-10-14', 'Not Started', '2026-10-01T05:00:04Z', '2026-09-28T17:00:00Z'),
('b5ebb76c-a1ee-5ec5-acef-741b932ecc20', '1928a2bb-1bdc-5d66-ab02-5ab44e724290', 'Reconcile patient receivables', 'Reconcile the aged receivables listing to the reporting pack.', '3e15587e-7da0-4761-8d82-4d8971672550', 'Medium', '2026-09-27', 'Completed', '2026-10-01T05:00:05Z', '2026-09-27T17:00:00Z'),
('85da34c5-d472-5074-8ca9-2ad6aba9a6e4', '1928a2bb-1bdc-5d66-ab02-5ab44e724290', 'Validate cash flow assumptions', 'Review the assumptions supporting the rolling cash flow model.', 'f13fb409-f2f9-4459-8116-9b0264ab9ac1', 'High', '2026-10-04', 'Submitted', '2026-10-01T05:00:06Z', '2026-09-30T17:00:00Z'),
('f4b62bf6-1158-5e21-98bf-55cf14e417f2', '1928a2bb-1bdc-5d66-ab02-5ab44e724290', 'Review draft reporting pack', 'Complete senior review notes for the draft financial reporting pack.', '1fb5b69a-d632-401f-ab83-85143118ad35', 'High', '2026-10-05', 'Under Review', '2026-10-01T05:00:07Z', '2026-10-01T17:00:00Z'),
('affcaf77-be55-556a-b4b1-12b0914aa08b', '1928a2bb-1bdc-5d66-ab02-5ab44e724290', 'Document governance observations', 'Capture governance observations and suggested actions.', 'f13fb409-f2f9-4459-8116-9b0264ab9ac1', 'Low', '2026-10-09', 'Not Started', '2026-10-01T05:00:08Z', '2026-09-29T17:00:00Z'),
('2a03936b-dc8b-592f-a9e8-1e355d1d30bb', '53022efc-280b-55b2-862a-79dd8eac32f8', 'Request SACCO loan portfolio listing', 'Follow up for the complete loan portfolio and aging analysis.', '3e872845-8d7c-484c-b74c-6c39cb8ddf95', 'Critical', '2026-09-26', 'Blocked', '2026-10-01T05:00:09Z', '2026-10-01T17:00:00Z'),
('800a8011-413d-5061-b049-d10582e91f90', '53022efc-280b-55b2-862a-79dd8eac32f8', 'Test member deposits', 'Perform sample testing over member deposit movements.', '3e15587e-7da0-4761-8d82-4d8971672550', 'High', '2026-10-07', 'In Progress', '2026-10-01T05:00:10Z', '2026-10-01T17:00:00Z'),
('7a0332f3-32d6-5b7e-a769-5e39da16b47e', '53022efc-280b-55b2-862a-79dd8eac32f8', 'Review liquidity disclosures', 'Tie liquidity disclosures to the supporting schedules.', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', 'Medium', '2026-10-09', 'Not Started', '2026-10-01T05:00:11Z', '2026-09-29T17:00:00Z'),
('45796db6-ae0b-548d-a4dd-28e66cc7a45e', '53022efc-280b-55b2-862a-79dd8eac32f8', 'Prepare SACCO review summary', 'Prepare the first draft of the manager review summary.', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', 'High', '2026-10-10', 'Not Started', '2026-10-01T05:00:12Z', '2026-09-28T17:00:00Z'),
('8d672001-ef65-5e4f-9201-2475a4bcc71e', '9fba9d91-bf5b-50cb-931c-937a18a56f3f', 'Complete fleet additions testing', 'Inspect additions and agree samples to supplier documentation.', '3e872845-8d7c-484c-b74c-6c39cb8ddf95', 'Medium', '2026-10-02', 'Completed', '2026-10-01T05:00:13Z', '2026-09-30T17:00:00Z'),
('5d5ccbb7-126e-5c29-82a8-d07a069ede37', '9fba9d91-bf5b-50cb-931c-937a18a56f3f', 'Run analytical review', 'Document final analytical review procedures and exceptions.', '1fb5b69a-d632-401f-ab83-85143118ad35', 'High', '2026-10-08', 'Submitted', '2026-10-01T05:00:14Z', '2026-09-30T17:00:00Z'),
('c587654f-ecb3-534b-a5b3-2b9fc945d838', '9fba9d91-bf5b-50cb-931c-937a18a56f3f', 'Manager review of Eastland file', 'Perform manager review and return clearance notes.', '1fb5b69a-d632-401f-ab83-85143118ad35', 'Critical', '2026-10-12', 'Not Started', '2026-10-01T05:00:15Z', '2026-09-29T17:00:00Z'),
('6bd4fdd0-d6c5-5963-9798-d0f5fb176f09', 'a2d79f38-6a8c-5cc8-8446-b5132e9a06e5', 'Confirm tax registration details', 'Confirm registration details before opening the compliance review.', 'f13fb409-f2f9-4459-8116-9b0264ab9ac1', 'Medium', '2026-10-20', 'In Progress', '2026-10-01T05:00:16Z', '2026-09-30T17:00:00Z'),
('7aeb09fd-48dd-5d14-905d-c9d72bc2d244', 'a2d79f38-6a8c-5cc8-8446-b5132e9a06e5', 'Issue outstanding information request', 'Prepare a concise request for the two remaining tax records.', '3e15587e-7da0-4761-8d82-4d8971672550', 'Low', '2026-10-22', 'Not Started', '2026-10-01T05:00:17Z', '2026-09-27T17:00:00Z')
on conflict do nothing;

insert into public.documents (id, client_id, engagement_id, name, document_type, status, uploaded_at) values
('5efef485-83e8-5be3-a5ed-4d10d654af04', '87eeb279-9094-5b92-b103-da847916f10c', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', '2026 Trial Balance.xlsx', 'Financial schedule', 'Received', '2026-09-29T09:30:00Z'),
('ff3dd9a6-637e-52dd-ba01-6b13c82a7045', '87eeb279-9094-5b92-b103-da847916f10c', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', 'Fixed Asset Register.xlsx', 'Working paper', 'Reviewed', '2026-09-28T09:30:00Z'),
('f7a682ed-2dc1-5793-b1b5-a2a83295654e', '87eeb279-9094-5b92-b103-da847916f10c', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', 'Bank Confirmation Request.pdf', 'Audit evidence', 'Requested', '2026-10-01T09:30:00Z'),
('78ba8771-5a0f-5455-ae49-5fdfaf7b9881', '2dd95a44-9dc8-51ec-882b-8a2c9acfa489', '1928a2bb-1bdc-5d66-ab02-5ab44e724290', 'Cash Flow Assumptions.docx', 'Advisory schedule', 'Received', '2026-09-30T09:30:00Z'),
('0f7af6ca-5036-5831-8ce6-e01fe54828ae', '139654a9-47a6-56e2-8546-9fc3b64b47e2', '53022efc-280b-55b2-862a-79dd8eac32f8', 'Member Deposits Listing.xlsx', 'Audit evidence', 'Requested', '2026-10-01T09:30:00Z'),
('e70a2b62-3371-5cea-b724-842b492f6355', '57f0bf8c-258b-55c3-bd7d-a9eef390385b', '9fba9d91-bf5b-50cb-931c-937a18a56f3f', 'Fleet Additions Register.xlsx', 'Audit evidence', 'Reviewed', '2026-09-30T09:30:00Z')
on conflict do nothing;

insert into public.quotations (id, client_id, service_type, description, terms, status, created_at) values
('9f6f7d79-d025-5272-8f07-7af22138ee6a', '9f402230-0e78-5ac5-90f7-a51d91c63094', 'Tax Consultation & Compliance', 'Demonstration quotation for a tax compliance review.', 'Valid for 30 days. This is fictional demonstration pricing.', 'Draft', '2026-10-01T11:00:00Z')
on conflict do nothing;

insert into public.quotation_items (id, quotation_id, description, quantity, unit_price) values
('6236a672-2703-5bb6-8231-f0dae4e7e832', '9f6f7d79-d025-5272-8f07-7af22138ee6a', 'Tax compliance review', 1, 95000)
on conflict do nothing;

insert into public.reports (id, client_id, engagement_id, report_type, status, created_at) values
('a73262bf-f5a9-531d-a9d1-388ff271204f', '87eeb279-9094-5b92-b103-da847916f10c', 'a58c3c36-9605-5820-ac27-6fb726e56c9a', 'Engagement status summary', 'Draft / Demonstration', '2026-10-01T12:00:00Z')
on conflict do nothing;

insert into public.activity_logs (id, actor_id, event_type, description, record_type, record_id, created_at, actor_name) values
('2118e0f7-bbfa-5c60-9bfb-2a0fc1ff0231', null, 'Document uploaded', 'Bank confirmation request uploaded to ABC Holdings Ltd', 'Document', 'f7a682ed-2dc1-5793-b1b5-a2a83295654e', '2026-11-06T07:00:05Z', 'Mary Wanjiku'),
('6360402c-2f35-59e0-afdd-f22253d3d9c2', null, 'Status changed', 'Review status changed for Nairobi Health Partners', 'Engagement', '1928a2bb-1bdc-5d66-ab02-5ab44e724290', '2026-11-06T05:00:05Z', 'Mary Wanjiku'),
('8bb9e578-c083-545d-b865-070a02b11177', null, 'Task completed', 'Fleet additions testing completed', 'Task', '8d672001-ef65-5e4f-9201-2475a4bcc71e', '2026-11-06T03:00:05Z', 'Brian Otieno'),
('d0ac363a-ecc7-5143-8759-d47115282876', null, 'Task assigned', 'Manager review assigned to Mary Wanjiku', 'Task', 'c587654f-ecb3-534b-a5b3-2b9fc945d838', '2026-11-06T01:00:05Z', 'David Kamau'),
('8cb7e26b-48b7-50e0-9ac2-e48b55b582dd', null, 'Engagement created', '2026 Tax Compliance Review opened for Summit Properties Ltd', 'Engagement', 'a2d79f38-6a8c-5cc8-8446-b5132e9a06e5', '2026-11-05T23:00:05Z', 'Joseph Mwangi'),
('386590a7-8696-5767-84e1-c6c3ada77d44', null, 'Client created', 'Summit Properties Ltd added to the demonstration environment', 'Client', '9f402230-0e78-5ac5-90f7-a51d91c63094', '2026-11-05T21:00:05Z', 'David Kamau')
on conflict do nothing;

insert into public.attendance_settings (id, expected_check_in, grace_minutes, working_days) values
('b836e754-79da-5e92-bed4-f3426b806d7e', '08:00:00', 15, '["Mon", "Tue", "Wed", "Thu", "Fri"]')
on conflict do nothing;

insert into public.attendance_records (id, staff_id, attendance_date, status, check_in, check_out, note, duration_minutes) values
('f4ca7f1b-fbe5-54cb-9abc-236042ea2603', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', '2026-10-01', 'Present', '07:52:00', null, null, null),
('5aa14656-0a8b-56b8-ab56-2279add14b6c', '1fb5b69a-d632-401f-ab83-85143118ad35', '2026-10-01', 'Late', '08:47:00', null, 'Traffic delay', null),
('878c1f9d-2064-5dad-8a45-2162b826bd59', '3e872845-8d7c-484c-b74c-6c39cb8ddf95', '2026-10-01', 'Not Checked In', null, null, null, null),
('b8734d34-b03f-57cb-8fc4-1481b8244c20', '3e15587e-7da0-4761-8d82-4d8971672550', '2026-10-01', 'Remote Work', '08:04:00', null, 'Approved remote work', null),
('a7567ec6-7a99-5109-b5c9-d49e73aeace8', 'f13fb409-f2f9-4459-8116-9b0264ab9ac1', '2026-10-01', 'Approved Leave', null, null, 'Approved leave', null),
('5b932732-d07b-5f64-907d-f7f9b4a54695', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', '2026-09-30', 'Present', '07:58:00', '17:12:00', null, 554),
('4ee53626-fdd3-573e-a23f-555086615cc6', '1fb5b69a-d632-401f-ab83-85143118ad35', '2026-09-30', 'Late', '08:32:00', '17:05:00', null, 513),
('38efd16a-efea-593a-8811-231fad3db45b', '3e872845-8d7c-484c-b74c-6c39cb8ddf95', '2026-09-30', 'Present', '08:05:00', null, null, null),
('9c7c6c1a-056e-55a7-8c26-cd37f469ae9d', '3e15587e-7da0-4761-8d82-4d8971672550', '2026-09-30', 'Present', '07:55:00', '17:00:00', null, 545),
('378dccd6-c93a-5a9b-b5c8-3330e9877162', 'f13fb409-f2f9-4459-8116-9b0264ab9ac1', '2026-09-30', 'Present', '08:02:00', '16:48:00', null, 526)
on conflict do nothing;

insert into public.accounting_accounts (id, code, name, account_type) values
('f727d46a-41e0-53db-a8e8-2ebdaa911479', '1000', 'Cash and bank', 'Asset'),
('f180ace7-994d-52ae-9a6a-790771d618b2', '1100', 'Trade receivables', 'Asset'),
('7861bb77-6b01-518d-acad-9948be420459', '1500', 'Office equipment', 'Asset'),
('e8a86b33-7873-5802-bc79-ae197d8f1f7d', '2000', 'Trade payables', 'Liability'),
('b0a18f75-dc4f-5733-9169-df19ed4b1d7e', '3000', 'Partner capital', 'Equity'),
('fcf3d17c-fafe-5f65-96c7-e828c14a4311', '4000', 'Professional fees', 'Revenue'),
('72b16954-8563-5aa5-8e21-004e75bd7b08', '5100', 'Office rent', 'Expense'),
('c2e15a02-5bc1-57f9-81d2-e728902ab931', '5200', 'Staff costs', 'Expense')
on conflict do nothing;

insert into public.journal_entries (id, entry_date, description, reference, status, created_at) values
('bc05c08b-b689-535e-9e1f-52c21d064014', '2026-09-01', 'Opening partner capital', 'OPEN-001', 'Posted', '2026-10-01T05:00:00Z'),
('f910fc9d-4528-54ce-987d-7c100a638b6f', '2026-09-05', 'Professional fees billed to ABC Holdings Ltd', 'INV-ABC-001', 'Posted', '2026-10-01T05:00:01Z'),
('3569bb5d-deb7-599b-a08e-02044bb056d6', '2026-09-12', 'Client receipt — ABC Holdings Ltd', 'RCPT-ABC-001', 'Posted', '2026-10-01T05:00:02Z'),
('50b7e3d7-6a56-5e79-ab3d-85e138f710e8', '2026-09-15', 'September office rent', 'EXP-RENT-001', 'Posted', '2026-10-01T05:00:03Z'),
('aac158f4-a1a2-54a4-9f20-4147eb552a76', '2026-09-25', 'September staff costs', 'PAY-SEP-001', 'Posted', '2026-10-01T05:00:04Z'),
('28661edd-4bbf-5696-819c-3d7ca8efbf66', '2026-09-28', 'Office equipment purchase', 'CAPEX-001', 'Posted', '2026-10-01T05:00:05Z')
on conflict do nothing;

insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit) values
('bc05c08b-b689-535e-9e1f-52c21d064014', 'f727d46a-41e0-53db-a8e8-2ebdaa911479', 1500000, 0),
('bc05c08b-b689-535e-9e1f-52c21d064014', 'b0a18f75-dc4f-5733-9169-df19ed4b1d7e', 0, 1500000),
('f910fc9d-4528-54ce-987d-7c100a638b6f', 'f180ace7-994d-52ae-9a6a-790771d618b2', 420000, 0),
('f910fc9d-4528-54ce-987d-7c100a638b6f', 'fcf3d17c-fafe-5f65-96c7-e828c14a4311', 0, 420000),
('3569bb5d-deb7-599b-a08e-02044bb056d6', 'f727d46a-41e0-53db-a8e8-2ebdaa911479', 250000, 0),
('3569bb5d-deb7-599b-a08e-02044bb056d6', 'f180ace7-994d-52ae-9a6a-790771d618b2', 0, 250000),
('50b7e3d7-6a56-5e79-ab3d-85e138f710e8', '72b16954-8563-5aa5-8e21-004e75bd7b08', 95000, 0),
('50b7e3d7-6a56-5e79-ab3d-85e138f710e8', 'f727d46a-41e0-53db-a8e8-2ebdaa911479', 0, 95000),
('aac158f4-a1a2-54a4-9f20-4147eb552a76', 'c2e15a02-5bc1-57f9-81d2-e728902ab931', 310000, 0),
('aac158f4-a1a2-54a4-9f20-4147eb552a76', 'f727d46a-41e0-53db-a8e8-2ebdaa911479', 0, 310000),
('28661edd-4bbf-5696-819c-3d7ca8efbf66', '7861bb77-6b01-518d-acad-9948be420459', 180000, 0),
('28661edd-4bbf-5696-819c-3d7ca8efbf66', 'e8a86b33-7873-5802-bc79-ae197d8f1f7d', 0, 180000)
on conflict do nothing;

insert into public.document_extractions (id, filename, status, summary, extracted_json) values
('39897106-e47b-54ed-b45a-dd04934134c0', 'Fictional ABC Holdings bank statement.csv', 'Needs Review', 'A fictional September 2026 bank statement with three extracted transactions. Review is required before any accounting record is created.', '{"transactions": [{"date": "2026-09-12", "description": "Client receipt \u2014 ABC Holdings Ltd", "debit": 250000, "credit": 0}, {"date": "2026-09-15", "description": "Office rent payment", "debit": 0, "credit": 95000}, {"date": "2026-09-25", "description": "Staff costs payment", "debit": 0, "credit": 310000}], "totalDebits": 250000, "totalCredits": 405000, "unusualItems": ["Net cash movement is negative for the extracted sample; confirm the opening balance and statement period."]}')
on conflict do nothing;

insert into public.internal_messages (id, sender_id, sender_name, recipient_id, recipient_name, body, kind, created_at) values
('0a098b32-ba4f-5cec-a9d7-ae3cd51b9ccb', 'benjamin', 'Benjamin Mutua', 'all', 'All users', 'Please check in before starting client work today.', 'broadcast', '2026-10-01T08:00:00Z'),
('695b03d4-9245-5906-8b5c-d18978baeb70', '3366d3f2-03f9-48fe-a701-e3d5cb7ad3f1', 'David Kamau', 'benjamin', 'Benjamin Mutua', 'The ABC Manufacturing review pack is ready for your review.', 'direct', '2026-10-01T08:15:00Z')
on conflict do nothing;
