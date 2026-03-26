import type { SystemHistoryEntry, BandwidthMonth } from "../types.js";
import { loadJson, saveJson } from "../store.js";

const BANDWIDTH_FILE = "bandwidth.json";

let bandwidthData: BandwidthMonth[] = [];
let lastMonth = "";

export async function initBandwidth(): Promise<void> {
  bandwidthData = await loadJson<BandwidthMonth[]>(BANDWIDTH_FILE, []);
}

export function updateBandwidth(entry: SystemHistoryEntry): void {
  const month = entry.timestamp.substring(0, 7); // "2026-03"

  if (month !== lastMonth) {
    lastMonth = month;
    if (!bandwidthData.find((b) => b.month === month)) {
      bandwidthData.push({ month, rxGB: 0, txGB: 0 });
    }
  }

  const current = bandwidthData.find((b) => b.month === month);
  if (current) {
    // Each history entry covers ~60s, convert KB/s * 60s to KB, then to GB
    current.rxGB = Math.round((current.rxGB + (entry.rxKBps * 60) / 1048576) * 1000) / 1000;
    current.txGB = Math.round((current.txGB + (entry.txKBps * 60) / 1048576) * 1000) / 1000;
  }

  // Keep last 12 months
  while (bandwidthData.length > 12) bandwidthData.shift();
}

export async function persistBandwidth(): Promise<void> {
  await saveJson(BANDWIDTH_FILE, bandwidthData);
}

export function getLastBandwidth(): BandwidthMonth[] {
  return bandwidthData;
}
