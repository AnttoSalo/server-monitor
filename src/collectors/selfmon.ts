import type { SelfMonitorStats } from "../types.js";

let lastStats: SelfMonitorStats | null = null;
let prevCpuUsage = process.cpuUsage();
let prevTime = Date.now();
let lastCollectionMs = 0;

export function setCollectionMs(ms: number): void {
  lastCollectionMs = ms;
}

export function collectSelfMonitor(): SelfMonitorStats {
  const mem = process.memoryUsage();
  const now = Date.now();
  const cpuUsage = process.cpuUsage(prevCpuUsage);
  const elapsedMs = now - prevTime;
  const cpuPercent = elapsedMs > 0
    ? Math.round(((cpuUsage.user + cpuUsage.system) / 1000 / elapsedMs) * 1000) / 10
    : 0;

  prevCpuUsage = process.cpuUsage();
  prevTime = now;

  lastStats = {
    memoryMB: Math.round(mem.rss / 1048576 * 10) / 10,
    cpuPercent,
    collectionMs: lastCollectionMs,
    uptimeSeconds: Math.round(process.uptime()),
  };
  return lastStats;
}

export function getLastSelfMonitor(): SelfMonitorStats | null {
  return lastStats;
}
