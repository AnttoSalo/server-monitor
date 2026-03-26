import { exec } from "child_process";
import { promisify } from "util";
import type { PendingUpdates } from "../types.js";

const execAsync = promisify(exec);

let lastUpdates: PendingUpdates | null = null;

export async function collectUpdates(): Promise<PendingUpdates> {
  try {
    const { stdout } = await execAsync(
      "apt list --upgradable 2>/dev/null | tail -n +2 | wc -l",
      { timeout: 30000 },
    );
    lastUpdates = {
      count: parseInt(stdout.trim()) || 0,
      lastChecked: new Date().toISOString(),
    };
  } catch {
    lastUpdates = lastUpdates ?? { count: 0, lastChecked: new Date().toISOString() };
  }
  return lastUpdates;
}

export function getLastUpdates(): PendingUpdates | null {
  return lastUpdates;
}
