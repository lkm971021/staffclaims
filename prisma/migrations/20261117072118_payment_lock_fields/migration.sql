-- Posted payment batches: financial fields are locked; only the Drive archive reference may be filled in later.
CREATE OR REPLACE FUNCTION reject_posted_payment_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Posted payment batch % cannot be deleted', OLD.ref;
    END IF;
    IF (NEW.ref, NEW."companyId", NEW."paymentDate", NEW.method, NEW."bankRef", NEW.status, NEW."postedById", NEW."postedAt", NEW."proofDocKey")
       IS DISTINCT FROM
       (OLD.ref, OLD."companyId", OLD."paymentDate", OLD.method, OLD."bankRef", OLD.status, OLD."postedById", OLD."postedAt", OLD."proofDocKey") THEN
      RAISE EXCEPTION 'Posted payment batch % cannot be modified', OLD.ref;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Items of a posted batch cannot be removed or changed.
CREATE OR REPLACE FUNCTION reject_posted_item_change() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "PaymentBatch" WHERE id = OLD."batchId";
  IF st = 'POSTED' THEN
    RAISE EXCEPTION 'Items of a posted payment batch cannot be modified';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_item_posted_locked BEFORE UPDATE OR DELETE ON "PaymentItem"
  FOR EACH ROW EXECUTE FUNCTION reject_posted_item_change();
