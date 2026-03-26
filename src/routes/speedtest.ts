import { Router } from "express";
import type { SpeedTestResult } from "../types.js";
import { loadJson, saveJson } from "../store.js";

const router = Router();
const HISTORY_FILE = "speedtest-history.json";
const MAX_HISTORY = 20;

let lastResult: SpeedTestResult = {
  timestamp: "",
  downloadMbps: 0,
  uploadMbps: 0,
  latencyMs: 0,
  status: "idle",
};

// Load last result from disk on startup
loadJson<SpeedTestResult[]>(HISTORY_FILE, []).then((history) => {
  if (history.length > 0) lastResult = history[history.length - 1];
});

async function measureDownload(): Promise<number> {
  const bytes = 25_000_000;
  const start = performance.now();
  const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}`);
  const data = await res.arrayBuffer();
  const elapsed = (performance.now() - start) / 1000;
  if (elapsed === 0) return 0;
  return Math.round((data.byteLength * 8 / 1_000_000 / elapsed) * 10) / 10;
}

async function measureUpload(): Promise<number> {
  const size = 10_000_000;
  const payload = Buffer.alloc(size, 0x42);
  const start = performance.now();
  await fetch("https://speed.cloudflare.com/__up", {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/octet-stream" },
  });
  const elapsed = (performance.now() - start) / 1000;
  if (elapsed === 0) return 0;
  return Math.round((size * 8 / 1_000_000 / elapsed) * 10) / 10;
}

async function measureLatency(): Promise<number> {
  const start = performance.now();
  await fetch("https://speed.cloudflare.com/__down?bytes=0");
  return Math.round(performance.now() - start);
}

async function persistResult(result: SpeedTestResult): Promise<void> {
  const history = await loadJson<SpeedTestResult[]>(HISTORY_FILE, []);
  history.push(result);
  while (history.length > MAX_HISTORY) history.shift();
  await saveJson(HISTORY_FILE, history);
}

async function runTest(): Promise<void> {
  try {
    lastResult = { ...lastResult, status: "running", phase: "latency", error: undefined };
    const latencyMs = await measureLatency();

    lastResult = { ...lastResult, phase: "download", latencyMs };
    const downloadMbps = await measureDownload();

    lastResult = { ...lastResult, phase: "upload", downloadMbps };
    const uploadMbps = await measureUpload();

    lastResult = {
      timestamp: new Date().toISOString(),
      downloadMbps,
      uploadMbps,
      latencyMs,
      status: "completed",
      phase: "done",
    };
    persistResult(lastResult).catch(() => {});
  } catch (err) {
    lastResult = {
      ...lastResult,
      status: "failed",
      timestamp: new Date().toISOString(),
      phase: undefined,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

router.get("/", (_req, res) => {
  res.json(lastResult);
});

router.get("/history", async (_req, res) => {
  const history = await loadJson<SpeedTestResult[]>(HISTORY_FILE, []);
  res.json({ entries: history });
});

router.post("/run", (_req, res) => {
  if (lastResult.status === "running") {
    res.status(409).json({ error: "Speed test already running" });
    return;
  }
  runTest();
  res.status(202).json({ status: "running" });
});

export default router;
