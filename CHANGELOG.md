# What's New in Server Monitor

A complete summary of everything built in this development session — taking the monitor from a basic CPU/RAM/disk/network tool to a comprehensive server monitoring dashboard with 25+ features.

---

## The Big Picture

What started as a simple server monitor with 4 metrics is now a full-featured monitoring dashboard with real-time WebSocket updates, Discord alerting, security monitoring, and more — all in a single lightweight Node.js process using ~30MB RAM.

---

## Features Added (in order)

### 1. Fixed Network Monitoring
**The original bug that started it all.** Network history was showing 0 for both RX and TX.

- **Root cause:** The parser picked the first non-loopback interface alphabetically. On servers with Docker/VPN interfaces, this was often a dormant virtual interface like `docker0`.
- **Fix:** Now sums all interfaces. Per-interface breakdown shown on dashboard.
- **Bonus:** `NETWORK_INTERFACE` env var lets you pin to a specific interface if needed.

### 2. Auto-Deploy Pipeline
Push to `main` and it deploys automatically.

- GitHub Actions workflow SSHs into the server via Cloudflare tunnel
- Runs `git pull`, `npm install`, `npm run build`, `pm2 restart`
- Debug workflow available for remote server diagnostics

### 3. System Monitoring Expansion (7 new metrics)
- **Load Average** (1/5/15 min) with gauge showing % of capacity
- **Swap Usage** with progress bar (only shown if swap exists)
- **CPU Temperature** per thermal zone with color-coded gauge
- **Disk I/O** read/write KB/s per device
- **Top Processes** by CPU and memory (normalized to 0-100%)
- **TCP Connections** (established/listening/time_wait counts)
- **Systemd Services** status monitoring

### 4. Performance Optimizations
Cut the monitor's own overhead in half:

- `pm2 jlist` interval: 10s to 30s
- `ps aux` interval: 10s to 15s
- `df` command: cached for 60s
- History served from memory (zero disk reads on API calls)
- History flushed to disk every 5 min instead of every 60s
- Atomic writes (temp file + rename) prevent data corruption
- **Result:** Shell spawns dropped from ~24/min to ~12/min

### 5. More Monitoring
- **Self-monitoring** — the monitor tracks its own CPU, memory, and collection time
- **System info** — OS, kernel, CPU model, architecture (collected once on startup)
- **Logged-in users** — who's currently SSHed in
- **Package updates** — how many apt upgrades are pending
- **Docker containers** — auto-detected, auto-disabled if Docker isn't running
- **Listening ports** — extracted from TCP data, labeled with known service names

### 6. Network Speed Test
On-demand bandwidth testing via Cloudflare's infrastructure:

- Downloads 25MB, uploads 10MB, measures latency
- Results persist across server restarts (last 20 saved)
- Real-time progress: shows each phase as it runs
- Button on the Network tab, only runs when you click it

### 7. Dashboard Improvements
- **Combined RX/TX chart** — one dual-line chart instead of two
- **Temperature zone breakdown** — shows individual sensor readings
- **Visual alert animations** — gauges pulse/glow when thresholds exceeded
- **Charts redraw on tab switch** — no more blank charts on first load
- **Export buttons** — download history as CSV or JSON
- **Bandwidth totals** — estimated total transfer for selected time period

### 8. Discord Alerting
Webhook-based alerts optimized for Discord with rich embeds:

- **CPU** > 90% (requires 60s sustained — no false positives)
- **Memory** > 85%
- **Disk** > 90%
- **Temperature** > 80°C
- **PM2 process down**
- **Systemd service failed**
- **Internet offline/degraded**
- 10-minute cooldown per alert type (no spam)
- Green recovery notifications when conditions clear
- All thresholds configurable via env vars

### 9. Uptime/Downtime Tracking
Incident log that records every state transition:

- Connectivity going offline/degraded
- PM2 processes crashing
- Systemd services failing
- Tracks duration and recovery time
- Last 100 incidents persisted to disk
- Shown on the Overview tab with colored status dots

### 10. Security Tab (new)
Dedicated tab for security-related monitoring:

- **SSL Certificate Expiry** — checks configured domains via `openssl`, color-coded by days remaining
- **SSH Auth Log** — recent failed and accepted login attempts with user, IP, and method
- **Disk SMART Health** — drive health status and temperature via `smartctl`
- **Cron Jobs** — lists active crontabs (user + system)

### 11. Monthly Bandwidth Tracking
Cumulative network usage per month, computed from history entries:

- 12-month rolling retention
- Shows RX and TX in GB per month
- Displayed on the Overview tab

### 12. PM2 Restart Tracking
Detects when PM2 processes restart and logs the events:

- 7-day history of restart events
- Useful for detecting crash loops
- Persisted to disk

### 13. Scheduled Discord Reports
Daily or weekly server status summaries sent to Discord:

- CPU, memory, disk, load, temperature, uptime
- PM2 process count, internet status
- Incident count (last 24h)
- Monthly bandwidth usage
- Sent at 8:00 AM (weekly = Monday only)

