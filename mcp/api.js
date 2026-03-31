/**
 * HTTP client for the server-monitor API.
 *
 * All read tools fetch data from the server-monitor REST API running on the
 * same machine. This keeps the MCP server decoupled — it never imports
 * server-monitor internals.
 */

const BASE = process.env.MONITOR_URL || 'http://localhost:3099';

/**
 * Fetch JSON from a server-monitor endpoint.
 * @param {string} path - e.g. "/status" or "/stats?range=24h"
 * @returns {Promise<any>}
 */
export async function monitorGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`server-monitor ${path}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * POST to a server-monitor endpoint.
 * @param {string} path
 * @returns {Promise<any>}
 */
export async function monitorPost(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`server-monitor POST ${path}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
