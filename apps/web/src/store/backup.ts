// Full-state backup export/import: dumps every IndexedDB key lernweb owns
// (decks, cards, settings, review log, streak) into one portable JSON file
// so users can move between devices or restore after clearing site data.

import { entries as idbEntries, setMany as idbSetMany, clear as idbClear } from "idb-keyval";

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: "lernweb";
  version: number;
  exportedAt: string; // ISO timestamp
  data: Record<string, unknown>;
}

// Only lernweb-owned keys are ever written by this app, but filter defensively
// in case idb-keyval's default store is ever shared with something else.
const OWNED_PREFIX = "lernweb:";

export async function exportBackup(): Promise<BackupFile> {
  const entries = await idbEntries<string, unknown>();
  const data: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (typeof key === "string" && key.startsWith(OWNED_PREFIX)) data[key] = value;
  }
  return {
    app: "lernweb",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function downloadBackup(backup: BackupFile, filename = `lernweb-backup-${backup.exportedAt.slice(0, 10)}.json`): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseBackup(text: string): BackupFile {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) throw new Error("backup file is not a JSON object");
  const o = raw as Record<string, unknown>;
  if (o.app !== "lernweb") throw new Error("not a lernweb backup file");
  if (typeof o.version !== "number") throw new Error("backup missing version");
  if (typeof o.data !== "object" || o.data === null) throw new Error("backup missing data");
  return { app: "lernweb", version: o.version, exportedAt: String(o.exportedAt ?? ""), data: o.data as Record<string, unknown> };
}

export interface ImportOptions {
  mode: "replace" | "merge"; // replace wipes existing lernweb: keys first
}

// Restores every key from the backup. "replace" clears the whole store first
// (safe: only lernweb: keys are ever written here); "merge" overlays on top
// of existing data, letting imported decks/settings win on key collisions.
export async function importBackup(backup: BackupFile, opts: ImportOptions = { mode: "replace" }): Promise<number> {
  if (backup.app !== "lernweb") throw new Error("not a lernweb backup file");
  if (opts.mode === "replace") await idbClear();
  const pairs = Object.entries(backup.data).filter(([k]) => k.startsWith(OWNED_PREFIX));
  if (pairs.length) await idbSetMany(pairs as [string, unknown][]);
  return pairs.length;
}
