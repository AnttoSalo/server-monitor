/**
 * MCP tool definitions and dispatch for monitor-mcp.
 *
 * Read tools fetch from the server-monitor HTTP API.
 * Write tools either POST to the API or exec PM2 commands directly.
 */

import { execFile, exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { monitorGet, monitorPost } from './api.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/** Get PM2 process info from `pm2 jlist`. */
async function getPm2Info(name) {
  const { stdout } = await execAsync('pm2 jlist', { timeout: 10_000 });
  const procs = JSON.parse(stdout);
  const proc = procs.find((p) => p.name === name);
  if (!proc) throw new Error(`PM2 process "${name}" not found`);
  return proc;
}

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
  {
    name: 'pm2_manage',
    description:
      'Manage PM2 process lifecycle: start, stop, reload, or delete a process. Use this for full control beyond just restarting.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'PM2 process name',
        },
        action: {
          type: 'string',
          enum: ['start', 'stop', 'reload', 'delete'],
          description: 'PM2 action to perform',
        },
      },
      required: ['name', 'action'],
    },
  },
  {
    name: 'deploy_app',
    description:
      'Build and restart a PM2 managed app. Runs `npm run build` in the process working directory, then restarts the process. Use this after pulling new code to deploy changes.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'PM2 process name to build and restart',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'tail_logs',
    description:
      'Read recent PM2 log lines (stdout + stderr combined) with optional text filter. Reads log files directly for speed and supports up to 1000 lines. More powerful than get_pm2_logs.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'PM2 process name',
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to return (default: 200, max: 1000)',
        },
        filter: {
          type: 'string',
          description: 'Case-insensitive text filter — only lines containing this string are returned',
        },
      },
      required: ['name'],
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

    case 'pm2_manage': {
      if (!args.name) throw new Error('name is required');
      if (!args.action) throw new Error('action is required');
      if (!/^[\w-]+$/.test(args.name)) {
        throw new Error('Invalid process name — only alphanumeric, dashes, and underscores allowed');
      }
      const allowed = ['start', 'stop', 'reload', 'delete'];
      if (!allowed.includes(args.action)) {
        throw new Error(`Invalid action — must be one of: ${allowed.join(', ')}`);
      }
      try {
        const { stdout, stderr } = await execFileAsync('pm2', [args.action, args.name], {
          timeout: 15_000,
        });
        return {
          success: true,
          process: args.name,
          action: args.action,
          stdout: stdout.trim(),
          stderr: stderr.trim() || undefined,
        };
      } catch (err) {
        throw new Error(`Failed to ${args.action} ${args.name}: ${err.message}`);
      }
    }

    case 'deploy_app': {
      if (!args.name) throw new Error('name is required');
      if (!/^[\w-]+$/.test(args.name)) {
        throw new Error('Invalid process name — only alphanumeric, dashes, and underscores allowed');
      }

      // Get process working directory from PM2
      const proc = await getPm2Info(args.name);
      const cwd = proc.pm2_env?.pm_cwd;
      if (!cwd) throw new Error(`Could not determine working directory for "${args.name}"`);

      // Build
      let buildOutput;
      try {
        const { stdout, stderr } = await execFileAsync('npm', ['run', 'build'], {
          cwd,
          timeout: 300_000, // 5 minutes
        });
        buildOutput = { stdout: stdout.trim(), stderr: stderr.trim() || undefined };
      } catch (err) {
        throw new Error(`Build failed for ${args.name} in ${cwd}: ${err.message}`);
      }

      // Restart
      let restartOutput;
      try {
        const { stdout } = await execFileAsync('pm2', ['restart', args.name], {
          timeout: 15_000,
        });
        restartOutput = stdout.trim();
      } catch (err) {
        throw new Error(`Build succeeded but restart failed for ${args.name}: ${err.message}`);
      }

      return {
        success: true,
        process: args.name,
        cwd,
        build: buildOutput,
        restart: restartOutput,
      };
    }

    case 'tail_logs': {
      if (!args.name) throw new Error('name is required');
      if (!/^[\w-]+$/.test(args.name)) {
        throw new Error('Invalid process name — only alphanumeric, dashes, and underscores allowed');
      }

      const maxLines = Math.min(args.lines || 200, 1000);

      // Get log file paths from PM2
      const logProc = await getPm2Info(args.name);
      const outPath = logProc.pm2_env?.pm_out_log_path;
      const errPath = logProc.pm2_env?.pm_err_log_path;

      // Read both log files
      const readLog = async (path) => {
        if (!path) return [];
        try {
          const content = await readFile(path, 'utf-8');
          return content.split('\n').filter((l) => l.trim());
        } catch {
          return [];
        }
      };

      const [outLines, errLines] = await Promise.all([
        readLog(outPath),
        readLog(errPath),
      ]);

      // Combine and take last N lines
      let combined = [...outLines, ...errLines];

      // Apply text filter if provided
      if (args.filter) {
        const lower = args.filter.toLowerCase();
        combined = combined.filter((l) => l.toLowerCase().includes(lower));
      }

      // Take last N lines
      const result = combined.slice(-maxLines);

      return {
        process: args.name,
        totalLines: combined.length,
        returnedLines: result.length,
        filter: args.filter || null,
        lines: result,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
