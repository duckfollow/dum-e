CREATE SCHEMA catalog_test;
CREATE TYPE catalog_test.workflow_status AS ENUM ('queued', 'done');
CREATE DOMAIN catalog_test.small_code AS text CHECK (length(VALUE) <= 16);
CREATE TABLE catalog_test.parent (tenant text NOT NULL, code integer NOT NULL, PRIMARY KEY (code, tenant));
CREATE TABLE catalog_test.child (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant text,
 parent_code integer,
 label text NOT NULL DEFAULT 'untitled',
 status catalog_test.workflow_status NOT NULL DEFAULT 'queued',
 code catalog_test.small_code,
 self_parent bigint REFERENCES catalog_test.child(id),
 computed text GENERATED ALWAYS AS (lower(label)) STORED,
 CONSTRAINT child_parent_fk FOREIGN KEY (parent_code, tenant) REFERENCES catalog_test.parent(code, tenant) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(label),
 CHECK (parent_code >= 0)
);
COMMENT ON TABLE catalog_test.child IS 'Metadata integration fixture';
COMMENT ON COLUMN catalog_test.child.status IS 'Workflow status';
CREATE INDEX child_expression_partial ON catalog_test.child (lower(label)) INCLUDE (status) WHERE parent_code IS NOT NULL;
CREATE TABLE catalog_test."odd""table" ("odd""column" text DEFAULT 'quoted');
CREATE VIEW catalog_test.child_view AS SELECT id,label FROM catalog_test.child;
CREATE MATERIALIZED VIEW catalog_test.child_materialized AS SELECT id FROM catalog_test.child WITH NO DATA;

CREATE SCHEMA IF NOT EXISTS shop_demo;
CREATE TYPE shop_demo.dum_e_preview_status AS ENUM ('ready');
CREATE TABLE shop_demo.dum_e_preview_types (
    id integer,
    active_drug_ids text[],
    numbers integer[],
    duration interval,
    "IP""address" inet,
    status shop_demo.dum_e_preview_status,
    payload jsonb
);
INSERT INTO shop_demo.dum_e_preview_types VALUES
    (2, '{}', ARRAY[10], NULL, NULL, NULL, NULL),
    (1, ARRAY['alpha', NULL], ARRAY[2], '1 day', '10.0.0.1', 'ready', '{"a":1}'),
    (3, NULL, NULL, NULL, NULL, NULL, NULL);
