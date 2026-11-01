## Dum-E v0.1.0-alpha.3

This Alpha introduces an expanded Updates window and smoother table switching.

### What’s changed

- New Updates window with installed and available versions, preview/stable channel information, manual checks, and release notes.
- Daily automatic update checks against the official Dum-E GitHub releases. Downloads and installation remain manual.
- Updates window follows Dum-E’s light and dark themes and includes links to companion tools.
- Keep the current table visible while a new table’s rows and metadata load, reducing loading-screen flashes.
- Share cached table metadata between the inspector and editable grid, avoiding duplicate requests and flicker when returning to a table.
- Reset table filters, sorting, and row selection before painting the newly selected table.

### Download and installation

- Apple Silicon Macs (arm64), macOS 13.5 or later.
- Download `Dum-E_0.1.0-alpha.3_aarch64.dmg`, quit Dum-E, open the DMG, and replace Dum-E in Applications.
- Saved connections and preferences are retained. Save SQL work and finish active queries before quitting.
- `SHA256SUMS.txt` contains the installer checksum.
- The app is ad-hoc signed and passes strict bundle signature verification. It is not Developer ID signed or Apple notarized; macOS may block downloaded builds.
- Intel Macs, Windows, and Linux have not been validated. Installation on another Mac and interactive UI verification remain pending.

### Validation

- 50 frontend tests passed, including shared metadata caching, retry behavior, and stale-response protection.
- 13 native unit/SQLite/storage/update tests passed. The 4 PostgreSQL integration tests were not run for this release.
- TypeScript, production frontend build, and Rust formatting checks passed.
- Native Apple Silicon app and DMG built locally; complete app bundle signature verified.

This remains an Alpha release. Report issues with reproduction steps and sanitized screenshots at https://github.com/duckfollow/dum-e/issues.
