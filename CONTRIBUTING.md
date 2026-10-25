# Contributing to Dum-E

Bug reports, improvements, and pull requests are welcome. Please open an issue to discuss larger changes before implementing them.

## Development

Use macOS 13.5+, Node.js 22.18+/24+, Rust stable, and Xcode Command Line Tools.

```sh
git clone https://github.com/duckfollow/dum-e.git
cd dum-e
npm ci
npm run dev
```

The frontend is in `src/`; database drivers, metadata, query execution, and editing are in `src-tauri/src/`. See [architecture](docs/architecture.md) and [development notes](docs/development.md).

## Validation

```sh
npm test
npm run build:web
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run test:native
npm run test:postgres
```

The PostgreSQL integration test requires Docker and uses a disposable PostgreSQL 17 container on a random loopback port. It never reads saved connections. Run it when changing database operations. macOS CI runs frontend and native unit tests; the Docker integration test is run separately.

Use a separate Tauri application identifier for UI experiments so test data does not replace real saved connections. Never test writes or destructive actions against a production database. Do not commit passwords, connection profiles, database dumps, or private data in logs/screenshots. Bug reports should include the app version, macOS version, database type/version, and reproduction steps with sanitized sample data.

Describe the problem, resulting behavior, and relevant validation in each PR. Contributions are provided under the project's MIT license.

## Third-party notices

After `npm ci`, maintainers can regenerate the macOS dependency notices with:

```sh
python3 scripts/third-party-notices.py
```

This requires Python 3, Cargo, and network access for license texts omitted from registry packages. Missing license texts are fetched from the crate's recorded upstream commit.
