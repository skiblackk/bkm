import type {
  ActivityLog,
  Client,
  DemoSnapshot,
  DocumentRecord,
  Engagement,
  Quotation,
  ReportRecord,
  StaffMember,
  Task,
} from './types';

const staff: StaffMember[] = [
  { id: 'staff-david', name: 'David Kamau', initials: 'DK', role: 'Audit Manager', email: 'david.kamau@demo.bkm', activeEngagements: 0, assignedTasks: 0, completedTasks: 0, overdueTasks: 0, availability: 62, color: '#165e56' },
  { id: 'staff-mary', name: 'Mary Wanjiku', initials: 'MW', role: 'Senior Auditor', email: 'mary.wanjiku@demo.bkm', activeEngagements: 0, assignedTasks: 0, completedTasks: 0, overdueTasks: 0, availability: 78, color: '#6c547f' },
  { id: 'staff-brian', name: 'Brian Otieno', initials: 'BO', role: 'Auditor', email: 'brian.otieno@demo.bkm', activeEngagements: 0, assignedTasks: 0, completedTasks: 0, overdueTasks: 0, availability: 44, color: '#a66b2d' },
  { id: 'staff-faith', name: 'Faith Njeri', initials: 'FN', role: 'Audit Associate', email: 'faith.njeri@demo.bkm', activeEngagements: 0, assignedTasks: 0, completedTasks: 0, overdueTasks: 0, availability: 86, color: '#4e6982' },
  { id: 'staff-joseph', name: 'Joseph Mwangi', initials: 'JM', role: 'Tax Consultant', email: 'joseph.mwangi@demo.bkm', activeEngagements: 0, assignedTasks: 0, completedTasks: 0, overdueTasks: 0, availability: 71, color: '#8a634e' },
];

const clients: Client[] = [
  { id: 'client-abc', name: 'ABC Holdings Ltd', industry: 'Real Estate & Construction', status: 'Active', location: 'Nairobi', contactName: 'Lilian Kiplagat', contactEmail: 'lilian.kiplagat@abc-demo.co.ke', contactPhone: '+254 700 000 201', services: ['Audit & Assurance', 'Tax Consultation & Compliance'], primaryManagerId: 'staff-david', engagementIds: ['eng-abc'], documentCount: 24, outstandingRequests: 3, lastActivity: '2 hours ago', description: 'A fictional property development and investment group used to demonstrate a multi-workstream statutory audit.' },
  { id: 'client-health', name: 'Nairobi Health Partners', industry: 'Healthcare', status: 'Active', location: 'Nairobi', contactName: 'Dr. Peter Maina', contactEmail: 'peter.maina@health-demo.co.ke', contactPhone: '+254 700 000 202', services: ['Accounting & Bookkeeping', 'Financial Advisory'], primaryManagerId: 'staff-mary', engagementIds: ['eng-health'], documentCount: 18, outstandingRequests: 1, lastActivity: 'Yesterday', description: 'A fictional outpatient healthcare network with a year-end financial reporting and advisory engagement.' },
  { id: 'client-green', name: 'Green Valley SACCO', industry: 'SACCO / Cooperative', status: 'Active', location: 'Kiambu', contactName: 'Samuel Njuguna', contactEmail: 'samuel.njuguna@green-demo.co.ke', contactPhone: '+254 700 000 203', services: ['Audit & Assurance', 'Financial Advisory'], primaryManagerId: 'staff-david', engagementIds: ['eng-green'], documentCount: 12, outstandingRequests: 4, lastActivity: '3 days ago', description: 'A fictional cooperative society used to demonstrate outstanding evidence requests and review status.' },
  { id: 'client-east', name: 'Eastland Logistics Ltd', industry: 'Transport & Logistics', status: 'Active', location: 'Mombasa', contactName: 'Grace Atieno', contactEmail: 'grace.atieno@east-demo.co.ke', contactPhone: '+254 700 000 204', services: ['Audit & Assurance', 'Accounting & Bookkeeping'], primaryManagerId: 'staff-mary', engagementIds: ['eng-east'], documentCount: 19, outstandingRequests: 0, lastActivity: '4 days ago', description: 'A fictional transport and logistics operator with a focused statutory audit engagement.' },
  { id: 'client-summit', name: 'Summit Properties Ltd', industry: 'Real Estate & Construction', status: 'On hold', location: 'Nakuru', contactName: 'Alex Wekesa', contactEmail: 'alex.wekesa@summit-demo.co.ke', contactPhone: '+254 700 000 205', services: ['Tax Consultation & Compliance'], primaryManagerId: 'staff-joseph', engagementIds: ['eng-summit'], documentCount: 7, outstandingRequests: 2, lastActivity: '18 Sep 2026', description: 'A fictional property company used to demonstrate a paused tax compliance workstream.' },
];

