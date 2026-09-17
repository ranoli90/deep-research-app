CREATE TABLE IF NOT EXISTS calculation_plans (
 model_intent_id uuid PRIMARY KEY REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id),run_id uuid NOT NULL REFERENCES runs(id),task_id uuid NOT NULL REFERENCES research_tasks(id),
 extraction_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id),support_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id),
 brief_revision integer NOT NULL,evidence_revision integer NOT NULL,calculation_ids uuid[] NOT NULL
);
ALTER TABLE research_drafts ADD COLUMN IF NOT EXISTS calculation_plan_intent_id uuid REFERENCES calculation_plans(model_intent_id);
CREATE TABLE IF NOT EXISTS calculated_report_coverage (
 model_intent_id uuid PRIMARY KEY REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id),run_id uuid NOT NULL REFERENCES runs(id),task_id uuid NOT NULL REFERENCES research_tasks(id),
 writer_intent_id uuid NOT NULL REFERENCES research_drafts(writer_intent_id),support_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id),
 brief_revision integer NOT NULL,evidence_revision integer NOT NULL,checker_version text NOT NULL,result jsonb NOT NULL,compiled jsonb NOT NULL
);

-- Derived drafts and coverage cannot survive removal of their exact model provenance.
-- Explicit replacement also updates databases where this migration was rehearsed.
ALTER TABLE calculation_plans DROP CONSTRAINT IF EXISTS calculation_plans_extraction_intent_id_fkey;
ALTER TABLE calculation_plans ADD CONSTRAINT calculation_plans_extraction_intent_id_fkey FOREIGN KEY(extraction_intent_id) REFERENCES model_operation_results(intent_id) ON DELETE CASCADE;
ALTER TABLE calculation_plans DROP CONSTRAINT IF EXISTS calculation_plans_support_intent_id_fkey;
ALTER TABLE calculation_plans ADD CONSTRAINT calculation_plans_support_intent_id_fkey FOREIGN KEY(support_intent_id) REFERENCES model_operation_results(intent_id) ON DELETE CASCADE;
ALTER TABLE research_drafts DROP CONSTRAINT IF EXISTS research_drafts_calculation_plan_intent_id_fkey;
ALTER TABLE research_drafts ADD CONSTRAINT research_drafts_calculation_plan_intent_id_fkey FOREIGN KEY(calculation_plan_intent_id) REFERENCES calculation_plans(model_intent_id) ON DELETE CASCADE;
ALTER TABLE calculated_report_coverage DROP CONSTRAINT IF EXISTS calculated_report_coverage_writer_intent_id_fkey;
ALTER TABLE calculated_report_coverage ADD CONSTRAINT calculated_report_coverage_writer_intent_id_fkey FOREIGN KEY(writer_intent_id) REFERENCES research_drafts(writer_intent_id) ON DELETE CASCADE;
ALTER TABLE calculated_report_coverage DROP CONSTRAINT IF EXISTS calculated_report_coverage_support_intent_id_fkey;
ALTER TABLE calculated_report_coverage ADD CONSTRAINT calculated_report_coverage_support_intent_id_fkey FOREIGN KEY(support_intent_id) REFERENCES model_operation_results(intent_id) ON DELETE CASCADE;
