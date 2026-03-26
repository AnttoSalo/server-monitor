# server-monitor

A lightweight server monitoring service that collects system metrics, PM2 process stats, and internet connectivity data. Includes a built-in web dashboard and a REST API for integration with other applications.

**Stack:** Node.js + TypeScript + Express
**Footprint:** ~30MB RAM, <2% CPU
**Data:** JSON file persistence (no database required)
**Dashboard:** Built-in web UI at the root URL

## Quick Start

```bash
git clone https://github.com/AnttoSalo/server-monitor.git
cd server-monitor
npm install
npm run build
PORT=3099 node dist/index.js
```

Open `http://localhost:3099` in your browser to see the dashboard.

## Running with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

The included `ecosystem.config.cjs` starts the service on port 3099 with a 100MB memory limit.

## Features

### Dashboard (5 tabs)

- **Overview** — CPU, RAM, disk, temperature, and load average gauges with alert animations. Swap bar, disk I/O, network throughput with per-interface breakdown, PM2 processes, systemd services, logged-in users, and system info.
- **Processes** — Top 10 processes by CPU and memory, Docker containers (if available), full PM2 process table.
- **Network** — Connectivity status with ping targets, WAN IP, TCP connection counts, listening ports with service labels, speed test (Cloudflare-based), and connectivity latency history chart.
- **History** — 10 time-series charts (CPU, memory, network RX/TX, load average, temperature, disk read/write, swap, TCP connections) with 1H/6H/24H/7D period selection, bandwidth totals, and per-chart avg/peak stats.
- **Logs** — PM2 process log viewer with process selector.

### Monitoring Capabilities

| Feature | Source | Interval |
|---------|--------|----------|
| CPU usage | `/proc/stat` | 10s |
| Memory (RAM) | `os.totalmem/freemem` | 10s |
| Swap usage | `/proc/meminfo` | 10s |
| Load average (1/5/15 min) | `/proc/loadavg` | 10s |
| Disk capacity | `df` (cached 60s) | 10s |
| Disk I/O (read/write KB/s) | `/proc/diskstats` | 10s |
| Network throughput (per-interface) | `/proc/net/dev` | 10s |
| CPU temperature (per thermal zone) | `/sys/class/thermal/` | 10s |
| TCP connections + listening ports | `/proc/net/tcp{,6}` | 10s |
| PM2 processes | `pm2 jlist` | 30s |
| Top processes by CPU/memory | `ps aux` | 15s |
| Internet connectivity | TCP ping to port 443 | 30s |
| WAN IP | `api.ipify.org` | 30s |
| Systemd services | `systemctl is-active` | 30s |
| Logged-in users | `who` | 30s |
| Docker containers | `docker ps` (auto-disabled if absent) | 30s |
| Package updates | `apt list --upgradable` | 1 hour |
| Speed test | Cloudflare (on-demand) | Manual |

### Self-monitoring

The monitor tracks its own CPU, memory, and collection time, displayed in a footer bar on the dashboard.

## API Reference

All endpoints return JSON. Authentication via NextAuth session cookie when `NEXTAUTH_SECRET` is set.

### `GET /status`

Complete snapshot of everything in a single request.

```json
{
  "system": {
    "cpu": 25,
    "cpuCores": 4,
    "memory": { "used": 5.2, "total": 7.6, "percent": 68 },
    "swap": { "used": 0, "total": 12, "percent": 0 },
    "disk": [{ "mount": "/", "used": 21, "total": 232, "percent": 10 }],
    "diskIO": { "readKBps": 12.3, "writeKBps": 5.6, "devices": [...] },
    "network": { "rxKBps": 12.5, "txKBps": 3.2, "interfaces": [...] },
    "loadAvg": { "load1": 0.5, "load5": 0.3, "load15": 0.2, "runProcs": 2, "totalProcs": 350 },
    "temperature": { "maxC": 45, "zones": [{ "zone": "x86_pkg_temp", "tempC": 45 }] },
    "tcpConnections": { "established": 18, "listening": 13, "timeWait": 5, "total": 36, "listeningPorts": [22, 80, 443, 3099] }
  },
  "pm2": { "processes": [...] },
  "connectivity": { "status": "online", "targets": [...], "wanIp": "..." },
  "topProcesses": { "byCpu": [...], "byMem": [...] },
  "services": [{ "name": "nginx", "status": "active" }],
  "sysInfo": { "os": "Linux 6.8.0", "kernel": "...", "arch": "x64", "cpuModel": "...", "cpuCores": 4, "totalMemGB": 7.6, "bootTimestamp": "..." },
  "selfMonitor": { "memoryMB": 32, "cpuPercent": 1.2, "collectionMs": 115, "uptimeSeconds": 86400 },
  "loggedInUsers": [{ "user": "antto", "terminal": "pts/0", "loginTime": "...", "from": "..." }],
  "pendingUpdates": { "count": 3, "lastChecked": "..." },
  "docker": [],
  "meta": { "hostname": "homeserver", "platform": "linux", "uptime": 180000, "bootTimestamp": "...", "nodeVersion": "v22.22.1", "monitorVersion": "1.0.0" }
}
```

### `GET /system`

Live system metrics only (same as `status.system`).

### `GET /system/history?range=1h`

Historical system stats. Entries recorded once per minute, persisted every 5 minutes.

| Param | Values | Default |
|-------|--------|---------|
| `range` | `1h`, `6h`, `24h`, `7d` | `1h` |

