import os from "os";
import type { SystemStats, PM2Process, ConnectivityStatus, ServiceStatus } from "../types.js";

const WEBHOOK_URL = process.env.ALERT_WEBHOOK || "";
const COOLDOWN_MS = 600_000; // 10 min

const THRESHOLDS = {
  cpu: parseInt(process.env.ALERT_CPU || "90"),
  memory: parseInt(process.env.ALERT_MEMORY || "85"),
  disk: parseInt(process.env.ALERT_DISK || "90"),
  temp: parseInt(process.env.ALERT_TEMP || "80"),
};

const CPU_SUSTAIN_COUNT = 6; // 6 checks at 10s = 60s sustained

let cpuBreachCount = 0;
const lastFired: Record<string, number> = {};
const activeAlerts = new Set<string>();

const RED = 15548997;
const AMBER = 16763904;
const GREEN = 5763719;

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
}

async function sendWebhook(embed: DiscordEmbed): Promise<void> {
  if (!WEBHOOK_URL) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [{ ...embed, timestamp: new Date().toISOString() }] }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Fire-and-forget — don't crash on webhook failure
  }
}

function canFire(key: string): boolean {
  const last = lastFired[key] || 0;
  return Date.now() - last >= COOLDOWN_MS;
}

function fireAlert(key: string, embed: DiscordEmbed): void {
  if (!canFire(key)) return;
  lastFired[key] = Date.now();
  activeAlerts.add(key);
  sendWebhook(embed);
}

function fireRecovery(key: string, title: string, detail: string): void {
  if (!activeAlerts.has(key)) return;
  activeAlerts.delete(key);
  sendWebhook({
    title,
    description: detail,
    color: GREEN,
    fields: [{ name: "Host", value: os.hostname(), inline: true }],
  });
}

const hostname = os.hostname();

export function checkAlerts(
  system: SystemStats,
  pm2Processes: PM2Process[],
  connectivity: ConnectivityStatus,
  services: ServiceStatus[],
): void {
  // --- CPU (sustained) ---
  if (system.cpu > THRESHOLDS.cpu) {
    cpuBreachCount++;
    if (cpuBreachCount >= CPU_SUSTAIN_COUNT) {
      fireAlert("cpu", {
        title: `🔴 CPU Critical — ${system.cpu}%`,
        description: `CPU usage has exceeded ${THRESHOLDS.cpu}% for over 60 seconds.`,
        color: RED,
        fields: [
          { name: "Host", value: hostname, inline: true },
          { name: "Current", value: `${system.cpu}%`, inline: true },
          { name: "Load", value: `${system.loadAvg.load1.toFixed(2)}`, inline: true },
        ],
      });
    }
  } else {
    if (cpuBreachCount >= CPU_SUSTAIN_COUNT) {
      fireRecovery("cpu", `🟢 CPU Recovered — ${system.cpu}%`, `CPU usage has dropped below ${THRESHOLDS.cpu}%.`);
    }
    cpuBreachCount = 0;
  }

  // --- Memory ---
  if (system.memory.percent > THRESHOLDS.memory) {
    fireAlert("memory", {
      title: `🔴 Memory Critical — ${system.memory.percent}%`,
      description: `RAM usage has exceeded ${THRESHOLDS.memory}%.`,
      color: RED,
      fields: [
        { name: "Host", value: hostname, inline: true },
        { name: "Used", value: `${system.memory.used}/${system.memory.total} GB`, inline: true },
      ],
    });
  } else {
    fireRecovery("memory", `🟢 Memory Recovered — ${system.memory.percent}%`, `RAM usage has dropped below ${THRESHOLDS.memory}%.`);
  }

  // --- Disk ---
  for (const d of system.disk) {
    const key = `disk:${d.mount}`;
    if (d.percent > THRESHOLDS.disk) {
      fireAlert(key, {
        title: `🔴 Disk Critical — ${d.mount} at ${d.percent}%`,
        description: `Disk usage on ${d.mount} has exceeded ${THRESHOLDS.disk}%.`,
        color: RED,
        fields: [
          { name: "Host", value: hostname, inline: true },
          { name: "Used", value: `${d.used}/${d.total} GB`, inline: true },
        ],
      });
    } else {
      fireRecovery(key, `🟢 Disk Recovered — ${d.mount} at ${d.percent}%`, `Disk usage on ${d.mount} has dropped below ${THRESHOLDS.disk}%.`);
    }
  }

  // --- Temperature ---
  if (system.temperature && system.temperature.maxC > THRESHOLDS.temp) {
    fireAlert("temp", {
      title: `🟠 Temperature Warning — ${system.temperature.maxC}°C`,
      description: `CPU temperature has exceeded ${THRESHOLDS.temp}°C.`,
      color: AMBER,
      fields: [
        { name: "Host", value: hostname, inline: true },
        { name: "Max", value: `${system.temperature.maxC}°C`, inline: true },
      ],
    });
  } else if (system.temperature) {
    fireRecovery("temp", `🟢 Temperature Recovered — ${system.temperature.maxC}°C`, `Temperature has dropped below ${THRESHOLDS.temp}°C.`);
  }

  // --- Connectivity ---
  if (connectivity.status === "offline") {
    fireAlert("connectivity", {
      title: "🔴 Internet Offline",
      description: "All ping targets are unreachable.",
      color: RED,
      fields: [{ name: "Host", value: hostname, inline: true }],
    });
  } else if (connectivity.status === "degraded") {
    const down = connectivity.targets.filter((t) => !t.reachable).map((t) => t.host);
    fireAlert("connectivity", {
      title: "🟠 Internet Degraded",
      description: `Some targets unreachable: ${down.join(", ")}`,
      color: AMBER,
      fields: [{ name: "Host", value: hostname, inline: true }],
    });
  } else {
    fireRecovery("connectivity", "🟢 Internet Recovered", "All ping targets are reachable again.");
  }

  // --- PM2 processes ---
  for (const p of pm2Processes) {
    const key = `pm2:${p.name}`;
    if (p.status !== "online") {
      fireAlert(key, {
        title: `🔴 PM2 Process Down — ${p.name}`,
        description: `Process "${p.name}" is ${p.status}.`,
        color: RED,
        fields: [
          { name: "Host", value: hostname, inline: true },
          { name: "Status", value: p.status, inline: true },
          { name: "Restarts", value: `${p.restarts}`, inline: true },
        ],
      });
    } else {
      fireRecovery(key, `🟢 PM2 Recovered — ${p.name}`, `Process "${p.name}" is back online.`);
    }
  }

  // --- Systemd services ---
  for (const s of services) {
    const key = `service:${s.name}`;
    if (s.status === "failed") {
      fireAlert(key, {
        title: `🔴 Service Failed — ${s.name}`,
        description: `Systemd service "${s.name}" has failed.`,
        color: RED,
        fields: [{ name: "Host", value: hostname, inline: true }],
      });
    } else if (s.status === "active") {
      fireRecovery(key, `🟢 Service Recovered — ${s.name}`, `Service "${s.name}" is active again.`);
    }
  }
}

export function getActiveAlertCount(): number {
  return activeAlerts.size;
}
