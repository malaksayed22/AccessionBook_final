-- Integrity layer: guarantees Prisma cannot express. The application services enforce the same
-- rules first (for good error messages); these make a violation impossible even if a service has a bug.
-- See docs/domain-model.md.

-- ---------------------------------------------------------------------------
-- Physical sanity
-- ---------------------------------------------------------------------------
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_quantities_check"
  CHECK (("humidWeight" IS NULL OR "humidWeight" >= 0)
     AND ("dryWeight" IS NULL OR "dryWeight" >= 0)
     AND ("seedCount" IS NULL OR "seedCount" >= 0));
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_sequence_check" CHECK ("sequence" >= 1);
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_destroyed_reason_check"
  CHECK ("kind" <> 'DESTROYED' OR ("reason" IS NOT NULL AND btrim("reason") <> ''));
ALTER TABLE "UnitState" ADD CONSTRAINT "UnitState_witness_not_actor_check"
  CHECK ("witnessId" IS NULL OR "witnessId" <> "recordedById");
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_quantity_check"
  CHECK (("unitCount" IS NULL OR "unitCount" >= 0) AND ("weightGrams" IS NULL OR "weightGrams" >= 0));
ALTER TABLE "Location" ADD CONSTRAINT "Location_capacity_check"
  CHECK ("capacity" IS NULL OR "capacity" >= 0);
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_limits_check"
  CHECK ("limitMin" IS NULL OR "limitMax" IS NULL OR "limitMin" <= "limitMax");

-- ---------------------------------------------------------------------------
-- Case-insensitive uniqueness
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "User_name_lower_key" ON "User" (lower("name"));
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email")) WHERE "email" IS NOT NULL;
CREATE UNIQUE INDEX "Organization_name_lower_key" ON "Organization" (lower("name"));

-- ---------------------------------------------------------------------------
-- Unit state chain: immutable, contiguous, nothing after a terminal event
-- ---------------------------------------------------------------------------
CREATE FUNCTION unit_state_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev_sequence integer;
  prev_kind "UnitStateKind";
BEGIN
  SELECT "sequence", "kind" INTO prev_sequence, prev_kind
  FROM "UnitState" WHERE "unitId" = NEW."unitId" ORDER BY "sequence" DESC LIMIT 1;

  IF NEW."sequence" <> COALESCE(prev_sequence, 0) + 1 THEN
    RAISE EXCEPTION 'UnitState sequence for unit % must be % (got %)',
      NEW."unitId", COALESCE(prev_sequence, 0) + 1, NEW."sequence"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF prev_kind IN ('SHIPPED', 'DESTROYED') THEN
    RAISE EXCEPTION 'Unit % has left inventory (%): no further events are allowed', NEW."unitId", prev_kind
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF prev_sequence IS NULL AND NEW."kind" NOT IN ('CREATED', 'RECEIVED') THEN
    RAISE EXCEPTION 'The first event of a unit must be CREATED or RECEIVED (got %)', NEW."kind"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER unit_state_sequence
  BEFORE INSERT ON "UnitState"
  FOR EACH ROW EXECUTE FUNCTION unit_state_before_insert();

CREATE FUNCTION reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER unit_state_immutable
  BEFORE UPDATE OR DELETE ON "UnitState"
  FOR EACH ROW EXECUTE FUNCTION reject_change();

-- The unit's pointer must name its own newest state.
CREATE FUNCTION unit_current_state_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."currentStateId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "UnitState" s
    WHERE s."id" = NEW."currentStateId"
      AND s."unitId" = NEW."id"
      AND s."sequence" = (SELECT max("sequence") FROM "UnitState" WHERE "unitId" = NEW."id")
  ) THEN
    RAISE EXCEPTION 'currentStateId % is not the newest state of unit %', NEW."currentStateId", NEW."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER unit_current_state
  BEFORE INSERT OR UPDATE OF "currentStateId" ON "BiologicalUnit"
  FOR EACH ROW EXECUTE FUNCTION unit_current_state_check();

-- ---------------------------------------------------------------------------
-- Holds: one active hold per unit; released holds are history
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "UnitHold_one_active_per_unit" ON "UnitHold" ("unitId") WHERE "releasedAt" IS NULL;
ALTER TABLE "UnitHold" ADD CONSTRAINT "UnitHold_release_consistency_check"
  CHECK (("releasedAt" IS NULL) = ("releasedById" IS NULL));

CREATE FUNCTION unit_hold_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'UnitHold rows are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."releasedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A released hold is history and cannot change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."unitId" <> OLD."unitId" OR NEW."kind" <> OLD."kind" OR NEW."reason" <> OLD."reason"
     OR NEW."origin" <> OLD."origin" OR NEW."placedById" <> OLD."placedById" OR NEW."placedAt" <> OLD."placedAt" THEN
    RAISE EXCEPTION 'Only the release fields of a hold may change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER unit_hold_guard
  BEFORE UPDATE OR DELETE ON "UnitHold"
  FOR EACH ROW EXECUTE FUNCTION unit_hold_guard();

