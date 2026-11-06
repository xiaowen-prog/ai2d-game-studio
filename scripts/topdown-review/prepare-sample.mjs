// Creates two actual AI drafts for USER acceptance. No gameplay automation or approval.
import { app, dialog } from 'electron';
import { copyFile, cp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { CodexAppServer } from '../../dist/main/codexAppServer.js';

if (process.env.NOOBI_PREPARE_TOPDOWN !== 'subscription-only' || process.env.OPENAI_API_KEY) throw Error('Existing subscription only; explicit sample creation required');
const authSource = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
const auth = JSON.parse(await readFile(authSource, 'utf8'));
if (auth.auth_mode !== 'chatgpt' || auth.OPENAI_API_KEY || !auth.tokens) throw Error('Existing ChatGPT login required');
const resume = process.env.NOOBI_RESUME_TOPDOWN_ROOT ? resolve(process.env.NOOBI_RESUME_TOPDOWN_ROOT) : null;
if (resume && !resume.startsWith(resolve('.noobi-private/topdown-review') + '/')) throw Error('Resume must use this project draft directory');
const stamp = Date.now(), root = resume ?? resolve('.noobi-private/topdown-review', `drafts-${stamp}`);
const data = join(root, 'user-data'), folder = join(root, '俯视核心试玩'), authHome = join(data, 'codex-home');
const evidence = resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-6', `${resume ? 'resume' : 'drafts'}-${stamp}`);
await mkdir(folder, { recursive: true }); await mkdir(evidence, { recursive: true });
if (!resume) {
  const previous = JSON.parse(await readFile(resolve('.noobi-private/scene-review/latest-topdown.json'), 'utf8'));
  if (!previous.passed) throw Error('Approved scene source missing');
  for (const file of ['creation', 'image-generation-attestations.json', 'asset-plans.json']) {
    await cp(join(previous.stateDirectory, file), join(data, file), { recursive: true, filter: path => !path.split('/').includes('runs') });
  }
  const projects = JSON.parse(await readFile(join(previous.stateDirectory, 'projects.json'), 'utf8'));
  if (projects.projects.length !== 1) throw Error('Expected one isolated sample project');
  await cp(projects.projects[0].root, folder, { recursive: true }); projects.projects[0].root = folder;
  projects.settings.defaultWorkspace = join(data, 'projects');
  await writeFile(join(data, 'projects.json'), JSON.stringify(projects));
}
const projects = JSON.parse(await readFile(join(data, 'projects.json'), 'utf8'));
if (projects.projects.length !== 1) throw Error('Expected one isolated sample project');
const project = projects.projects[0];
await mkdir(authHome, { recursive: true, mode: 0o700 });
await copyFile(authSource, join(authHome, 'auth.json')); await chmod(join(authHome, 'auth.json'), 0o600);
app.setAppPath(resolve('.')); process.env.NOOBI_USER_DATA_DIR = data;
delete process.env.NOOBI_DISABLE_GENERATION; delete process.env.NOOBI_RENDERER_URL;
const records = [], clients = new Set(); let phase = resume ? '接续AI修改剑气碰墙反弹一次' : '制作普通剑气草稿', closing = false, window = null, baseArtifact = null, finalArtifact = null;
const maxTurns = resume ? 3 : 6;
const saveProgress = () => writeFileSync(join(evidence, '制作进度.json'), JSON.stringify({ root, phase, records, baseArtifact, finalArtifact, manualAcceptance: 'pending' }, null, 2));
const originalStart = CodexAppServer.prototype.start, originalTurn = CodexAppServer.prototype.startTurn;
CodexAppServer.prototype.start = function () {
  if (!clients.has(this)) {
    clients.add(this);
    this.on('notification', ({ method, params }) => {
      const row = [...records].reverse().find(record => record.threadId === params?.threadId);
      if (row) {
        if (method === 'thread/tokenUsage/updated') row.usage = params.tokenUsage?.last;
        if (method === 'item/agentMessage/delta' && !row.firstMs) row.firstMs = Date.now() - row.started;
        if (method === 'turn/completed') { row.elapsedMs = Date.now() - row.started; row.status = params.turn?.status; saveProgress(); }
      }
      if (method === 'item/started' && params?.item?.type === 'imageGeneration') void finish(Error('No new image generation authorized for these drafts'));
    });
  }
  return originalStart.call(this);
};
CodexAppServer.prototype.startTurn = async function (options) {
  if (records.length >= maxTurns || this.status.account?.type !== 'chatgpt' || this.status.account?.planType !== 'pro') throw Error('Subscription or bounded draft budget unavailable');
  const model = options.model ?? this.status.models.find(value => value.isDefault)?.model;
  if (!model) throw Error('Configured model unavailable');
  const row = { phase, model, threadId: options.threadId, turnId: 'pending', started: Date.now(), status: 'started', usage: null, firstMs: null, elapsedMs: 0 };
  records.push(row); saveProgress(); console.log(`Text ${records.length}/${maxTurns} ${phase}`);
  row.turnId = await originalTurn.call(this, { ...options, model }); return row.turnId;
};
dialog.showErrorBox = (_title, message) => void finish(Error(message));
const timeout = setTimeout(() => void finish(Error('Draft preparation timed out; no automatic retry')), 15 * 60_000);
async function finish(error) {
  if (closing) return; closing = true; clearTimeout(timeout);
  if (error && window && !window.isDestroyed()) await writeFile(join(evidence, '制作中断.png'), (await window.webContents.capturePage()).toPNG()).catch(() => {});
  for (const client of clients) await client.stop().catch(() => {});
  await rm(join(authHome, 'auth.json'), { force: true });
  const result = { preparedAt: new Date().toISOString(), prepared: !error, manualAcceptance: 'pending', error: error?.message ?? null, stateDirectory: data, projectId: project.id, evidenceDirectory: evidence, root, resumed: !!resume, textTurns: records.length, imageCalls: 0, automaticRepairs: 0, records, baseArtifact, finalArtifact, authRemoved: true };
  await writeFile(join(evidence, '制作记录.json'), JSON.stringify(result, null, 2));
  await writeFile(resolve('.noobi-private/topdown-review/latest-topdown.json'), JSON.stringify(result, null, 2));
  await writeFile(join(evidence, '制作调用记录.md'), '# 真实 AI 制作记录\n\n不代替用户验收；未执行自动试玩、确认或历史恢复测试。\n\n| 时间 | 制作内容 | 模型 | 输入 token | 输出 token | 耗时 ms | 生成状态 |\n| --- | --- | --- | --- | --- | --- | --- |\n' + records.map(row => `| ${new Date(row.started).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })} | ${row.phase} | ${row.model} | ${row.usage?.inputTokens ?? '-'} | ${row.usage?.outputTokens ?? '-'} | ${row.elapsedMs} | ${row.status} |`).join('\n') + '\n');
  console.log(JSON.stringify({ prepared: !error, error: error?.message, evidence, text: records.length, manualAcceptance: 'pending' })); app.exit(error ? 1 : 0);
}
async function prepare(win) {
  window = win;
  const run = code => win.webContents.executeJavaScript(code);
  const wait = async (code, attempts = 600) => { for (let i = 0; i < attempts; i++) { if (closing) throw Error('Stopped'); if (await run(code)) return; await new Promise(done => setTimeout(done, 100)); } throw Error('Draft interface timeout'); };
  const click = async label => { await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`); await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`); };
  const state = async () => { const reply = await run(`window.noobi.creation.get(${JSON.stringify(project.id)})`); if (!reply.ok) throw Error('Unable to read draft state'); return reply.value; };
  const ready = async () => { await wait(`document.querySelector('.creation-status')?.textContent==='待确认'||!!document.querySelector('.creation-error')`, 6000); const value = await state(); if (value.error) throw Error(value.error.message); if (value.task?.state !== 'succeeded') throw Error('Draft generation did not complete'); return value.steps.playable.artifact; };
  await wait(`!!document.querySelector('.home-project-grid button')`);
  await run(`document.querySelector('.home-project-grid button').click()`);
  if (resume) {
    const value = await state();
    if (!['stopped', 'failed', 'succeeded'].includes(value.task?.state) || value.steps.playable.artifact?.playable?.maxBounces !== 0) throw Error('Resume requires a saved ordinary draft and no active task');
    baseArtifact = value.steps.playable.artifact;
  } else {
    await click('开始核心试玩'); await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);
    baseArtifact = await ready();
  }
  phase = 'AI修改剑气碰墙反弹一次';
  await wait(`!!document.getElementById('creation-request') && !document.getElementById('creation-request').disabled`);
  const prompt = '剑气碰墙反弹一次：第一次撞墙改变方向继续飞，第二次撞墙消失。命中练习目标仍然消失并计数。人物、衣服、背景、动作、地图、目标位置和数量、移动速度、剑气速度以及其他规则都保持不变，不生成新图片。';
  await run(`(()=>{const e=document.getElementById('creation-request');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(prompt)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('发送修改'); await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);
  finalArtifact = await ready();
  // Deliver the pending draft as-is. No keys, confirmation or acceptance verdict.
  win.show(); await new Promise(done => setTimeout(done, 2000));
  await writeFile(join(evidence, '待用户验收.png'), (await win.webContents.capturePage()).toPNG());
  await writeFile(join(evidence, '待确认状态.json'), JSON.stringify(await state(), null, 2));
}
app.once('browser-window-created', (_event, win) => win.webContents.once('did-finish-load', () => void prepare(win).then(() => finish(), finish)));
app.on('before-quit', event => { if (!closing) { event.preventDefault(); void finish(Error('Draft preparation interrupted; saved versions retained')); } });
process.once('SIGTERM', () => void finish(Error('Draft preparation interrupted; saved versions retained')));
process.once('SIGINT', () => void finish(Error('Draft preparation interrupted; saved versions retained')));
console.log(JSON.stringify({ root, data, evidence }));
await import('../../dist/main/main.js');
