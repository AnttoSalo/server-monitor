import { readFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import type { SystemStats, DiskInfo, SystemHistoryEntry, InterfaceStats } from "../types.js";
import { loadJson, saveJson, pruneByAge } from "../store.js";

const execAsync = promisify(exec);
const HISTORY_FILE = "system-history.json";
const RETENTION_DAYS = parseInt(process.env.HISTORY_RETENTION_DAYS || "7");
const PERSIST_INTERVAL_MS = 60_000;

const NETWORK_INTERFACE = process.env.NETWORK_INTERFACE || "";

let lastStats: SystemStats | null = null;
let lastPersistedAt = 0;
let networkLoggedOnce = false;

// --- CPU from /proc/stat ---

interface CpuSnapshot {
  idle: number;
  total: number;
}

function parseProcStat(content: string): CpuSnapshot {
  const line = content.split("\n")[0];
  const parts = line.split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
  return {
    idle: idle + iowait,
    total: user + nice + system + idle + iowait + irq + softirq + (steal || 0),
  };
}

async function getCpu(): Promise<number> {
  try {
    const s1 = parseProcStat(await readFile("/proc/stat", "utf-8"));
    await new Promise((r) => setTimeout(r, 100));
    const s2 = parseProcStat(await readFile("/proc/stat", "utf-8"));
    const totalDelta = s2.total - s1.total;
    const idleDelta = s2.idle - s1.idle;
    if (totalDelta === 0) return 0;
    return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
  } catch {
    return 0;
  }
}

// --- Memory from os module ---

function getMemory(): { used: number; total: number; percent: number } {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const total = Math.round((totalBytes / 1073741824) * 10) / 10;
  const used = Math.round(((totalBytes - freeBytes) / 1073741824) * 10) / 10;
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { used, total, percent };
}

// --- Disk from df ---

async function getDisks(): Promise<DiskInfo[]> {
  try {
    const { stdout } = await execAsync("df -BG --output=target,used,size,pcent / /home 2>/dev/null", { timeout: 5000 });
    const lines = stdout.trim().split("\n").slice(1);
    const disks: DiskInfo[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4 && !seen.has(parts[0])) {
        seen.add(parts[0]);
        disks.push({
          mount: parts[0],
          used: parseFloat(parts[1]) || 0,
          total: parseFloat(parts[2]) || 0,
          percent: parseInt(parts[3]) || 0,
        });
      }
    }
    return disks;
  } catch {
    return [];
  }
}

// --- Network from /proc/net/dev ---

interface IfaceBytes { rx: number; tx: number }

function parseAllNetDev(content: string): Map<string, IfaceBytes> {
  const result = new Map<string, IfaceBytes>();
  const lines = content.trim().split("\n").slice(2);
  for (const line of lines) {
    const match = line.match(/^\s*(\S+):\s*(.*)/);
    if (match && match[1] !== "lo") {
      const values = match[2].trim().split(/\s+/).map(Number);
      result.set(match[1], { rx: values[0] || 0, tx: values[8] || 0 });
    }
  }
  return result;
}

function logNetworkInterfaces(ifaces: Map<string, IfaceBytes>): void {
  if (networkLoggedOnce) return;
  networkLoggedOnce = true;
  const names = [...ifaces.keys()];
  if (NETWORK_INTERFACE) {
    if (ifaces.has(NETWORK_INTERFACE)) {
      console.log(`Network: monitoring interface ${NETWORK_INTERFACE}`);
    } else {
      console.warn(`Network: interface '${NETWORK_INTERFACE}' not found. Available: ${names.join(", ") || "none"}`);
    }
  } else {
    console.log(`Network: monitoring all interfaces (${names.join(", ") || "none"})`);
  }
}

async function getNetwork(): Promise<{ rxKBps: number; txKBps: number; interfaces: InterfaceStats[] }> {
  try {
    const all1 = parseAllNetDev(await readFile("/proc/net/dev", "utf-8"));
    logNetworkInterfaces(all1);
    const t1 = Date.now();
    await new Promise((r) => setTimeout(r, 100));
    const all2 = parseAllNetDev(await readFile("/proc/net/dev", "utf-8"));
    const elapsed = (Date.now() - t1) / 1000;
    if (elapsed === 0) return { rxKBps: 0, txKBps: 0, interfaces: [] };

    // Compute per-interface deltas (only for interfaces present in both samples)
    const perIface: InterfaceStats[] = [];
    for (const [name, b2] of all2) {
      const b1 = all1.get(name);
      if (!b1) continue;
      perIface.push({
        name,
        rxKBps: Math.max(0, Math.round(((b2.rx - b1.rx) / 1024 / elapsed) * 10) / 10),
        txKBps: Math.max(0, Math.round(((b2.tx - b1.tx) / 1024 / elapsed) * 10) / 10),
      });
    }

    // Aggregate: sum per-interface deltas (or single interface if env var set)
    let rxKBps = 0, txKBps = 0;
    if (NETWORK_INTERFACE) {
      const iface = perIface.find((i) => i.name === NETWORK_INTERFACE);
      if (iface) { rxKBps = iface.rxKBps; txKBps = iface.txKBps; }
    } else {
      for (const i of perIface) { rxKBps += i.rxKBps; txKBps += i.txKBps; }
      rxKBps = Math.round(rxKBps * 10) / 10;
      txKBps = Math.round(txKBps * 10) / 10;
    }

    return { rxKBps, txKBps, interfaces: perIface };
  } catch {
    return { rxKBps: 0, txKBps: 0, interfaces: [] };
  }
}

// --- Public API ---

export async function collectSystem(): Promise<SystemStats> {
  const [cpu, disk, network] = await Promise.all([getCpu(), getDisks(), getNetwork()]);
  const memory = getMemory();
  lastStats = { cpu, memory, disk, network };

  // Persist every 60s
  const now = Date.now();
  if (now - lastPersistedAt >= PERSIST_INTERVAL_MS) {
    lastPersistedAt = now;
    persistHistory(lastStats).catch(() => {});
  }

  return lastStats;
}

export function getLastStats(): SystemStats | null {
  return lastStats;
}

async function persistHistory(stats: SystemStats): Promise<void> {
  const entries = await loadJson<SystemHistoryEntry[]>(HISTORY_FILE, []);
  entries.push({
    timestamp: new Date().toISOString(),
    cpu: stats.cpu,
    memPercent: stats.memory.percent,
    memUsedGB: stats.memory.used,
    diskPercent: stats.disk[0]?.percent ?? 0,
    rxKBps: stats.network.rxKBps,
    txKBps: stats.network.txKBps,
  });
  const pruned = pruneByAge(entries, RETENTION_DAYS * 86_400_000);
  await saveJson(HISTORY_FILE, pruned);
}

export async function getHistory(rangeMs: number): Promise<SystemHistoryEntry[]> {
  const entries = await loadJson<SystemHistoryEntry[]>(HISTORY_FILE, []);
  const cutoff = Date.now() - rangeMs;
  return entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);
}