const engagements: Engagement[] = [
  { id: 'eng-abc', clientId: 'client-abc', name: '2026 Statutory Audit', type: 'Audit & Assurance', period: 'FY 2026', status: 'In Progress', managerId: 'staff-david', teamIds: ['staff-mary', 'staff-brian', 'staff-faith'], deadline: '15 Oct 2026', progress: 68, taskIds: [], documentCount: 24, outstandingDocuments: 3, reviewNote: 'Manager review scheduled after evidence completion.' },
  { id: 'eng-health', clientId: 'client-health', name: '2026 Financial Reporting Advisory', type: 'Financial Advisory', period: 'FY 2026', status: 'Under Review', managerId: 'staff-mary', teamIds: ['staff-faith', 'staff-joseph'], deadline: '08 Oct 2026', progress: 81, taskIds: [], documentCount: 18, outstandingDocuments: 1, reviewNote: 'Draft schedules are awaiting senior review.' },
  { id: 'eng-green', clientId: 'client-green', name: '2026 Cooperative Audit', type: 'Audit & Assurance', period: 'FY 2026', status: 'In Progress', managerId: 'staff-david', teamIds: ['staff-brian', 'staff-faith'], deadline: '11 Oct 2026', progress: 54, taskIds: [], documentCount: 12, outstandingDocuments: 4, reviewNote: 'Evidence request list has four open items.' },
  { id: 'eng-east', clientId: 'client-east', name: '2026 Statutory Audit', type: 'Audit & Assurance', period: 'FY 2026', status: 'In Progress', managerId: 'staff-mary', teamIds: ['staff-brian'], deadline: '18 Oct 2026', progress: 72, taskIds: [], documentCount: 19, outstandingDocuments: 0, reviewNote: 'Awaiting manager review of final analytical procedures.' },
  { id: 'eng-summit', clientId: 'client-summit', name: '2026 Tax Compliance Review', type: 'Tax Consultation & Compliance', period: 'FY 2026', status: 'Planning', managerId: 'staff-joseph', teamIds: ['staff-faith'], deadline: '28 Oct 2026', progress: 23, taskIds: [], documentCount: 7, outstandingDocuments: 2, reviewNote: 'Engagement is paused pending client confirmation.' },
];

