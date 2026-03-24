import net from "net";
import type { ConnectivityStatus, PingTarget, ConnectivityHistoryEntry } from "../types.js";
import { loadJson, saveJson, pruneByAge } from "../store.js";

const HISTORY_FILE = "connectivity.json";
const PERSIST_INTERVAL_MS = 300_000; // 5 min
const RETENTION_MS = 86_400_000; // 24h

let lastStatus: ConnectivityStatus = {
  status: "offline",
  targets: [],
  wanIp: null,
  lastChecked: new Date().toISOString(),
};
let lastPersistedAt = 0;

const TARGETS = (process.env.PING_TARGETS || "1.1.1.1,8.8.8.8,google.com").split(",");

function tcpPing(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve(latency);
    });
    socket.on("timeout", () => { socket.destroy(); reject(new Error("timeout")); });
    socket.on("error", (err) => { socket.destroy(); reject(err); });
    socket.connect(port, host);
  });
}

async function pingTarget(host: string): Promise<PingTarget> {
  try {
    const latencyMs = await tcpPing(host, 443, 3000);
    return { host, latencyMs, reachable: true };
  } catch {
    return { host, latencyMs: -1, reachable: false };
  }
}

async function getWanIp(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json() as { ip: string };
    return data.ip;
  } catch {
    return lastStatus.wanIp;
  }
}

export async function collectConnectivity(): Promise<ConnectivityStatus> {
  const targets = await Promise.all(TARGETS.map(pingTarget));
  const reachableCount = targets.filter((t) => t.reachable).length;
  const wanIp = await getWanIp();

  let status: ConnectivityStatus["status"] = "online";
  if (reachableCount === 0) status = "offline";
  else if (reachableCount < targets.length) status = "degraded";

  lastStatus = {
    status,
    targets,
    wanIp,
    lastChecked: new Date().toISOString(),
  };

  // Persist every 5 min
  const now = Date.now();
  if (now - lastPersistedAt >= PERSIST_INTERVAL_MS) {
    lastPersistedAt = now;
    persistHistory(targets).catch(() => {});
  }

  return lastStatus;
}

export function getLastConnectivity(): ConnectivityStatus {
  return lastStatus;
}

async function persistHistory(targets: PingTarget[]): Promise<void> {
  const entries = await loadJson<ConnectivityHistoryEntry[]>(HISTORY_FILE, []);
  entries.push({ timestamp: new Date().toISOString(), targets });
  const pruned = pruneByAge(entries, RETENTION_MS);
  await saveJson(HISTORY_FILE, pruned);
}

export async function getConnectivityHistory(rangeMs: number): Promise<ConnectivityHistoryEntry[]> {
  const entries = await loadJson<ConnectivityHistoryEntry[]>(HISTORY_FILE, []);
  const cutoff = Date.now() - rangeMs;
  return entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);
}
