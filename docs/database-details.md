# PostgreSQL and SQLite: table details and relationships

## Product plan

Make the existing SQL databases useful before adding another driver. Keep this work read-only and local. MySQL is out of scope; MongoDB remains a later, separate document workspace.

1. **Table details:** columns, exact database types, NULL/defaults, primary keys, foreign keys, unique constraints, and indexes. Respect database-specific semantics instead of forcing both drivers into misleading generic labels.
2. **Everyday browsing:** server-side filters/sorts, pagination ordered by a stable key, column-aware SQL completion, and clearer connection management.
3. **Relations:** navigate declared foreign keys; show a focused graph around the selected table. No relationship is inferred from names such as `user_id`. Schema design and writing DDL are outside this feature.

This implementation starts with table details and the focused relationship viewer. Step 2 remains separate work; existing result filters/sorts still apply only to the current preview page.

## Table workspace

Table tabs expose **Data · Structure · Indexes · Relations · SQL**. Query-only tabs keep the existing SQL editor/results. Metadata is fetched for the selected connection/schema/object, has loading/error/retry states, and can be refreshed independently. A disconnected session must be reconnected before reading metadata.

- **Structure:** columns in ordinal order; declared/formatted type; nullable state; PK order; defaults and generated-column mode (PostgreSQL expressions; SQLite expressions remain in stored SQL); identities; enums/domains and comments where supported. Show primary/unique/check/foreign-key constraints when catalog introspection supports them.
- **Indexes:** preserve compound key order, expressions, included/auxiliary columns, uniqueness, primary index status, partial predicates, method and catalog SQL where available.
- **Relations:** both incoming and outgoing foreign keys, including compound keys, self references, qualified table names, and update/delete actions. A focused graph links only the selected table and directly connected objects. Keep a complete list alongside the graph, with explicit graph display limits for high-degree tables. Nodes can be moved and opened. The graph displays at most 25 nodes and reports omitted nodes; the list retains all returned relationships.
- **SQL:** stored SQLite CREATE SQL; PostgreSQL catalog-derived definition preview with clear export limitations. It is a read-only inspection aid, not a migration or a complete `pg_dump` replacement.

## Driver-specific truth

### PostgreSQL

Use `pg_catalog` and supported introspection functions (`format_type`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_expr`, `pg_get_viewdef`). Look up object names using bound schema/table parameters; never interpolate identifiers into metadata queries. Preserve FK column pairing in catalog order. Do not label every FK one-to-many: uniqueness and nullability can change cardinality. Display partitioned/view/foreign object kinds and avoid presenting an incomplete definition as an exact export.

### SQLite

Use `sqlite_schema` and table-valued PRAGMAs: `table_xinfo`, `table_list`, `index_list`, `index_xinfo`, and `foreign_key_list`. Include generated/hidden columns. PK order is not a boolean; nullable PK behavior differs on legacy rowid tables. Detect INTEGER PRIMARY KEY aliases accurately, and show STRICT / WITHOUT ROWID state. Foreign-key enforcement is a setting of this read-only connection, not a global property of the database file. Resolve omitted parent column lists against the parent's declared primary key. SQLite does not expose all constraint names or deferrability through PRAGMAs: mark unavailable values honestly and retain exact stored DDL.

## Boundaries and verification

- Metadata calls reuse the existing native session; no credentials go into browser storage or URLs.
- Table inspection never edits existing database files or schemas. The [SQL editor](sql-execution.md) can execute explicit user-authored changes according to database/file permissions.
- New sample relationships use an app-owned, versioned SQLite fixture; old sample files stay intact.
- Validate real SQLite and disposable PostgreSQL fixtures: composite/reordered keys, self references, quoted identifiers, generated/default/nullable columns, unique/expression/partial indexes, views, and incoming/outgoing FKs.
- Frontend tests cover graph identity, direction, composite/self references and display limits. Async refresh guards are also checked during code review and desktop inspection.
- Metadata calls have a 20-second deadline and 4 MB response limit. SQLite incoming-FK discovery is limited to 2,000 tables; both drivers reject more than 10,000 FK column pairs with an explicit error.
- Confirm TypeScript/native builds and inspect the actual desktop table workspace.

## References

- [SQLite PRAGMAs](https://www.sqlite.org/pragma.html)
- [SQLite STRICT tables](https://www.sqlite.org/stricttables.html)
- [PostgreSQL pg_constraint](https://www.postgresql.org/docs/current/catalog-pg-constraint.html)
- [PostgreSQL pg_index](https://www.postgresql.org/docs/current/catalog-pg-index.html)
