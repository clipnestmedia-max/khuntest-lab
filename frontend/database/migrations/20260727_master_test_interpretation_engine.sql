-- Master Test Interpretation Engine migration
-- Safe to run repeatedly. Back up production data before applying.

CREATE TABLE IF NOT EXISTS test_master_configs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  test_code VARCHAR(80) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  short_name VARCHAR(120) DEFAULT '',
  department VARCHAR(120) DEFAULT '',
  category VARCHAR(120) DEFAULT '',
  sample_type VARCHAR(120) DEFAULT '',
  method VARCHAR(255) DEFAULT '',
  analyzer VARCHAR(255) DEFAULT '',
  result_type VARCHAR(60) DEFAULT 'text',
  decimal_places INT NULL,
  default_unit VARCHAR(80) DEFAULT '',
  allowed_units JSON NULL,
  general_interpretation TEXT NULL,
  clinical_notes TEXT NULL,
  recommendation TEXT NULL,
  report_comment TEXT NULL,
  critical_value_enabled TINYINT(1) DEFAULT 0,
  auto_flag_enabled TINYINT(1) DEFAULT 1,
  auto_interpretation_enabled TINYINT(1) DEFAULT 1,
  show_method_on_report TINYINT(1) DEFAULT 1,
  show_sample_on_report TINYINT(1) DEFAULT 1,
  show_interpretation_on_report TINYINT(1) DEFAULT 1,
  show_clinical_notes_on_report TINYINT(1) DEFAULT 1,
  display_order INT DEFAULT 0,
  status VARCHAR(30) DEFAULT 'draft',
  version INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by VARCHAR(160) DEFAULT '',
  updated_by VARCHAR(160) DEFAULT '',
  INDEX idx_test_master_status (status),
  INDEX idx_test_master_department (department),
  INDEX idx_test_master_code_status (test_code, status)
);

CREATE TABLE IF NOT EXISTS test_reference_ranges (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  test_master_id BIGINT NOT NULL,
  label VARCHAR(160) DEFAULT '',
  gender VARCHAR(30) DEFAULT 'all',
  minimum_age_days INT NULL,
  maximum_age_days INT NULL,
  pregnancy_status VARCHAR(40) DEFAULT 'all',
  trimester VARCHAR(30) DEFAULT NULL,
  method VARCHAR(255) DEFAULT '',
  unit VARCHAR(80) DEFAULT '',
  lower_limit DECIMAL(18,6) NULL,
  upper_limit DECIMAL(18,6) NULL,
  lower_inclusive TINYINT(1) DEFAULT 1,
  upper_inclusive TINYINT(1) DEFAULT 1,
  text_range TEXT NULL,
  priority INT DEFAULT 0,
  enabled TINYINT(1) DEFAULT 1,
  version INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reference_ranges_test_master FOREIGN KEY (test_master_id) REFERENCES test_master_configs(id) ON DELETE CASCADE,
  INDEX idx_reference_test_enabled (test_master_id, enabled),
  INDEX idx_reference_conditions (gender, minimum_age_days, maximum_age_days, unit, method)
);

CREATE TABLE IF NOT EXISTS test_interpretation_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  test_master_id BIGINT NOT NULL,
  name VARCHAR(160) DEFAULT '',
  result_type VARCHAR(60) DEFAULT 'numeric',
  operator VARCHAR(60) DEFAULT 'between',
  minimum_value DECIMAL(18,6) NULL,
  maximum_value DECIMAL(18,6) NULL,
  qualitative_value VARCHAR(255) DEFAULT '',
  gender VARCHAR(30) DEFAULT 'all',
  minimum_age_days INT NULL,
  maximum_age_days INT NULL,
  pregnancy_status VARCHAR(40) DEFAULT 'all',
  method VARCHAR(255) DEFAULT '',
  unit VARCHAR(80) DEFAULT '',
  flag VARCHAR(20) DEFAULT '',
  severity VARCHAR(60) DEFAULT '',
  interpretation TEXT NULL,
  clinical_note TEXT NULL,
  recommendation TEXT NULL,
  priority INT DEFAULT 0,
  enabled TINYINT(1) DEFAULT 1,
  version INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_interpretation_rules_test_master FOREIGN KEY (test_master_id) REFERENCES test_master_configs(id) ON DELETE CASCADE,
  INDEX idx_rules_test_enabled (test_master_id, enabled),
  INDEX idx_rules_priority (test_master_id, priority)
);

CREATE TABLE IF NOT EXISTS test_master_audit (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  test_master_id BIGINT NULL,
  test_code VARCHAR(80) DEFAULT '',
  field_changed VARCHAR(160) NOT NULL,
  old_value LONGTEXT NULL,
  new_value LONGTEXT NULL,
  changed_by VARCHAR(160) DEFAULT '',
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  version INT DEFAULT 1,
  reason VARCHAR(255) DEFAULT '',
  INDEX idx_test_master_audit_test (test_master_id, changed_at),
  INDEX idx_test_master_audit_code (test_code, changed_at)
);

-- Preserve finalized report-time interpretation snapshots. These columns are additive only.
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS selected_reference_range JSON NULL;
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS result_flag VARCHAR(20) DEFAULT '';
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS generated_interpretation TEXT NULL;
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS final_interpretation TEXT NULL;
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS interpretation_edited TINYINT(1) DEFAULT 0;
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS interpretation_edited_by VARCHAR(160) DEFAULT '';
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS interpretation_edited_at DATETIME NULL;
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS matched_interpretation_rule_id VARCHAR(80) DEFAULT '';
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS interpretation_engine_version VARCHAR(40) DEFAULT '';
ALTER TABLE report_results ADD COLUMN IF NOT EXISTS master_test_version INT NULL;
