import type { Table } from "./model.ts";
import type { TableDetails } from "./table-model.ts";

// Shared by the table inspector and editable grid for this connection catalog.
export function createTableDetailsCache(
  fetchDetails: (id: string, table: Table) => Promise<TableDetails>,
) {
  const values = new Map<string, TableDetails>();
  const pending = new Map<string, Promise<TableDetails>>();
  const key = (id: string, table: Table) =>
    JSON.stringify([id, table.schema, table.name]);
  return {
    peek(id: string, table: Table) {
      return values.get(key(id, table)) ?? null;
    },
    load(id: string, table: Table, force = false): Promise<TableDetails> {
      const identity = key(id, table);
      if (!force) {
        const value = values.get(identity);
        if (value) return Promise.resolve(value);
        const request = pending.get(identity);
        if (request) return request;
      }
      const request = fetchDetails(id, table).then(
        (value) => {
          if (pending.get(identity) === request) {
            values.set(identity, value);
            pending.delete(identity);
          }
          return value;
        },
        (error) => {
          if (pending.get(identity) === request) pending.delete(identity);
          throw error;
        },
      );
      pending.set(identity, request);
      return request;
    },
  };
}
export type TableDetailsCache = ReturnType<typeof createTableDetailsCache>;
