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
import speedtestRouter from "./routes/speedtest.js";

const PORT = parseInt(process.env.PORT || "3099");
const BASE = process.env.BASE_PATH || "";
const SYSTEM_INTERVAL = parseInt(process.env.SYSTEM_INTERVAL || "10000");
const PM2_INTERVAL = parseInt(process.env.PM2_INTERVAL || "30000");
const PROCESS_INTERVAL = parseInt(process.env.PROCESS_INTERVAL || "15000");
const CONNECTIVITY_INTERVAL = parseInt(process.env.CONNECTIVITY_INTERVAL || "30000");
const app = express();

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Log slow requests (>500ms) and errors
app.use((req, res, next) => {
  const start = performance.now();
  res.on("finish", () => {
    const ms = Math.round(performance.now() - start);
    if (ms > 500 || res.statusCode >= 400) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

app.use(authMiddleware);

app.use(BASE + "/status", statusRouter);
app.use(BASE + "/system", systemRouter);
app.use(BASE + "/pm2", pm2Router);
app.use(BASE + "/connectivity", connectivityRouter);
app.use(BASE + "/health", healthRouter);
app.use(BASE + "/speedtest", speedtestRouter);

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

  setInterval(async () => {
    const t = performance.now();
    await collectSystem().catch(console.error);
    setCollectionMs(Math.round(performance.now() - t));
    collectSelfMonitor();
  }, SYSTEM_INTERVAL);

  setInterval(() => { collectPM2().catch(console.error); }, PM2_INTERVAL);
  setInterval(() => { collectTopProcesses().catch(console.error); }, PROCESS_INTERVAL);
  setInterval(() => { collectConnectivity().catch(console.error); }, CONNECTIVITY_INTERVAL);
  setInterval(() => { collectServices().catch(console.error); }, CONNECTIVITY_INTERVAL);
  setInterval(() => { collectUsers().catch(console.error); }, CONNECTIVITY_INTERVAL);
  setInterval(() => { collectDocker().catch(console.error); }, CONNECTIVITY_INTERVAL);

  // Package updates every 1 hour
  setInterval(() => { collectUpdates().catch(console.error); }, 3_600_000);
}

app.listen(PORT, () => {
  console.log(`server-monitor listening on port ${PORT}${BASE ? ` (base: ${BASE})` : ""}`);
  startCollectors();
});
