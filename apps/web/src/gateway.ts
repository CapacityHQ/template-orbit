import { type ChildProcess, spawn } from 'node:child_process';
import { Agent, createServer, type IncomingMessage, request, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { pool } from '@orbit/db';
import { createRealtimeHub, errorFields, fromNodeSocket, logger } from '@orbit/realtime-server';
import { WebSocketServer } from 'ws';
import { createMaintenanceScheduler } from './lib/deployment/scheduler.ts';

const publicPort = Number(process.env['PORT'] ?? 3000);
const webPort = Number(process.env['ORBIT_WEB_PORT'] ?? 3001);
const origin = process.env['BETTER_AUTH_URL'];
if (origin === undefined) throw new Error('BETTER_AUTH_URL is required for the gateway.');
const canonical = new URL(origin);
const allowedOrigins = new Set<string>([canonical.origin]);
allowedOrigins.add(`${canonical.protocol}//www.${canonical.host}`);
for (const host of (process.env['ORBIT_AUTH_ALLOWED_HOSTS'] ?? '').split(',')) {
  const trimmed = host.trim();
  if (trimmed.length > 0) allowedOrigins.add(`${canonical.protocol}//${trimmed}`);
}
const cronSecret = process.env['CRON_SECRET']?.trim() ?? '';
const schedulerEnabled = cronSecret.length > 0 && process.env['ORBIT_GATEWAY_SCHEDULER'] !== 'false';
const SHUTDOWN_CAP_MS = 25_000;
const CHILD_KILL_AFTER_MS = 15_000;

const webEnv = { ...process.env, PORT: String(webPort), HOSTNAME: '127.0.0.1' };
const web: ChildProcess = spawn(
  process.execPath,
  [fileURLToPath(new URL('./start.mjs', import.meta.url))],
  { env: webEnv, stdio: 'inherit' },
);

const hub = await createRealtimeHub();
const sockets = new WebSocketServer({ noServer: true, maxPayload: 65_536 });
const agent = new Agent({ keepAlive: true, maxSockets: 256 });

function proxy(incoming: IncomingMessage, response: ServerResponse): void {
  const upstream = request(
    {
      agent,
      host: '127.0.0.1',
      port: webPort,
      method: incoming.method,
      path: incoming.url,
      headers: incoming.headers,
    },
    (proxied) => {
      response.writeHead(proxied.statusCode ?? 502, proxied.headers);
      proxied.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json' });
    }
    response.end(JSON.stringify({ status: 'unavailable', service: 'web' }));
  });
  incoming.pipe(upstream);
}

function realtimeHealth(response: ServerResponse): void {
  const stats = hub.stats();
  const ready = stats.redis === 'ready';
  response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: ready ? 'ok' : 'unavailable', hub: stats }));
}

const server = createServer((incoming, response) => {
  if (incoming.method === 'GET' && incoming.url === '/api/realtime/health') {
    realtimeHealth(response);
    return;
  }
  proxy(incoming, response);
});

server.on('upgrade', (incoming: IncomingMessage, socket: Socket, head: Buffer) => {
  socket.on('error', () => socket.destroy());
  if (incoming.method !== 'GET' || incoming.url !== '/api/ws') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  if (!allowedOrigins.has(incoming.headers.origin ?? '')) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  if (hub.stats().redis !== 'ready') {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(incoming, socket, head, (connection) => {
    const session = hub.accept(fromNodeSocket(connection));
    connection.on('message', (data, binary) => {
      if (binary) connection.close(1003, 'text_frames_required');
      else session.message(data.toString());
    });
    connection.on('pong', () => session.pong());
    connection.on('close', () => session.closed());
    connection.on('error', () => connection.terminate());
  });
});

const scheduler = schedulerEnabled
  ? createMaintenanceScheduler(async (path) => {
      try {
        const response = await fetch(new URL(path, `http://127.0.0.1:${webPort}`), {
          headers: { authorization: `Bearer ${cronSecret}` },
          signal: AbortSignal.timeout(300_000),
          redirect: 'error',
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        logger.info('maintenance job ran', { job: path });
      } catch (error) {
        logger.error('maintenance job failed', { job: path, ...errorFields(error) });
      }
    })
  : null;
const schedulerTimer = scheduler === null ? null : setInterval(() => scheduler.tick(), 1_000);

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(publicPort, '0.0.0.0', () => {
    server.off('error', reject);
    resolve();
  });
});
logger.info('gateway listening', {
  port: publicPort,
  web: webPort,
  scheduler: schedulerEnabled,
  origins: [...allowedOrigins],
});

let stopping = false;

async function stopChild(): Promise<void> {
  if (web.exitCode !== null || web.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => web.kill('SIGKILL'), CHILD_KILL_AFTER_MS);
    web.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    web.kill('SIGTERM');
  });
}

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info('gateway shutting down', { signal });
  setTimeout(() => process.exit(0), SHUTDOWN_CAP_MS).unref();
  if (schedulerTimer !== null) clearInterval(schedulerTimer);
  server.close();
  server.closeAllConnections();
  for (const socket of sockets.clients) socket.terminate();
  await Promise.allSettled([
    new Promise<void>((resolve) => sockets.close(() => resolve())),
    hub.close(),
    scheduler?.drain(),
  ]);
  await stopChild();
  await pool.end().catch(() => undefined);
  process.exit(0);
}

web.on('exit', (code, signalCode) => {
  if (stopping) return;
  logger.error('web process exited', { code, signal: signalCode });
  stop('child-exit').catch(() => process.exit(1));
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stop(signal).catch((error: unknown) => {
      logger.error('gateway shutdown failed', errorFields(error));
      process.exit(1);
    });
  });
}
