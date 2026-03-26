import { readFile } from "fs/promises";
import os from "os";
import type { SysInfo } from "../types.js";

let cached: SysInfo | null = null;

export async function collectSysInfo(): Promise<SysInfo> {
  if (cached) return cached;

  let kernel = "";
  try {
    kernel = (await readFile("/proc/version", "utf-8")).trim().split(" ").slice(0, 3).join(" ");
  } catch {
    kernel = os.release();
  }

  const cpus = os.cpus();
  cached = {
    os: os.type() + " " + os.release(),
    kernel,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || "unknown",
    cpuCores: cpus.length || 1,
    totalMemGB: Math.round(os.totalmem() / 1073741824 * 10) / 10,
    bootTimestamp: new Date(Date.now() - os.uptime() * 1000).toISOString(),
  };
  return cached;
}

export function getLastSysInfo(): SysInfo | null {
  return cached;
}
