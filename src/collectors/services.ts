import { exec } from "child_process";
import { promisify } from "util";
import type { ServiceStatus } from "../types.js";

const execAsync = promisify(exec);

const MONITOR_SERVICES = (process.env.MONITOR_SERVICES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let lastServices: ServiceStatus[] = [];

export async function collectServices(): Promise<ServiceStatus[]> {
  if (MONITOR_SERVICES.length === 0) {
    lastServices = [];
    return lastServices;
  }

  try {
    const { stdout } = await execAsync(
      `systemctl is-active ${MONITOR_SERVICES.join(" ")} 2>/dev/null`,
      { timeout: 5000 },
    ).catch((e: { stdout?: string }) => ({ stdout: e.stdout || "" }));

    const statuses = stdout.trim().split("\n");
    lastServices = MONITOR_SERVICES.map((name, i) => {
      const raw = (statuses[i] || "unknown").trim();
      const status = (["active", "inactive", "failed"].includes(raw) ? raw : "unknown") as ServiceStatus["status"];
      return { name, status };
    });
  } catch {
    lastServices = MONITOR_SERVICES.map((name) => ({ name, status: "unknown" as const }));
  }
  return lastServices;
}

export function getLastServices(): ServiceStatus[] {
  return lastServices;
}
