import { exec } from "child_process";
import { promisify } from "util";
import type { TopProcess } from "../types.js";

const execAsync = promisify(exec);

let lastTopProcesses: { byCpu: TopProcess[]; byMem: TopProcess[] } = { byCpu: [], byMem: [] };

function parsePsOutput(stdout: string): TopProcess[] {
  const lines = stdout.trim().split("\n").slice(1); // skip header
  const processes: TopProcess[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 11) continue;
    const command = parts.slice(10).join(" ");
    // Filter out ps/head themselves — they spike during measurement
    if (command.startsWith("ps aux") || command === "head -13") continue;
    processes.push({
      user: parts[0],
      pid: parseInt(parts[1]) || 0,
      cpu: parseFloat(parts[2]) || 0,
      mem: parseFloat(parts[3]) || 0,
      rssKB: parseInt(parts[5]) || 0,
      command: command.substring(0, 80),
    });
  }
  return processes;
}

export async function collectTopProcesses(): Promise<{ byCpu: TopProcess[]; byMem: TopProcess[] }> {
  try {
    const [byCpuResult, byMemResult] = await Promise.all([
      execAsync("ps aux --sort=-%cpu | head -13", { timeout: 5000 }),
      execAsync("ps aux --sort=-%mem | head -13", { timeout: 5000 }),
    ]);
    lastTopProcesses = {
      byCpu: parsePsOutput(byCpuResult.stdout),
      byMem: parsePsOutput(byMemResult.stdout),
    };
  } catch {
    lastTopProcesses = { byCpu: [], byMem: [] };
  }
  return lastTopProcesses;
}

export function getLastTopProcesses(): { byCpu: TopProcess[]; byMem: TopProcess[] } {
  return lastTopProcesses;
}
