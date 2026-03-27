import { Router } from "express";
import os from "os";
import { getHistory, getLastStats } from "../collectors/system.js";
import { getConnectivityHistory } from "../collectors/connectivity.js";
import { getLastProcesses } from "../collectors/pm2.js";
import { getRestartHistory } from "../collectors/restarts.js";
import { getIncidents } from "../collectors/uptime.js";
import { getLastBandwidth } from "../collectors/bandwidth.js";
import { getLastSshAuth } from "../collectors/sshauth.js";
import { getLastCerts } from "../collectors/certs.js";
import { getLastSmart } from "../collectors/smart.js";
import { getLastDocker } from "../collectors/docker.js";
import { getLastSelfMonitor } from "../collectors/selfmon.js";
import { getLastUsers } from "../collectors/users.js";
import { getLastUpdates } from "../collectors/updates.js";
import { getLastSysInfo } from "../collectors/sysinfo.js";
import { loadJson } from "../store.js";
import type {
  SystemHistoryEntry,
  ConnectivityHistoryEntry,
  SpeedTestResult,
  StatsResponse,
} from "../types.js";

const router = Router();

const RANGE_MAP: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

/* ── Helpers ─────────────────────────────────────────── */

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── System Performance ──────────────────────────────── */

function computeSystemPerf(entries: SystemHistoryEntry[], cpuCores: number) {
  const cpuVals = entries.map((e) => e.cpu);
  const memVals = entries.map((e) => e.memPercent);
  const diskVals = entries.map((e) => e.diskPercent);
  const loadVals = entries.map((e) => e.load1);
  const tempVals = entries.map((e) => e.tempC).filter((v) => v > 0);
  const swapVals = entries.map((e) => e.swapPercent);
  const readVals = entries.map((e) => e.diskReadKBps);
  const writeVals = entries.map((e) => e.diskWriteKBps);

  // Memory trend: compare first 20% vs last 20%
  const chunk = Math.max(1, Math.floor(entries.length * 0.2));
  const firstAvg = avg(memVals.slice(0, chunk));
  const lastAvg = avg(memVals.slice(-chunk));
  const diff = lastAvg - firstAvg;
  const trend: "rising" | "falling" | "stable" = diff > 2 ? "rising" : diff < -2 ? "falling" : "stable";

  // Peak memory time
  let peakMemIdx = 0;
  for (let i = 1; i < memVals.length; i++) {
    if (memVals[i] > memVals[peakMemIdx]) peakMemIdx = i;
  }

  // Disk R/W ratio
  const avgRead = avg(readVals);
  const avgWrite = avg(writeVals);
  const rwTotal = avgRead + avgWrite;

  return {
    cpu: {
      avg: r2(avg(cpuVals)),
      median: r2(median(cpuVals)),
      peak: r2(Math.max(0, ...cpuVals)),
      p95: r2(percentile(cpuVals, 0.95)),
      timeAbove90Pct: cpuVals.filter((v) => v > 90).length,
    },
    memory: {
      avgPercent: r2(avg(memVals)),
      peakPercent: r2(Math.max(0, ...memVals)),
      peakTime: entries[peakMemIdx]?.timestamp ?? "",
      trend,
    },
    disk: {
      avgPercent: r2(avg(diskVals)),
      avgReadKBps: r2(avgRead),
      avgWriteKBps: r2(avgWrite),
      readWriteRatio: rwTotal > 0 ? r2(avgRead / rwTotal) : 0,
    },
    load: {
      avg: r2(avg(loadVals)),
      peak: r2(Math.max(0, ...loadVals)),
      normalized: cpuCores > 0 ? r2(avg(loadVals) / cpuCores) : 0,
    },
    temperature: {
      avg: r2(avg(tempVals)),
      peak: r2(tempVals.length > 0 ? Math.max(...tempVals) : 0),
      timeAbove80: tempVals.filter((v) => v > 80).length,
    },
    swap: {
      avg: r2(avg(swapVals)),
      peak: r2(Math.max(0, ...swapVals)),
    },
  };
}

/* ── Network & Bandwidth ─────────────────────────────── */

function computeNetworkStats(entries: SystemHistoryEntry[]) {
  const rxVals = entries.map((e) => e.rxKBps);
  const txVals = entries.map((e) => e.txKBps);

  // Each entry covers ~60s
  const totalRxKB = rxVals.reduce((s, v) => s + v * 60, 0);
  const totalTxKB = txVals.reduce((s, v) => s + v * 60, 0);

  const bandwidth = getLastBandwidth();
  const year = new Date().getFullYear().toString();
  let ytdRx = 0, ytdTx = 0;
  for (const m of bandwidth) {
    if (m.month.startsWith(year)) {
      ytdRx += m.rxGB;
      ytdTx += m.txGB;
    }
  }

  return {
    totalRxMB: r2(totalRxKB / 1024),
    totalTxMB: r2(totalTxKB / 1024),
    avgRxKBps: r2(avg(rxVals)),
    avgTxKBps: r2(avg(txVals)),
    peakRxKBps: r2(Math.max(0, ...rxVals)),
    peakTxKBps: r2(Math.max(0, ...txVals)),
    monthlyBandwidth: bandwidth,
    ytdRxGB: r2(ytdRx),
    ytdTxGB: r2(ytdTx),
  };
}

