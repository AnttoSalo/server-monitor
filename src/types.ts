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
  tcpConnections: { established: number; listening: number; timeWait: number; total: number };
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

export interface StatusResponse {
  system: SystemStats;
  pm2: { processes: PM2Process[] };
  connectivity: ConnectivityStatus;
  topProcesses: { byCpu: TopProcess[]; byMem: TopProcess[] };
  services: ServiceStatus[];
  meta: {
    hostname: string;
    platform: string;
    uptime: number;
    nodeVersion: string;
    monitorVersion: string;
  };
}
