# Saved connections

Connections are stored on this Mac and loaded into the sidebar when Dum-E opens. No cloud account is required.

## Save or connect

In New connection, enter PostgreSQL server settings or select an existing SQLite file:

- **Save** stores the profile without contacting the database or opening a session. PostgreSQL can be saved while the server is offline. Local field validation still applies; SQLite requires an existing file.
- **Save & connect** connects first, then saves the profile after a successful connection (the existing automatic-save behavior).
- **Test connection** checks access without saving a profile or retaining the typed password.

Click a saved sidebar entry to reconnect. A PostgreSQL profile without a remembered password opens the connection dialog so the password can be entered. Saved credentials and local SQLite profiles can reconnect directly. Connections do not automatically open at app launch.

## Passwords and storage

Host, port, database, username, file path and profile name live in `~/Library/Application Support/com.duckfollow.dum-e/connections.json`. Passwords are never serialized to that file or browser storage.

**Remember password** is opt-in and stores the supplied PostgreSQL password in macOS Keychain. Save with a blank password preserves an existing Keychain entry; Save does not fetch the password or verify database authentication. With Remember password off, the typed password is not retained, and a previous Keychain entry for the profile is removed. The dialog clears its password after successful saving/connection and closes.

Saving an active connection through the native command is rejected; disconnect before changing a saved configuration. A separate saved-connection editing/removal interface is not part of this change.

## Verification

Desktop QA saves an isolated PostgreSQL test profile without connecting, checks that no session was opened, restarts the isolated app and verifies the profile is loaded. All database integration tests use disposable fixtures; no saved user database is used.