/* ── Connectivity ────────────────────────────────────── */

function computeConnectivityStats(entries: ConnectivityHistoryEntry[]) {
  if (entries.length === 0) {
    return { uptimePercent: 100, perTarget: [] };
  }

  // Uptime = entries where at least one target reachable
  const upCount = entries.filter((e) => e.targets.some((t) => t.reachable)).length;
  const uptimePercent = r2((upCount / entries.length) * 100);

  // Per-target stats
  const hostMap = new Map<string, { latencies: number[]; total: number; unreachable: number }>();
  for (const e of entries) {
    for (const t of e.targets) {
      let rec = hostMap.get(t.host);
      if (!rec) {
        rec = { latencies: [], total: 0, unreachable: 0 };
        hostMap.set(t.host, rec);
      }
      rec.total++;
      if (t.reachable) {
        rec.latencies.push(t.latencyMs);
      } else {
        rec.unreachable++;
      }
    }
  }

  const perTarget = [...hostMap.entries()].map(([host, rec]) => ({
    host,
    avgLatencyMs: r2(avg(rec.latencies)),
    worstLatencyMs: r2(rec.latencies.length > 0 ? Math.max(...rec.latencies) : 0),
    packetLossPct: r2((rec.unreachable / rec.total) * 100),
  }));

  return { uptimePercent, perTarget };
}

/* ── Speed Test ──────────────────────────────────────── */

async function computeSpeedTestStats() {
  const history = await loadJson<SpeedTestResult[]>("speedtest-history.json", []);
  const completed = history.filter((t) => t.status === "completed");

  if (completed.length === 0) {
    return {
      avgDownload: 0, avgUpload: 0,
      bestDownload: 0, worstDownload: 0,
      bestUpload: 0, worstUpload: 0,
      avgLatency: 0,
      lastTestTimestamp: "",
      totalTests: 0,
    };
  }

  const dls = completed.map((t) => t.downloadMbps);
  const uls = completed.map((t) => t.uploadMbps);
  const lats = completed.map((t) => t.latencyMs);

  return {
    avgDownload: r2(avg(dls)),
    avgUpload: r2(avg(uls)),
    bestDownload: r2(Math.max(...dls)),
    worstDownload: r2(Math.min(...dls)),
    bestUpload: r2(Math.max(...uls)),
    worstUpload: r2(Math.min(...uls)),
    avgLatency: r2(avg(lats)),
    lastTestTimestamp: completed[completed.length - 1].timestamp,
    totalTests: completed.length,
  };
}

/* ── Process Stats ───────────────────────────────────── */

async function computeProcessStats(rangeMs: number) {
  const pm2 = getLastProcesses();
  const restarts = await getRestartHistory();
  const docker = getLastDocker();

  const pm2Online = pm2.filter((p) => p.status === "online").length;
  const cutoff = Date.now() - rangeMs;

  // Restart counts per process in range
  const restartMap = new Map<string, number>();
  let totalRestarts = 0;
  for (const r of restarts) {
    if (new Date(r.timestamp).getTime() >= cutoff) {
      restartMap.set(r.name, (restartMap.get(r.name) ?? 0) + 1);
      totalRestarts++;
    }
  }

  let mostRestarted: { name: string; count: number } | null = null;
  for (const [name, count] of restartMap) {
    if (!mostRestarted || count > mostRestarted.count) {
      mostRestarted = { name, count };
    }
  }

  const perProcess = pm2.map((p) => ({
    name: p.name,
    cpu: r2(p.cpu),
    memoryMB: r2(p.memoryMB),
    restarts: restartMap.get(p.name) ?? 0,
    status: p.status,
  }));

  // Docker by state
  const dockerByState: Record<string, number> = {};
  for (const c of docker) {
    dockerByState[c.state] = (dockerByState[c.state] ?? 0) + 1;
  }

  return { pm2Online, pm2Total: pm2.length, totalRestarts, mostRestarted, perProcess, dockerByState };
}

/* ── Security Stats ──────────────────────────────────── */

function computeSecurityStats() {
  const ssh = getLastSshAuth();
  const certs = getLastCerts();
  const smart = getLastSmart();

  const failed = ssh.filter((e) => e.type === "failed");
  const accepted = ssh.filter((e) => e.type === "accepted");

  // Top attacking IPs
  const ipMap = new Map<string, number>();
  for (const e of failed) {
    ipMap.set(e.ip, (ipMap.get(e.ip) ?? 0) + 1);
  }
  const topAttackingIPs = [...ipMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ip, count]) => ({ ip, count }));

  // Auth method distribution
  const authMethodDist: Record<string, number> = {};
  for (const e of ssh) {
    authMethodDist[e.method] = (authMethodDist[e.method] ?? 0) + 1;
  }

  // Certs
  const validCerts = certs.filter((c) => !c.error);
  const soonestCertExpiryDays = validCerts.length > 0 ? Math.min(...validCerts.map((c) => c.daysRemaining)) : -1;
  const certsExpiringWithin30d = validCerts.filter((c) => c.daysRemaining <= 30).length;

  // SMART
  const smartSummary: Record<string, number> = {};
  for (const s of smart) {
    smartSummary[s.status] = (smartSummary[s.status] ?? 0) + 1;
  }

  return {
    totalSshEvents: ssh.length,
    failedLogins: failed.length,
    acceptedLogins: accepted.length,
    successRate: ssh.length > 0 ? r2((accepted.length / ssh.length) * 100) : 100,
    topAttackingIPs,
    authMethodDist,
    soonestCertExpiryDays,
    certsExpiringWithin30d,
    smartSummary,
  };
}

