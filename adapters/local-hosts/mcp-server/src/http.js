import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  NodeStreamableHTTPServerTransport,
  originValidation
} from '@modelcontextprotocol/node';
import { createAutocacheMcpServer } from './mcp.js';
import { scope } from './runtime.js';

const MAX_REQUEST_BYTES = 128 * 1024;

function parsePort(value) {
  const port = Number(value === undefined ? 3210 : value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('AUTOCACHE_MCP_PORT must be an integer from 0 to 65535');
  }
  return port;
}

function isLoopback(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(host);
}

function parseAllowedHosts(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseAllowedOrigins(value) {
  const origins = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
  return origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('AUTOCACHE_MCP_ALLOWED_ORIGINS entries must be absolute http:// or https:// origins');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)
        || parsed.username || parsed.password
        || (parsed.pathname && parsed.pathname !== '/')
        || parsed.search || parsed.hash) {
      throw new Error('AUTOCACHE_MCP_ALLOWED_ORIGINS entries must be origins without paths, credentials, query, or fragment');
    }
    // SDK v2 originValidation receives allowed origin hostnames and validates
    // the hostname parsed from the request's Origin header. Keep the operator
    // input origin-shaped, then pass only its validated hostname to the guard.
    return parsed.hostname;
  });
}

function bearerMatches(header, token) {
  if (!token) return true;
  const candidate = String(header || '').replace(/^Bearer\s+/i, '');
  const left = Buffer.from(candidate);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(response, status, body, headers = {}) {
  if (response.headersSent) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(JSON.stringify(body));
}

function rpcError(response, status, code, message, headers) {
  json(response, status, {
    jsonrpc: '2.0',
    error: { code, message },
    id: null
  }, headers);
}

async function readJsonBody(request) {
  const contentType = String(request.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    const error = new Error('Content-Type must be application/json');
    error.status = 415;
    throw error;
  }

  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    const error = new Error('Request body exceeds 128 KiB');
    error.status = 413;
    throw error;
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) {
    const error = new Error('Request body exceeds 128 KiB');
    error.status = 413;
    throw error;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body is not valid JSON');
    error.status = 400;
    throw error;
  }
}

export async function startHttpServer({ env = process.env, logger = console.error } = {}) {
  const host = String(env.AUTOCACHE_MCP_HOST || '127.0.0.1').trim();
  const port = parsePort(env.AUTOCACHE_MCP_PORT);
  const token = String(env.AUTOCACHE_MCP_TOKEN || '').trim();
  const allowedHosts = parseAllowedHosts(env.AUTOCACHE_MCP_ALLOWED_HOSTS);
  const allowedOriginHosts = parseAllowedOrigins(env.AUTOCACHE_MCP_ALLOWED_ORIGINS);

  if (!isLoopback(host) && token.length < 16) {
    throw new Error('non-loopback HTTP binding requires AUTOCACHE_MCP_TOKEN with at least 16 characters');
  }
  if (!isLoopback(host) && allowedHosts.length === 0) {
    throw new Error('non-loopback HTTP binding requires AUTOCACHE_MCP_ALLOWED_HOSTS');
  }
  if (!isLoopback(host) && allowedOriginHosts.length === 0) {
    throw new Error('non-loopback HTTP binding requires AUTOCACHE_MCP_ALLOWED_ORIGINS');
  }

  const validateHost = isLoopback(host)
    ? localhostHostValidation()
    : hostHeaderValidation(allowedHosts);
  const validateOrigin = isLoopback(host)
    ? localhostOriginValidation()
    : originValidation(allowedOriginHosts);

  const httpServer = createServer(async (request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;

    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      json(response, 200, {
        ok: true,
        name: 'autocache-local-hosts',
        transport: 'streamable-http',
        scope,
        automatic_lifecycle_capture: false
      });
      return;
    }
    if (requestUrl.pathname !== '/mcp') {
      rpcError(response, 404, -32004, 'Not found');
      return;
    }
    if (!bearerMatches(request.headers.authorization, token)) {
      rpcError(response, 401, -32001, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });
      return;
    }
    if (request.method !== 'POST') {
      rpcError(response, 405, -32000, 'Method not allowed', { Allow: 'POST' });
      return;
    }

    let parsedBody;
    try {
      parsedBody = await readJsonBody(request);
    } catch (error) {
      const status = Number(error?.status) || 400;
      rpcError(response, status, -32700, error instanceof Error ? error.message : 'Invalid request body');
      return;
    }

    const mcpServer = createAutocacheMcpServer();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    response.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      logger(`AutoCache MCP HTTP request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      rpcError(response, 500, -32603, 'Internal server error');
    }
  });

  const listeningServer = await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve(httpServer));
  });
  const address = listeningServer.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;

  return {
    server: listeningServer,
    host,
    port: actualPort,
    url: new URL(`http://${host.includes(':') ? `[${host}]` : host}:${actualPort}/mcp`),
    async close() {
      if (typeof listeningServer.closeAllConnections === 'function') {
        listeningServer.closeAllConnections();
      }
      await new Promise((resolve, reject) => {
        listeningServer.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}
