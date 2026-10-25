# Edit data directly in the table

Open a table’s **Data** view. The main grid is the editor; there is no separate editing window, Stage step or mandatory Review screen.

- **Edit:** double-click a cell, or focus it and press Enter/F2. Type a value and press Enter or leave the cell to finish. Escape cancels the current cell. Changed cells are highlighted.
- **Add:** choose **Add row**. A new row appears at the bottom and its first ordinary editable cell receives focus. Generated keys/columns show **Auto**, database defaults show **Default**, and required values show **Required**. Omitted values use database defaults. Selecting Value and entering an empty string is different from selecting NULL or Default.
- **Delete:** select row checkboxes, then choose **Delete**. Existing rows stay visible with a strikethrough until saved; their Undo button restores them, including earlier unsaved cell edits. Removing an unsaved new row only removes its local draft.
- **Save:** choose **Save** or press ⌘S/Ctrl+S in the grid. The toolbar summarizes new, edited and deleted rows. A batch containing deletes asks for one confirmation before saving. All operations use one transaction.
- **Discard:** clears pending changes. Auto refresh pauses while editing, and navigation/query actions ask you to save or discard first. Drafts are session-only; closing the app with pending edits invokes the webview’s unsaved-changes handling where supported.

Only generated table-browsing results are editable. Custom SQL results, views, tables without a Primary Key, foreign/partitioned/virtual tables, generated/identity columns and unsupported edited types remain read-only. Composite keys are supported. Supported values are text, integer, decimal/real, boolean and explicit NULL. Existing rows containing JSON/array/binary preview objects or NULL keys are read-only. PostgreSQL JSON/JSONB rows are read-only even for scalar JSON, to distinguish JSON null from SQL NULL.

Every update/delete reads the original row under a write lock and compares its full preview before writing. A changed/missing row or any constraint/permission error rolls back the entire batch, including inserts. SQLite enables foreign keys and uses BEGIN IMMEDIATE. PostgreSQL uses the connected role and SHARE ROW EXCLUSIVE locking to stabilize catalog/row checks, with a three-second lock timeout. Updates/deletes are executed first, then inserts; database constraints and triggers determine whether the batch can succeed. There is no automatic dependency reordering.

Identifiers are quoted; values are bound. PostgreSQL converts bound JSON through the table’s composite type so target types are validated by the database. Inserts include only explicitly set columns, preserving identity, generated-column and default behavior. Large integer edits remain strings and are checked against the signed 64-bit range. The batch is limited to 200 changed rows and 8 MB. Triggers/cascades can affect additional rows beyond the toolbar’s direct row count.

After a failed Save, edits cannot be retried blindly: reload to check the database, since a lost commit response may leave the outcome unknown. Discard can release the draft without navigating to the database. After a confirmed commit, the batch is cleared before reloading, so a reload failure cannot duplicate inserts or repeat writes.

## Validation

`npm test` covers parsing, NULL/precision, edits, mutation batches, deletion undo and snapshot updates after inserts. `npm run test:native` exercises real temporary SQLite fixtures. `npm run test:postgres` runs the same update/insert/delete scenarios in a disposable PostgreSQL Docker container. These cover mixed-operation atomicity, defaults/generated IDs, stale/deleted rows, quoted names/values, constraints and rollback.
