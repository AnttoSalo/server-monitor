import express from "express";
import { createServer } from "http";
import { join } from "path";
import { WebSocketServer } from "ws";
import { collectSystem, getLastStats } from "./collectors/system.js";
import { collectPM2, getLastProcesses } from "./collectors/pm2.js";
import { collectConnectivity, getLastConnectivity } from "./collectors/connectivity.js";
import { collectTopProcesses } from "./collectors/processes.js";
import { collectServices, getLastServices } from "./collectors/services.js";
import { collectSysInfo } from "./collectors/sysinfo.js";
import { collectSelfMonitor, setCollectionMs } from "./collectors/selfmon.js";
import { collectUsers } from "./collectors/users.js";
import { collectUpdates } from "./collectors/updates.js";
import { collectDocker } from "./collectors/docker.js";
import { collectCerts } from "./collectors/certs.js";
import { collectSshAuth } from "./collectors/sshauth.js";
import { collectSmart } from "./collectors/smart.js";
import { collectCrontabs } from "./collectors/crontabs.js";
import { initBandwidth, updateBandwidth, persistBandwidth } from "./collectors/bandwidth.js";
import { trackRestarts } from "./collectors/restarts.js";
import { checkAlerts } from "./collectors/alerts.js";
import { trackUptime } from "./collectors/uptime.js";
import { checkScheduledReport } from "./collectors/reports.js";
import { authMiddleware } from "./auth.js";
import statusRouter from "./routes/status.js";
import systemRouter from "./routes/system.js";
import pm2Router from "./routes/pm2.js";
import connectivityRouter from "./routes/connectivity.js";
import healthRouter from "./routes/health.js";
import speedtestRouter from "./routes/speedtest.js";
import exportRouter from "./routes/export.js";

const PORT = parseInt(process.env.PORT || "3099");
const BASE = process.env.BASE_PATH || "";
const SYSTEM_INTERVAL = parseInt(process.env.SYSTEM_INTERVAL || "10000");
const PM2_INTERVAL = parseInt(process.env.PM2_INTERVAL || "30000");
const PROCESS_INTERVAL = parseInt(process.env.PROCESS_INTERVAL || "15000");
const CONNECTIVITY_INTERVAL = parseInt(process.env.CONNECTIVITY_INTERVAL || "30000");
const app = express();
const server = createServer(app);

// WebSocket server for real-time push
const wss = new WebSocketServer({ server, path: BASE + "/ws" });

function broadcastStatus(): void {
  if (wss.clients.size === 0) return;
  const system = getLastStats();
  if (!system) return;
  const msg = JSON.stringify({ type: "status", system });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

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
app.use(BASE + "/export", exportRouter);

app.use(BASE + "/", express.static(join(import.meta.dirname, "..", "public")));

// Track whether a history entry was just added (for bandwidth tracking)
let lastHistoryEntryCount = 0;

async function startCollectors() {
  console.log("Starting collectors...");

  await initBandwidth();

  const t0 = performance.now();
  await Promise.allSettled([
    collectSystem(), collectPM2(), collectConnectivity(),
    collectTopProcesses(), collectServices(), collectSysInfo(),
    collectUsers(), collectUpdates(), collectDocker(),
    collectCerts(), collectSshAuth(), collectSmart(), collectCrontabs(),
  ]);
  setCollectionMs(Math.round(performance.now() - t0));
  collectSelfMonitor();
  console.log("Initial collection complete");

  // System stats at configured interval
  setInterval(async () => {
    const t = performance.now();
    await collectSystem().catch(console.error);
    setCollectionMs(Math.round(performance.now() - t));
    collectSelfMonitor();

    // Check alerts and track uptime
    const sys = getLastStats();
    const pm2 = getLastProcesses();
    const conn = getLastConnectivity();
    const svcs = getLastServices();
    if (sys) {
      checkAlerts(sys, pm2, conn, svcs);
      trackUptime(conn, svcs, pm2).catch(() => {});
    }

    // Broadcast via WebSocket
    broadcastStatus();

    // Check scheduled reports
    checkScheduledReport();
  }, SYSTEM_INTERVAL);

  setInterval(async () => {
    await collectPM2().catch(console.error);
    trackRestarts(getLastProcesses()).catch(() => {});
  }, PM2_INTERVAL);
  setInterval(() => { collectTopProcesses().catch(console.error); }, PROCESS_INTERVAL);
  setInterval(() => { collectConnectivity().catch(console.error); }, CONNECTIVITY_INTERVAL);
  setInterval(() => { collectServices().catch(console.error); }, CONNECTIVITY_INTERVAL);
  setInterval(() => { collectUsers().catch(console.error); }, CONNECTIVITY_INTERVAL);
  setInterval(() => { collectDocker().catch(console.error); }, CONNECTIVITY_INTERVAL);
  setInterval(() => { collectSshAuth().catch(console.error); }, CONNECTIVITY_INTERVAL);

  // Slow collectors
  setInterval(() => { collectUpdates().catch(console.error); }, 3_600_000); // 1 hour
  setInterval(() => { collectCerts().catch(console.error); }, 3_600_000); // 1 hour
  setInterval(() => { collectSmart().catch(console.error); }, 3_600_000); // 1 hour
  setInterval(() => { collectCrontabs().catch(console.error); }, 3_600_000); // 1 hour

  // Bandwidth persistence every 5 min
  setInterval(() => { persistBandwidth().catch(() => {}); }, 300_000);
}

server.listen(PORT, () => {
  console.log(`server-monitor listening on port ${PORT}${BASE ? ` (base: ${BASE})` : ""}`);
  startCollectors();
});
