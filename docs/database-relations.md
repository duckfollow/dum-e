# Database Relations overview

Open **Database Relations** under Database Explorer to inspect all visible objects and declared foreign keys in the current PostgreSQL database or SQLite file. A schema's **… → Schema relations overview** opens the same workspace with that schema selected. The overview is a separate tab; individual table Relations pages retain their focused direct-neighbor graph.

## Explore

- All tables and views in the visible catalog are included, even without foreign keys. Views generally appear as isolated objects because they do not declare table foreign keys.
- Filter by schema or search qualified object names. Matching objects retain their direct neighbors, including external schemas, so cross-schema links remain visible. The filter does not recursively pull in the rest of the database.
- **Connected objects only** hides isolated objects. Clear filters restores the database-wide view.
- FK arrows point from referencing columns to the referenced table. Each declared constraint is one link; composite column pairs and self references remain intact. Names such as `user_id` never imply a relationship.
- Move graph cards with handles or arrow keys; zoom, Fit and Reset adjust the temporary layout. Connected components are grouped in a deterministic grid. Click an object to open its Structure tab.
- Paginated FK and object lists cover all matching metadata, including objects not rendered in large diagrams. Each FK lists column pairs and delete action.
- Refresh relations reloads the snapshot after SQL/schema changes. Disconnect/reconnect is handled explicitly; stale in-flight requests cannot replace another connection's overview.

## Native catalog access

`database_relations` reuses the authenticated native session and performs read-only catalog reads. It does not call table-details once per table. PostgreSQL uses one FK catalog query and preserves array pairing order; relationships are returned only when both endpoints are visible through the existing object discovery rules. It does not elevate database privileges.

SQLite scans declared foreign keys across user tables once, canonicalizes referenced table names, and resolves omitted referenced columns using a bulk primary-key catalog query. Unknown parent columns remain explicitly unavailable. Missing targets can be present in the FK list but are omitted from the diagram and cannot be opened.

## Limits

- Up to 2,000 visible objects, 10,000 PostgreSQL FK constraints or 10,000 SQLite FK column pairs. SQLite primary-key lookup has a 100,000-row bound.
- 20-second native request deadline; 8 MB serialized metadata limit. Exceeding catalog limits returns an error instead of silently presenting a partial database.
- The diagram renders at most 200 nodes and 1,000 links. It explicitly reports omitted objects/links; use filters and the complete paginated lists to reach other objects. Lists paginate at 100 entries.
- Positions are temporary and reset after filtering, refresh or reopening. This is an inspection graph, not an editable schema designer or an export tool. Default PostgreSQL visibility rules are reused, so this does not imply introspection of objects hidden from the account.

The table list and FK scan can observe concurrent catalog changes; use Refresh for a new snapshot. Database files and schemas are never edited by overview loading.

## Verification

Tests exercise isolated objects, schema-qualified identity collisions, compound/self references, cross-schema filtering, retained external neighbors, graph caps/no dangling edges, SQLite implicit parent primary keys, PostgreSQL materialized views and restricted-login visibility. Desktop QA opens the overview from the explorer, checks filtering/Fit and navigates to a related table using an isolated sample.
