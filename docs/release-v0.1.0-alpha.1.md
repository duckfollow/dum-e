# Dum-E v0.1.0-alpha.1

First macOS Alpha for early testers. Dum-E is a local database workspace for PostgreSQL and SQLite.

## Packaging correction

The initial DMG contained an incomplete linker-only signature and failed app-bundle signature verification. The replacement uses explicit ad-hoc signing of the complete app and passes strict signature verification. This corrects bundle integrity; it does not provide Developer ID trust or notarization. Downloaded builds may still be blocked by macOS.

## Download

- macOS 13.5 or later, Apple Silicon (arm64).
- Open the DMG and drag Dum-E into Applications.
- This Alpha is not Developer ID signed or notarized. macOS may prevent it from opening. It is intended for a small group of testers; a signed public build is still pending.
- Intel Macs, Windows and Linux are not validated in this release.

## Included

- Saved connections and optional macOS Keychain password storage.
- SQL editor with multiple tabs, selected SQL execution and statement results.
- Table/schema explorer, structure, indexes and foreign-key relationship diagrams.
- Inline Add/Edit/Delete for primary-key tables, Save/Discard, atomic transactions and stale-row checks.
- Auto refresh with configurable intervals and a compact countdown.
- JSON viewer with expandable Tree, Formatted/Raw views, search and copy. Exact JSON numbers and JSON null are preserved.
- CSV/JSON export, row inspector, paging, and light/dark themes.
- Local SQLite sample available through Explore a sample.

## Known limits

- This is an Alpha, not a stable release. Use test data or a disposable copy for initial evaluation.
- SQL runs with the connected database user's or SQLite file's permissions. Changes made by running SQL apply directly.
- Preview limits: 200 rows, 64 KiB per cell and 4 MiB per Run. Current-page search/sort does not query the whole table.
- SQL tabs and query history are session-only and disappear when the app exits.
- MongoDB, MySQL, SSH tunnels and backup/restore are not supported.
- Remote PostgreSQL requires verified TLS with a trusted certificate. Custom CA and client-certificate authentication are not supported.
- Keychain prompts and remote TLS compatibility still need independent release testing.

## Report a problem

Open an issue at https://github.com/duckfollow/dum-e/issues with your macOS version, chip type, database type/version, steps to reproduce, and expected/actual behavior. Remove credentials, connection details and private data from queries or screenshots before attaching them.

## Release validation

Automated checks cover the frontend, native SQLite and isolated PostgreSQL 17. A production arm64 DMG is built locally. Installation and launch on another Mac remain pending; this release does not claim that verification.
