// Reopen the latest real run with generation disabled; no fixture images or model calls.
import { app, dialog } from 'electron';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CodexAppServer } from '../../dist/main/codexAppServer.js';
import { CreationVersionStore } from '../../dist/main/creationVersionStore.js';
const { PNG } = createRequire(import.meta.url)('pngjs');

const evidence = resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-2');
const latest = JSON.parse(await readFile(join(evidence, '真实调用检查.json'), 'utf8'));
const records = join(latest.stateDirectory, 'creation/records');
const files = (await readdir(records)).filter(name => name.endsWith('.json'));
assert.equal(files.length, 1);
const before = JSON.parse(await readFile(join(records, files[0]), 'utf8'));
let modelCalls = 0;
CodexAppServer.prototype.startTurn = async () => { modelCalls++; throw new Error('重开检查禁止模型调用'); };
app.setAppPath(resolve('.'));
process.env.NOOBI_USER_DATA_DIR = latest.stateDirectory;
process.env.NOOBI_DISABLE_GENERATION = '1';
delete process.env.NOOBI_SMOKE_CAPTURE;
delete process.env.NOOBI_RENDERER_URL;
const timeout = setTimeout(() => { console.error('真实保存复核超时'); app.exit(1); }, 55_000);
dialog.showErrorBox = (_title, message) => { console.error(message); app.exit(1); };
app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => { void check(win).catch(error => {
    console.error(error.message); clearTimeout(timeout); app.exit(1);
  }); });
});
async function check(win) {
  const run = source => win.webContents.executeJavaScript(source);
  const wait = async source => {
    for (let i = 0; i < 400; i++) {
      if (await run(source)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`保存复核未满足：${source}`);
  };
  await wait(`!!document.querySelector('.home-project-grid button')`);
  await run(`document.querySelector('.home-project-grid button').click()`);
  await wait(`!!document.querySelector('.creation-status')`);
  const reply = await run(`window.noobi.creation.get(${JSON.stringify(before.projectId)})`);
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.value.steps, before.steps);
  assert.equal(reply.value.currentStage, 'character');
  assert.equal(reply.value.steps.scene.status, 'idle');
  assert.deepEqual(reply.value.error, before.error);
  const artifact = before.steps.character.artifact;
  if (artifact) {
    await wait(`document.querySelectorAll('.creation-candidates img').length===2&&Array.from(document.querySelectorAll('.creation-candidates img')).every(i=>i.complete&&i.naturalWidth>0)`);
    assert.equal(await run(`document.querySelectorAll('.creation-candidates button').length`), 2);
  } else {
    assert.equal(await run(`document.querySelector('.creation-error')?.textContent.includes(${JSON.stringify(before.error.message)})`), true);
    assert.equal(await run(`document.body.textContent.includes('人物制作失败')`), true);
  }
  assert.equal(modelCalls, 0);
  if (latest.scopedEdit) {
    const proof = latest.scopedEdit;
    const edited = before.history.map(h => h.steps.character.artifact).find(a => a?.candidates.some(c => c.image === proof.outputImage));
    assert.ok(edited?.snapshotId, '真实修改及确认的历史版本必须保留');
    const root = await new CreationVersionStore(join(latest.stateDirectory, 'creation/artifacts')).root(before.projectId, edited.snapshotId);
    const a = PNG.sync.read(await readFile(join(root, proof.sourceImage)));
    const b = PNG.sync.read(await readFile(join(root, proof.outputImage)));
    const regions = JSON.parse(await readFile(join(root, '.noobi/character-edit-region.json'), 'utf8'));
    const exactMask = regions.maskImage ? PNG.sync.read(await readFile(join(root, regions.maskImage))) : null;
    if (exactMask) { assert.equal(exactMask.width, a.width); assert.equal(exactMask.height, a.height); }
    // Independent point-in-polygon check, not the product's scanline compositor.
    const inside = (x, y, polygon) => {
      let value = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) value = !value;
      }
      return value;
    };
    let changedOutsideRegion = 0, changedInsideRegion = 0;
    assert.equal(a.width, b.width); assert.equal(a.height, b.height);
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data.subarray(i, i + 4).equals(b.data.subarray(i, i + 4))) continue;
      const px = (x + 0.5) * 1000 / a.width, py = (y + 0.5) * 1000 / a.height;
      const allowed = regions.editPolygons.some(p => inside(px, py, p)) && !regions.preservePolygons.some(p => inside(px, py, p)) && (!exactMask || exactMask.data[i] === 255);
      if (allowed) changedInsideRegion++; else changedOutsideRegion++;
    }
    assert.equal(changedOutsideRegion, 0); assert.ok(changedInsideRegion > 0);
    await writeFile(join(evidence, '独立像素复核.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
      source: latest.evidenceDirectory, changedOutsideRegion, changedInsideRegion, realModelCalls: 0,
      method: 'Independent point-in-polygon comparison of original and saved final RGBA pixels' }, null, 2));
  }
  win.show(); await new Promise(resolve => setTimeout(resolve, 350));
  await writeFile(join(latest.evidenceDirectory, '人物-真实重开.png'), (await win.webContents.capturePage()).toPNG());
  await writeFile(join(evidence, '真实保存复核.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), mode: 'reopened actual Electron app with latest real-generated data; generation disabled',
    realModelCalls: modelCalls, source: latest.evidenceDirectory,
    results: ['实际应用重新启动，原方向、人物成果及确认状态与磁盘一致', artifact ? '两张真实人物图片重新加载成功，选择未改变' : '真实失败原因重新显示，没有误导为账户问题', '场景仍未开始，未越过人物节点', '全程零模型调用'],
  }, null, 2));
  console.log('真实保存复核通过：4 项，新增模型调用 0 次。');
  clearTimeout(timeout); app.quit();
}
await import('../../dist/main/main.js');
