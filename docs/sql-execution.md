# SQL execution

## Database permissions

SQL is available immediately after connecting. There is no Full SQL toggle or app-level read-only gate. CREATE SCHEMA/TABLE/INDEX, ALTER, INSERT, UPDATE, DELETE, DROP, EXPLAIN and database-supported maintenance commands run directly with the connection's database permissions; there is no staged Apply step.

PostgreSQL username/password authenticates the connection. PostgreSQL roles, GRANT/REVOKE, role membership and object ownership determine what it can do; Dum-E never grants privileges or switches to an elevated user. The header shows the connected username and database, with host/port in its tooltip. Permission errors include the database's original message and guidance about role grants/ownership. Reconnecting keeps the same permission model without enabling a mode.

SQLite has no PostgreSQL-style user accounts: access follows the database file, parent directory and filesystem permissions. Dum-E does not change those permissions. Table browsing and metadata inspection continue to use independent read-only connections. That implementation detail does not restrict the SQL editor.

Dum-E account/role management is deferred. Future GUI Drop/Truncate actions should keep explicit confirmation and respect database permissions; direct SQL execution remains user-authored SQL and follows database semantics.

### Example PostgreSQL roles

Configure these through a database administrator; Dum-E does not run these commands automatically. Use separate login users or group roles for viewers, editors and schema owners. Do not use a superuser for everyday connections.

```sql
-- Example group roles; login users can be assigned membership separately.
CREATE ROLE dum_e_viewer NOLOGIN;
CREATE ROLE dum_e_editor NOLOGIN;

GRANT USAGE ON SCHEMA shop_demo TO dum_e_viewer, dum_e_editor;
GRANT SELECT ON ALL TABLES IN SCHEMA shop_demo TO dum_e_viewer;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA shop_demo TO dum_e_editor;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shop_demo TO dum_e_editor;
```

Create login users and configure passwords using your PostgreSQL administration workflow, then grant the appropriate group role. Grants above cover existing objects only; configure ALTER DEFAULT PRIVILEGES for each actual object-creating role when future objects should receive the same grants. Rename/drop typically require object ownership; granting INSERT/UPDATE/DELETE does not make a user a schema owner. Existing memberships, PUBLIC grants, functions and ownership also contribute privileges, so a viewer group alone does not revoke access a login already has.

## Run a statement or script

- The Run button executes the editor's whole script. **⌘ Enter** executes selected SQL when text is selected; otherwise the entire script.
- Multiple statements are passed unchanged to the database driver. Semicolons inside strings, comments, PostgreSQL dollar-quoted function bodies and SQLite triggers are handled by the driver, not a hand-written splitter.
- Choose a completed statement in the results selector to inspect its rows and database-reported affected row count. Affected counts are shown for recognized DML only; SELECT/DDL and statements the optional parser cannot classify show a dash. Parsing never rejects Full SQL. Counts are not a sum of data changes.
- The explorer refreshes after SQL script execution, including errors, because earlier changes may have committed. Existing table tabs/results are snapshots; refresh or reopen them for current data.
- A SQL tab supports up to 64 KB of input. Retain up to 100 statement results, 200 rows per result, and 4 MB total row previews. Extra results/rows are omitted from the display, but execution continues through the script. RETURNING streams are consumed to completion so preview limits do not silently stop writes.
- A result with no rows may not include column metadata in Full SQL. Unsupported PostgreSQL preview types and oversized cells are reported separately from execution; use a separate SELECT with casts to inspect data, rather than rerunning writes.

## Transactions and errors

Each Run opens a fresh native connection and closes it afterwards. Session settings, temporary tables and an open transaction do not carry between Runs. Put BEGIN, changes, and COMMIT/ROLLBACK in the **same Run**. A BEGIN without COMMIT is rolled back when that Run's connection closes.

PostgreSQL simple-query scripts normally run in one implicit transaction unless explicit transaction commands change that. SQLite normally autocommits individual statements unless BEGIN/COMMIT is supplied. No app-level transaction is added, so standalone maintenance commands such as VACUUM and PostgreSQL CREATE DATABASE can run outside a transaction; PostgreSQL commands that forbid transaction blocks must be run alone.

Completed statement results are execution receipts, not commit receipts: PostgreSQL can roll back earlier completed statements after a later error, while earlier SQLite autocommits may persist. Errors stop the script. Explicit commits can persist even if a later statement fails. There is no automatic retry.

Cancel/deadline drops the client request/connection. SQLite uses a progress interrupt; PostgreSQL may continue until the server timeout. A cancelled or timed-out write can have an uncertain outcome. Inspect database state before retrying. Existing limits remain: 15-second statement timeout, 3-second lock/busy timeout, and 20-second client request deadline. SQL can change database/session settings when the role permits it, so these are defaults, not a sandbox for untrusted SQL.

## PostgreSQL example

Connect to a disposable database with a user allowed to create schemas/tables, then run:

```sql
CREATE SCHEMA IF NOT EXISTS demo;
CREATE TABLE demo.test (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO demo.test (name) VALUES ('Dum-E'), ('EDITH') RETURNING *;
SELECT * FROM demo.test ORDER BY id;
```

## SQLite example

```sql
BEGIN;
CREATE TABLE sql_example (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);
INSERT INTO sql_example (name) VALUES ('Dum-E'), ('EDITH');
UPDATE sql_example SET name = 'Workshop' WHERE id = 1;
COMMIT;
SELECT * FROM sql_example ORDER BY id;
```

SQLite does not implement PostgreSQL CREATE SCHEMA. SQL follows each database's dialect. This is server SQL execution, not a psql/sqlite3 terminal: client commands such as `\dt`, `\copy`, `.tables`, COPY STDIN/STDOUT streaming, SQL file imports, persistent interactive transactions, and GUI row editing are not implemented.

## Verification

Temporary SQLite and disposable PostgreSQL tests exercise DDL/DML scripts, embedded semicolons, RETURNING past the row limit, affected counts, read-only browsing isolation, restricted PostgreSQL login permissions, driver-specific partial failure, and explicit rollback. Tests never use saved user connections.