### `GET /pm2`

All PM2-managed processes with live stats.

### `GET /pm2/logs/:name?lines=100`

Tail PM2 logs for a specific process. Max 500 lines.

### `GET /connectivity`

Internet connectivity status with ping targets and WAN IP.

### `GET /connectivity/history?range=1h`

Historical ping data. Entries recorded every minute, retained for 24 hours.

### `GET /health`

Health check endpoint. Returns unhealthy if CPU > 95%, memory > 90%, PM2 processes down, or internet unreachable.

### `GET /speedtest`

Last speed test result (download/upload Mbps, latency).

### `GET /speedtest/history`

Last 20 speed test results.

### `POST /speedtest/run`

Trigger an on-demand speed test (Cloudflare). Returns 202 if started, 409 if already running.

## Configuration

All configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3099` | HTTP server port |
| `BASE_PATH` | `""` | URL path prefix (e.g., `/monitor`) |
| `PING_TARGETS` | `1.1.1.1,8.8.8.8,google.com` | Comma-separated hosts to ping |
| `HISTORY_RETENTION_DAYS` | `7` | Days to retain system history |
| `NETWORK_INTERFACE` | `""` (all) | Specific interface to monitor |
| `MONITOR_SERVICES` | `""` | Comma-separated systemd services to watch |
| `NEXTAUTH_SECRET` | `""` (disabled) | NextAuth v5 session secret for authentication |
| `LOGIN_URL` | `https://nns.antto.org/login` | Redirect URL for unauthenticated requests |
| `SYSTEM_INTERVAL` | `10000` | System metrics collection interval (ms) |
| `PM2_INTERVAL` | `30000` | PM2 stats collection interval (ms) |
| `PROCESS_INTERVAL` | `15000` | Top processes collection interval (ms) |
| `CONNECTIVITY_INTERVAL` | `30000` | Connectivity check interval (ms) |

## Data Persistence

| File | Content | Retention | Flush interval |
|------|---------|-----------|----------------|
| `data/system-history.json` | CPU, memory, disk, network, load, temp, swap, TCP | 7 days | 5 minutes |
| `data/connectivity.json` | Ping target latency and reachability | 24 hours | 5 minutes |
| `data/speedtest-history.json` | Speed test results | Last 20 | On each test |

All writes use atomic temp-file-then-rename to prevent corruption.

## Performance

- Shell command spawns: ~12/minute (df cached 60s, PM2 every 30s, ps every 15s)
- `/proc` filesystem reads: ~12 per 10s cycle (near-zero overhead)
- History served from in-memory buffers (zero disk I/O on API reads)
- Slow request logging (>500ms) to stdout

## Integration Examples

### JavaScript/TypeScript

```typescript
const res = await fetch("http://your-server:3099/status");
const data = await res.json();
console.log(`CPU: ${data.system.cpu}%`);
console.log(`RAM: ${data.system.memory.percent}%`);
console.log(`Internet: ${data.connectivity.status}`);
```

### Python

```python
import requests
data = requests.get("http://your-server:3099/status").json()
print(f"CPU: {data['system']['cpu']}%")
print(f"Temp: {data['system']['temperature']['maxC']}°C")
```

### Health Check (cron)

```bash
STATUS=$(curl -s http://your-server:3099/health | jq -r '.healthy')
[ "$STATUS" != "true" ] && echo "Server unhealthy!" | mail -s "Alert" you@example.com
```

## Requirements

- **Node.js** 20+ (tested on 22.x)
- **PM2** installed globally
- **Linux** (uses `/proc` and `/sys` filesystems)

## Development

```bash
npm run dev     # Watch mode with tsx
npm run build   # Compile TypeScript
npm test        # Run tests
npm start       # Run compiled output
```

## Directory Structure

```
server-monitor/
├── src/
│   ├── index.ts              # Express server + collector scheduling
│   ├── auth.ts               # NextAuth v5 session verification
│   ├── store.ts              # JSON persistence (atomic writes)
│   ├── types.ts              # TypeScript interfaces
│   ├── collectors/
│   │   ├── system.ts         # CPU, RAM, disk, network, temp, load, swap, I/O, TCP
│   │   ├── pm2.ts            # PM2 process stats + log reading
│   │   ├── connectivity.ts   # Internet ping + WAN IP
│   │   ├── processes.ts      # Top processes by CPU/memory
│   │   ├── services.ts       # Systemd service status
│   │   ├── sysinfo.ts        # OS/kernel info (collected once)
│   │   ├── selfmon.ts        # Monitor's own resource usage
│   │   ├── users.ts          # Logged-in users
│   │   ├── updates.ts        # Pending package updates
│   │   └── docker.ts         # Docker container listing
│   └── routes/
│       ├── status.ts         # GET /status (consolidated)
│       ├── system.ts         # GET /system, /system/history
│       ├── pm2.ts            # GET /pm2, /pm2/logs/:name
│       ├── connectivity.ts   # GET /connectivity, /connectivity/history
│       ├── health.ts         # GET /health
│       └── speedtest.ts      # Speed test (trigger + results + history)
├── public/
│   └── index.html            # Built-in web dashboard
├── data/                     # Runtime data (gitignored)
├── dist/                     # Compiled JavaScript (gitignored)
├── ecosystem.config.cjs      # PM2 config
├── package.json
└── tsconfig.json
```
