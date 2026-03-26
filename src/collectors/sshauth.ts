import { exec } from "child_process";
import { promisify } from "util";
import type { SshAuthEvent } from "../types.js";

const execAsync = promisify(exec);

let lastEvents: SshAuthEvent[] = [];

export async function collectSshAuth(): Promise<SshAuthEvent[]> {
  try {
    // Get last 50 SSH auth events from journalctl (works on systemd systems)
    const { stdout } = await execAsync(
      "journalctl _COMM=sshd -n 100 --no-pager -o short-iso 2>/dev/null | grep -E '(Failed|Accepted)' | tail -50",
      { timeout: 5000 },
    );
    const events: SshAuthEvent[] = [];
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      // Format: 2026-03-26T10:00:00+0000 hostname sshd[123]: Failed password for user from 1.2.3.4 port 22 ssh2
      const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+)/);
      const timestamp = tsMatch ? tsMatch[1] : "";
      const isFailed = line.includes("Failed");
      const userMatch = line.match(/for (?:invalid user )?(\S+) from/);
      const ipMatch = line.match(/from (\S+) port/);
      const methodMatch = line.match(/(password|publickey)/);
      if (timestamp && userMatch && ipMatch) {
        events.push({
          timestamp,
          type: isFailed ? "failed" : "accepted",
          user: userMatch[1],
          ip: ipMatch[1],
          method: methodMatch ? methodMatch[1] : "unknown",
        });
      }
    }
    lastEvents = events;
  } catch {
    // journalctl may not be available or may require permissions
    lastEvents = [];
  }
  return lastEvents;
}

export function getLastSshAuth(): SshAuthEvent[] {
  return lastEvents;
}
