import { Router } from "express";
import type { SpeedTestResult } from "../types.js";

const router = Router();

let lastResult: SpeedTestResult = {
  timestamp: "",
  downloadMbps: 0,
  uploadMbps: 0,
  latencyMs: 0,
  status: "idle",
};

async function measureDownload(): Promise<number> {
  const bytes = 25_000_000;
  const url = `https://speed.cloudflare.com/__down?bytes=${bytes}`;
  const start = performance.now();
  const res = await fetch(url);
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
  } catch (err) {
    lastResult = {
      ...lastResult,
      status: "failed",
      phase: undefined,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

router.get("/", (_req, res) => {
  res.json(lastResult);
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
