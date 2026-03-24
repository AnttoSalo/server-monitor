import { Router } from "express";
import { getLastProcesses } from "../collectors/pm2.js";
import { getLastConnectivity } from "../collectors/connectivity.js";
import { getLastStats } from "../collectors/system.js";

const router = Router();

router.get("/", (_req, res) => {
  const processes = getLastProcesses();
  const connectivity = getLastConnectivity();
  const system = getLastStats();

  const pm2Healthy = processes.length > 0 && processes.every((p) => p.status === "online");
  const internetHealthy = connectivity.status === "online";
  const systemHealthy = system ? system.memory.percent < 90 && system.cpu < 95 : false;

  res.json({
    healthy: pm2Healthy && internetHealthy && systemHealthy,
    checks: {
      pm2: { healthy: pm2Healthy, online: processes.filter((p) => p.status === "online").length, total: processes.length },
      internet: { healthy: internetHealthy, status: connectivity.status },
      system: { healthy: systemHealthy, cpu: system?.cpu ?? 0, memPercent: system?.memory.percent ?? 0 },
    },
  });
});

export default router;
