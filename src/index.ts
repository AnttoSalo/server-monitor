import express from "express";
import { join } from "path";
import { collectSystem } from "./collectors/system.js";
import { collectPM2 } from "./collectors/pm2.js";
import { collectConnectivity } from "./collectors/connectivity.js";
import { collectTopProcesses } from "./collectors/processes.js";
import { collectServices } from "./collectors/services.js";
import { collectSysInfo } from "./collectors/sysinfo.js";
import { collectSelfMonitor, setCollectionMs } from "./collectors/selfmon.js";
import { collectUsers } from "./collectors/users.js";
import { collectUpdates } from "./collectors/updates.js";
import { collectDocker } from "./collectors/docker.js";
import { authMiddleware } from "./auth.js";
import statusRouter from "./routes/status.js";
import systemRouter from "./routes/system.js";
import pm2Router from "./routes/pm2.js";
import connectivityRouter from "./routes/connectivity.js";
import healthRouter from "./routes/health.js";

const PORT = parseInt(process.env.PORT || "3099");
const BASE = process.env.BASE_PATH || "";
const app = express();

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(authMiddleware);

app.use(BASE + "/status", statusRouter);
app.use(BASE + "/system", systemRouter);
app.use(BASE + "/pm2", pm2Router);
app.use(BASE + "/connectivity", connectivityRouter);
app.use(BASE + "/health", healthRouter);

app.use(BASE + "/", express.static(join(import.meta.dirname, "..", "public")));

async function startCollectors() {
  console.log("Starting collectors...");

  const t0 = performance.now();
  await Promise.allSettled([
    collectSystem(), collectPM2(), collectConnectivity(),
    collectTopProcesses(), collectServices(), collectSysInfo(),
    collectUsers(), collectUpdates(), collectDocker(),
  ]);
  setCollectionMs(Math.round(performance.now() - t0));
  collectSelfMonitor();
  console.log("Initial collection complete");

  // System stats every 10s (with self-monitor timing)
  setInterval(async () => {
    const t = performance.now();
    await collectSystem().catch(console.error);
    setCollectionMs(Math.round(performance.now() - t));
    collectSelfMonitor();
  }, 10_000);

  // PM2 stats every 30s (reduced from 10s)
  setInterval(() => { collectPM2().catch(console.error); }, 30_000);

  // Top processes every 15s (reduced from 10s)
  setInterval(() => { collectTopProcesses().catch(console.error); }, 15_000);

  // Connectivity every 30s
  setInterval(() => { collectConnectivity().catch(console.error); }, 30_000);

  // Services + users every 30s
  setInterval(() => { collectServices().catch(console.error); }, 30_000);
  setInterval(() => { collectUsers().catch(console.error); }, 30_000);

  // Docker every 30s
  setInterval(() => { collectDocker().catch(console.error); }, 30_000);

  // Package updates every 1 hour
  setInterval(() => { collectUpdates().catch(console.error); }, 3_600_000);
}

app.listen(PORT, () => {
  console.log(`server-monitor listening on port ${PORT}${BASE ? ` (base: ${BASE})` : ""}`);
  startCollectors();
});
