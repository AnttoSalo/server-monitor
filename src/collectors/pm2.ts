import { exec } from "child_process";
import { promisify } from "util";
import type { PM2Process } from "../types.js";

const execAsync = promisify(exec);

let lastProcesses: PM2Process[] = [];

export async function collectPM2(): Promise<PM2Process[]> {
  try {
    const { stdout } = await execAsync("pm2 jlist", { timeout: 5000 });
    const raw = JSON.parse(stdout);
    lastProcesses = raw.map((p: Record<string, unknown>) => {
      const env = p.pm2_env as Record<string, unknown> | undefined;
      const monit = p.monit as { cpu?: number; memory?: number } | undefined;
      return {
        id: p.pm_id as number,
        name: p.name as string,
        status: (env?.status as string) ?? "unknown",
        cpu: monit?.cpu ?? 0,
        memoryMB: Math.round((monit?.memory ?? 0) / 1048576),
        uptimeMs: Date.now() - ((env?.pm_uptime as number) ?? Date.now()),
        restarts: (env?.restart_time as number) ?? 0,
      };
    });
    return lastProcesses;
  } catch {
    return lastProcesses;
  }
}

export function getLastProcesses(): PM2Process[] {
  return lastProcesses;
}

export async function getPM2Logs(name: string, lines: number): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `pm2 logs ${name} --nostream --lines ${Math.min(lines, 500)} 2>&1`,
      { timeout: 5000 }
    );
    return stdout.split("\n").filter((l) => l.trim());
  } catch (err) {
    return [`Error reading logs: ${err instanceof Error ? err.message : "unknown"}`];
  }
}
