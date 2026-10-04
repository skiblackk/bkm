CREATE TABLE IF NOT EXISTS user_permissions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  permission_key VARCHAR(80) NOT NULL,
  granted_by CHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_permission (user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  actor_name VARCHAR(180) NOT NULL,
  actor_role VARCHAR(120) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id VARCHAR(120),
  detail TEXT NOT NULL,
  severity ENUM('info','security','change') NOT NULL DEFAULT 'info',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created_at (created_at),
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_action (action)
);
