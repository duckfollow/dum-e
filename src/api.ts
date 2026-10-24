import { invoke, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
export async function api<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop)
    throw Error(
      "Open the Dum-E desktop app to connect to databases. This browser is a UI preview.",
    );
  return invoke<T>(command, args);
}
