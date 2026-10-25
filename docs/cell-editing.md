# Cell editing

Open a table’s Data view and double-click a cell, or choose **Edit data**. The editing window uses the current page (up to 200 rows). Focus a cell and press Enter as a keyboard alternative.

1. Enter a value and choose **Stage change**. Boolean columns offer true/false. **Set NULL** is separate from entering the text `NULL` or an empty string.
2. Edit other cells, then choose **Review changes**. Review shows original and proposed values, changed cells, and the number of directly affected rows.
3. Choose **Apply** to save the entire batch in one transaction, or **Discard** to remove all staged edits. Closing with pending edits asks before discarding.

Primary keys, including composite keys, identify rows using their original values. Tables without a primary key, views, partitioned/foreign/virtual tables, generated/identity columns and unsupported column types are read-only. Supported edited types are text, integer, decimal/real and boolean. Rows containing JSON/array/binary objects or NULL key values are read-only because their previews cannot safely represent every original value. Custom SQL results are read-only. Edit data is available only for the generated table-browsing query.

Every edited row is read and compared with its full original preview under a write lock immediately before updating. A missing or changed row causes the entire transaction to roll back. A constraint, permissions or trigger error also rolls back the batch. Use **Discard & reload** after an Apply error; do not blindly retry after a connection error, since a lost commit response can leave the commit outcome unknown. After a successful Apply, the table is refreshed and the editing window closes.

SQLite uses `BEGIN IMMEDIATE`, enables foreign-key enforcement and respects existing file permissions. PostgreSQL uses the connected role, locks the target table in SHARE ROW EXCLUSIVE mode to keep catalog and row checks stable, and locks rows before comparing them. This first implementation briefly serializes writes to the target PostgreSQL table; lock acquisition times out after three seconds. Values are bound parameters and identifiers are quoted. PostgreSQL converts bound JSON values through the table’s composite type so the database validates each target type. Large integers remain strings in the interface and are checked against the signed 64-bit range. Triggers and cascading actions may affect rows beyond the directly edited row count.

Edits remain local to the open editing window. There is no persistent draft storage. Add row and Delete row are deferred to a later iteration.

## Validation

`npm test` covers value parsing, precision, NULL semantics, reverting changes and editing eligibility. `npm run test:native` exercises a disposable SQLite database with composite keys, quoted identifiers/values, full-batch rollback, stale/deleted rows, generated columns, missing keys and foreign keys. `npm run test:postgres` runs the PostgreSQL editing integration test in the existing disposable Docker workflow.
