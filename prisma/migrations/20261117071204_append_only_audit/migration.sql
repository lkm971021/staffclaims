-- Audit records are append-only: any UPDATE or DELETE is rejected by the database itself.
CREATE OR REPLACE FUNCTION reject_audit_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only (table %, op %)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modification();
CREATE TRIGGER workflow_event_append_only BEFORE UPDATE OR DELETE ON "WorkflowEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modification();
CREATE TRIGGER claim_version_append_only BEFORE UPDATE OR DELETE ON "ClaimVersion"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modification();
CREATE TRIGGER adjustment_append_only BEFORE UPDATE OR DELETE ON "Adjustment"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modification();

-- A submitted claim can never be deleted (only drafts may be discarded).
CREATE OR REPLACE FUNCTION reject_submitted_claim_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' OR OLD."firstSubmittedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Submitted claim % cannot be deleted', OLD.ref;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER claim_no_delete_after_submit BEFORE DELETE ON "Claim"
  FOR EACH ROW EXECUTE FUNCTION reject_submitted_claim_delete();

-- Paid / posted payment records cannot be removed.
CREATE OR REPLACE FUNCTION reject_posted_payment_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted payment batch % cannot be modified or deleted', OLD.ref;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_batch_posted_locked BEFORE UPDATE OR DELETE ON "PaymentBatch"
  FOR EACH ROW EXECUTE FUNCTION reject_posted_payment_change();
