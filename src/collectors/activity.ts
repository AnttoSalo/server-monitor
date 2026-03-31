import type { SystemStats, TopProcess, PM2Process, SystemHistoryEntry, Activity, ActivityState } from "../types.js";

let stressStartedAt: number | null = null;
let lastLevel = "idle";
let lastActivity: ActivityState | null = null;

// --- PM2 cross-reference ---

function matchPm2Name(command: string, pm2Procs: PM2Process[]): string | null {
  const cmdLower = command.toLowerCase();
  for (const p of pm2Procs) {
    const nameLower = p.name.toLowerCase();
    // Direct name in path: /srv/dev/nnshq/ or /app-name/dist/
    if (cmdLower.includes("/" + nameLower + "/")) return p.name;
    if (cmdLower.includes("/" + nameLower + ".")) return p.name;
  }
  return null;
}

// --- Process description ---

function projectNameFromCwd(cwd?: string): string | null {
  if (!cwd) return null;
  const parts = cwd.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

function describeCommand(cmd: string, cwd?: string): { desc: string; type: Activity["type"] } {
  const c = cmd.toLowerCase();
  const project = projectNameFromCwd(cwd);
  // Build tools
  if (c.includes("tsc") && !c.includes("tsx")) return { desc: "TypeScript compilation", type: "build" };
  if (c.includes("webpack")) return { desc: "Webpack bundling", type: "build" };
  if (c.includes("vite") && !c.includes("vitest")) return { desc: "Vite build", type: "build" };
  if (c.includes("esbuild")) return { desc: "esbuild bundling", type: "build" };
  if (c.includes("turbopack") || c.includes("next build")) return { desc: "Next.js build", type: "build" };
  if (c.includes("npm run build") || c.includes("npm run compile")) return { desc: project ? `${project} build` : "build script", type: "build" };
  if (c.includes("gcc") || c.includes("g++") || c.includes("make")) return { desc: "C/C++ compilation", type: "build" };
  if (c.includes("rustc") || c.includes("cargo build")) return { desc: "Rust compilation", type: "build" };
  if (c.includes("go build")) return { desc: "Go compilation", type: "build" };
  // Package managers
  if (c.includes("npm install") || c.includes("npm ci")) return { desc: project ? `npm install (${project})` : "npm install", type: "system" };
  if (c.includes("apt") || c.includes("dpkg")) return { desc: "system package update", type: "system" };
  // Frameworks serving
  if (c.includes("next-server")) return { desc: "Next.js server", type: "serve" };
  if (c.includes("nuxt")) return { desc: "Nuxt server", type: "serve" };
  if (c.includes("nest")) return { desc: "NestJS server", type: "serve" };
  if (c.includes("express") || c.includes("fastify")) return { desc: "web server", type: "serve" };
  // Databases
  if (c.includes("postgres") || c.includes("psql")) return { desc: "PostgreSQL", type: "database" };
  if (c.includes("mysql") || c.includes("mariadb")) return { desc: "MySQL", type: "database" };
  if (c.includes("redis")) return { desc: "Redis", type: "database" };
  if (c.includes("mongod")) return { desc: "MongoDB", type: "database" };
  // System
  if (c.includes("nginx")) return { desc: "nginx", type: "serve" };
  if (c.includes("cloudflared")) return { desc: "Cloudflare tunnel", type: "system" };
  if (c.includes("docker")) return { desc: "Docker", type: "system" };
  if (c.includes("pm2")) return { desc: "PM2 manager", type: "system" };
  // Node.js — extract path name
  if (c.includes("node ") || c.includes("node\t")) {
    const pathMatch = cmd.match(/\/([^/]+?)(?:\/(?:dist|src|server|index|app)\b|\.(?:js|ts))/i);
    if (pathMatch) return { desc: pathMatch[1].replace(/[_-]/g, " "), type: "serve" };
    return { desc: "Node.js process", type: "unknown" };
  }
  if (c.includes("python") || c.includes("python3")) return { desc: "Python script", type: "unknown" };
  return { desc: cmd.substring(0, 40), type: "unknown" };
}

// --- Process grouping ---

function groupProcesses(procs: TopProcess[], pm2Procs: PM2Process[]): Activity[] {
  const groups = new Map<string, { procs: TopProcess[]; pm2Name: string | null; desc: string; type: Activity["type"] }>();

  for (const p of procs.filter((p) => p.cpu > 3)) {
    const pm2Name = matchPm2Name(p.command, pm2Procs);
    const { desc, type } = describeCommand(p.command, p.cwd);
    const key = pm2Name || desc;

    if (!groups.has(key)) {
      groups.set(key, { procs: [], pm2Name, desc, type });
    }
    groups.get(key)!.procs.push(p);
  }

  const activities: Activity[] = [];
  for (const [, group] of groups) {
    const totalCpu = Math.round(group.procs.reduce((s, p) => s + p.cpu, 0) * 10) / 10;
    const totalMem = Math.round(group.procs.reduce((s, p) => s + p.mem, 0) * 10) / 10;
    const count = group.procs.length;

    let label: string;
    if (group.pm2Name) {
      const verb = group.type === "build" ? "is building" : group.type === "serve" ? "is running" : "is active";
      label = `${group.pm2Name} ${verb}`;
    } else {
      label = group.desc;
    }

    activities.push({
      type: group.type,
      label,
      processes: count > 1
        ? [`${group.desc} (${count} workers)`]
        : [group.desc],
      cpuPercent: totalCpu,
      memPercent: totalMem,
    });
  }

  return activities.sort((a, b) => b.cpuPercent - a.cpuPercent);
}

// --- Activity classification from resource signals ---

function classifyOverallActivity(activities: Activity[], system: SystemStats): Activity["type"] {
  const hasBuild = activities.some((a) => a.type === "build");
  const hasServe = activities.some((a) => a.type === "serve");
  const hasDB = activities.some((a) => a.type === "database");
  const highDiskWrite = system.diskIO.writeKBps > 500;
  const highNetwork = system.network.rxKBps > 100 || system.network.txKBps > 100;

  if (hasBuild || highDiskWrite) return "build";
  if (hasDB) return "database";
  if (hasServe || highNetwork) return "serve";
  return "unknown";
}

// --- Trend detection ---

function detectTrend(recentHistory: SystemHistoryEntry[]): "rising" | "stable" | "falling" {
  if (recentHistory.length < 6) return "stable";
  const recent = recentHistory.slice(-3);
  const older = recentHistory.slice(0, 3);
  const recentAvg = recent.reduce((s, e) => s + e.cpu, 0) / recent.length;
  const olderAvg = older.reduce((s, e) => s + e.cpu, 0) / older.length;
  const diff = recentAvg - olderAvg;
  if (diff > 10) return "rising";
  if (diff < -10) return "falling";
  return "stable";
}

// --- Resource notes ---

function memoryNote(system: SystemStats, recentHistory: SystemHistoryEntry[]): string {
  const pct = system.memory.percent;
  if (recentHistory.length >= 3) {
    const prevAvg = recentHistory.slice(-3).reduce((s, e) => s + e.memPercent, 0) / 3;
    const diff = pct - prevAvg;
    if (diff > 5) return `${pct}% (climbing)`;
    if (diff < -5) return `${pct}% (dropping)`;
  }
  return `${pct}% (stable)`;
}

function diskNote(system: SystemStats): string {
  const total = system.diskIO.readKBps + system.diskIO.writeKBps;
  if (total < 10) return "idle";
  const r = system.diskIO.readKBps >= 1024 ? (system.diskIO.readKBps / 1024).toFixed(1) + " MB/s" : Math.round(system.diskIO.readKBps) + " KB/s";
  const w = system.diskIO.writeKBps >= 1024 ? (system.diskIO.writeKBps / 1024).toFixed(1) + " MB/s" : Math.round(system.diskIO.writeKBps) + " KB/s";
  return `R: ${r} / W: ${w}`;
}

function networkNote(system: SystemStats): string {
  const total = system.network.rxKBps + system.network.txKBps;
  if (total < 5) return "quiet";
  const rx = system.network.rxKBps >= 1024 ? (system.network.rxKBps / 1024).toFixed(1) + " MB/s" : Math.round(system.network.rxKBps) + " KB/s";
  const tx = system.network.txKBps >= 1024 ? (system.network.txKBps / 1024).toFixed(1) + " MB/s" : Math.round(system.network.txKBps) + " KB/s";
  return `↓${rx} ↑${tx}`;
}

// --- Historical baseline ---

function baselineNote(currentCpu: number, fullHistory: SystemHistoryEntry[]): string {
  if (fullHistory.length < 60) return ""; // need at least 1 hour of data
  const currentHour = new Date().getHours();
  const sameHourEntries = fullHistory.filter((e) => new Date(e.timestamp).getHours() === currentHour);
  if (sameHourEntries.length < 10) return "";
  const avg = sameHourEntries.reduce((s, e) => s + e.cpu, 0) / sameHourEntries.length;
  if (currentCpu > avg * 2) return "Unusual for this time of day";
  return "Typical for this time of day";
}

// --- Main analysis ---

const IDLE_RETURN: ActivityState = {
  level: "idle", summary: "", details: [], activities: [],
  startedAt: null, durationMs: 0, trend: "stable",
  resources: {
    cpu: { percent: 0, note: "idle" },
    memory: { percent: 0, note: "idle" },
    diskIO: { readKBps: 0, writeKBps: 0, note: "idle" },
    network: { rxKBps: 0, txKBps: 0, note: "quiet" },
  },
};

export function analyzeActivity(
  system: SystemStats,
  topProcs: { byCpu: TopProcess[]; byMem: TopProcess[] },
  pm2Procs: PM2Process[],
  recentHistory: SystemHistoryEntry[],
  fullHistory: SystemHistoryEntry[],
): ActivityState {
  const cpu = system.cpu;

  // Determine level
  let level: ActivityState["level"];
  if (cpu > 90) level = "critical";
  else if (cpu > 70) level = "heavy";
  else if (cpu > 50) level = "moderate";
  else if (cpu > 30) level = "light";
  else level = "idle";

  if (level === "idle") {
    if (stressStartedAt !== null) {
      // Debounce: only clear after staying idle
      stressStartedAt = null;
      lastLevel = "idle";
    }
    lastActivity = IDLE_RETURN;
    return IDLE_RETURN;
  }

  // Duration tracking
  const now = Date.now();
  if (stressStartedAt === null || lastLevel === "idle") {
    stressStartedAt = now;
  }
  lastLevel = level;
  const durationMs = now - stressStartedAt;

  // Group and classify processes
  const activities = groupProcesses(topProcs.byCpu, pm2Procs);
  const trend = detectTrend(recentHistory);

  // Build summary
  const durationStr = durationMs < 60_000
    ? `${Math.round(durationMs / 1000)}s`
    : `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;

  const levelLabels: Record<string, string> = {
    light: "Light activity", moderate: "Moderate load",
    heavy: "Heavy load", critical: "Critical load",
  };

  const topActivity = activities[0];
  let summary = `${levelLabels[level]} for ${durationStr}`;
  if (topActivity) {
    summary += ` — ${topActivity.label} (${topActivity.cpuPercent}% CPU)`;
  }

  // Build details
  const details: string[] = [];
  for (const a of activities.slice(0, 4)) {
    let line = `${a.label}: ${a.cpuPercent}% CPU, ${a.memPercent}% memory`;
    if (a.processes.length > 0 && a.processes[0] !== a.label) {
      line += ` (${a.processes[0]})`;
    }
    details.push(line);
  }

  const memNote = memoryNote(system, recentHistory);
  const dioNote = diskNote(system);
  const netNote = networkNote(system);
  const baseline = baselineNote(cpu, fullHistory);
  if (baseline) details.push(baseline);

  const state: ActivityState = {
    level,
    summary,
    details,
    activities,
    startedAt: stressStartedAt ? new Date(stressStartedAt).toISOString() : null,
    durationMs,
    trend,
    resources: {
      cpu: { percent: cpu, note: `${cpu}% (${trend})` },
      memory: { percent: system.memory.percent, note: memNote },
      diskIO: { readKBps: system.diskIO.readKBps, writeKBps: system.diskIO.writeKBps, note: dioNote },
      network: { rxKBps: system.network.rxKBps, txKBps: system.network.txKBps, note: netNote },
    },
  };

  lastActivity = state;
  return state;
}

export function getLastActivity(): ActivityState {
  return lastActivity ?? IDLE_RETURN;
}