-- ---------------------------------------------------------------------------
-- Regulated records are voided (with who and why), never deleted
-- ---------------------------------------------------------------------------
ALTER TABLE "UnitAttachment" ADD CONSTRAINT "UnitAttachment_void_check"
  CHECK ("voidedAt" IS NULL OR ("voidedById" IS NOT NULL AND btrim(coalesce("voidReason", '')) <> ''));
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_void_check"
  CHECK ("voidedAt" IS NULL OR ("voidedById" IS NOT NULL AND btrim(coalesce("voidReason", '')) <> ''));
ALTER TABLE "QualityIncident" ADD CONSTRAINT "QualityIncident_void_check"
  CHECK ("voidedAt" IS NULL OR ("voidedById" IS NOT NULL AND btrim(coalesce("voidReason", '')) <> ''));
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_void_check"
  CHECK ("voidedAt" IS NULL OR ("voidedById" IS NOT NULL AND btrim(coalesce("voidReason", '')) <> ''));

CREATE FUNCTION reject_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted; void them instead', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER unit_attachment_no_delete BEFORE DELETE ON "UnitAttachment"
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER lab_test_no_delete BEFORE DELETE ON "LabTest"
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER quality_incident_no_delete BEFORE DELETE ON "QualityIncident"
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER shipment_no_delete BEFORE DELETE ON "Shipment"
  FOR EACH ROW EXECUTE FUNCTION reject_delete();
CREATE TRIGGER unit_activity_no_delete BEFORE DELETE ON "UnitActivity"
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- ---------------------------------------------------------------------------
-- Experiment codes: atomic per-prefix counter (no max+1 race)
-- ---------------------------------------------------------------------------
CREATE FUNCTION next_experiment_number(p_prefix text) RETURNS integer
LANGUAGE sql AS $$
  INSERT INTO "ExperimentCodeCounter" ("prefix", "lastNumber") VALUES (p_prefix, 1)
  ON CONFLICT ("prefix") DO UPDATE SET "lastNumber" = "ExperimentCodeCounter"."lastNumber" + 1
  RETURNING "lastNumber"
$$;

-- ---------------------------------------------------------------------------
-- Tamper-evident audit trail
--   * append-only: UPDATE, DELETE and TRUNCATE are rejected by the database
--   * hash-chained: every row stores the hash of its predecessor, so altering or
--     removing any row in the middle of history is detectable (audit_verify_chain)
--   * seq / prevHash / hash are assigned here, under a lock, never by the app
-- ---------------------------------------------------------------------------
CREATE FUNCTION audit_row_hash(r "AuditLog") RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(
    sha256(convert_to(
      concat_ws('|',
        r."prevHash", r."seq"::text, r."userId"::text, r."userName", r."userRole",
        r."entityType", r."entityId"::text, r."entityLabel", r."action", r."summary",
        coalesce(r."details"::text, ''), coalesce(r."reason", ''), coalesce(r."requestId", ''),
        coalesce(r."ip", ''), coalesce(r."userAgent", ''),
        to_char(r."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS')
      ), 'UTF8')),
    'hex')
$$;

CREATE FUNCTION audit_chain_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq integer;
  last_hash text;
BEGIN
  -- One writer at a time keeps the chain linear even under concurrent requests.
  PERFORM pg_advisory_xact_lock(7240001);
  SELECT "seq", "hash" INTO last_seq, last_hash FROM "AuditLog" ORDER BY "seq" DESC LIMIT 1;
  NEW."seq" := COALESCE(last_seq, 0) + 1;
  NEW."prevHash" := COALESCE(last_hash, '');
  NEW."createdAt" := date_trunc('milliseconds', NEW."createdAt");
  NEW."hash" := audit_row_hash(NEW);
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_chain
  BEFORE INSERT ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_chain_before_insert();

CREATE FUNCTION audit_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER audit_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_reject_change();

CREATE TRIGGER audit_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_change();

-- Returns no rows when the chain is intact, otherwise the first broken position.
CREATE FUNCTION audit_verify_chain()
RETURNS TABLE (broken_seq integer, reason text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r "AuditLog";
  expected_seq integer := 0;
  expected_prev text := '';
BEGIN
  FOR r IN SELECT * FROM "AuditLog" ORDER BY "seq" LOOP
    expected_seq := expected_seq + 1;
    IF r."seq" <> expected_seq THEN
      broken_seq := r."seq";
      reason := format('sequence gap or reorder (expected %s)', expected_seq);
      RETURN NEXT;
      RETURN;
    END IF;
    IF r."prevHash" <> expected_prev THEN
      broken_seq := r."seq";
      reason := 'previous-hash link broken (a row before this one was altered or removed)';
      RETURN NEXT;
      RETURN;
    END IF;
    IF r."hash" <> audit_row_hash(r) THEN
      broken_seq := r."seq";
      reason := 'row content does not match its hash (row was altered)';
      RETURN NEXT;
      RETURN;
    END IF;
    expected_prev := r."hash";
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Unit names are printed on barcode labels, so "P1" and "p1" must never coexist.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "BiologicalUnit_name_lower_key" ON "BiologicalUnit" (lower("name"));
