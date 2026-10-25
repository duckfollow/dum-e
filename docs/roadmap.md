# Product scope

## Initial alpha — implemented

PostgreSQL + SQLite. Real native connections, saved profiles, optional macOS Keychain passwords, verified remote TLS, table/view explorer, SQL tabs, bounded read-only results, filtering/sorting within a result page, row inspector, exports, themes, and a SQLite sample.

## Table inspection — implemented

Structure, indexes, incoming/outgoing foreign keys, a movable focused relationship graph, and read-only SQL definitions for PostgreSQL and SQLite. See the [implementation plan and boundaries](database-details.md).

## Full SQL — implemented

SQL available on connection, driver-native scripts, selected SQL execution, statement results/affected counts and automatic explorer refresh. PostgreSQL roles/file permissions enforce access; app-level access management is deferred. See [SQL execution](sql-execution.md).

## Explorer actions — implemented

Schema/table context menus, open/copy actions, SQL templates, rename, typed Drop confirmation, dependency checks and empty PostgreSQL schema discovery. See [explorer actions](explorer-actions.md).

## Database Relations — implemented

Database-wide declared-FK overview, isolated objects, schema/name filters, cross-schema neighbors, navigable graph and complete paginated object/FK lists. Large diagrams are explicitly bounded. See [Database Relations](database-relations.md).

## Next — everyday database work

- Connection editing/removal and clearer environment labels.
- Connection custom CA support; test verified TLS against trusted/untrusted server fixtures.
- Cancel PostgreSQL queries via protocol-level cancellation.
- Column-aware completion and saved SQL files.
- Server-side table filters/sorts with stable pagination.
- Add/Delete row using the staged transaction workflow. Cell editing with primary/composite keys, review, Apply/Discard and stale-row checks is implemented; see [cell editing](cell-editing.md).

## Later — MongoDB

MongoDB is a separate document workspace: collection browser, Extended JSON document viewer, filters, pagination, then staged document edits. It will not be forced into a SQL editor. Driver support and UX are not implemented in the current alpha.

## Outside the early scope

MySQL, unbounded/exportable ER diagrams, schema designer, plugin marketplace, cloud sync, team accounts, SSH tunnels, database administration, backup/restore, and AI query execution.
