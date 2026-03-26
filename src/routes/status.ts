import { Router } from "express";
import os from "os";
import { getLastStats } from "../collectors/system.js";
import { getLastProcesses } from "../collectors/pm2.js";
import { getLastConnectivity } from "../collectors/connectivity.js";
import { getLastTopProcesses } from "../collectors/processes.js";
import { getLastServices } from "../collectors/services.js";
import { getLastSysInfo } from "../collectors/sysinfo.js";
import { getLastSelfMonitor } from "../collectors/selfmon.js";
import { getLastUsers } from "../collectors/users.js";
import { getLastUpdates } from "../collectors/updates.js";
import { getLastDocker } from "../collectors/docker.js";
import type { StatusResponse } from "../types.js";

const router = Router();

const EMPTY_SYSTEM = {
  cpu: 0,
  cpuCores: os.cpus().length || 1,
  memory: { used: 0, total: 0, percent: 0 },
  swap: { used: 0, total: 0, percent: 0 },
  disk: [],
  diskIO: { readKBps: 0, writeKBps: 0, devices: [] },
  network: { rxKBps: 0, txKBps: 0, interfaces: [] },
  loadAvg: { load1: 0, load5: 0, load15: 0, runProcs: 0, totalProcs: 0 },
  temperature: null,
  tcpConnections: { established: 0, listening: 0, timeWait: 0, total: 0, listeningPorts: [] },
};

router.get("/", (_req, res) => {
  const response: StatusResponse = {
    system: getLastStats() ?? EMPTY_SYSTEM,
    pm2: { processes: getLastProcesses() },
    connectivity: getLastConnectivity(),
    topProcesses: getLastTopProcesses(),
    services: getLastServices(),
    sysInfo: getLastSysInfo(),
    selfMonitor: getLastSelfMonitor(),
    loggedInUsers: getLastUsers(),
    pendingUpdates: getLastUpdates(),
    docker: getLastDocker(),
    meta: {
      hostname: os.hostname(),
      platform: process.platform,
      uptime: os.uptime(),
      bootTimestamp: new Date(Date.now() - os.uptime() * 1000).toISOString(),
      nodeVersion: process.version,
      monitorVersion: "1.0.0",
    },
  };

  res.json(response);
});

export default router;
