import { exec } from "child_process";
import { promisify } from "util";
import type { LoggedInUser } from "../types.js";

const execAsync = promisify(exec);

let lastUsers: LoggedInUser[] = [];

export async function collectUsers(): Promise<LoggedInUser[]> {
  try {
    const { stdout } = await execAsync("who 2>/dev/null", { timeout: 3000 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    lastUsers = lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        user: parts[0] || "",
        terminal: parts[1] || "",
        loginTime: (parts[2] || "") + " " + (parts[3] || ""),
        from: (parts[4] || "").replace(/[()]/g, ""),
      };
    });
  } catch {
    lastUsers = [];
  }
  return lastUsers;
}

export function getLastUsers(): LoggedInUser[] {
  return lastUsers;
}
