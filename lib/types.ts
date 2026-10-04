export type ClientStatus = 'Active' | 'On hold' | 'Archived';
export type EngagementStatus = 'In Progress' | 'Under Review' | 'Planning' | 'Completed';
export type TaskStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'Submitted' | 'Under Review' | 'Completed';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type ActivityType = 'Client created' | 'Engagement created' | 'Task assigned' | 'Task completed' | 'Document uploaded' | 'Status changed';

export interface StaffMember {
  id: string;
  name: string;
  initials: string;
  role: string;
  email: string;
  activeEngagements: number;
  assignedTasks: number;
  completedTasks: number;
  overdueTasks: number;
  availability: number;
  color: string;
  permissions?: string[];
}

export interface Client {
  id: string;
  name: string;
  industry: string;
  status: ClientStatus;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  services: string[];
  primaryManagerId: string;
  engagementIds: string[];
  documentCount: number;
  outstandingRequests: number;
  lastActivity: string;
  description: string;
}

export interface Engagement {
  id: string;
  clientId: string;
  name: string;
  type: string;
  period: string;
  status: EngagementStatus;
  managerId: string;
  teamIds: string[];
  deadline: string;
  progress: number;
  taskIds: string[];
  documentCount: number;
  outstandingDocuments: number;
  reviewNote: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  clientId: string;
  engagementId: string;
  assignedTo: string;
  priority: TaskPriority;
  dueDate: string;
  status: TaskStatus;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  type: ActivityType;
  description: string;
  actor: string;
  timestamp: string;
  recordType: 'Client' | 'Engagement' | 'Task' | 'Document';
  recordId: string;
}

export interface DocumentRecord {
  id: string;
  clientId: string;
  engagementId: string;
  name: string;
  type: string;
  status: 'Received' | 'Requested' | 'Reviewed';
  uploadedAt: string;
}

export interface QuotationItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Quotation {
  id: string;
  clientId: string;
  service: string;
  description: string;
  terms: string;
  items: QuotationItem[];
  status: 'Draft' | 'Ready for review';
  createdAt: string;
}

export interface ReportRecord {
  id: string;
  clientId: string;
  engagementId: string;
  reportType: string;
  status: 'Draft / Demonstration';
  createdAt: string;
}

export interface DemoSnapshot {
  staff: StaffMember[];
  clients: Client[];
  engagements: Engagement[];
  tasks: Task[];
  activities: ActivityLog[];
  documents: DocumentRecord[];
  quotations: Quotation[];
  reports: ReportRecord[];
  environment: 'DEMO ENVIRONMENT';
}

export interface DashboardMetrics {
  activeClients: number;
  activeEngagements: number;
  pendingTasks: number;
  overdueTasks: number;
  upcomingDeadlines: number;
  pendingReviews: number;
}

export interface InternalMessage {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string | 'all';
  recipientName: string;
  body: string;
  createdAt: string;
  kind: 'direct' | 'broadcast' | 'alert';
}