const tasks: Task[] = [
  { id: 'task-001', title: 'Obtain signed bank confirmations', description: 'Request and file confirmations for all operating and reserve accounts.', clientId: 'client-abc', engagementId: 'eng-abc', assignedTo: 'staff-brian', priority: 'High', dueDate: '28 Sep 2026', status: 'Blocked', updatedAt: '30 Sep 2026' },
  { id: 'task-002', title: 'Review property valuation schedules', description: 'Tie valuation schedules to the fixed asset register and supporting reports.', clientId: 'client-abc', engagementId: 'eng-abc', assignedTo: 'staff-mary', priority: 'High', dueDate: '03 Oct 2026', status: 'In Progress', updatedAt: '01 Oct 2026' },
  { id: 'task-003', title: 'Complete revenue cut-off testing', description: 'Select samples around year-end and document the cut-off conclusion.', clientId: 'client-abc', engagementId: 'eng-abc', assignedTo: 'staff-faith', priority: 'Medium', dueDate: '06 Oct 2026', status: 'Under Review', updatedAt: '30 Sep 2026' },
  { id: 'task-004', title: 'Prepare management letter points', description: 'Summarize control observations for manager review.', clientId: 'client-abc', engagementId: 'eng-abc', assignedTo: 'staff-mary', priority: 'Medium', dueDate: '10 Oct 2026', status: 'Not Started', updatedAt: '29 Sep 2026' },
  { id: 'task-005', title: 'Finalize audit completion checklist', description: 'Close out required sign-offs and completion documentation.', clientId: 'client-abc', engagementId: 'eng-abc', assignedTo: 'staff-david', priority: 'Critical', dueDate: '14 Oct 2026', status: 'Not Started', updatedAt: '28 Sep 2026' },
  { id: 'task-006', title: 'Reconcile patient receivables', description: 'Reconcile the aged receivables listing to the reporting pack.', clientId: 'client-health', engagementId: 'eng-health', assignedTo: 'staff-faith', priority: 'Medium', dueDate: '27 Sep 2026', status: 'Completed', updatedAt: '27 Sep 2026' },
  { id: 'task-007', title: 'Validate cash flow assumptions', description: 'Review the assumptions supporting the rolling cash flow model.', clientId: 'client-health', engagementId: 'eng-health', assignedTo: 'staff-joseph', priority: 'High', dueDate: '04 Oct 2026', status: 'Submitted', updatedAt: '30 Sep 2026' },
  { id: 'task-008', title: 'Review draft reporting pack', description: 'Complete senior review notes for the draft financial reporting pack.', clientId: 'client-health', engagementId: 'eng-health', assignedTo: 'staff-mary', priority: 'High', dueDate: '05 Oct 2026', status: 'Under Review', updatedAt: '01 Oct 2026' },
  { id: 'task-009', title: 'Document governance observations', description: 'Capture governance observations and suggested actions.', clientId: 'client-health', engagementId: 'eng-health', assignedTo: 'staff-joseph', priority: 'Low', dueDate: '09 Oct 2026', status: 'Not Started', updatedAt: '29 Sep 2026' },
  { id: 'task-010', title: 'Request SACCO loan portfolio listing', description: 'Follow up for the complete loan portfolio and aging analysis.', clientId: 'client-green', engagementId: 'eng-green', assignedTo: 'staff-brian', priority: 'Critical', dueDate: '26 Sep 2026', status: 'Blocked', updatedAt: '01 Oct 2026' },
  { id: 'task-011', title: 'Test member deposits', description: 'Perform sample testing over member deposit movements.', clientId: 'client-green', engagementId: 'eng-green', assignedTo: 'staff-faith', priority: 'High', dueDate: '07 Oct 2026', status: 'In Progress', updatedAt: '01 Oct 2026' },
  { id: 'task-012', title: 'Review liquidity disclosures', description: 'Tie liquidity disclosures to the supporting schedules.', clientId: 'client-green', engagementId: 'eng-green', assignedTo: 'staff-david', priority: 'Medium', dueDate: '09 Oct 2026', status: 'Not Started', updatedAt: '29 Sep 2026' },
  { id: 'task-013', title: 'Prepare SACCO review summary', description: 'Prepare the first draft of the manager review summary.', clientId: 'client-green', engagementId: 'eng-green', assignedTo: 'staff-david', priority: 'High', dueDate: '10 Oct 2026', status: 'Not Started', updatedAt: '28 Sep 2026' },
  { id: 'task-014', title: 'Complete fleet additions testing', description: 'Inspect additions and agree samples to supplier documentation.', clientId: 'client-east', engagementId: 'eng-east', assignedTo: 'staff-brian', priority: 'Medium', dueDate: '02 Oct 2026', status: 'Completed', updatedAt: '30 Sep 2026' },
  { id: 'task-015', title: 'Run analytical review', description: 'Document final analytical review procedures and exceptions.', clientId: 'client-east', engagementId: 'eng-east', assignedTo: 'staff-mary', priority: 'High', dueDate: '08 Oct 2026', status: 'Submitted', updatedAt: '30 Sep 2026' },
  { id: 'task-016', title: 'Manager review of Eastland file', description: 'Perform manager review and return clearance notes.', clientId: 'client-east', engagementId: 'eng-east', assignedTo: 'staff-mary', priority: 'Critical', dueDate: '12 Oct 2026', status: 'Not Started', updatedAt: '29 Sep 2026' },
  { id: 'task-017', title: 'Confirm tax registration details', description: 'Confirm registration details before opening the compliance review.', clientId: 'client-summit', engagementId: 'eng-summit', assignedTo: 'staff-joseph', priority: 'Medium', dueDate: '20 Oct 2026', status: 'In Progress', updatedAt: '30 Sep 2026' },
  { id: 'task-018', title: 'Issue outstanding information request', description: 'Prepare a concise request for the two remaining tax records.', clientId: 'client-summit', engagementId: 'eng-summit', assignedTo: 'staff-faith', priority: 'Low', dueDate: '22 Oct 2026', status: 'Not Started', updatedAt: '27 Sep 2026' },
];

