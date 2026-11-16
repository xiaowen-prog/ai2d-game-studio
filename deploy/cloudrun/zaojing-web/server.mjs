import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'client');
const port = Number(process.env.PORT || 8080);
const accessSecret = process.env.ZAOJING_ACCESS_SECRET || '';
const ownerCode = normalizeCode(process.env.ZAOJING_OWNER_CODE || '');
const inviteCodes = new Set(
  (process.env.ZAOJING_INVITE_CODES || '')
    .split(',')
    .map(normalizeCode)
    .filter(Boolean),
);
const accessCookie = 'zaojing_access';
const accessTtlSeconds = 7 * 24 * 60 * 60;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function normalizeCode(value) {
  return value.trim().toUpperCase();
}

function encoded(value) {
  return Buffer.from(value).toString('base64url');
}

function decoded(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sameSecret(candidate, expected) {
  const actual = Buffer.from(candidate);
  const reference = Buffer.from(expected);
  return actual.length === reference.length && timingSafeEqual(actual, reference);
}

function validCode(candidate) {
  const normalized = normalizeCode(candidate);
  return [ownerCode, ...inviteCodes].filter(Boolean).some((code) => sameSecret(normalized, code));
}

function sign(value) {
  return createHmac('sha256', accessSecret).update(value).digest('base64url');
}

function createAccessToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + accessTtlSeconds;
  const payload = `v1.${expiresAt}`;
  return `${encoded(payload)}.${sign(payload)}`;
}

function readCookies(request) {
  const value = request.headers.cookie || '';
  return Object.fromEntries(value.split(';').map((item) => {
    const index = item.indexOf('=');
    return index < 0 ? [item.trim(), ''] : [item.slice(0, index).trim(), item.slice(index + 1).trim()];
  }).filter(([key]) => key));
}

function hasAccess(request) {
  if (!accessSecret) return false;
  const token = readCookies(request)[accessCookie];
  if (!token) return false;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;
  let payload;
  try { payload = decoded(encodedPayload); } catch { return false; }
  const [, expiresAt] = payload.split('.');
  if (!/^v1\.\d+$/u.test(payload) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  return sameSecret(signature, sign(payload));
}

function safePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  const candidate = join(root, relative);
  return candidate.startsWith(root) ? candidate : null;
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

function sendFile(response, path, method) {
  const extension = extname(path).toLowerCase();
  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypes[extension] || 'application/octet-stream');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.setHeader('Cache-Control', extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
  if (method === 'HEAD') return response.end();
  createReadStream(path).on('error', () => response.destroy()).pipe(response);
}

function accessPage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>造境 · 邀请进入</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b0d0f;color:#f5f1e8}
*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,#243b31 0,#111817 38%,#0b0d0f 75%)}
main{width:min(480px,100%);padding:42px 38px;border:1px solid #405247;background:rgba(17,24,22,.92);box-shadow:0 28px 90px #0008}
.brand{display:flex;align-items:center;gap:12px;color:#f6c85f;font-weight:700;letter-spacing:.08em}.mark{width:14px;height:14px;background:#f6c85f;box-shadow:10px 0 #9ed08b,0 10px #9ed08b}
h1{font-size:34px;line-height:1.1;margin:54px 0 14px}p{color:#b8c1b6;line-height:1.75;margin:0 0 28px}.hint{font-size:13px;color:#829084;margin-top:18px}form{display:flex;gap:10px}input,button{font:inherit;border-radius:0;border:1px solid #596d5e;height:48px}input{flex:1;min-width:0;padding:0 14px;background:#0d1311;color:#fff;letter-spacing:.12em;text-transform:uppercase}button{padding:0 20px;background:#f6c85f;color:#16180f;border-color:#f6c85f;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.error{min-height:24px;margin-top:12px;color:#ff8f73;font-size:14px}
</style></head><body><main><div class="brand"><span class="mark" aria-hidden="true"></span><span>造境 / ZAOJING</span></div><h1>先拿到一张邀请函</h1><p>这是造境的试用入口。输入邀请码后进入制作台；开始真实制作时，请在自己的电脑上连接自己的 Codex CLI。</p><form id="form"><input id="code" autocomplete="one-time-code" aria-label="邀请码" placeholder="输入邀请码" maxlength="64" required><button id="submit" type="submit">进入造境</button></form><div class="error" id="error" role="status" aria-live="polite"></div><p class="hint">网页不会接收你的 Codex 登录态或本机项目文件。</p></main><script>
const form=document.getElementById('form'),code=document.getElementById('code'),submit=document.getElementById('submit'),error=document.getElementById('error');
form.addEventListener('submit',async(event)=>{event.preventDefault();const value=code.value.trim();if(!value)return;submit.disabled=true;error.textContent='正在核对…';try{const response=await fetch('/__access/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:value})});const result=await response.json();if(!response.ok)throw new Error(result.error||'邀请码无效');location.reload()}catch(reason){error.textContent=reason instanceof Error?reason.message:'邀请码无效';submit.disabled=false;code.focus();}});
</script></body></html>`;
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const url = new URL(request.url || '/', 'http://localhost');
  try {
    if (url.pathname === '/__access/status') {
      return hasAccess(request) ? sendJson(response, 200, { ok: true }) : sendJson(response, 401, { ok: false });
    }
    if (url.pathname === '/__access/verify') {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
      let input;
      try { input = JSON.parse(await readBody(request)); } catch { return sendJson(response, 400, { error: '请求格式有误。' }); }
      if (typeof input?.code !== 'string' || !validCode(input.code)) return sendJson(response, 401, { error: '邀请码无效或已失效。' });
      return sendJson(response, 200, { ok: true }, {
        'Set-Cookie': `${accessCookie}=${createAccessToken()}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${accessTtlSeconds}`,
        'Cache-Control': 'no-store',
      });
    }
    if (!hasAccess(request)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(accessPage());
    }
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      return response.end('Method Not Allowed');
    }
    const target = safePath(request.url || '/');
    let file = target;
    try {
      if (!file || !statSync(file).isFile()) file = join(root, 'index.html');
      sendFile(response, file, request.method);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
    }
  } catch {
    sendJson(response, 400, { error: '请求未完成。' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`造境邀请制预览服务 listening on ${port}`);
});
