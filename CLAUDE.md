# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server with hot reload (tsx watch)
npm run build        # TypeScript compile to dist/
npm start            # Run compiled output (dist/index.js)
npm test             # Run tests once (vitest run)
npm run test:watch   # Run tests in watch mode (vitest)
```

Production deployment uses PM2: `pm2 start ecosystem.config.cjs`

## Architecture

This is a Linux server monitoring service: Express HTTP server + WebSocket + static dashboard.

**Entry point:** `src/index.ts` — creates Express app, mounts routes, starts collector intervals, sets up WebSocket broadcast.

### Collectors (`src/collectors/`)

Each collector module follows the same pattern:
- A `collect*()` async function that reads system data (from `/proc`, shell commands, etc.) and caches the result in a module-level variable
- A `getLast*()` function that returns the cached value synchronously
- Called on intervals from `src/index.ts` (10s for system stats, 30s for PM2/connectivity/services, 1h for certs/SMART/updates)

Key collectors: `system.ts` (CPU/memory/disk/network from `/proc`), `pm2.ts`, `connectivity.ts` (TCP ping), `activity.ts` (stress analysis), `alerts.ts` (Discord webhooks), `uptime.ts` (incident tracking), `bandwidth.ts` (monthly totals), `reports.ts` (scheduled Discord summaries).

### Routes (`src/routes/`)

Express routers mounted at `BASE_PATH + /status`, `/system`, `/pm2`, `/connectivity`, `/health`, `/speedtest`, `/export`, `/stats`. Each route calls the relevant `getLast*()` functions to build responses.

### Data layer (`src/store.ts`)

JSON file persistence in `data/` directory. `loadJson()`/`saveJson()` with atomic writes (write to temp file, then rename). `pruneByAge()` for time-based retention. No database.

History is buffered in memory and flushed to disk every 5 minutes. History entries are recorded every 60 seconds.

### Auth (`src/auth.ts`)

Optional NextAuth v5 JWT session cookie verification. Enabled when `NEXTAUTH_SECRET` env var is set. Localhost requests bypass auth.

### Dashboard (`public/index.html`)

Single-file HTML dashboard with inline CSS/JS. Connects via WebSocket for real-time updates with polling fallback.

### Types (`src/types.ts`)

All interfaces in one file. `StatusResponse` is the full `/status` shape. `StatsResponse` is the aggregated `/stats` shape.

## Key Environment Variables

- `PORT` (default: 3099)
- `BASE_PATH` — URL prefix for reverse proxy setups
- `NEXTAUTH_SECRET` — enables auth when set
- `PING_TARGETS` — comma-separated hosts for connectivity checks
- `MONITOR_SERVICES` — comma-separated systemd service names
- `HISTORY_RETENTION_DAYS` (default: 7)
- `SYSTEM_INTERVAL`, `PM2_INTERVAL`, `PROCESS_INTERVAL`, `CONNECTIVITY_INTERVAL` — collection intervals in ms
- `NETWORK_INTERFACE` — override auto-detected network interface
- `ALERT_WEBHOOK`, `ALERT_CPU`, `ALERT_MEMORY`, `ALERT_DISK`, `ALERT_TEMP` — Discord alerting
- `CERT_DOMAINS` — comma-separated domains for SSL monitoring
- `REPORT_INTERVAL` — "daily" or "weekly" for scheduled Discord reports

## Testing

Tests use Vitest. Most collectors read Linux-specific files (`/proc/*`, `/sys/*`), so tests focus on cross-platform-safe modules (selfmon, sysinfo, processes). Test files are in `test/`.
