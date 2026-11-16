import { createServer, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

type Operation = (...args: any[]) => unknown;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export async function startBrowserStudio(
  renderer: string,
  operations: ReadonlyMap<string, Operation>,
  delivery: (projectId: string, versionId: string) => Promise<string>,
) {
  const allowedOrigins = new Set(
    (process.env.NOOBI_BROWSER_ALLOWED_ORIGINS
      ?? 'https://zaojing-game-studio-preview.dear-vale-4884.chatgpt.site')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const sessionToken = randomBytes(32).toString('base64url');
  const sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  const clients = new Set<ServerResponse>();
  const matchesSession = (candidate: string | undefined) => {
    if (!candidate || Date.now() >= sessionExpiresAt) return false;
    const expected = Buffer.from(sessionToken);
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const sessionFromRequest = (request: import('node:http').IncomingMessage, url: URL) => {
    const header = request.headers['x-noobi-session'];
    return typeof header === 'string' ? header : url.searchParams.get('token') ?? undefined;
  };
  const sendError = (response: ServerResponse, status: number, code: string, message: string) => {
    if (response.headersSent || response.destroyed) return;
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code, error: message }));
  };
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.headers.host !== host) {
        response.writeHead(403).end();
        return;
      }
      const requestOrigin = request.headers.origin;
      const crossOrigin = typeof requestOrigin === 'string' && requestOrigin !== origin;
      const trustedCrossOrigin = crossOrigin && allowedOrigins.has(requestOrigin);
      if (crossOrigin && !trustedCrossOrigin) {
        response.writeHead(403).end();
        return;
      }
      if (trustedCrossOrigin) {
        response.setHeader('Access-Control-Allow-Origin', requestOrigin);
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Noobi-Session');
        response.setHeader('Access-Control-Allow-Private-Network', 'true');
        response.setHeader('Vary', 'Origin');
      }
      const url = new URL(request.url ?? '/', origin);
      const path = url.pathname;
      if (path.startsWith('/studio/')) {
        if (request.method === 'OPTIONS' && trustedCrossOrigin) {
          response.writeHead(204).end();
          return;
        }
        if (!trustedCrossOrigin && request.headers['sec-fetch-site'] !== 'same-origin') {
          response.writeHead(403).end();
          return;
        }
        if (!matchesSession(sessionFromRequest(request, url))) {
          sendError(response, 401, 'SESSION_REQUIRED', '本机制作台会话已失效，请从桌面应用重新打开。');
          return;
        }
        if (request.method === 'GET' && path === '/studio/events') {
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          response.write(': connected\n\n');
          clients.add(response);
          response.on('close', () => clients.delete(response));
          return;
        }
        if (request.method === 'GET' && path === '/studio/download') {
          const directory = await delivery(url.searchParams.get('project') ?? '', url.searchParams.get('version') ?? '');
          const file = join(directory, 'game-package.zip');
          const info = await stat(file);
          response.writeHead(200, {
            'Content-Type': 'application/zip', 'Content-Length': info.size,
            'Content-Disposition': 'attachment; filename="game-package.zip"',
          });
          await pipeline(createReadStream(file), response);
          return;
        }
        const operation = operations.get(path.slice('/studio/'.length));
        if (request.method !== 'POST' || !operation || (!trustedCrossOrigin && request.headers.origin !== origin) ||
          request.headers['content-type'] !== 'application/json') {
          response.writeHead(403).end();
          return;
        }
        request.setEncoding('utf8');
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 256 * 1024) {
            response.writeHead(413).end();
            return;
          }
        }
        let args: unknown;
        try {
          args = JSON.parse(body);
        } catch {
          sendError(response, 400, 'INVALID_JSON', '请求格式有误。');
          return;
        }
        if (!Array.isArray(args)) {
          sendError(response, 400, 'INVALID_REQUEST', '请求格式有误。');
          return;
        }
        const value = await operation(...args);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value ?? null));
        return;
      }
      if (request.method !== 'GET' || (path !== '/' && !/^\/assets\/[\w.-]+$/u.test(path))) {
        response.writeHead(404).end();
        return;
      }
      const file = join(renderer, path === '/' ? 'index.html' : path.slice(1));
      const info = await stat(file);
      response.writeHead(200, {
        'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size,
      });
      await pipeline(createReadStream(file), response);
    } catch (error) {
      console.error('[browser-studio]', error);
      sendError(response, 400, 'OPERATION_FAILED', '操作未完成，请回到桌面制作台查看详细信息。');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    const configuredPort = Number(process.env.NOOBI_BROWSER_PORT ?? '47621');
    server.listen(Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 47621, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动本机浏览器入口。');
  const host = `127.0.0.1:${address.port}`;
  const origin = `http://${host}`;
  return {
    url: `${origin}/?studioToken=${encodeURIComponent(sessionToken)}`,
    broadcast(channel: string, payload: unknown) {
      const message = `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of clients) {
        if (!client.write(message)) client.destroy();
      }
    },
    close() {
      server.close();
      server.closeAllConnections();
    },
  };
}
