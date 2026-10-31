CREATE TABLE IF NOT EXISTS roles (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  id CHAR(36) PRIMARY KEY,
  role_id CHAR(36) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  initials VARCHAR(8) NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_role FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS clients (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  industry VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL,
  location VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  primary_manager_id CHAR(36) NULL,
  document_count INT NOT NULL DEFAULT 0,
  outstanding_requests INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clients_status (status),
  INDEX idx_clients_industry (industry)
);

CREATE TABLE IF NOT EXISTS client_contacts (
  id CHAR(36) PRIMARY KEY,
  client_id CHAR(36) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contacts_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  INDEX idx_contacts_client (client_id)
);

CREATE TABLE IF NOT EXISTS engagements (
  id CHAR(36) PRIMARY KEY,
  client_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  service_type VARCHAR(120) NOT NULL,
  period_label VARCHAR(80) NOT NULL,
  status VARCHAR(40) NOT NULL,
  manager_id CHAR(36) NOT NULL,
  deadline DATE NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  document_count INT NOT NULL DEFAULT 0,
  outstanding_documents INT NOT NULL DEFAULT 0,
  review_note TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_engagement_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_engagement_manager FOREIGN KEY (manager_id) REFERENCES profiles(id),
  INDEX idx_engagements_deadline (deadline),
  INDEX idx_engagements_status (status)
);

CREATE TABLE IF NOT EXISTS engagement_members (
  engagement_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  PRIMARY KEY (engagement_id, profile_id),
  CONSTRAINT fk_members_engagement FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id CHAR(36) PRIMARY KEY,
  engagement_id CHAR(36) NOT NULL,
  title VARCHAR(190) NOT NULL,
  description TEXT NOT NULL,
  assigned_to CHAR(36) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_engagement FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_assignee FOREIGN KEY (assigned_to) REFERENCES profiles(id),
  INDEX idx_tasks_due_status (due_date, status),
  INDEX idx_tasks_assigned (assigned_to)
);

CREATE TABLE IF NOT EXISTS task_comments (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  author_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comments_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS documents (
  id CHAR(36) PRIMARY KEY,
  client_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL,
  storage_path VARCHAR(255) NULL,
  uploaded_by CHAR(36) NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_documents_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_documents_engagement FOREIGN KEY (engagement_id) REFERENCES engagements(id),
  CONSTRAINT fk_documents_uploader FOREIGN KEY (uploaded_by) REFERENCES profiles(id),
  INDEX idx_documents_engagement (engagement_id)
);

CREATE TABLE IF NOT EXISTS quotations (
  id CHAR(36) PRIMARY KEY,
  client_id CHAR(36) NOT NULL,
  service_type VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  terms TEXT NOT NULL,
  status VARCHAR(40) NOT NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_quotations_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_quotations_author FOREIGN KEY (created_by) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id CHAR(36) PRIMARY KEY,
  quotation_id CHAR(36) NOT NULL,
  description VARCHAR(190) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_quote_items_quote FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id CHAR(36) PRIMARY KEY,
  client_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  report_type VARCHAR(120) NOT NULL,
  status VARCHAR(50) NOT NULL,
  content_json JSON NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_reports_engagement FOREIGN KEY (engagement_id) REFERENCES engagements(id),
  CONSTRAINT fk_reports_author FOREIGN KEY (created_by) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NULL,
  event_type VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL,
  record_type VARCHAR(40) NOT NULL,
  record_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_activity_actor FOREIGN KEY (actor_id) REFERENCES profiles(id),
  INDEX idx_activity_created (created_at)
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id CHAR(36) PRIMARY KEY,
  profile_id CHAR(36) NULL,
  title VARCHAR(190) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_conversation_profile FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id CHAR(36) PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_message_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_actions (
  id CHAR(36) PRIMARY KEY,
  conversation_id CHAR(36) NULL,
  tool_name VARCHAR(100) NOT NULL,
  input_json JSON NULL,
  result_summary VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_action_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id)
);
