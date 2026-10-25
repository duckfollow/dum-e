# Development

Use `npm run dev` from this repository to start Tauri and Vite together. Frontend-only preview uses `npm run dev:web`; preview deliberately cannot connect to databases. Port 1430 is reserved for Dum-E, separate from EDITH's port 1420.

`npm run build:web` checks TypeScript and bundles the UI. `npm run build` builds native bundles for the current Mac. `npm run tauri -- build --debug --bundles app` makes a debug bundle suitable for native UI testing without a Vite server. Outputs are ignored under `src-tauri/target`.

## Checks

- `npm test`: SQL identifier quoting/pagination, stable result filtering/sorting, precision-preserving JSON and spreadsheet-safe CSV; qualified graph identities, composite/self relationships, and bounded graph layout.
- `npm run test:native`: actual temporary SQLite fixture, read-only query validation, null/binary/large-integer handling, preview row bounds, and cancellation; real SQLite metadata, nullable/STRICT primary keys, generated columns, partial/expression indexes, quoted names, and composite/incoming foreign keys.
- `npm run test:postgres`: disposable Docker PostgreSQL fixture; real connection, BIGINT/NUMERIC/BOOL/JSONB/DATE results, preview bounds, write-CTE rejection in a read-only transaction, and schema discovery; catalog metadata with enum/domain/identity/generated columns, composite/self foreign keys, index expressions/INCLUDE/predicates, views, and definition previews.
- `cargo fmt --manifest-path src-tauri/Cargo.toml` and `npm exec prettier -- --write src scripts docs *.json *.ts *.html`: formatting.

Do not test against saved user database connections. The PostgreSQL test creates its own credentials and isolated loopback port. It stops/removes only its own uniquely named container. Docker is a test dependency, not an application dependency.

Keychain prompts/storage and verified TLS should also be tested interactively before a public release. Initial automated PostgreSQL integration uses a local non-TLS fixture; it does not establish compatibility with all hosting providers. Windows/Linux and Intel builds have not been validated.

## Upstream references

- [Tauri 2 project setup](https://v2.tauri.app/start/create-project/)
- [SQLx 0.8.6 PostgreSQL connection options](https://docs.rs/sqlx/0.8.6/sqlx/postgres/struct.PgConnectOptions.html)
- [SQLx SQLite progress handler](https://docs.rs/sqlx/0.8.6/sqlx/sqlite/struct.LockedSqliteHandle.html)
- [keyring 3.6.3 platform credential stores](https://docs.rs/keyring/3.6.3/keyring/)

## Full SQL checks

Native fixtures also cover full scripts: CREATE/ALTER/DROP, INSERT/UPDATE/DELETE, RETURNING beyond preview limits, affected counts, explicit rollback and differing SQLite/PostgreSQL failure semantics. UI checks use an isolated sample: run a script immediately after connecting, switch statement results, and confirm explorer refresh. No Full SQL toggle should appear. The header must show the PostgreSQL username/database. A restricted PostgreSQL login must be able to SELECT permitted tables while INSERT/CREATE fail with a useful permission message; reconnect must work without enabling a mode.

## Table details UI checks

Use **Explore a sample**, then open `mission_assignments`. Inspect Structure, Indexes, Relations, and SQL; follow a graph node to another table, zoom/reset and move nodes. Check both themes. The versioned sample includes compound keys, incoming/outgoing/self references, a generated column and a partial index. Metadata refresh must not overwrite another selected table.

## macOS release integrity

Local builds use explicit ad-hoc bundle signing (`signingIdentity: "-"`) so the entire app has a sealed, verifiable signature. `npm run build` verifies the finished bundle with `codesign --verify --deep --strict`. A valid DMG checksum alone does not verify the enclosed app signature. Ad-hoc signing is not Developer ID signing or notarization and does not make downloaded builds trusted by Gatekeeper. For public distribution, override the signing identity with the Developer ID Application certificate, notarize, and test a downloaded build on another Mac.