/* ── System Overview ─────────────────────────────────── */

function computeOverviewStats(totalDataPoints: number) {
  const selfMon = getLastSelfMonitor();
  const users = getLastUsers();
  const updates = getLastUpdates();
  const sysInfo = getLastSysInfo();

  return {
    serverUptimeSec: Math.floor(os.uptime()),
    monitorUptimeSec: selfMon?.uptimeSeconds ?? 0,
    totalDataPoints,
    collectionCycleMs: selfMon?.collectionMs ?? 0,
    pendingUpdates: updates?.count ?? 0,
    activeUserSessions: users.length,
    hostname: os.hostname(),
    os: sysInfo?.os ?? os.type(),
    cpuModel: sysInfo?.cpuModel ?? "",
    cpuCores: sysInfo?.cpuCores ?? os.cpus().length,
    totalMemGB: sysInfo?.totalMemGB ?? r2(os.totalmem() / 1073741824),
  };
}

/* ── Route Handler ───────────────────────────────────── */

router.get("/", async (req, res) => {
  const range = (req.query.range as string) || "24h";
  const rangeMs = RANGE_MAP[range] || RANGE_MAP["24h"];

  const [systemHistory, connHistory, speedTest, processes] = await Promise.all([
    getHistory(rangeMs),
    getConnectivityHistory(Math.min(rangeMs, 86_400_000)), // connectivity capped at 24h
    computeSpeedTestStats(),
    computeProcessStats(rangeMs),
  ]);

  const cpuCores = getLastStats()?.cpuCores ?? os.cpus().length;

  // getIncidents returns a promise
  const incidents = await getIncidents();
  // Compute uptime after incidents are loaded
  const uptimeStats = computeUptimeStatsSync(incidents, rangeMs);

  const result: StatsResponse = {
    system: computeSystemPerf(systemHistory, cpuCores),
    network: computeNetworkStats(systemHistory),
    connectivity: computeConnectivityStats(connHistory),
    uptime: uptimeStats,
    speedTest,
    processes,
    security: computeSecurityStats(),
    overview: computeOverviewStats(systemHistory.length),
    range,
    computedAt: new Date().toISOString(),
  };

  res.json(result);
});

/* Synchronous uptime computation that takes pre-loaded incidents */
function computeUptimeStatsSync(incidents: Awaited<ReturnType<typeof getIncidents>>, rangeMs: number) {
  const now = Date.now();
  const rangeStart = now - rangeMs;

  const inRange = incidents.filter((i) => new Date(i.startedAt).getTime() >= rangeStart);
  const recovered = inRange.filter((i) => i.status === "recovered" && i.durationMs);

  const totalDowntime = recovered.reduce((s, i) => s + (i.durationMs ?? 0), 0);
  const activeDown = inRange.filter((i) => i.status === "down");
  const activeDowntime = activeDown.reduce((s, i) => s + (now - new Date(i.startedAt).getTime()), 0);

  const totalDowntimeMs = totalDowntime + activeDowntime;
  const overallUptimePct = rangeMs > 0 ? r2(Math.max(0, ((rangeMs - totalDowntimeMs) / rangeMs) * 100)) : 100;

  let lastRecovery = rangeStart;
  for (const i of incidents) {
    if (i.status === "recovered" && i.recoveredAt) {
      const t = new Date(i.recoveredAt).getTime();
      if (t > lastRecovery) lastRecovery = t;
    }
  }
  const currentStreakMs = activeDown.length > 0 ? 0 : now - lastRecovery;

  const mttrMs = recovered.length > 0 ? r2(avg(recovered.map((i) => i.durationMs ?? 0))) : 0;
  const totalIncidents = inRange.length;
  const mtbfMs = totalIncidents > 0 ? r2(rangeMs / totalIncidents) : rangeMs;
  const longestOutageMs = recovered.length > 0 ? Math.max(...recovered.map((i) => i.durationMs ?? 0)) : 0;

  const incidentsByType: Record<string, number> = {};
  for (const i of inRange) {
    const key = i.type.includes(":") ? i.type.split(":")[0] : i.type;
    incidentsByType[key] = (incidentsByType[key] ?? 0) + 1;
  }

  return {
    overallUptimePct,
    currentStreakMs,
    mttrMs,
    mtbfMs,
    totalIncidents,
    incidentsByType,
    longestOutageMs,
    recentIncidents: inRange.slice(-10).reverse(),
  };
}

export default router;
