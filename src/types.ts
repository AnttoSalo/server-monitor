export interface InterfaceStats {
  name: string;
  rxKBps: number;
  txKBps: number;
}

export interface ThermalZone {
  zone: string;
  tempC: number;
}

export interface DiskIOStats {
  device: string;
  readKBps: number;
  writeKBps: number;
}

export interface TopProcess {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rssKB: number;
  command: string;
  cwd?: string;
}

export interface ServiceStatus {
  name: string;
  status: "active" | "inactive" | "failed" | "unknown";
}

export interface SystemStats {
  cpu: number;
  cpuCores: number;
  memory: { used: number; total: number; percent: number };
  swap: { used: number; total: number; percent: number };
  disk: DiskInfo[];
  diskIO: { readKBps: number; writeKBps: number; devices: DiskIOStats[] };
  network: { rxKBps: number; txKBps: number; interfaces: InterfaceStats[] };
  loadAvg: { load1: number; load5: number; load15: number; runProcs: number; totalProcs: number };
  temperature: { maxC: number; zones: ThermalZone[] } | null;
  tcpConnections: { established: number; listening: number; timeWait: number; total: number; listeningPorts: number[] };
}

export interface DiskInfo {
  mount: string;
  used: number;
  total: number;
  percent: number;
}

export interface PM2Process {
  id: number;
  name: string;
  status: string;
  cpu: number;
  memoryMB: number;
  uptimeMs: number;
  restarts: number;
}

export interface PingTarget {
  host: string;
  latencyMs: number;
  reachable: boolean;
}

export interface ConnectivityStatus {
  status: "online" | "degraded" | "offline";
  targets: PingTarget[];
  wanIp: string | null;
  lastChecked: string;
}

export interface SystemHistoryEntry {
  timestamp: string;
  cpu: number;
  memPercent: number;
  memUsedGB: number;
  diskPercent: number;
  rxKBps: number;
  txKBps: number;
  load1: number;
  swapPercent: number;
  tempC: number;
  diskReadKBps: number;
  diskWriteKBps: number;
  tcpEstablished: number;
}

export interface ConnectivityHistoryEntry {
  timestamp: string;
  targets: PingTarget[];
}

export interface SpeedTestResult {
  timestamp: string;
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
  status: "idle" | "running" | "completed" | "failed";
  phase?: string;
  error?: string;
}

export interface SysInfo {
  os: string;
  kernel: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemGB: number;
  bootTimestamp: string;
}

export interface SelfMonitorStats {
  memoryMB: number;
  cpuPercent: number;
  collectionMs: number;
  uptimeSeconds: number;
}

export interface LoggedInUser {
  user: string;
  terminal: string;
  loginTime: string;
  from: string;
}

export interface PendingUpdates {
  count: number;
  lastChecked: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
}

export interface CertStatus {
  domain: string;
  validTo: string;
  daysRemaining: number;
  issuer: string;
  error?: string;
}

export interface SshAuthEvent {
  timestamp: string;
  type: "failed" | "accepted";
  user: string;
  ip: string;
  method: string;
}

export interface SmartHealth {
  device: string;
  status: "healthy" | "warning" | "failing" | "unknown";
  temperature?: number;
  detail?: string;
}

export interface CronJob {
  user: string;
  schedule: string;
  command: string;
}

export interface BandwidthMonth {
  month: string;
  rxGB: number;
  txGB: number;
}

export interface PM2RestartEntry {
  timestamp: string;
  name: string;
  restarts: number;
}

export interface Activity {
  type: "build" | "serve" | "database" | "system" | "download" | "unknown";
  label: string;
  processes: string[];
  cpuPercent: number;
  memPercent: number;
}

