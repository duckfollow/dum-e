# Development

Use `npm run dev` from this repository to start Tauri and Vite together. Frontend-only preview uses `npm run dev:web`; preview deliberately cannot connect to databases. Port 1430 is reserved for Dum-E, separate from EDITH's port 1420.

`npm run build:web` checks TypeScript and bundles the UI. `npm run build` builds native bundles for the current Mac. `npm run tauri -- build --debug --bundles app` makes a debug bundle suitable for native UI testing without a Vite server. Outputs are ignored under `src-tauri/target`.

## Checks

- `npm test`: SQL identifier quoting/pagination, stable result filtering/sorting, precision-preserving JSON and spreadsheet-safe CSV.
- `npm run test:native`: actual temporary SQLite fixture, read-only query validation, null/binary/large-integer handling, preview row bounds, and cancellation.
- `npm run test:postgres`: disposable Docker PostgreSQL fixture; real connection, BIGINT/NUMERIC/BOOL/JSONB/DATE results, preview bounds, write-CTE rejection in a read-only transaction, and schema discovery.
- `cargo fmt --manifest-path src-tauri/Cargo.toml` and `npm exec prettier -- --write src scripts docs *.json *.ts *.html`: formatting.

Do not test against saved user database connections. The PostgreSQL test creates its own credentials and isolated loopback port. It stops/removes only its own uniquely named container. Docker is a test dependency, not an application dependency.

Keychain prompts/storage and verified TLS should also be tested interactively before a public release. Initial automated PostgreSQL integration uses a local non-TLS fixture; it does not establish compatibility with all hosting providers. Windows/Linux and Intel builds have not been validated.

## Upstream references

- [Tauri 2 project setup](https://v2.tauri.app/start/create-project/)
- [SQLx 0.8.6 PostgreSQL connection options](https://docs.rs/sqlx/0.8.6/sqlx/postgres/struct.PgConnectOptions.html)
- [SQLx SQLite progress handler](https://docs.rs/sqlx/0.8.6/sqlx/sqlite/struct.LockedSqliteHandle.html)
- [keyring 3.6.3 platform credential stores](https://docs.rs/keyring/3.6.3/keyring/)
