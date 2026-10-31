ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id CHAR(36) NULL, ADD COLUMN IF NOT EXISTS related_type VARCHAR(80) NULL, ADD COLUMN IF NOT EXISTS related_id CHAR(36) NULL, ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(190) NULL, ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_notifications_recipient_read ON notifications (recipient_id, is_read, created_at);
CREATE UNIQUE INDEX uq_notifications_dedupe ON notifications (dedupe_key);
CREATE TABLE IF NOT EXISTS conversations (
  id CHAR(36) PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id CHAR(36) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, profile_id),
  CONSTRAINT fk_cp_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS private_messages (
  id CHAR(36) PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  recipient_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  client_message_id VARCHAR(190) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL,
  CONSTRAINT fk_pm_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_sender FOREIGN KEY (sender_id) REFERENCES profiles(id),
  CONSTRAINT fk_pm_recipient FOREIGN KEY (recipient_id) REFERENCES profiles(id),
  UNIQUE KEY uq_pm_sender_client (sender_id, client_message_id),
  INDEX idx_pm_conversation_created (conversation_id, created_at),
  INDEX idx_pm_recipient_read (recipient_id, read_at)
);
