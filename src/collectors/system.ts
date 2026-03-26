import { readFile, readdir } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import type { SystemStats, DiskInfo, SystemHistoryEntry, InterfaceStats, ThermalZone, DiskIOStats } from "../types.js";
import { loadJson, saveJson, pruneByAge } from "../store.js";
import { updateBandwidth } from "./bandwidth.js";

const execAsync = promisify(exec);
const HISTORY_FILE = "system-history.json";
const RETENTION_DAYS = parseInt(process.env.HISTORY_RETENTION_DAYS || "7");
const PERSIST_INTERVAL_MS = 300_000; // flush to disk every 5 min
const HISTORY_ENTRY_INTERVAL_MS = 60_000; // add entry every 60s

const NETWORK_INTERFACE = process.env.NETWORK_INTERFACE || "";

let lastStats: SystemStats | null = null;
let lastEntryAt = 0;
let lastPersistedAt = 0;
let networkLoggedOnce = false;

// --- In-memory history buffer ---
let historyBuffer: SystemHistoryEntry[] | null = null;

async function ensureHistoryLoaded(): Promise<SystemHistoryEntry[]> {
  if (!historyBuffer) historyBuffer = await loadJson<SystemHistoryEntry[]>(HISTORY_FILE, []);
  return historyBuffer;
}

// --- CPU from /proc/stat ---

interface CpuSnapshot { idle: number; total: number }

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

// --- Memory ---

function getMemory(): { used: number; total: number; percent: number } {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const total = Math.round((totalBytes / 1073741824) * 10) / 10;
  const used = Math.round(((totalBytes - freeBytes) / 1073741824) * 10) / 10;
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { used, total, percent };
}

// --- Swap from /proc/meminfo ---

async function getSwap(): Promise<{ used: number; total: number; percent: number }> {
  try {
    const content = await readFile("/proc/meminfo", "utf-8");
    let totalKB = 0, freeKB = 0;
    for (const line of content.split("\n")) {
      if (line.startsWith("SwapTotal:")) totalKB = parseInt(line.split(/\s+/)[1]) || 0;
      else if (line.startsWith("SwapFree:")) freeKB = parseInt(line.split(/\s+/)[1]) || 0;
    }
    const total = Math.round((totalKB / 1048576) * 10) / 10;
    const used = Math.round(((totalKB - freeKB) / 1048576) * 10) / 10;
    const percent = totalKB > 0 ? Math.round(((totalKB - freeKB) / totalKB) * 100) : 0;
    return { used, total, percent };
  } catch {
    return { used: 0, total: 0, percent: 0 };
  }
}

// --- Load Average from /proc/loadavg ---

async function getLoadAvg(): Promise<{ load1: number; load5: number; load15: number; runProcs: number; totalProcs: number }> {
  try {
    const content = await readFile("/proc/loadavg", "utf-8");
    const parts = content.trim().split(/\s+/);
    const [running, total] = (parts[3] || "0/0").split("/").map(Number);
    return {
      load1: parseFloat(parts[0]) || 0,
      load5: parseFloat(parts[1]) || 0,
      load15: parseFloat(parts[2]) || 0,
      runProcs: running || 0,
      totalProcs: total || 0,
    };
  } catch {
    return { load1: 0, load5: 0, load15: 0, runProcs: 0, totalProcs: 0 };
  }
}

// --- Disk from df (cached 60s) ---

let diskCache: DiskInfo[] = [];
let diskCachedAt = 0;

async function getDisks(): Promise<DiskInfo[]> {
  if (Date.now() - diskCachedAt < 60_000) return diskCache;
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
    diskCache = disks;
    diskCachedAt = Date.now();
    return disks;
  } catch {
    return diskCache;
  }
}

// --- Disk I/O from /proc/diskstats ---

const DISK_DEVICE_RE = /^[shv]d[a-z]$|^nvme\d+n\d+$/;

interface DiskStatSnapshot { [device: string]: { readSectors: number; writeSectors: number } }

function parseDiskStats(content: string): DiskStatSnapshot {
  const result: DiskStatSnapshot = {};
  for (const line of content.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    const device = parts[2];
    if (device && DISK_DEVICE_RE.test(device)) {
      result[device] = {
        readSectors: parseInt(parts[5]) || 0,
        writeSectors: parseInt(parts[9]) || 0,
      };
    }
  }
  return result;
}

