# JSON viewer

Click the JSON badge in a result cell or the row inspector to open a read-only snapshot. PostgreSQL JSON/JSONB columns support objects, arrays and scalar values. Valid object/array JSON stored in text columns (including SQLite) is also recognized.

- **Tree** expands nested objects and arrays. Expand all / Collapse all control the document; search automatically reveals matching keys/values and their ancestors.
- **Formatted** displays indented, syntax-colored JSON.
- **Raw** displays the original JSON returned by the database.
- **Copy JSON** copies the current source view (formatted in Tree mode). Escape or the close button returns to the unchanged table.

PostgreSQL raw metadata preserves exact numeric literals and duplicate keys in JSON values. JSONB uses the database's canonical representation. JSON `null` and SQL `NULL` are displayed separately. Auto refresh pauses while the viewer is open.

Existing query limits apply (64 KiB per cell, 4 MiB result budget). Trees are bounded to 5,000 nodes and 128 nesting levels; larger structures can still be inspected and copied in Raw mode. The viewer never writes to the database.
