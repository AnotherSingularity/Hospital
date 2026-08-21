-- Cadence Overlay Resolver — PostgreSQL schema for the FUTURE persistence adapter.
--
-- The MVP0 proof of concept does not use this. It is provided so the in-memory
-- CatalogRepository has a real target to be replaced by.
--
-- THIS DATABASE IS NOT AUTHORIZED TO HOLD PHI. There is deliberately no patient
-- table, no appointment table, no free-text request column, and no transcript
-- column. Adding one is a governance decision, not a schema change.
--
-- P1.4: row-level security below is ONE control, not tenant isolation by itself.
-- The application must ALSO pass an explicit tenant predicate on every query.
-- RLS is the backstop for a bug in the query layer, not a substitute for it.

BEGIN;

CREATE SCHEMA IF NOT EXISTS cadence;
SET search_path TO cadence, public;

CREATE TABLE tenant (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE department (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  capabilities  text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX department_tenant_idx ON department (tenant_id);

CREATE TABLE visit_type (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  code                  text NOT NULL,
  display_name          text NOT NULL,
  duration_minutes      int  NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  specialty             text NOT NULL,
  active                boolean NOT NULL DEFAULT true,
  version               int  NOT NULL DEFAULT 1,
  body_region           text,
  laterality            text CHECK (laterality IN ('left','right','bilateral','not_applicable')),
  contrast              text CHECK (contrast IN ('with','without','with_and_without','not_applicable')),
  modality              text,
  age_bands             text[] NOT NULL DEFAULT '{adult}',
  required_capabilities text[] NOT NULL DEFAULT '{}',
  aliases               text[] NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, code)
);
CREATE INDEX visit_type_tenant_active_idx ON visit_type (tenant_id, active);

-- Governance metadata is not optional. A rule set without an owner, an approver,
-- an effective window, and a source reference cannot be published (P0.5).
CREATE TABLE rule_set (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  version            int  NOT NULL,
  status             text NOT NULL CHECK (status IN ('draft','in_review','approved','retired')),
  effective_at       timestamptz NOT NULL,
  review_at          timestamptz NOT NULL,
  approved_by        text NOT NULL,
  authored_by        text NOT NULL,
  clinical_approver  text,
  source_ref         text NOT NULL,
  schema_version     text NOT NULL,
  supersedes         text REFERENCES rule_set(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version),
  CONSTRAINT review_after_effective CHECK (review_at > effective_at),
  CONSTRAINT no_self_supersession    CHECK (supersedes IS DISTINCT FROM id),
  -- A safety rule may not be published by its own author.
  CONSTRAINT clinical_approver_distinct
    CHECK (clinical_approver IS NULL OR clinical_approver <> authored_by)
);
CREATE INDEX rule_set_active_idx ON rule_set (tenant_id, status, effective_at, review_at);

CREATE TABLE rule (
  id              text PRIMARY KEY,
  rule_set_id     text NOT NULL REFERENCES rule_set(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  priority        int  NOT NULL CHECK (priority BETWEEN 0 AND 1000),
  kind            text NOT NULL CHECK (kind IN ('requirement','eligibility','safety_screening','capability','preparation')),
  -- Validated JSON, never executable user code. Shape is enforced in the
  -- application by the Zod grammar; the check here is a coarse backstop.
  conditions      jsonb NOT NULL CHECK (jsonb_typeof(conditions) = 'object'),
  effect          jsonb NOT NULL CHECK (jsonb_typeof(effect) = 'object'),
  safety_critical boolean NOT NULL DEFAULT false,
  explanation     text NOT NULL
);
CREATE INDEX rule_set_priority_idx ON rule (rule_set_id, priority, id);

-- Audit storage. Note what is absent: no request body, no prompt, no transcript,
-- no patient identifier. Field NAMES only (P1.3).
CREATE TABLE audit_event (
  id                bigserial PRIMARY KEY,
  schema_version    text NOT NULL,
  channel           text NOT NULL CHECK (channel IN ('workflow','security')),
  event_type        text NOT NULL,
  tenant_id         text NOT NULL,
  actor_id          text NOT NULL,
  trace_id          text NOT NULL,
  occurred_at       timestamptz NOT NULL,
  input_field_names text[] NOT NULL DEFAULT '{}',
  result_state      text,
  candidate_ids     text[] NOT NULL DEFAULT '{}',
  rule_ids          text[] NOT NULL DEFAULT '{}',
  rule_set_version  int,
  latency_ms        numeric,
  outcome           text NOT NULL CHECK (outcome IN ('ok','error')),
  error_code        text
);
CREATE INDEX audit_event_tenant_time_idx ON audit_event (tenant_id, occurred_at DESC);
CREATE INDEX audit_event_channel_idx ON audit_event (channel, occurred_at DESC);

-- Append-only: audit rows may not be updated or deleted by the application role.
REVOKE UPDATE, DELETE ON audit_event FROM PUBLIC;

/* ------------------------------------------------------------------ */
/* Row-level security — the backstop, not the primary control          */
/* ------------------------------------------------------------------ */

ALTER TABLE department ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_set   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE department  FORCE ROW LEVEL SECURITY;
ALTER TABLE visit_type  FORCE ROW LEVEL SECURITY;
ALTER TABLE rule_set    FORCE ROW LEVEL SECURITY;
ALTER TABLE rule        FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;

-- Fails closed: if app.tenant_id is unset, current_setting returns '' and no
-- row matches. An unscoped query returns nothing rather than everything.
CREATE POLICY department_tenant_isolation ON department
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY visit_type_tenant_isolation ON visit_type
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY rule_set_tenant_isolation ON rule_set
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY rule_tenant_isolation ON rule
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY audit_event_tenant_isolation ON audit_event
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
