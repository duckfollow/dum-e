import type { Driver } from "./model";

export interface SavedScript {
  id: string;
  name: string;
  sql: string;
  profileId: string;
  connectionName: string;
  driver: Driver;
  updatedAt: number;
}
export const SAVED_SCRIPTS_KEY = "dum-e.saved-scripts.v1";
export function readSavedScripts(
  storage: Pick<Storage, "getItem">,
): SavedScript[] {
  const raw = storage.getItem(SAVED_SCRIPTS_KEY);
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        item &&
        ["id", "name", "sql", "profileId", "connectionName"].every(
          (key) => typeof item[key] === "string",
        ) &&
        ["sqlite", "postgres"].includes(item.driver) &&
        typeof item.updatedAt === "number" &&
        Number.isFinite(item.updatedAt),
    )
  ) {
    throw new Error(
      "Saved scripts could not be read. Existing data has not been changed.",
    );
  }
  return value;
}
export function writeSavedScripts(
  storage: Pick<Storage, "setItem">,
  scripts: SavedScript[],
) {
  storage.setItem(SAVED_SCRIPTS_KEY, JSON.stringify(scripts));
}