export interface ActivityState {
  level: "idle" | "light" | "moderate" | "heavy" | "critical";
  summary: string;
  details: string[];
  activities: Activity[];
  startedAt: string | null;
  durationMs: number;
  trend: "rising" | "stable" | "falling";
  resources: {
    cpu: { percent: number; note: string };
    memory: { percent: number; note: string };
    diskIO: { readKBps: number; writeKBps: number; note: string };
    network: { rxKBps: number; txKBps: number; note: string };
  };
}

export interface Incident {
  id: string;
  type: string;
  detail: string;
  status: "down" | "recovered";
  startedAt: string;
  recoveredAt?: string;
  durationMs?: number;
}

export interface StatusResponse {
  system: SystemStats;
  pm2: { processes: PM2Process[] };
  connectivity: ConnectivityStatus;
  topProcesses: { byCpu: TopProcess[]; byMem: TopProcess[] };
  services: ServiceStatus[];
  sysInfo: SysInfo | null;
  selfMonitor: SelfMonitorStats | null;
  loggedInUsers: LoggedInUser[];
  pendingUpdates: PendingUpdates | null;
  docker: DockerContainer[];
  incidents: Incident[];
  certs: CertStatus[];
  sshAuth: SshAuthEvent[];
  smart: SmartHealth[];
  crontabs: CronJob[];
  bandwidth: BandwidthMonth[];
  activity: ActivityState;
  meta: {
    hostname: string;
    platform: string;
    uptime: number;
    bootTimestamp: string;
    nodeVersion: string;
    monitorVersion: string;
  };
}

export interface StatsResponse {
  system: {
    cpu: { avg: number; median: number; peak: number; p95: number; timeAbove90Pct: number };
    memory: { avgPercent: number; peakPercent: number; peakTime: string; trend: "rising" | "falling" | "stable" };
    disk: { avgPercent: number; avgReadKBps: number; avgWriteKBps: number; readWriteRatio: number };
    load: { avg: number; peak: number; normalized: number };
    temperature: { avg: number; peak: number; timeAbove80: number };
    swap: { avg: number; peak: number };
  };
  network: {
    totalRxMB: number; totalTxMB: number;
    avgRxKBps: number; avgTxKBps: number;
    peakRxKBps: number; peakTxKBps: number;
    monthlyBandwidth: BandwidthMonth[];
    ytdRxGB: number; ytdTxGB: number;
  };
  connectivity: {
    uptimePercent: number;
    perTarget: { host: string; avgLatencyMs: number; worstLatencyMs: number; packetLossPct: number }[];
  };
  uptime: {
    overallUptimePct: number;
    currentStreakMs: number;
    mttrMs: number;
    mtbfMs: number;
    totalIncidents: number;
    incidentsByType: Record<string, number>;
    longestOutageMs: number;
    recentIncidents: Incident[];
  };
  speedTest: {
    avgDownload: number; avgUpload: number;
    bestDownload: number; worstDownload: number;
    bestUpload: number; worstUpload: number;
    avgLatency: number;
    lastTestTimestamp: string;
    totalTests: number;
  };
  processes: {
    pm2Online: number; pm2Total: number;
    totalRestarts: number;
    mostRestarted: { name: string; count: number } | null;
    perProcess: { name: string; cpu: number; memoryMB: number; restarts: number; status: string }[];
    dockerByState: Record<string, number>;
  };
  security: {
    totalSshEvents: number;
    failedLogins: number; acceptedLogins: number;
    successRate: number;
    topAttackingIPs: { ip: string; count: number }[];
    authMethodDist: Record<string, number>;
    soonestCertExpiryDays: number;
    certsExpiringWithin30d: number;
    smartSummary: Record<string, number>;
  };
  overview: {
    serverUptimeSec: number;
    monitorUptimeSec: number;
    totalDataPoints: number;
    collectionCycleMs: number;
    pendingUpdates: number;
    activeUserSessions: number;
    hostname: string;
    os: string;
    cpuModel: string;
    cpuCores: number;
    totalMemGB: number;
  };
  range: string;
  computedAt: string;
}
