import { createServer, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

type Operation = (...args: any[]) => unknown;
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
  const clients = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.headers.host !== host) {
        response.writeHead(403).end();
        return;
      }
      const url = new URL(request.url ?? '/', origin);
      const path = url.pathname;
      if (path.startsWith('/studio/')) {
        if (request.headers['sec-fetch-site'] !== 'same-origin') {
          response.writeHead(403).end();
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
        if (request.method !== 'POST' || !operation || request.headers.origin !== origin ||
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
        const args: unknown = JSON.parse(body);
        if (!Array.isArray(args)) throw new Error('请求格式有误。');
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
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          error: error instanceof Error ? error.message : '操作失败。',
        }));
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动本机浏览器入口。');
  const host = `127.0.0.1:${address.port}`;
  const origin = `http://${host}`;
  return {
    url: origin,
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
