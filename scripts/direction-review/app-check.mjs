// Actual desktop entry, preload and IPC. Generation is disabled before importing the app.
import { app, dialog } from 'electron';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const scratch = await mkdtemp(join(tmpdir(), 'noobi-direction-app-'));
app.setAppPath(resolve('.'));
const folder = join(scratch, 'direction-project');
await mkdir(folder);
process.env.NOOBI_USER_DATA_DIR = join(scratch, 'user-data');
process.env.NOOBI_DISABLE_GENERATION = '1';
delete process.env.NOOBI_SMOKE_CAPTURE;
delete process.env.NOOBI_RENDERER_URL;
const evidence = resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-1');
let chooserCalls = 0;
dialog.showOpenDialog = async () => { chooserCalls++; return { canceled: false, filePaths: [folder] }; };
dialog.showErrorBox = (_title, message) => { console.error(message); app.exit(1); };
const timeout = setTimeout(() => { console.error('Desktop direction check timed out'); app.exit(1); }, 55_000);

app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => { void check(win).catch((error) => {
    console.error(error.message); clearTimeout(timeout); app.exit(1);
  }); });
});
async function check(win) {
  const run = (source) => win.webContents.executeJavaScript(source);
  const capture = async (name) => { win.show(); await new Promise(r=>setTimeout(r,350)); await writeFile(join(evidence,name),(await win.webContents.capturePage()).toPNG()); };
  const wait = async (source) => {
    for (let i = 0; i < 400; i++) {
      if (await run(source)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Desktop condition timed out: ${source}`);
  };
  await wait(`!!document.querySelector('[aria-label="首次使用指引"]')`);
  const fillIdea = () => run(`(()=>{const e=document.querySelector('textarea[aria-label="描述你想制作的游戏"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'太空主题的2D横版闯关');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await fillIdea();
  const key = (options) => run(`document.querySelector('textarea[aria-label="描述你想制作的游戏"]').dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({key:'Enter',bubbles:true,...options})}))`);
  await key({isComposing:true}); await key({shiftKey:true});
  assert.equal(await run(`!!document.querySelector('.settings-modal')`), false);
  await key({});
  await wait(`!!document.querySelector('.settings-modal')`);
  assert.match(await run('document.body.innerText'), /登录 Codex/);
  assert.equal(chooserCalls, 0, 'Unsigned submit must show guidance before selecting a project folder');
  await mkdir(evidence, { recursive: true });
  await capture('首次使用-登录指引.png');
  await run(`document.querySelector('.settings-modal button[aria-label="关闭"]').click()`);
  assert.equal(await run(`document.querySelector('textarea[aria-label="描述你想制作的游戏"]').value`), '太空主题的2D横版闯关');
  await win.webContents.reload();
  await wait(`document.querySelector('textarea[aria-label="描述你想制作的游戏"]')?.value==='太空主题的2D横版闯关'`);
  await capture('首次使用-首页指引.png');
  win.setMinimumSize(390, 620); win.setContentSize(390, 844);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true);
  await capture('首次使用-窄窗口.png');
  win.setContentSize(1280, 900);
  // Exercise real IPC separately; UI correctly refuses to generate before login.
  const project = await run(`window.noobi.createProject({idea:'太空主题的2D横版闯关',projectDirectory:${JSON.stringify(folder)},stagedCreation:true},[])`);
  const id = project.id;
  const first = await run(`window.noobi.creation.get(${JSON.stringify(id)})`);
  await run(`window.noobi.creation.act({projectId:${JSON.stringify(id)},operationId:crypto.randomUUID(),expectedRevision:${first.value.revision},action:'run'})`);
  let reply;
  for(let i=0;i<100;i++) { reply=await run(`window.noobi.creation.get(${JSON.stringify(id)})`); if(reply.value.error) break; await new Promise(r=>setTimeout(r,50)); }
  assert.equal(reply.ok, true);
  assert.equal(reply.value.idea, '太空主题的2D横版闯关');
  assert.equal(reply.value.currentStage, 'direction');
  assert.equal(reply.value.error.code, 'GENERATION_DISABLED');
  assert.equal(reply.value.steps.direction.artifact, null);
  assert.equal(reply.value.steps.character.status, 'idle');
  const disk = JSON.parse(await readFile(join(process.env.NOOBI_USER_DATA_DIR, 'creation', 'records', `${id}.json`), 'utf8'));
  assert.equal(disk.idea, reply.value.idea);
  assert.equal(disk.task.state, 'failed');
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, '桌面入口检查.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), mode: 'actual Electron application, model generation disabled', realModelCalls: 0,
    results: ['未登录首页主动显示三步指引和去登录入口', 'Enter 打开登录引导，Shift+Enter 与中文选字不发送', '未登录不弹文件夹或发起生成', '关闭登录设置与刷新后保留想法', '390px 无横向溢出', '实际 IPC 禁用生成并保存想法，不伪造成果'],
  }, null, 2));
  console.log('实际桌面入口检查通过：6 项；真实模型调用 0 次。');
  clearTimeout(timeout); app.quit();
}
// Do not await app readiness at ESM top level: Electron must finish loading the entry first.
await import('../../dist/main/main.js');
