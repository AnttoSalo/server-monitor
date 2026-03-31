import { exec } from "child_process";
import { promisify } from "util";
import { readlink } from "fs/promises";
import os from "os";
import type { TopProcess } from "../types.js";

const execAsync = promisify(exec);
const cpuCores = os.cpus().length || 1;

// Filter out commands that are artifacts of our own monitoring
const SELF_COMMANDS = ["ps aux", "head -", "pm2 jlist", "pm2 prettylist"];

let lastTopProcesses: { byCpu: TopProcess[]; byMem: TopProcess[] } = { byCpu: [], byMem: [] };

function parsePsOutput(stdout: string): TopProcess[] {
  const lines = stdout.trim().split("\n").slice(1); // skip header
  const processes: TopProcess[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 11) continue;
    const command = parts.slice(10).join(" ");
    if (SELF_COMMANDS.some((c) => command.includes(c))) continue;
    processes.push({
      user: parts[0],
      pid: parseInt(parts[1]) || 0,
      // Normalize per-core % to total system % (e.g. 320% on 4 cores -> 80%)
      cpu: Math.round(((parseFloat(parts[2]) || 0) / cpuCores) * 10) / 10,
      mem: parseFloat(parts[3]) || 0,
      rssKB: parseInt(parts[5]) || 0,
      command: command.substring(0, 80),
    });
  }
  return processes;
}

async function enrichWithCwd(procs: TopProcess[]): Promise<void> {
  await Promise.all(
    procs.map(async (p) => {
      try {
        p.cwd = await readlink(`/proc/${p.pid}/cwd`);
      } catch {
        // Permission denied or process gone — skip
      }
    })
  );
}

export async function collectTopProcesses(): Promise<{ byCpu: TopProcess[]; byMem: TopProcess[] }> {
  try {
    const [byCpuResult, byMemResult] = await Promise.all([
      execAsync("ps aux --sort=-%cpu | head -15", { timeout: 5000 }),
      execAsync("ps aux --sort=-%mem | head -15", { timeout: 5000 }),
    ]);
    const byCpu = parsePsOutput(byCpuResult.stdout).slice(0, 10);
    const byMem = parsePsOutput(byMemResult.stdout).slice(0, 10);
    // Resolve working directories for all unique processes
    const allProcs = new Map<number, TopProcess>();
    for (const p of [...byCpu, ...byMem]) allProcs.set(p.pid, p);
    await enrichWithCwd([...allProcs.values()]);
    lastTopProcesses = { byCpu, byMem };
  } catch {
    lastTopProcesses = { byCpu: [], byMem: [] };
  }
  return lastTopProcesses;
}

export function getLastTopProcesses(): { byCpu: TopProcess[]; byMem: TopProcess[] } {
  return lastTopProcesses;
}
