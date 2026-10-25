# Architecture

Dum-E is a standalone Tauri 2 desktop app. React/TypeScript renders the workspace; CodeMirror 6 supplies SQL editing; Lucide supplies UI icons. The arm icon is an original SVG source at `public/favicon.svg`, with generated desktop assets in `src-tauri/icons`.

## Native boundary

The frontend invokes named Tauri commands. Rust uses SQLx for PostgreSQL/SQLite and sqlparser for one-statement query validation. Database credentials never appear in a frontend connection URL. The frontend holds a typed password only while the connection dialog is open, then clears it. Rust retains credentials for connected sessions; disconnect or process exit releases them. Native macOS Keychain persistence is optional.

`connections.json` stores connection metadata and the Keychain preference only. Writes use a temporary file, fsync, and rename with owner-only permissions on Unix. Existing corrupt connection files fail visibly instead of silently resetting. Do not publish your app data folder.

The database layer has no HTTP service, Node child process, telemetry, or dependency on EDITH. Production assets are bundled and CSP restricts script/connect sources. CodeMirror uses inline styles, so style CSP allows inline styles; script CSP does not.

## Files

| File                        | Responsibility                                                                |
| --------------------------- | ----------------------------------------------------------------------------- |
| `src/main.tsx`              | Workspace UI, connection dialog, SQL tabs, result grid                        |
| `src/SqlEditor.tsx`         | CodeMirror lifecycle, dialect, shortcut, schema completions                   |
| `src/model.ts`              | Table SQL, identifier quoting, current-page filtering/sorting, export formats |
| `src/api.ts`                | Native invocation; explicit browser-preview boundary                          |
| `src/styles.css`            | Theme tokens, workbench layout, components                                    |
| `src-tauri/src/lib.rs`      | IPC, saved connections, Keychain, cancellation, export dialog                 |
| `src-tauri/src/db.rs`       | Drivers, validation, typed previews, read-only execution                      |
| `src-tauri/src/demo.sql`    | Fictional workshop data for the sample database                               |
| `scripts/test-postgres.mjs` | Isolated PostgreSQL integration test lifecycle                                |

Table inspection lives in `src/TableWorkbench.tsx` with graph identity/layout in `src/table-model.ts` and theme-aware styling in `src/table-workbench.css`. The native `src-tauri/src/metadata.rs` reads driver catalogs in read-only transactions. `table_details` reuses the selected session, returns bounded typed metadata, and never executes the SQL definition preview.

## SQL execution and permissions

The table-preview path accepts one query statement; its drivers enforce read-only behavior independently. SQLite attaches a progress handler for cancellation/deadline, opens existing files read-only, and enables `query_only`. PostgreSQL starts a read-only transaction and configures statement/lock timeouts. This is a database client, not a sandbox for malicious database functions: use database roles with suitable privileges.

Results preserve null and large integer/decimal values; a preview limit never silently labels truncated data as a complete dataset. Unknown PostgreSQL types fail with a suggestion to cast to text. Query tabs are in memory only. Sample creation writes only the app-owned sample file. The SQL editor can write when database/file permissions allow it.

`src-tauri/src/execution.rs` executes driver-native scripts through `raw_sql`, consumes all RETURNING rows past preview limits, and returns statement results plus a separate execution/preview error. Every connected session can invoke `execute_sql`; no app-level mode flag is stored. PostgreSQL roles and SQLite filesystem permissions enforce access. Browsing still uses `run_query`, with independent read-only connections. Connections are run-scoped; transactions cannot span Runs. See [SQL execution](sql-execution.md) for commit and cancellation semantics.

Database-wide relationship inspection uses `src-tauri/src/relations.rs` for bounded bulk catalog reads, `src/database-relations-model.ts` for filtering/layout, and `src/DatabaseRelations.tsx` for the separate overview tab. The graph renderer is shared with focused table Relations. See [Database Relations](database-relations.md).

`src/CellEditing.tsx` stages cell changes in a modal and shows a before/after review. `src-tauri/src/editing.rs` handles `apply_cell_edits` on a dedicated writable connection, validates actual catalog keys/columns, checks original row values under locks and commits the entire batch atomically. See [cell editing](cell-editing.md) for eligibility, concurrency and error recovery.
