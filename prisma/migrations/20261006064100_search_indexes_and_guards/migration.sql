-- Raw SQL that Prisma's schema language cannot express.
-- NOTE for future `prisma migrate dev` runs: Prisma does not model these objects. If a generated
-- migration tries to DROP any index/trigger/function below, delete those statements before applying.

-- ---------------------------------------------------------------------------
-- Full-text search on resource chunks (mock-mode retrieval + hybrid ranking)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION socra_resource_chunk_tsvector() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."headingPath", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."content", '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER resource_chunk_tsvector_trg
  BEFORE INSERT OR UPDATE OF "content", "headingPath" ON "ResourceChunk"
  FOR EACH ROW EXECUTE FUNCTION socra_resource_chunk_tsvector();

CREATE INDEX "ResourceChunk_searchVector_gin_idx" ON "ResourceChunk" USING GIN ("searchVector");

-- ---------------------------------------------------------------------------
-- Vector similarity (cosine) — pgvector HNSW
-- ---------------------------------------------------------------------------
CREATE INDEX "ResourceChunk_embedding_hnsw_idx" ON "ResourceChunk"
  USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "PracticeItem_embedding_hnsw_idx" ON "PracticeItem"
  USING hnsw ("embedding" vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Append-only guards
-- A retention job may purge rows by running, inside its transaction:
--   SELECT set_config('socra.retention_purge', 'on', true);
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION socra_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('socra.retention_purge', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Table "%" is append-only (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$ LANGUAGE plpgsql;

-- AuditLog: no UPDATE, DELETE only during retention purge.
CREATE TRIGGER audit_log_append_only_trg
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION socra_block_mutation();

-- HeldOutEvalItem: permanent evaluation set.
CREATE TRIGGER held_out_eval_append_only_trg
  BEFORE UPDATE OR DELETE ON "HeldOutEvalItem"
  FOR EACH ROW EXECUTE FUNCTION socra_block_mutation();

-- AnalyticsEvent: immutable envelope; only status/quarantineReason may change (quarantine).
CREATE OR REPLACE FUNCTION socra_analytics_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('socra.retention_purge', true), 'off') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'AnalyticsEvent is append-only (DELETE blocked)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'quarantineReason') <> (to_jsonb(OLD) - 'status' - 'quarantineReason') THEN
    RAISE EXCEPTION 'AnalyticsEvent is append-only (only status/quarantineReason may change)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER analytics_event_guard_trg
  BEFORE UPDATE OR DELETE ON "AnalyticsEvent"
  FOR EACH ROW EXECUTE FUNCTION socra_analytics_event_guard();

-- LearningEvidence: append-only; corrections are recorded via invalidatedAt/invalidationReason only.
CREATE OR REPLACE FUNCTION socra_learning_evidence_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('socra.retention_purge', true), 'off') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'LearningEvidence is append-only (DELETE blocked)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'invalidatedAt' - 'invalidationReason') <> (to_jsonb(OLD) - 'invalidatedAt' - 'invalidationReason') THEN
    RAISE EXCEPTION 'LearningEvidence is append-only (only invalidatedAt/invalidationReason may change)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER learning_evidence_guard_trg
  BEFORE UPDATE OR DELETE ON "LearningEvidence"
  FOR EACH ROW EXECUTE FUNCTION socra_learning_evidence_guard();
