import { exec } from "child_process";
import { promisify } from "util";
import type { CronJob } from "../types.js";

const execAsync = promisify(exec);

let lastCrontabs: CronJob[] = [];

export async function collectCrontabs(): Promise<CronJob[]> {
  try {
    // Get current user's crontab + system crontabs
    const results: CronJob[] = [];

    // Current user's crontab
    try {
      const { stdout } = await execAsync("crontab -l 2>/dev/null", { timeout: 3000 });
      const user = process.env.USER || "unknown";
      for (const line of stdout.trim().split("\n")) {
        if (!line || line.startsWith("#")) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6) {
          results.push({
            user,
            schedule: parts.slice(0, 5).join(" "),
            command: parts.slice(5).join(" ").substring(0, 120),
          });
        }
      }
    } catch { /* no crontab */ }

    // System crontabs from /etc/cron.d
    try {
      const { stdout } = await execAsync(
        "cat /etc/cron.d/* 2>/dev/null | grep -v '^#' | grep -v '^$' | grep -v '^SHELL' | grep -v '^PATH' | grep -v '^MAILTO' | head -20",
        { timeout: 3000 },
      );
      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 7) {
          results.push({
            user: parts[5],
            schedule: parts.slice(0, 5).join(" "),
            command: parts.slice(6).join(" ").substring(0, 120),
          });
        }
      }
    } catch { /* no /etc/cron.d */ }

    lastCrontabs = results;
  } catch {
    lastCrontabs = [];
  }
  return lastCrontabs;
}

export function getLastCrontabs(): CronJob[] {
  return lastCrontabs;
}
