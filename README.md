# server-monitor

A lightweight server monitoring service that collects system metrics, PM2 process stats, and internet connectivity data. Includes a built-in web dashboard and a REST API for integration with other applications.

**Stack:** Node.js + TypeScript + Express
**Footprint:** ~15MB RAM, negligible CPU
**Data:** JSON file persistence (no database required)
**Dashboard:** Built-in web UI at the root URL — no separate frontend needed

## Quick Start

```bash
git clone https://github.com/AnttoSalo/server-monitor.git
cd server-monitor
npm install
npm run build
PORT=3099 node dist/index.js
```

Open `http://localhost:3099` in your browser to see the dashboard.

Verify the API:
```bash
curl http://localhost:3099/status
```

## Running with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

The included `ecosystem.config.cjs` starts the service on port 3099 with a 100MB memory limit.

## API Reference

All endpoints return JSON. No authentication required (designed for LAN use).

### `GET /status`

**The main endpoint.** Returns a complete snapshot of everything in a single request. Ideal for dashboards that want one API call.

```json
{
  "system": {
    "cpu": 25,
    "memory": { "used": 5.2, "total": 7.6, "percent": 68 },
    "disk": [{ "mount": "/", "used": 21, "total": 232, "percent": 10 }],
    "network": { "rxKBps": 12.5, "txKBps": 3.2 }
  },
  "pm2": {
    "processes": [
      {
        "id": 0,
        "name": "my-app",
        "status": "online",
        "cpu": 2.1,
        "memoryMB": 198,
        "uptimeMs": 86400000,
        "restarts": 1
      }
    ]
  },
  "connectivity": {
    "status": "online",
    "targets": [
      { "host": "1.1.1.1", "latencyMs": 12, "reachable": true },
      { "host": "8.8.8.8", "latencyMs": 15, "reachable": true },
      { "host": "google.com", "latencyMs": 18, "reachable": true }
    ],
    "wanIp": "86.50.xxx.xxx",
    "lastChecked": "2026-03-24T15:30:00.000Z"
  },
  "meta": {
    "hostname": "my-server",
    "platform": "linux",
    "uptime": 1234567,
    "nodeVersion": "v22.22.1",
    "monitorVersion": "1.0.0"
  }
}
```

### `GET /system`

Live system metrics only.

```json
{
  "cpu": 25,
  "memory": { "used": 5.2, "total": 7.6, "percent": 68 },
  "disk": [{ "mount": "/", "used": 21, "total": 232, "percent": 10 }],
  "network": { "rxKBps": 12.5, "txKBps": 3.2 }
}
```

### `GET /system/history?range=1h`

Historical system stats. Entries are recorded once per minute.

**Query parameters:**
| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `range` | `1h`, `6h`, `24h`, `7d` | `1h` | Time range to return |

```json
{
  "entries": [
    {
      "timestamp": "2026-03-24T15:00:00.000Z",
      "cpu": 25,
      "memPercent": 68,
      "memUsedGB": 5.2,
      "diskPercent": 10,
      "rxKBps": 12.5,
      "txKBps": 3.2
    }
  ],
  "range": "1h"
}
```

### `GET /pm2`

All PM2-managed processes with live stats.

```json
{
  "processes": [
    {
      "id": 0,
      "name": "my-app",
      "status": "online",
      "cpu": 2.1,
      "memoryMB": 198,
      "uptimeMs": 86400000,
      "restarts": 1
    }
  ]
}
```

**Status values:** `online`, `stopped`, `errored`, `launching`

### `GET /pm2/logs/:name?lines=100`

Tail PM2 logs for a specific process.

**URL parameters:**
| Param | Description |
|-------|-------------|
| `name` | PM2 process name (alphanumeric, dashes, underscores) |

**Query parameters:**
| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `lines` | 100 | 500 | Number of log lines to return |

```json
{
  "processName": "my-app",
  "lines": [
    "2026-03-24T15:30:00: Server started on port 3000",
    "2026-03-24T15:30:01: Connected to database"
  ]
}
```

### `GET /connectivity`

Internet connectivity status.

```json
{
  "status": "online",
  "targets": [
    { "host": "1.1.1.1", "latencyMs": 12, "reachable": true },
    { "host": "8.8.8.8", "latencyMs": 15, "reachable": true }
  ],
  "wanIp": "86.50.xxx.xxx",
  "lastChecked": "2026-03-24T15:30:00.000Z"
}
```

**Status values:**
- `online` — All targets reachable
- `degraded` — Some targets reachable
- `offline` — No targets reachable

### `GET /connectivity/history?range=1h`

Historical ping data. Entries are recorded every 5 minutes, retained for 24 hours.

**Query parameters:**
| Param | Values | Default |
|-------|--------|---------|
| `range` | `1h`, `6h`, `24h` | `1h` |

```json
{
  "entries": [
    {
      "timestamp": "2026-03-24T15:00:00.000Z",
      "targets": [
        { "host": "1.1.1.1", "latencyMs": 12, "reachable": true }
      ]
    }
  ],
  "range": "1h"
}
```