async function getDiskIO(): Promise<{ readKBps: number; writeKBps: number; devices: DiskIOStats[] }> {
  try {
    const snap1 = parseDiskStats(await readFile("/proc/diskstats", "utf-8"));
    const t1 = Date.now();
    await new Promise((r) => setTimeout(r, 100));
    const snap2 = parseDiskStats(await readFile("/proc/diskstats", "utf-8"));
    const elapsed = (Date.now() - t1) / 1000;
    if (elapsed === 0) return { readKBps: 0, writeKBps: 0, devices: [] };

    const devices: DiskIOStats[] = [];
    for (const device of Object.keys(snap2)) {
      const s1 = snap1[device];
      if (!s1) continue;
      const s2 = snap2[device];
      devices.push({
        device,
        readKBps: Math.max(0, Math.round(((s2.readSectors - s1.readSectors) * 512 / 1024 / elapsed) * 10) / 10),
        writeKBps: Math.max(0, Math.round(((s2.writeSectors - s1.writeSectors) * 512 / 1024 / elapsed) * 10) / 10),
      });
    }

    let readKBps = 0, writeKBps = 0;
    for (const d of devices) { readKBps += d.readKBps; writeKBps += d.writeKBps; }
    return { readKBps: Math.round(readKBps * 10) / 10, writeKBps: Math.round(writeKBps * 10) / 10, devices };
  } catch {
    return { readKBps: 0, writeKBps: 0, devices: [] };
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
    if (ifaces.has(NETWORK_INTERFACE)) console.log(`Network: monitoring interface ${NETWORK_INTERFACE}`);
    else console.warn(`Network: interface '${NETWORK_INTERFACE}' not found. Available: ${names.join(", ") || "none"}`);
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

// --- Temperature from /sys/class/thermal ---

let thermalZones: { path: string; type: string }[] | null = null;

async function discoverThermalZones(): Promise<{ path: string; type: string }[]> {
  try {
    const entries = await readdir("/sys/class/thermal");
    const zones: { path: string; type: string }[] = [];
    for (const entry of entries) {
      if (!entry.startsWith("thermal_zone")) continue;
      const base = `/sys/class/thermal/${entry}`;
      try {
        const type = (await readFile(`${base}/type`, "utf-8")).trim();
        zones.push({ path: `${base}/temp`, type });
      } catch { /* skip */ }
    }
    return zones;
  } catch {
    return [];
  }
}

async function getTemperature(): Promise<{ maxC: number; zones: ThermalZone[] } | null> {
  try {
    if (thermalZones === null) thermalZones = await discoverThermalZones();
    if (thermalZones.length === 0) return null;
    const zones: ThermalZone[] = await Promise.all(
      thermalZones.map(async (z) => {
        try {
          const raw = await readFile(z.path, "utf-8");
          return { zone: z.type, tempC: Math.round(parseInt(raw) / 100) / 10 };
        } catch {
          return { zone: z.type, tempC: 0 };
        }
      })
    );
    return { maxC: Math.max(...zones.map((z) => z.tempC), 0), zones };
  } catch {
    return null;
  }
}

// --- TCP Connections + Listening Ports from /proc/net/tcp ---

async function getTcpConnections(): Promise<{ established: number; listening: number; timeWait: number; total: number; listeningPorts: number[] }> {
  try {
    const [tcp4, tcp6] = await Promise.all([
      readFile("/proc/net/tcp", "utf-8").catch(() => ""),
      readFile("/proc/net/tcp6", "utf-8").catch(() => ""),
    ]);

    let established = 0, listening = 0, timeWait = 0, total = 0;
    const portSet = new Set<number>();
    const lines = [...tcp4.trim().split("\n").slice(1), ...tcp6.trim().split("\n").slice(1)];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const state = parts[3];
      total++;
      if (state === "01") established++;
      else if (state === "0A") {
        listening++;
        // Extract port from local_address (field 1): hex_ip:hex_port
        const portHex = parts[1].split(":")[1];
        if (portHex) portSet.add(parseInt(portHex, 16));
      }
      else if (state === "06") timeWait++;
    }
    return { established, listening, timeWait, total, listeningPorts: [...portSet].sort((a, b) => a - b) };
  } catch {
    return { established: 0, listening: 0, timeWait: 0, total: 0, listeningPorts: [] };
  }
}

// --- Public API ---

export async function collectSystem(): Promise<SystemStats> {
  const [cpu, disk, network, diskIO, loadAvg, swap, temperature, tcpConnections] = await Promise.all([
    getCpu(), getDisks(), getNetwork(), getDiskIO(),
    getLoadAvg(), getSwap(), getTemperature(), getTcpConnections(),
  ]);
  const memory = getMemory();
  const cpuCores = os.cpus().length || 1;
  lastStats = { cpu, cpuCores, memory, swap, disk, diskIO, network, loadAvg, temperature, tcpConnections };

  const now = Date.now();
  // Add history entry every 60s
  if (now - lastEntryAt >= HISTORY_ENTRY_INTERVAL_MS) {
    lastEntryAt = now;
    const buf = await ensureHistoryLoaded();
    buf.push({
      timestamp: new Date().toISOString(),
      cpu: lastStats.cpu,
      memPercent: lastStats.memory.percent,
      memUsedGB: lastStats.memory.used,
      diskPercent: lastStats.disk[0]?.percent ?? 0,
      rxKBps: lastStats.network.rxKBps,
      txKBps: lastStats.network.txKBps,
      load1: lastStats.loadAvg.load1,
      swapPercent: lastStats.swap.percent,
      tempC: lastStats.temperature?.maxC ?? 0,
      diskReadKBps: lastStats.diskIO.readKBps,
      diskWriteKBps: lastStats.diskIO.writeKBps,
      tcpEstablished: lastStats.tcpConnections.established,
    });
    historyBuffer = pruneByAge(buf, RETENTION_DAYS * 86_400_000);
    // Track monthly bandwidth from this entry
    updateBandwidth(buf[buf.length - 1]);
  }

  // Flush to disk every 5 min
  if (now - lastPersistedAt >= PERSIST_INTERVAL_MS) {
    lastPersistedAt = now;
    if (historyBuffer) saveJson(HISTORY_FILE, historyBuffer).catch(() => {});
  }

  return lastStats;
}

export function getLastStats(): SystemStats | null {
  return lastStats;
}

export async function getHistory(rangeMs: number): Promise<SystemHistoryEntry[]> {
  const buf = await ensureHistoryLoaded();
  const cutoff = Date.now() - rangeMs;
  return buf.filter((e) => new Date(e.timestamp).getTime() > cutoff);
}
