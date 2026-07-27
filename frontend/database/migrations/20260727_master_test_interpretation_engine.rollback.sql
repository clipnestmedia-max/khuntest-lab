-- Rollback for Master Test Interpretation Engine metadata tables.
-- This intentionally does not remove columns from report_results by default
-- because finalized report snapshots must be preserved.

DROP TABLE IF EXISTS test_master_audit;
DROP TABLE IF EXISTS test_interpretation_rules;
DROP TABLE IF EXISTS test_reference_ranges;
DROP TABLE IF EXISTS test_master_configs;
