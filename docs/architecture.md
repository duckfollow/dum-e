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

## Read-only alpha

SQL parsing restricts input to one query statement; the drivers enforce read-only behavior independently. SQLite attaches a progress handler for cancellation/deadline, opens existing files read-only, and enables `query_only`. PostgreSQL starts a read-only transaction and configures statement/lock timeouts. This is a database client, not a sandbox for malicious database functions: use database roles with suitable privileges.

Results preserve null and large integer/decimal values; a preview limit never silently labels truncated data as a complete dataset. Unknown PostgreSQL types fail with a suggestion to cast to text. Query tabs are in memory only. All sample writes target only the app-owned sample file.