### `GET /health`

Simple health check — returns whether all subsystems are healthy.

```json
{
  "healthy": true,
  "checks": {
    "pm2": { "healthy": true, "online": 5, "total": 5 },
    "internet": { "healthy": true, "status": "online" },
    "system": { "healthy": true, "cpu": 25, "memPercent": 68 }
  }
}
```

**Thresholds:** CPU < 95%, Memory < 90%, all PM2 processes online, internet reachable.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3099` | HTTP server port |
| `PING_TARGETS` | `1.1.1.1,8.8.8.8,google.com` | Comma-separated hosts to ping |
| `HISTORY_RETENTION_DAYS` | `7` | Days to retain system history data |

## Integration Examples

### Fetch in JavaScript/TypeScript

```typescript
// Single consolidated request
const res = await fetch("http://your-server:3099/status");
const data = await res.json();

console.log(`CPU: ${data.system.cpu}%`);
console.log(`RAM: ${data.system.memory.used}/${data.system.memory.total} GB`);
console.log(`Internet: ${data.connectivity.status}`);
console.log(`PM2 processes: ${data.pm2.processes.length}`);

// Check if a specific service is running
const myApp = data.pm2.processes.find(p => p.name === "my-app");
if (myApp?.status !== "online") {
  console.warn("my-app is down!");
}
```

### Fetch in Python

```python
import requests

data = requests.get("http://your-server:3099/status").json()

print(f"CPU: {data['system']['cpu']}%")
print(f"RAM: {data['system']['memory']['percent']}%")
print(f"Internet: {data['connectivity']['status']}")

for proc in data['pm2']['processes']:
    print(f"  {proc['name']}: {proc['status']} ({proc['memoryMB']}MB)")
```

### Simple Health Check (cron/script)

```bash
# Check if server is healthy
STATUS=$(curl -s http://your-server:3099/health | jq -r '.healthy')
if [ "$STATUS" != "true" ]; then
  echo "Server unhealthy!" | mail -s "Alert" you@example.com
fi
```

### Next.js / React Integration

```typescript
// In a React component
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then(r => r.json());

function ServerStatus() {
  const { data } = useSWR("http://your-server:3099/status", fetcher, {
    refreshInterval: 10000,
  });

  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <p>CPU: {data.system.cpu}%</p>
      <p>RAM: {data.system.memory.percent}%</p>
      <p>Internet: {data.connectivity.status}</p>
    </div>
  );
}
```

### Proxy Through Your App (avoid CORS)

If your frontend can't call the monitor directly (different origin), proxy it through your backend:

```typescript
// Next.js API route example: /api/server-monitor/[...path]/route.ts
import { NextResponse } from "next/server";

const MONITOR_URL = process.env.SERVER_MONITOR_URL || "http://localhost:3099";

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(request.url);
  const res = await fetch(`${MONITOR_URL}/${path.join("/")}${url.search}`);
  const data = await res.json();
  return NextResponse.json(data);
}
```

Then your frontend calls `/api/server-monitor/status` instead of the direct URL.

## Data Collection

The service runs background collectors on intervals:

| Collector | Interval | Method | Persistence |
|-----------|----------|--------|-------------|
| System (CPU/RAM/disk/network) | 10 seconds | `/proc/stat`, `os.totalmem()`, `df`, `/proc/net/dev` | Every 60s to `data/system-history.json` (7-day retention) |
| PM2 processes | 10 seconds | `pm2 jlist` | In-memory only |
| Connectivity | 30 seconds | TCP connect to port 443 | Every 5 min to `data/connectivity.json` (24h retention) |

Data files are automatically pruned to stay within retention limits.

## Requirements

- **Node.js** 20+ (tested on 22.x)
- **PM2** installed globally (for PM2 process monitoring and log access)
- **Linux** (uses `/proc` filesystem for CPU and network stats)

## Directory Structure

```
server-monitor/
├── src/
│   ├── index.ts              # Express server + collector scheduling
│   ├── collectors/
│   │   ├── system.ts         # CPU, RAM, disk, network collection
│   │   ├── pm2.ts            # PM2 process stats + log reading
│   │   └── connectivity.ts   # Internet ping + WAN IP detection
│   ├── routes/
│   │   ├── status.ts         # GET /status (consolidated)
│   │   ├── system.ts         # GET /system, /system/history
│   │   ├── pm2.ts            # GET /pm2, /pm2/logs/:name
│   │   ├── connectivity.ts   # GET /connectivity, /connectivity/history
│   │   └── health.ts         # GET /health
│   ├── store.ts              # JSON file persistence + pruning
│   └── types.ts              # TypeScript type definitions
├── data/                     # Runtime data (gitignored)
├── dist/                     # Compiled JavaScript (gitignored)
├── package.json
├── tsconfig.json
└── ecosystem.config.cjs      # PM2 process config
```
