import { Router } from "express";
import os from "os";
import { getLastStats } from "../collectors/system.js";
import { getLastProcesses } from "../collectors/pm2.js";
import { getLastConnectivity } from "../collectors/connectivity.js";
import { getLastTopProcesses } from "../collectors/processes.js";
import { getLastServices } from "../collectors/services.js";
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
  tcpConnections: { established: 0, listening: 0, timeWait: 0, total: 0 },
};

router.get("/", (_req, res) => {
  const system = getLastStats();
  const processes = getLastProcesses();
  const connectivity = getLastConnectivity();
  const topProcesses = getLastTopProcesses();
  const services = getLastServices();

  const response: StatusResponse = {
    system: system ?? EMPTY_SYSTEM,
    pm2: { processes },
    connectivity,
    topProcesses,
    services,
    meta: {
      hostname: os.hostname(),
      platform: process.platform,
      uptime: os.uptime(),
      nodeVersion: process.version,
      monitorVersion: "1.0.0",
    },
  };

  res.json(response);
});

export default router;
