import os from "os";
import { getLastStats } from "./system.js";
import { getLastProcesses } from "./pm2.js";
import { getLastConnectivity } from "./connectivity.js";
import { getIncidents } from "./uptime.js";
import { getLastBandwidth } from "./bandwidth.js";

const WEBHOOK_URL = process.env.ALERT_WEBHOOK || "";
const REPORT_INTERVAL = process.env.REPORT_INTERVAL || "daily"; // "daily" | "weekly" | "off"

let lastReportDay = "";

function formatGB(gb: number): string {
  return gb >= 1 ? gb.toFixed(2) + " GB" : (gb * 1024).toFixed(0) + " MB";
}

async function sendReport(): Promise<void> {
  if (!WEBHOOK_URL || REPORT_INTERVAL === "off") return;

  const system = getLastStats();
  const pm2 = getLastProcesses();
  const conn = getLastConnectivity();
  const incidents = await getIncidents();
  const bandwidth = getLastBandwidth();

  if (!system) return;

  const hostname = os.hostname();
  const uptimeDays = Math.floor(os.uptime() / 86400);
  const onlineCount = pm2.filter((p) => p.status === "online").length;
  const recentIncidents = incidents.filter(
    (i) => Date.now() - new Date(i.startedAt).getTime() < 86_400_000
  );
  const currentMonth = bandwidth.find((b) => b.month === new Date().toISOString().substring(0, 7));

  const fields = [
    { name: "CPU", value: `${system.cpu}%`, inline: true },
    { name: "Memory", value: `${system.memory.percent}% (${system.memory.used}/${system.memory.total} GB)`, inline: true },
    { name: "Disk", value: system.disk.map((d) => `${d.mount}: ${d.percent}%`).join(", "), inline: true },
    { name: "Load", value: `${system.loadAvg.load1.toFixed(2)} / ${system.loadAvg.load5.toFixed(2)} / ${system.loadAvg.load15.toFixed(2)}`, inline: true },
    { name: "Temp", value: system.temperature ? `${system.temperature.maxC}°C` : "N/A", inline: true },
    { name: "Uptime", value: `${uptimeDays} days`, inline: true },
    { name: "PM2", value: `${onlineCount}/${pm2.length} online`, inline: true },
    { name: "Internet", value: conn.status, inline: true },
    { name: "Incidents (24h)", value: `${recentIncidents.length}`, inline: true },
  ];

  if (currentMonth) {
    fields.push({ name: "Bandwidth (month)", value: `↓ ${formatGB(currentMonth.rxGB)} / ↑ ${formatGB(currentMonth.txGB)}`, inline: true });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `📊 ${REPORT_INTERVAL === "weekly" ? "Weekly" : "Daily"} Report — ${hostname}`,
          color: 3447003, // blue
          fields,
          timestamp: new Date().toISOString(),
        }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch { /* fire-and-forget */ }
}

export function checkScheduledReport(): void {
  if (!WEBHOOK_URL || REPORT_INTERVAL === "off") return;

  const now = new Date();
  const dayKey = REPORT_INTERVAL === "weekly"
    ? `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`
    : now.toISOString().substring(0, 10);

  // Send report once at 8:00 AM
  if (now.getHours() === 8 && dayKey !== lastReportDay) {
    if (REPORT_INTERVAL === "weekly" && now.getDay() !== 1) return; // Monday only
    lastReportDay = dayKey;
    sendReport();
  }
}
