# Dum-E

**Your little database helper.** A small, local-first database workspace for macOS, built with Tauri, React, TypeScript, and Rust.

## Current alpha

- PostgreSQL and SQLite connections, saved on this device.
- Test connection; verified TLS for remote PostgreSQL.
- Optional password storage in macOS Keychain; passwords are never written to the connections file or browser storage.
- Tables/views explorer and schema refresh.
- SQL editor with syntax highlighting, table-name completions, multiple tabs, and ⌘ Enter.
- Read-only SELECT / WITH queries, previewed up to 200 rows.
- Current-page filtering/sorting, table paging, and row inspector.
- CSV / JSON export through a native save dialog.
- Light, Dark, and System appearance.
- A real SQLite sample database via **Explore a sample**.

This alpha is **read-only**. Editing rows, DDL, MongoDB, SSH tunnels, and backup/restore are not implemented. MySQL is intentionally out of scope. SQL tabs/results live in memory and are discarded when the app exits.

## Run locally

Requirements: macOS 13.5+, Node.js 22.18+ or 24+, npm, Rust stable, and Xcode Command Line Tools. macOS is the current development target; other platforms are not validated.

```sh
cd /Users/tankps/Documents/project-github/dum-e
npm ci
npm run dev
```

`npm run dev` starts the desktop app and its own Vite server on `127.0.0.1:1430`. Do not start `dev:web` separately first. **Explore a sample** opens a real SQLite file without credentials. Click a table to browse it, or run the sample query with ⌘ Enter.

```sh
npm run dev:web     # UI preview only; database connections require the desktop app
npm run build:web   # TypeScript check + frontend production build
npm run build      # Build native .app / .dmg for this Mac
```

The packaged app talks directly to databases through native Rust commands. No separate local HTTP server or bundled Node runtime is needed after installation. Developer ID signing and notarization are not configured.

## Connect to your database

**SQLite:** New connection → SQLite → choose an existing database file → Test connection → Connect. Dum-E does not create or migrate the selected file.

**PostgreSQL:** Enter name, host, port, database, username, and password. Verified TLS is enabled by default. TLS can be disabled for `localhost`, `127.0.0.1`, or `::1` only. Remote connections require a trusted certificate matching the hostname; self-signed/custom CA upload and client certificate authentication are not implemented yet. Remember password is opt-in and uses macOS Keychain.

## Data and limits

Connection metadata is stored at `~/Library/Application Support/com.duckfollow.dum-e/connections.json`, separately from EDITH. The file does not contain passwords. SQLite sample data is stored in the same folder as `workshop-sample.sqlite`. Closing/disconnecting releases in-memory session credentials; active sessions are not restored automatically on launch.

- One SELECT / WITH statement per Run; SQL is parsed before execution.
- SQLite files are opened read-only with `query_only=ON`. PostgreSQL uses a read-only transaction and server-side timeouts. Database privileges still determine what data can be read; use an appropriate database role.
- 200 preview rows, 64 KB per cell, 4 MB per result, 64 KB query text.
- PostgreSQL connection timeout: 8 seconds; statement timeout: 15 seconds; client request deadline: 20 seconds.
- SQLite progress callbacks interrupt long-running queries on cancellation/deadline.
- Cancel stops the UI request and drops the native connection. PostgreSQL can continue server-side until its statement timeout (up to 15 seconds).
- Page controls appear for table browsing. Add an `ORDER BY` on a stable unique key for consistent pagination. Editing the generated SQL turns the tab into a custom query.
- Filters and header sorting affect the current result page only. Exports contain the whole retained result, not just filtered rows.
- Integers and exact decimals are represented as strings to avoid JavaScript precision loss. JSON exports preserve a `{ columns, rows }` matrix, including duplicate column names and nulls. Unsupported PostgreSQL types produce a clear error; cast these columns to text in SQL.
- Binary data is a labeled byte count / hex preview, not a full binary export. CSV prefixes potential spreadsheet formulas with an apostrophe and represents SQL NULL as an empty field. Use JSON for unambiguous NULL / empty-string distinction.
- Query history is the open tabs for this session, not a persistent audit log. No telemetry or cloud account is included.

## Validation

```sh
npm run check
npm test
npm run test:native
npm run test:postgres
```

The last command requires Docker. It creates a disposable PostgreSQL 17 container on a random loopback port, seeds test-only data, runs the PostgreSQL integration test, and stops the container in `finally`. It never uses your saved connections.

See [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [development notes](docs/development.md).
