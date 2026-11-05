// Two real text turns through the actual Electron UI, preload, host service and Codex adapter.
// Run only after account/usage review and user authorization. No images, retries or later stages.
import { app, dialog } from 'electron';
import { appendFile, chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { CodexAppServer } from '../../dist/main/codexAppServer.js';

if (process.env.NOOBI_APPROVED_DIRECTION_TURNS !== '2') throw new Error('Explicit approval for two direction turns is required');
if (process.env.OPENAI_API_KEY) throw new Error('API-key billing is not authorized for this test');
const authSource = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
const auth = JSON.parse(await readFile(authSource, 'utf8'));
if (auth.auth_mode !== 'chatgpt' || auth.OPENAI_API_KEY || !auth.tokens) throw new Error('An existing ChatGPT subscription login is required');
const runRoot = resolve('.noobi-private', `direction-real-${Date.now()}`);
const userData = join(runRoot, 'user-data');
const authHome = join(userData, 'codex-home');
const projectFolder = join(runRoot, '太空方向验证');
const evidence = resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-1');
await mkdir(authHome, { recursive: true, mode: 0o700 });
await copyFile(authSource, join(authHome, 'auth.json')); await chmod(join(authHome, 'auth.json'), 0o600);
await mkdir(projectFolder, { recursive: true }); await mkdir(evidence, { recursive: true });
app.setAppPath(resolve('.')); process.env.NOOBI_USER_DATA_DIR = userData;
delete process.env.NOOBI_DISABLE_GENERATION; delete process.env.NOOBI_SMOKE_CAPTURE; delete process.env.NOOBI_RENDERER_URL;
const records = []; const clients = new Set();
const originalStart = CodexAppServer.prototype.start;
CodexAppServer.prototype.start = function () { clients.add(this); return originalStart.call(this); };
const originalRun = CodexAppServer.prototype.runTurn;
const originalThread = CodexAppServer.prototype.startThread;
CodexAppServer.prototype.startThread = async function (options) {
  assert.equal(options.sandbox, 'read-only'); assert.equal(options.ephemeral, true);
  assert.equal(options.approvalPolicy, 'never'); assert.ok(!options.dynamicTools?.length);
  return originalThread.call(this, options);
};
CodexAppServer.prototype.runTurn = async function (options) {
  assert.ok(records.length < 2, 'Two-turn budget exhausted');
  assert.equal(this.status.account?.type, 'chatgpt'); assert.equal(this.status.account?.planType, 'pro');
  clients.add(this);
  const record = { model: options.model, effort: options.effort, started: Date.now(), turnId: '-', usage: null, firstMs: null, tools: [], outcome: '失败' };
  records.push(record);
  const observe = ({ method, params }) => {
    if (params?.threadId !== options.threadId) return;
    if (method === 'thread/tokenUsage/updated') record.usage = params.tokenUsage?.last;
    if (method === 'turn/started') record.turnId = params.turn?.id ?? '-';
    if (method === 'item/agentMessage/delta' && record.firstMs === null) record.firstMs = Date.now() - record.started;
    if (method === 'item/started' && params.item?.type && !['reasoning', 'agentMessage', 'userMessage'].includes(params.item.type)) record.tools.push(params.item.type);
  };
  this.on('notification', observe);
  try {
    const result = await originalRun.call(this, options);
    record.turnId = result.turnId; record.status = result.status;
    return result;
  } finally { record.elapsedMs = Date.now() - record.started; this.off('notification', observe); }
};
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectFolder] });
let closing = false;
const timeout = setTimeout(() => { void finish(new Error('Real direction test timed out')); }, 240_000);
async function finish(error) {
  if (closing) return; closing = true; clearTimeout(timeout);
  for (const runtime of clients) await runtime.stop().catch(() => undefined);
  await rm(authHome, { recursive: true, force: true });
  if (records.length) {
    const log = join(evidence, '冒烟记录.md');
    try { await readFile(log); } catch {
      await writeFile(log, '# 冒烟记录（脚本自动写入，不得手填）\n- 产品：AI2D游戏制作平台\n- 阶段：阶段2-1\n- 模型：OpenAI / ' + records[0].model + '\n- 计费：现有 ChatGPT Pro 订阅额度；不使用 API Key，不充值；最多 2 次文字调用。\n\n| 时间 | 链路 | 请求 ID | 输入 token | 输出 token | 首字耗时 | 总耗时 | 结构校验 | 重试次数 | 结果 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n');
    }
    for (const [index, row] of records.entries()) {
      const timestamp = new Date(row.started).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
      await appendFile(log, `| ${timestamp} | ${index ? '修改方向卡' : '首次方向卡'} | ${row.turnId} | ${row.usage?.inputTokens ?? '-'} | ${row.usage?.outputTokens ?? '-'} | ${row.firstMs === null ? '-' : (row.firstMs / 1000).toFixed(2) + 's'} | ${(row.elapsedMs / 1000).toFixed(2)}s | ${row.outcome === '通过' ? '首测合规' : '未通过'} | 0 | ${row.outcome} |\n`);
    }
    await writeFile(join(evidence, '真实调用检查.json'), JSON.stringify({ checkedAt: new Date().toISOString(), realModelCalls: records.length,
      result: error ? '失败' : '通过', records, stateDirectory: userData, authRemoved: true }, null, 2));
  }
  if (error) { console.error(error.message); app.exit(1); } else { console.log('真实方向链路通过：2 次文字调用，确认和恢复没有额外调用。'); app.quit(); }
}
dialog.showErrorBox = (_title, message) => { void finish(new Error(message)); };
app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => { void check(win).then(() => finish(), finish); });
});
async function check(win) {
  const run = (source) => win.webContents.executeJavaScript(source);
  const wait = async (source, count = 600) => {
    for (let i = 0; i < count; i++) { if (await run(source)) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
    throw new Error(`UI condition timed out: ${source}`);
  };
  const fill = (selector, value) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const click = async (label) => {
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  };
  const idea = '做一个太空主题的2D横版闯关游戏。宇航员在月球移动、单次跳跃，收集3块能源晶体后到达飞船；清晰像素风，只做一个短关卡。';
  await wait(`!!document.querySelector('textarea[aria-label="描述你想制作的游戏"]')`);
  const bootstrap = await run('window.noobi.bootstrap()');
  assert.equal(bootstrap.runtime.account?.type, 'chatgpt');
  assert.equal(bootstrap.runtime.account?.planType, 'pro');
  assert.equal(await run(`!!document.querySelector('[aria-label="首次使用指引"]')`), false);
  await fill('textarea[aria-label="描述你想制作的游戏"]', idea);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await run(`document.querySelector('textarea[aria-label="描述你想制作的游戏"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await wait(`!!document.querySelector('.creation-direction') || !!document.querySelector('.creation-error')`, 1000);
  if (await run(`!!document.querySelector('.creation-error')`)) throw new Error('首次方向生成失败，请查看项目保留的错误；未自动重试');
  await wait(`!document.querySelector('.launch-transition')`);
  const state = async () => {
    const info = await run('window.noobi.bootstrap()'); const id = info.projects[0].id;
    return (await run(`window.noobi.creation.get(${JSON.stringify(id)})`)).value;
  };
  const first = await state(); const before = first.steps.direction.artifact.direction;
  assert.equal(before.genre, 'platformer'); assert.match(before.theme + before.title, /太空|月球|宇航/);
  assert.equal(first.steps.direction.status, 'awaiting-confirmation');
  assert.equal(records.length, 1); assert.deepEqual(records[0].tools, []); records[0].outcome = '通过';
  await writeFile(join(evidence, '真实方向-初次.png'), (await win.webContents.capturePage()).toPNG());
  await fill('#creation-request', '只把操作方式中的“单次跳跃”改为“二段跳”。名称、主题、目标、画风和制作范围全部保持原文不变。');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await run(`document.getElementById('creation-request').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);
  await wait(`document.querySelector('.creation-status')?.textContent==='待确认' || !!document.querySelector('.creation-error')`, 1000);
  if (await run(`!!document.querySelector('.creation-error')`)) throw new Error('修改方向失败，上一版已保留；未自动重试');
  const second = await state(); const after = second.steps.direction.artifact.direction;
  assert.match(after.controls, /二段跳|双跳|两次跳/);
  for (const key of ['title', 'genre', 'theme', 'goal', 'style', 'scope']) assert.deepEqual(after[key], before[key], `Unrequested ${key} changed`);
  assert.equal(records.length, 2); assert.deepEqual(records[1].tools, []); records[1].outcome = '通过';
  await click('确认方向并保存'); await wait(`document.querySelector('.creation-status')?.textContent==='已确认'`);
  const approved = await state(); assert.equal(approved.currentStage, 'direction'); assert.equal(approved.steps.character.status, 'idle');
  await writeFile(join(evidence, '真实方向-修改确认.png'), (await win.webContents.capturePage()).toPNG());
  await run(`(()=>{const s=document.getElementById('creation-history');s.value=s.options[s.options.length-1].value;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('恢复这个版本'); await click('确认影响，继续');
  await wait(`document.querySelector('.creation-status')?.textContent==='待确认'`);
  assert.deepEqual((await state()).steps.direction.artifact.direction, before); assert.equal(records.length, 2);
  await writeFile(join(evidence, '真实方向-恢复.png'), (await win.webContents.capturePage()).toPNG());
  await writeFile(join(evidence, '真实方向样例.md'), `# 方向卡真实样例\n\n本页由实际桌面测试脚本写入；共两次真实文字调用，无图片调用。测试输入为公开构造样例，不含私人资料。\n\n## 用户想法\n\n${idea}\n\n## 第一次 AI 输出\n\n${Object.entries(before).map(([k,v]) => `- ${k}：${Array.isArray(v) ? v.join('；') : v}`).join('\n')}\n\n## 用户修改\n\n只把单次跳跃改为二段跳，其余字段保持原文。\n\n## 修改结果\n\n${Object.entries(after).map(([k,v]) => `- ${k}：${Array.isArray(v) ? v.join('；') : v}`).join('\n')}\n\n## 操作结果\n\n确认后停在方向；恢复初稿后内容与待确认状态一致。两次操作均未额外调用 AI。只有这一个样例通过，不代表各种需求都已验证。用户对内容质量的验收仍待确认。\n`);
}
await import('../../dist/main/main.js');
