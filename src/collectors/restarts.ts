import type { PM2Process, PM2RestartEntry } from "../types.js";
import { loadJson, saveJson } from "../store.js";

const RESTARTS_FILE = "pm2-restarts.json";
const MAX_ENTRIES = 1000;
const RETENTION_MS = 7 * 86_400_000; // 7 days

let history: PM2RestartEntry[] | null = null;
let prevRestarts: Record<string, number> = {};

async function ensureLoaded(): Promise<PM2RestartEntry[]> {
  if (!history) history = await loadJson<PM2RestartEntry[]>(RESTARTS_FILE, []);
  return history;
}

export async function trackRestarts(processes: PM2Process[]): Promise<void> {
  const entries = await ensureLoaded();
  const now = new Date().toISOString();
  let changed = false;

  for (const p of processes) {
    const prev = prevRestarts[p.name];
    if (prev !== undefined && p.restarts > prev) {
      // Restart detected
      entries.push({ timestamp: now, name: p.name, restarts: p.restarts });
      changed = true;
    }
    prevRestarts[p.name] = p.restarts;
  }

  if (changed) {
    // Prune old entries
    const cutoff = Date.now() - RETENTION_MS;
    history = entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);
    while (history.length > MAX_ENTRIES) history.shift();
    saveJson(RESTARTS_FILE, history).catch(() => {});
  }
}

export async function getRestartHistory(): Promise<PM2RestartEntry[]> {
  return ensureLoaded();
}
