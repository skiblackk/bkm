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

/**
 * How BKM stands in relation to the organisation.
 *
 * 'serviced' — BKM delivers work to them and bills them.
 * 'vendor'   — they supply BKM, and BKM pays them. They still live in the same
 *              register so contacts, documents and history stay in one place,
 *              but the money flows the other way, so the record says so
 *              explicitly instead of leaving it to be inferred.
 */
export type ClientRelationship = 'serviced' | 'vendor';

export type ChargeDirection = 'payable' | 'receivable';
export type BillingFrequency = 'one-off' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

/** What is being paid for, and how much. */
export interface ServiceCharge {
  id: string;
  clientId: string;
  serviceName: string;
  description: string;
  direction: ChargeDirection;
  amount: number;
  currency: string;
  billingFrequency: BillingFrequency;
  status: 'Active' | 'Paused' | 'Ended';
  effectiveFrom: string;
}

/** Money that actually moved against a charge. */
export interface ClientPayment {
  id: string;
  clientId: string;
  chargeId: string | null;
  amount: number;
  currency: string;
  paidOn: string;
  method: string;
  reference: string;
  notes: string;
}

/** A numbered receipt issued for one payment. */
export interface ClientReceipt {
  id: string;
  receiptNumber: string;
  paymentId: string;
  clientId: string;
  amount: number;
  currency: string;
  issuedOn: string;
  issuedByName: string;
  notes: string;
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
  relationship: ClientRelationship;
  logoUrl: string;
  serviceCharges: ServiceCharge[];
  payments: ClientPayment[];
  receipts: ClientReceipt[];
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
  status: 'Draft';
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
  environment: 'LIVE';
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

export interface PrivateConversation {
  id: string;
  participantIds: string[];
  participantNames: Record<string, string>;
  createdAt: string;
  latestMessage?: PrivateMessage | null;
  unreadCount?: number;
}

export interface PrivateMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  clientMessageId?: string;
}

export interface NotificationRecord {
  id: string;
  recipientId: string;
  category: string;
  priority: 'Low' | 'Normal' | 'High' | 'Urgent';
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
  linkPath?: string;
  relatedType?: string;
  relatedId?: string;
  dedupeKey?: string;
}
