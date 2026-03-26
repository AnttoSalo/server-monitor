import { randomBytes } from "crypto";
import type { ConnectivityStatus, ServiceStatus, PM2Process, Incident } from "../types.js";
import { loadJson, saveJson } from "../store.js";

const INCIDENTS_FILE = "incidents.json";
const MAX_INCIDENTS = 100;

let incidents: Incident[] | null = null;
let prevConnectivity: string = "online";
let prevServices: Record<string, string> = {};
let prevPm2: Record<string, string> = {};
let initialized = false;

async function ensureLoaded(): Promise<Incident[]> {
  if (!incidents) incidents = await loadJson<Incident[]>(INCIDENTS_FILE, []);
  return incidents;
}

function genId(): string {
  return randomBytes(6).toString("hex");
}

async function addIncident(type: string, detail: string, status: "down" | "recovered"): Promise<void> {
  const list = await ensureLoaded();

  if (status === "recovered") {
    // Find the matching active incident and mark it recovered
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].type === type && list[i].status === "down") {
        list[i].status = "recovered";
        list[i].recoveredAt = new Date().toISOString();
        list[i].durationMs = new Date(list[i].recoveredAt!).getTime() - new Date(list[i].startedAt).getTime();
        list[i].detail = detail;
        break;
      }
    }
  } else {
    list.push({
      id: genId(),
      type,
      detail,
      status: "down",
      startedAt: new Date().toISOString(),
    });
  }

  // Trim to max
  while (list.length > MAX_INCIDENTS) list.shift();
  incidents = list;
  saveJson(INCIDENTS_FILE, list).catch(() => {});
}

export async function trackUptime(
  connectivity: ConnectivityStatus,
  services: ServiceStatus[],
  pm2Processes: PM2Process[],
): Promise<void> {
  // Skip first call to establish baseline
  if (!initialized) {
    initialized = true;
    prevConnectivity = connectivity.status;
    for (const s of services) prevServices[s.name] = s.status;
    for (const p of pm2Processes) prevPm2[p.name] = p.status;
    await ensureLoaded();
    return;
  }

  // Connectivity
  if (connectivity.status !== prevConnectivity) {
    if (connectivity.status === "offline" || connectivity.status === "degraded") {
      await addIncident("connectivity", `Internet ${connectivity.status}`, "down");
    } else if (prevConnectivity === "offline" || prevConnectivity === "degraded") {
      await addIncident("connectivity", "Internet recovered", "recovered");
    }
    prevConnectivity = connectivity.status;
  }

  // Services
  for (const s of services) {
    const prev = prevServices[s.name];
    if (prev && prev !== s.status) {
      if (s.status === "failed" || s.status === "inactive") {
        await addIncident(`service:${s.name}`, `${s.name} ${s.status}`, "down");
      } else if (s.status === "active" && (prev === "failed" || prev === "inactive")) {
        await addIncident(`service:${s.name}`, `${s.name} recovered`, "recovered");
      }
    }
    prevServices[s.name] = s.status;
  }

  // PM2 processes
  for (const p of pm2Processes) {
    const prev = prevPm2[p.name];
    if (prev && prev !== p.status) {
      if (p.status !== "online") {
        await addIncident(`pm2:${p.name}`, `${p.name} ${p.status}`, "down");
      } else if (prev !== "online") {
        await addIncident(`pm2:${p.name}`, `${p.name} recovered`, "recovered");
      }
    }
    prevPm2[p.name] = p.status;
  }
}

export async function getIncidents(): Promise<Incident[]> {
  return ensureLoaded();
}
