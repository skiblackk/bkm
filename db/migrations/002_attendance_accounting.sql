CREATE TABLE IF NOT EXISTS attendance_records (
  id CHAR(36) PRIMARY KEY,
  staff_id CHAR(36) NOT NULL,
  attendance_date DATE NOT NULL,
  status VARCHAR(40) NOT NULL,
  check_in TIME NULL,
  check_out TIME NULL,
  note VARCHAR(255) NULL,
  duration_minutes INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_staff_day (staff_id, attendance_date),
  INDEX idx_attendance_date_status (attendance_date, status),
  CONSTRAINT fk_attendance_staff FOREIGN KEY (staff_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS attendance_settings (
  id CHAR(36) PRIMARY KEY,
  expected_check_in TIME NOT NULL,
  grace_minutes INT NOT NULL DEFAULT 15,
  working_days_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounting_accounts (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(190) NOT NULL,
  account_type VARCHAR(30) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id CHAR(36) PRIMARY KEY,
  period_id CHAR(36) NULL,
  entry_date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  reference VARCHAR(80) NOT NULL UNIQUE,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_je_period FOREIGN KEY (period_id) REFERENCES accounting_periods(id),
  CONSTRAINT fk_je_author FOREIGN KEY (created_by) REFERENCES profiles(id),
  INDEX idx_je_date (entry_date)
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id CHAR(36) PRIMARY KEY,
  journal_entry_id CHAR(36) NOT NULL,
  account_id CHAR(36) NOT NULL,
  debit DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit DECIMAL(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_jel_entry FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_jel_account FOREIGN KEY (account_id) REFERENCES accounting_accounts(id),
  CONSTRAINT chk_jel_side CHECK ((debit = 0 AND credit >= 0) OR (credit = 0 AND debit >= 0))
);

CREATE TABLE IF NOT EXISTS document_extractions (
  id CHAR(36) PRIMARY KEY,
  document_id CHAR(36) NULL,
  filename VARCHAR(190) NOT NULL,
  status VARCHAR(40) NOT NULL,
  summary TEXT NOT NULL,
  extracted_json JSON NOT NULL,
  approved_by CHAR(36) NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_extraction_document FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT fk_extraction_approver FOREIGN KEY (approved_by) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  category VARCHAR(40) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  title VARCHAR(190) NOT NULL,
  body TEXT NOT NULL,
  link_path VARCHAR(255) NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_read_created (is_read, created_at)
);