const activities: ActivityLog[] = [
  { id: 'activity-001', type: 'Document uploaded', description: 'Bank confirmation request uploaded to ABC Holdings Ltd', actor: 'Mary Wanjiku', timestamp: '2 hours ago', recordType: 'Document', recordId: 'doc-003' },
  { id: 'activity-002', type: 'Status changed', description: 'Review status changed for Nairobi Health Partners', actor: 'Mary Wanjiku', timestamp: 'Yesterday', recordType: 'Engagement', recordId: 'eng-health' },
  { id: 'activity-003', type: 'Task completed', description: 'Fleet additions testing completed', actor: 'Brian Otieno', timestamp: 'Yesterday', recordType: 'Task', recordId: 'task-014' },
  { id: 'activity-004', type: 'Task assigned', description: 'Manager review assigned to Mary Wanjiku', actor: 'David Kamau', timestamp: '30 Sep 2026', recordType: 'Task', recordId: 'task-016' },
  { id: 'activity-005', type: 'Engagement created', description: '2026 Tax Compliance Review opened for Summit Properties Ltd', actor: 'Joseph Mwangi', timestamp: '28 Sep 2026', recordType: 'Engagement', recordId: 'eng-summit' },
  { id: 'activity-006', type: 'Client created', description: 'Summit Properties Ltd added to the demonstration environment', actor: 'David Kamau', timestamp: '18 Sep 2026', recordType: 'Client', recordId: 'client-summit' },
];

const documents: DocumentRecord[] = [
  { id: 'doc-001', clientId: 'client-abc', engagementId: 'eng-abc', name: '2026 Trial Balance.xlsx', type: 'Financial schedule', status: 'Received', uploadedAt: '29 Sep 2026' },
  { id: 'doc-002', clientId: 'client-abc', engagementId: 'eng-abc', name: 'Fixed Asset Register.xlsx', type: 'Working paper', status: 'Reviewed', uploadedAt: '28 Sep 2026' },
  { id: 'doc-003', clientId: 'client-abc', engagementId: 'eng-abc', name: 'Bank Confirmation Request.pdf', type: 'Audit evidence', status: 'Requested', uploadedAt: '01 Oct 2026' },
  { id: 'doc-004', clientId: 'client-health', engagementId: 'eng-health', name: 'Cash Flow Assumptions.docx', type: 'Advisory schedule', status: 'Received', uploadedAt: '30 Sep 2026' },
  { id: 'doc-005', clientId: 'client-green', engagementId: 'eng-green', name: 'Member Deposits Listing.xlsx', type: 'Audit evidence', status: 'Requested', uploadedAt: '01 Oct 2026' },
  { id: 'doc-006', clientId: 'client-east', engagementId: 'eng-east', name: 'Fleet Additions Register.xlsx', type: 'Audit evidence', status: 'Reviewed', uploadedAt: '30 Sep 2026' },
];

const quotations: Quotation[] = [
  { id: 'quote-001', clientId: 'client-summit', service: 'Tax Consultation & Compliance', description: 'Demonstration quotation for a tax compliance review.', terms: 'Valid for 30 days. This is fictional demonstration pricing.', items: [{ id: 'item-001', description: 'Tax compliance review', quantity: 1, unitPrice: 95000 }], status: 'Draft', createdAt: '01 Oct 2026' },
];

const reports: ReportRecord[] = [
  { id: 'report-001', clientId: 'client-abc', engagementId: 'eng-abc', reportType: 'Engagement status summary', status: 'Draft / Demonstration', createdAt: '01 Oct 2026' },
];

export const seedSnapshot: DemoSnapshot = { environment: 'DEMO ENVIRONMENT', staff, clients, engagements, tasks, activities, documents, quotations, reports };

export function cloneSeedSnapshot(): DemoSnapshot {
  return JSON.parse(JSON.stringify(seedSnapshot)) as DemoSnapshot;
}
