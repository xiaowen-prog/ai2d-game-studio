// Offline acceptance server: no Codex runtime, account or media provider is imported.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreationWorkflowService, publicCreationError } from '../../src/main/creationWorkflowService.js';
import { CreationWorkflowStore, creationId } from '../../src/main/creationWorkflowStore.js';
import { directionArtifact } from '../../src/main/creationArtifact.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const data = resolve(process.env.RESTART_CHECK_DIR || join(repo, '.noobi-private/direction-review-data'));
await mkdir(data, { recursive: true });
let activeId: string | null = await readFile(join(data, 'active'), 'utf8').catch(() => null);
let calls = 0;
const store = new CreationWorkflowStore(join(data, 'records'));
const service = new CreationWorkflowService({ store, lastEnabledStage: 'direction', generator: { async generate(state, signal) {
  calls += 1;
  await new Promise((done) => setTimeout(done, 450)); signal.throwIfAborted();
  const prior = state.steps.direction.artifact?.direction;
  const direction = prior ? structuredClone(prior) : { title: '竹林剑客 · 离线示例', genre: 'topdown' as const, theme: '武侠竹林', controls: '方向键移动，自动发射剑气', goal: '击败三波敌人', style: '清晰的 2D 像素画', scope: ['1 个主角、1 张地图', '2 类敌人、3 波敌人'] };
  const prompt = state.task?.prompt ?? '';
  if (prompt.includes('手动')) direction.controls = '方向键移动，空格键手动攻击';
  else if (prompt) direction.theme = `离线修改演示：${prompt}`;
  const artifact = directionArtifact(direction);
  artifact.checks = ['离线预置示例，不代表真实 AI 生成'];
  artifact.changes = prior && prompt ? [prompt.includes('手动') ? '已调整操作方式（离线示例）' : '已调整主题（离线示例）'] : [];
  return artifact;
} } });
if (activeId) await service.recover(activeId);
const server = createServer(async (req, res) => {
  const json = (value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '')) return json({ error: { message: '仅接受本机访问' } }, 403);
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json({ error: { message: '不接受外部页面请求' } }, 403);
    const url = new URL(req.url!, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/state') return json({ workflow: activeId ? await service.get(activeId) : null, calls });
    if (req.method === 'GET' && url.pathname === '/api/record') return json(await service.get(url.searchParams.get('id') ?? ''));
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 25_000) throw new Error('Request too long'); }
      const input = JSON.parse(raw);
      if (url.pathname === '/api/new') {
        const state = await service.create(creationId(), input.idea);
        activeId = state.projectId; await writeFile(join(data, 'active'), activeId); return json(state);
      }
      if (url.pathname === '/api/act') {
        try { return json({ ok: true, value: await service.act(input) }); }
        catch (error) { return json({ ok: false, error: publicCreationError(error) }); }
      }
    }
    const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
    const file = files[url.pathname];
    if (req.method !== 'GET' || !file) { res.writeHead(404); res.end(); return; }
    const body = await readFile(join(repo, '.noobi-private/direction-review', file[0]));
    res.writeHead(200, { 'content-type': `${file[1]}; charset=utf-8`, 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'none'" }); res.end(body);
  } catch (error) { json({ error: publicCreationError(error) }, 400); }
});
server.on('error', () => { console.error('验收端口无法使用，未停止其他进程。'); process.exit(1); });
server.listen(Number(process.env.DIRECTION_REVIEW_PORT ?? 8794), '127.0.0.1', async () => {
  const address = server.address(); if (!address || typeof address === 'string') return;
  await writeFile(join(data, 'server.json'), JSON.stringify({ pid: process.pid, port: address.port }));
  console.log(`方向卡离线验收：http://127.0.0.1:${address.port}/（真实模型 0 次）`);
});
process.on('SIGTERM', () => { void service.stopAll().finally(() => server.close(() => process.exit(0))); });
