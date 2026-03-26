import { describe, it, expect } from "vitest";
import type {
  SystemStats, SystemHistoryEntry, StatusResponse, SpeedTestResult,
  SysInfo, SelfMonitorStats, LoggedInUser, PendingUpdates, DockerContainer,
  ServiceStatus, TopProcess, ConnectivityStatus, PM2Process,
  CertStatus, SshAuthEvent, SmartHealth, CronJob, BandwidthMonth, Incident, PM2RestartEntry,
} from "../src/types.js";

describe("type contracts", () => {
  it("SystemStats has all required fields", () => {
    const stats: SystemStats = {
      cpu: 50,
      cpuCores: 4,
      memory: { used: 4, total: 8, percent: 50 },
      swap: { used: 0, total: 2, percent: 0 },
      disk: [{ mount: "/", used: 10, total: 100, percent: 10 }],
      diskIO: { readKBps: 0, writeKBps: 0, devices: [] },
      network: { rxKBps: 1, txKBps: 1, interfaces: [] },
      loadAvg: { load1: 0.5, load5: 0.3, load15: 0.2, runProcs: 2, totalProcs: 300 },
      temperature: { maxC: 45, zones: [{ zone: "cpu", tempC: 45 }] },
      tcpConnections: { established: 10, listening: 5, timeWait: 2, total: 17, listeningPorts: [22, 80] },
    };
    expect(stats.cpu).toBe(50);
    expect(stats.tcpConnections.listeningPorts).toContain(22);
  });

  it("SystemHistoryEntry has all persisted fields", () => {
    const entry: SystemHistoryEntry = {
      timestamp: new Date().toISOString(),
      cpu: 50, memPercent: 60, memUsedGB: 4.8, diskPercent: 10,
      rxKBps: 1.5, txKBps: 0.5, load1: 0.5, swapPercent: 0,
      tempC: 45, diskReadKBps: 10, diskWriteKBps: 5, tcpEstablished: 10,
    };
    expect(Object.keys(entry)).toHaveLength(13);
  });

  it("SpeedTestResult has status enum values", () => {
    const idle: SpeedTestResult = { timestamp: "", downloadMbps: 0, uploadMbps: 0, latencyMs: 0, status: "idle" };
    const running: SpeedTestResult = { timestamp: "", downloadMbps: 0, uploadMbps: 0, latencyMs: 0, status: "running", phase: "download" };
    const done: SpeedTestResult = { timestamp: new Date().toISOString(), downloadMbps: 95, uploadMbps: 47, latencyMs: 12, status: "completed" };
    const failed: SpeedTestResult = { timestamp: "", downloadMbps: 0, uploadMbps: 0, latencyMs: 0, status: "failed", error: "timeout" };
    expect(idle.status).toBe("idle");
    expect(running.phase).toBe("download");
    expect(done.downloadMbps).toBe(95);
    expect(failed.error).toBe("timeout");
  });

  it("StatusResponse includes all top-level fields", () => {
    const response: StatusResponse = {
      system: {} as SystemStats,
      pm2: { processes: [] },
      connectivity: { status: "online", targets: [], wanIp: null, lastChecked: "" },
      topProcesses: { byCpu: [], byMem: [] },
      services: [],
      sysInfo: null,
      selfMonitor: null,
      loggedInUsers: [],
      pendingUpdates: null,
      docker: [],
      incidents: [],
      certs: [],
      sshAuth: [],
      smart: [],
      crontabs: [],
      bandwidth: [],
      meta: {
        hostname: "test", platform: "linux", uptime: 0,
        bootTimestamp: "", nodeVersion: "", monitorVersion: "1.0.0",
      },
    };
    expect(Object.keys(response)).toHaveLength(17);
    expect(response.meta.bootTimestamp).toBeDefined();
  });

  it("new monitoring types have correct shape", () => {
    const cert: CertStatus = { domain: "example.com", validTo: "2026-12-01T00:00:00Z", daysRemaining: 250, issuer: "Let's Encrypt" };
    const ssh: SshAuthEvent = { timestamp: "2026-03-26T10:00:00", type: "failed", user: "root", ip: "1.2.3.4", method: "password" };
    const smart: SmartHealth = { device: "sda", status: "healthy", temperature: 35 };
    const cron: CronJob = { user: "root", schedule: "0 * * * *", command: "/usr/bin/backup" };
    const bw: BandwidthMonth = { month: "2026-03", rxGB: 42.5, txGB: 12.3 };
    const restart: PM2RestartEntry = { timestamp: "2026-03-26T10:00:00Z", name: "myapp", restarts: 5 };
    const incident: Incident = { id: "abc123", type: "pm2:myapp", detail: "myapp errored", status: "down", startedAt: "2026-03-26T10:00:00Z" };

    expect(cert.daysRemaining).toBe(250);
    expect(ssh.type).toBe("failed");
    expect(smart.status).toBe("healthy");
    expect(cron.schedule).toBe("0 * * * *");
    expect(bw.rxGB).toBe(42.5);
    expect(restart.restarts).toBe(5);
    expect(incident.status).toBe("down");
  });
});
