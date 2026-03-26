import { exec } from "child_process";
import { promisify } from "util";
import type { SmartHealth } from "../types.js";

const execAsync = promisify(exec);

let lastHealth: SmartHealth[] = [];
let smartAvailable: boolean | null = null;

export async function collectSmart(): Promise<SmartHealth[]> {
  if (smartAvailable === false) return lastHealth;

  try {
    // Discover block devices
    const { stdout: lsblk } = await execAsync("lsblk -dn -o NAME,TYPE 2>/dev/null", { timeout: 5000 });
    const devices = lsblk.trim().split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter(([, type]) => type === "disk")
      .map(([name]) => name);

    if (devices.length === 0) { lastHealth = []; return []; }

    lastHealth = await Promise.all(devices.map(async (device) => {
      try {
        const { stdout } = await execAsync(
          `smartctl -H -A /dev/${device} 2>/dev/null`,
          { timeout: 10000 },
        );
        smartAvailable = true;
        const healthMatch = stdout.match(/SMART overall-health.*?:\s*(\S+)/);
        const status = healthMatch
          ? healthMatch[1] === "PASSED" ? "healthy" : "failing"
          : "unknown";
        const tempMatch = stdout.match(/Temperature_Celsius.*?\s(\d+)\s*$/m)
          || stdout.match(/Current Temperature:\s*(\d+)/);
        const temperature = tempMatch ? parseInt(tempMatch[1]) : undefined;
        return { device, status, temperature } as SmartHealth;
      } catch {
        return { device, status: "unknown" as const, detail: "smartctl not available or no permission" };
      }
    }));
  } catch {
    smartAvailable = false;
    lastHealth = [];
  }
  return lastHealth;
}

export function getLastSmart(): SmartHealth[] {
  return lastHealth;
}