### 14. WebSocket Real-Time Updates
Live system data pushed to the dashboard without polling:

- WebSocket server at `/ws`
- Broadcasts system stats on every collection cycle
- Dashboard connects automatically, falls back to HTTP polling
- Reduces unnecessary network traffic

### 15. Dark/Light Theme
Toggle in the header, persisted to localStorage.

### 16. Log Search and Filtering
The log viewer now supports:

- **Text search** — type to filter log lines in real time
- **Level filtering** — show only errors or warnings
- Debounced input for smooth filtering

### 17. Configurable Collection Intervals
All intervals can be tuned via environment variables:

- `SYSTEM_INTERVAL` (default 10s)
- `PM2_INTERVAL` (default 30s)
- `PROCESS_INTERVAL` (default 15s)
- `CONNECTIVITY_INTERVAL` (default 30s)

### 18. Documentation and Tests
- Comprehensive README covering all features, API endpoints, and env vars
- 15 tests using vitest (store, collectors, type contracts)
- `npm test` works out of the box

---

## Setup Guide

### Basic Setup

```bash
git clone https://github.com/AnttoSalo/server-monitor.git
cd server-monitor
npm install
npm run build
PORT=3099 node dist/index.js
```

Open `http://localhost:3099` to see the dashboard.

### Production Setup (PM2)

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### Enable Discord Alerts

1. In Discord: **Server Settings > Integrations > Webhooks > New Webhook**
2. Copy the webhook URL
3. Set it on the server:

```bash
# Option A: Edit ecosystem.config.cjs
ALERT_WEBHOOK: "https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN"

# Option B: Set via PM2 env
pm2 set monitor ALERT_WEBHOOK "https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN"
```

4. Restart: `pm2 restart monitor`

Alerts will fire for CPU >90% (sustained 60s), memory >85%, disk >90%, temperature >80°C, process/service failures, and connectivity loss. All thresholds are configurable:

```
ALERT_CPU=90
ALERT_MEMORY=85
ALERT_DISK=90
ALERT_TEMP=80
```

### Enable SSL Certificate Monitoring

Set the domains to monitor (comma-separated):

```
CERT_DOMAINS=yourdomain.com,api.yourdomain.com
```

Checked hourly. Results appear on the Security tab.

### Enable Scheduled Reports

```
REPORT_INTERVAL=daily    # or "weekly" or "off"
```

Requires `ALERT_WEBHOOK` to be set. Reports send at 8:00 AM (weekly = Mondays).

### Enable Service Monitoring

```
MONITOR_SERVICES=ssh,nginx,postgresql,docker
```

Comma-separated list of systemd service names. Checked every 30s.

### Configure Behind a Reverse Proxy

```
BASE_PATH=/monitor
```

The dashboard and all API endpoints will be served under `/monitor/`.

### Authentication (NextAuth)

If your server runs a NextAuth v5 app on the same domain:

```
NEXTAUTH_SECRET=your-nextauth-secret
LOGIN_URL=https://yourdomain.com/login
```

The monitor will validate the NextAuth session cookie. Localhost access bypasses auth.

---

## All Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3099` | HTTP/WebSocket server port |
| `BASE_PATH` | `""` | URL path prefix |
| `PING_TARGETS` | `1.1.1.1,8.8.8.8,google.com` | Connectivity ping targets |
| `HISTORY_RETENTION_DAYS` | `7` | System history retention |
| `NETWORK_INTERFACE` | `""` (all) | Specific interface to monitor |
| `MONITOR_SERVICES` | `""` | Systemd services to watch |
| `ALERT_WEBHOOK` | `""` | Discord/webhook URL |
| `ALERT_CPU` | `90` | CPU alert threshold (%) |
| `ALERT_MEMORY` | `85` | Memory alert threshold (%) |
| `ALERT_DISK` | `90` | Disk alert threshold (%) |
| `ALERT_TEMP` | `80` | Temperature alert threshold (°C) |
| `CERT_DOMAINS` | `""` | Domains for SSL expiry checks |
| `REPORT_INTERVAL` | `daily` | Report frequency (daily/weekly/off) |
| `NEXTAUTH_SECRET` | `""` | NextAuth session secret |
| `LOGIN_URL` | — | Auth redirect URL |
| `SYSTEM_INTERVAL` | `10000` | System collection interval (ms) |
| `PM2_INTERVAL` | `30000` | PM2 collection interval (ms) |
| `PROCESS_INTERVAL` | `15000` | Process list interval (ms) |
| `CONNECTIVITY_INTERVAL` | `30000` | Connectivity check interval (ms) |

---

## Architecture at a Glance

```
18 commits | 22 source files | 15 collectors | 7 API routes | 6 dashboard tabs
~30MB RAM | ~12 shell spawns/min | WebSocket + HTTP polling | 6 persisted data files
```

Built with Node.js + TypeScript + Express. No database. No frontend framework. One HTML file. Zero external monitoring dependencies.
