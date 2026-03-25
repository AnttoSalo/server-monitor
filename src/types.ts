export interface InterfaceStats {
  name: string;
  rxKBps: number;
  txKBps: number;
}

export interface SystemStats {
  cpu: number;
  memory: { used: number; total: number; percent: number };
  disk: DiskInfo[];
  network: { rxKBps: number; txKBps: number; interfaces: InterfaceStats[] };
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
}

export interface ConnectivityHistoryEntry {
  timestamp: string;
  targets: PingTarget[];
}

export interface StatusResponse {
  system: SystemStats;
  pm2: { processes: PM2Process[] };
  connectivity: ConnectivityStatus;
  meta: {
    hostname: string;
    platform: string;
    uptime: number;
    nodeVersion: string;
    monitorVersion: string;
  };
}
