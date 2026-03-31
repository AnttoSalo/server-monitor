/**
 * MCP tool definitions and dispatch for monitor-mcp.
 *
 * Read tools fetch from the server-monitor HTTP API.
 * Write tools either POST to the API or exec PM2 commands directly.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { monitorGet, monitorPost } from './api.js';

const execFileAsync = promisify(execFile);

// ─── Tool Definitions (MCP schema) ──────────────────────

export const TOOLS = [
  {
    name: 'get_server_status',
    description:
      'Get a full real-time snapshot of the server: CPU, memory, disk, network, PM2 processes, connectivity, services, Docker containers, incidents, activity analysis, and system metadata. This is the most comprehensive single call.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_system_stats',
    description:
      'Get aggregated server statistics over a time range. Includes CPU/memory/disk/load averages and peaks, network bandwidth totals, connectivity uptime percentage, incident MTTR/MTBF, speed test history, process restart counts, and security summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: ['1h', '6h', '24h', '7d'],
          description: 'Time range for aggregation (default: 24h)',
        },
      },
    },
  },
  {
    name: 'get_incidents',
    description:
      'Get current and recent incidents (downtime events) with uptime statistics. Shows which services, PM2 processes, or connectivity went down, when they recovered, and overall uptime percentage.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: ['1h', '6h', '24h', '7d'],
          description: 'Time range for incident history (default: 24h)',
        },
      },
    },
  },
  {
    name: 'get_process_list',
    description:
      'Get all PM2 managed processes with their status, CPU, memory, uptime, and restart count. Also includes the top 10 system processes by CPU and memory usage.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_pm2_logs',
    description:
      'Fetch recent log output for a specific PM2 process. Useful for troubleshooting crashes or errors.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'PM2 process name',
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to fetch (default: 100, max: 500)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_connectivity',
    description:
      'Get internet connectivity status: online/degraded/offline, ping target latencies, WAN IP, and optional latency history.',
    inputSchema: {
      type: 'object',
      properties: {
        include_history: {
          type: 'boolean',
          description: 'Include connectivity latency history (default: false)',
        },
        range: {
          type: 'string',
          enum: ['1h', '6h', '24h'],
          description: 'History time range if include_history is true (default: 1h)',
        },
      },
    },
  },
  {
    name: 'get_security_summary',
    description:
      'Get security-related information: SSH authentication events (failed/accepted logins, top attacking IPs), SSL certificate expiry status, and disk SMART health.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ─── Write Tools ────────────────────────────────────────

  {
    name: 'restart_pm2_process',
    description:
      'Restart a PM2 managed process by name. Use this to recover crashed or misbehaving services. Returns the PM2 output confirming the restart.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'PM2 process name to restart',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'run_speed_test',
    description:
      'Trigger an internet speed test (download/upload via Cloudflare). The test runs in the background; call get_server_status after ~30 seconds to see the result.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── Tool Dispatch ───────────────────────────────────────

/** @param {string} name @param {object} args @returns {Promise<object>} */
export async function handleToolCall(name, args) {
  switch (name) {
    case 'get_server_status': {
      return monitorGet('/status');
    }

    case 'get_system_stats': {
      const range = args.range || '24h';
      return monitorGet(`/stats?range=${range}`);
    }

    case 'get_incidents': {
      const range = args.range || '24h';
      const [status, stats] = await Promise.all([
        monitorGet('/status'),
        monitorGet(`/stats?range=${range}`),
      ]);
      return {
        activeIncidents: status.incidents.filter((i) => i.status === 'down'),
        recentIncidents: stats.uptime.recentIncidents,
        uptime: {
          overallUptimePct: stats.uptime.overallUptimePct,
          currentStreakMs: stats.uptime.currentStreakMs,
          mttrMs: stats.uptime.mttrMs,
          mtbfMs: stats.uptime.mtbfMs,
          totalIncidents: stats.uptime.totalIncidents,
          incidentsByType: stats.uptime.incidentsByType,
          longestOutageMs: stats.uptime.longestOutageMs,
        },
        range,
      };
    }

    case 'get_process_list': {
      const status = await monitorGet('/status');
      return {
        pm2: status.pm2.processes,
        topByCpu: status.topProcesses.byCpu,
        topByMem: status.topProcesses.byMem,
        docker: status.docker,
        services: status.services,
      };
    }

    case 'get_pm2_logs': {
      if (!args.name) throw new Error('name is required');
      if (!/^[\w-]+$/.test(args.name)) {
        throw new Error('Invalid process name — only alphanumeric, dashes, and underscores allowed');
      }
      const lines = Math.min(args.lines || 100, 500);
      return monitorGet(`/pm2/logs/${args.name}?lines=${lines}`);
    }

    case 'get_connectivity': {
      const current = await monitorGet('/connectivity');
      if (!args.include_history) return current;

      const range = args.range || '1h';
      const history = await monitorGet(`/connectivity/history?range=${range}`);
      return { ...current, history: history.entries };
    }

    case 'get_security_summary': {
      const status = await monitorGet('/status');
      return {
        sshAuth: status.sshAuth,
        certs: status.certs,
        smart: status.smart,
      };
    }

    // ─── Write Tools ──────────────────────────────────────

    case 'restart_pm2_process': {
      if (!args.name) throw new Error('name is required');
      if (!/^[\w-]+$/.test(args.name)) {
        throw new Error('Invalid process name — only alphanumeric, dashes, and underscores allowed');
      }
      try {
        const { stdout, stderr } = await execFileAsync('pm2', ['restart', args.name], {
          timeout: 15_000,
        });
        return {
          success: true,
          process: args.name,
          stdout: stdout.trim(),
          stderr: stderr.trim() || undefined,
        };
      } catch (err) {
        throw new Error(`Failed to restart ${args.name}: ${err.message}`);
      }
    }

    case 'run_speed_test': {
      return monitorPost('/speedtest/run');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
