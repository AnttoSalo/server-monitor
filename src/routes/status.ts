import { Router } from "express";
import os from "os";
import { getLastStats } from "../collectors/system.js";
import { getLastProcesses } from "../collectors/pm2.js";
import { getLastConnectivity } from "../collectors/connectivity.js";
import type { StatusResponse } from "../types.js";

const router = Router();

router.get("/", (_req, res) => {
  const system = getLastStats();
  const processes = getLastProcesses();
  const connectivity = getLastConnectivity();

  const response: StatusResponse = {
    system: system ?? {
      cpu: 0,
      memory: { used: 0, total: 0, percent: 0 },
      disk: [],
      network: { rxKBps: 0, txKBps: 0, interfaces: [] },
    },
    pm2: { processes },
    connectivity,
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
