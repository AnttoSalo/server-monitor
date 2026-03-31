/**
 * monitor-mcp — MCP Server for server-monitor
 *
 * Exposes server health, processes, incidents, and metrics to AI agents
 * via Model Context Protocol. Reads data from the server-monitor HTTP API
 * and can restart PM2 processes directly.
 *
 * Usage:
 *   cd mcp && MCP_API_KEY=secret npm start
 *
 * Endpoints:
 *   GET  /sse          SSE stream for MCP client connections
 *   POST /messages     MCP message relay (used by SSE transport)
 *   GET  /health       Health check (no auth)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';
import { TOOLS, handleToolCall } from './tools.js';

const PORT = parseInt(process.env.MCP_PORT || '3103', 10);
const API_KEY = process.env.MCP_API_KEY;

if (!API_KEY) {
  console.error('Error: MCP_API_KEY environment variable is required');
  process.exit(1);
}

// ─── MCP Server Factory ─────────────────────────────────
// Each SSE connection gets its own MCP Server instance.

function createMcpServer() {
  const server = new Server(
    { name: 'monitor-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ error: err.message }) },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// ─── HTTP + SSE Transport ────────────────────────────────

/** @type {Map<string, { transport: SSEServerTransport, server: Server }>} */
const sessions = new Map();

const httpServer = createServer(async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Health check — no auth
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          server: 'monitor-mcp',
          version: '1.0.0',
          activeSessions: sessions.size,
        })
      );
      return;
    }

    // Auth: Bearer token must match MCP_API_KEY
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token !== API_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // SSE connection — creates a new MCP session
    if (url.pathname === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/messages', res);
      const server = createMcpServer();
      sessions.set(transport.sessionId, { transport, server });

      res.on('close', () => {
        sessions.delete(transport.sessionId);
        server.close().catch(() => {});
        console.log(`Session closed: ${transport.sessionId}`);
      });

      console.log(`New session: ${transport.sessionId}`);
      await server.connect(transport);
      return;
    }

    // MCP messages — routes POST to the correct session's transport
    if (url.pathname === '/messages' && req.method === 'POST') {
      const sessionId = url.searchParams.get('sessionId');
      const session = sessions.get(sessionId);

      if (!session) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown session' }));
        return;
      }

      await session.transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`monitor-mcp listening on http://0.0.0.0:${PORT}`);
  console.log(`  SSE endpoint:   http://localhost:${PORT}/sse`);
  console.log(`  Health check:   http://localhost:${PORT}/health`);
});

// ─── Graceful Shutdown ───────────────────────────────────

function shutdown() {
  console.log('\nShutting down...');
  for (const [id, { server }] of sessions) {
    server.close().catch(() => {});
  }
  sessions.clear();
  httpServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
