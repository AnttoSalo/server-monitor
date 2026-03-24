import express from "express";
import { join } from "path";
import { collectSystem } from "./collectors/system.js";
import { collectPM2 } from "./collectors/pm2.js";
import { collectConnectivity } from "./collectors/connectivity.js";
import { authMiddleware } from "./auth.js";
import statusRouter from "./routes/status.js";
import systemRouter from "./routes/system.js";
import pm2Router from "./routes/pm2.js";
import connectivityRouter from "./routes/connectivity.js";
import healthRouter from "./routes/health.js";

const PORT = parseInt(process.env.PORT || "3099");
const BASE = process.env.BASE_PATH || "";
const app = express();

// CORS — allow any local consumer
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Auth — validates NextAuth session cookie when NEXTAUTH_SECRET is set
app.use(authMiddleware);

// API routes (with optional base path prefix)
app.use(BASE + "/status", statusRouter);
app.use(BASE + "/system", systemRouter);
app.use(BASE + "/pm2", pm2Router);
app.use(BASE + "/connectivity", connectivityRouter);
app.use(BASE + "/health", healthRouter);

// Serve dashboard UI
app.use(BASE + "/", express.static(join(import.meta.dirname, "..", "public")));

// Start background collectors
async function startCollectors() {
  console.log("Starting collectors...");

  // Initial collection
  await Promise.allSettled([collectSystem(), collectPM2(), collectConnectivity()]);
  console.log("Initial collection complete");

  // System stats every 10s
  setInterval(() => { collectSystem().catch(console.error); }, 10_000);

  // PM2 stats every 10s
  setInterval(() => { collectPM2().catch(console.error); }, 10_000);

  // Connectivity every 30s
  setInterval(() => { collectConnectivity().catch(console.error); }, 30_000);
}

app.listen(PORT, () => {
  console.log(`server-monitor listening on port ${PORT}${BASE ? ` (base: ${BASE})` : ""}`);
  startCollectors();
});
