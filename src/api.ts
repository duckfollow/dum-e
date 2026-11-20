import { beginActivity } from "./activity";
import { invoke, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
const activityLabels: Record<string, string> = {
  execute_sql: "Running SQL…",
  run_query: "Loading query results…",
  apply_cell_edits: "Saving database changes…",
  list_tables: "Loading tables…",
  list_schemas: "Loading schemas…",
  table_details: "Loading table details…",
  database_relations: "Loading database relationships…",
  connect_database: "Connecting to database…",
  test_connection: "Testing connection…",
  save_connection: "Saving connection…",
  open_sample: "Opening sample database…",
};
export async function api<T>(
  command: string,
  args?: Record<string, unknown>,
  activityLabel?: string,
): Promise<T> {
  if (!desktop)
    throw Error(
      "Open the Dum-E desktop app to connect to databases. This browser is a UI preview.",
    );
  const label = activityLabel || activityLabels[command];
  const finish = label ? beginActivity(label) : undefined;
  try {
    return await invoke<T>(command, args);
  } finally {
    finish?.();
  }
}
