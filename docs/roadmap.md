# Product scope

## Initial alpha — implemented

PostgreSQL + SQLite. Real native connections, saved profiles, optional macOS Keychain passwords, verified remote TLS, table/view explorer, SQL tabs, bounded read-only results, filtering/sorting within a result page, row inspector, exports, themes, and a SQLite sample.

## Next — everyday database work

- Column details, primary/foreign keys, indexes, and object search.
- Connection editing/removal and clearer environment labels.
- Connection custom CA support; test verified TLS against trusted/untrusted server fixtures.
- Cancel PostgreSQL queries via protocol-level cancellation.
- SQL selection execution, column-aware completion, saved SQL files.
- Server-side table filters/sorts with stable pagination.
- Row editing only with a stable key; staged changes, parameterized writes, transaction preview, explicit Apply/rollback.
- Separate write-enabled connection mode with clear environment cues.

## Later — MongoDB

MongoDB is a separate document workspace: collection browser, Extended JSON document viewer, filters, pagination, then staged document edits. It will not be forced into a SQL editor. Driver support and UX are not implemented in the current alpha.

## Outside the early scope

MySQL, ER diagrams, schema designer, plugin marketplace, cloud sync, team accounts, SSH tunnels, database administration, backup/restore, and AI query execution.
