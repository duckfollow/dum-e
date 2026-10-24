# Explorer object menus

Right-click a schema/table, or use the **…** button shown on hover or keyboard focus (always visible on touch devices). Menus support arrow keys, Home/End and Escape. Object-management dialogs trap focus and can be cancelled before execution.

## Table and view actions

- Open Data, Structure, Indexes, Relations or SQL definition.
- Copy qualified name, SELECT SQL or SQL definition. PostgreSQL definitions are explicitly catalog previews, not complete exports.
- Refresh the connection catalog.
- Rename: edit the name, review quoted SQL, then apply. PostgreSQL identifier names are limited to 63 UTF-8 bytes to avoid silent truncation. SQLite view renaming is unavailable.
- Drop: review SQL/dependencies, type the displayed fully qualified object name, then confirm. No automatic CASCADE. PostgreSQL uses RESTRICT for tables, views, materialized views and foreign tables.

SQLite DROP TABLE can cause implicit deletion and cascading foreign-key actions. When introspection finds incoming foreign keys from another table, the menu blocks Drop and directs the user to review dependencies in a SQL tab. Self references alone do not trigger that block. If dependency inspection fails, table/view mutations remain disabled until the user reopens the dialog and inspection succeeds. Dependency checks are a preview; concurrent schema changes and database permissions are ultimately enforced by the database.

## Schema actions

- New table opens an editable SQL template; it does not execute automatically.
- Open SQL editor starts a tab with the schema named in its title; SQL must qualify object names explicitly. Search path/session settings do not carry between Runs.
- Copy schema name; Refresh.
- PostgreSQL Rename schema and Drop schema. Drop uses RESTRICT and requires an empty schema.
- SQLite main schema cannot be renamed/dropped; those actions are disabled.

Accessible empty PostgreSQL schemas are listed alongside schemas with tables, so newly created empty schemas can be renamed/dropped. The catalog includes schemas with USAGE/CREATE privileges or role ownership; normal PostgreSQL permissions still govern actions.

## State and permissions

Mutations use the existing native SQL execution path with the selected connection's PostgreSQL role or SQLite file permissions. Every identifier is quoted; names cannot append SQL. No application permission bypass or elevation is introduced.

Successful operations refresh schemas/tables and metadata. Rename updates matching table tabs and regenerates their browsing SQL, clears their stale results, and preserves unrelated custom SQL text. Drop closes matching object tabs. SQL tabs containing manually written names are not rewritten. If execution times out or fails, review database state before retrying; earlier effects may have committed. If execution succeeds but catalog refresh fails, the UI explicitly reports success with a refresh failure instead of encouraging a repeated mutation.

These menus do not implement Truncate, full-table export, grid editing or a schema designer. CSV/JSON exports in the result toolbar continue to export the retained query preview.

## Verification

SQL-builder tests cover quoted/injection-like names, object-specific dialect syntax, RESTRICT, SQLite unsupported actions and PostgreSQL UTF-8 name limits. Real driver tests cover empty schema discovery and schema rename/drop. Desktop QA uses only the isolated sample database to verify menus, rename, confirmation gating, dependency blocking and tab/catalog synchronization.
