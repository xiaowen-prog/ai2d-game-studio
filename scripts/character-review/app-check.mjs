// Actual desktop/IPC integration with an explicitly offline seeded candidate pair.
import { app, dialog } from 'electron';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { CreationWorkflowStore, creationId } from '../../dist/main/creationWorkflowStore.js';
import { CreationWorkflowService } from '../../dist/main/creationWorkflowService.js';
import { CreationVersionStore } from '../../dist/main/creationVersionStore.js';
import { offlineCharacterGenerator } from '../../.noobi-private/character-review/fixtures.mjs';
const scratch=await mkdtemp(join(tmpdir(),'noobi-character-app-'));
const data=join(scratch,'user-data');const folder=join(scratch,'project');await mkdir(folder);
app.setAppPath(resolve('.'));process.env.NOOBI_USER_DATA_DIR=data;process.env.NOOBI_DISABLE_GENERATION='1';
delete process.env.NOOBI_SMOKE_CAPTURE;delete process.env.NOOBI_RENDERER_URL;
const evidence=resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-2');
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});
const timeout=setTimeout(()=>{console.error('Character desktop check timed out');app.exit(1);},55_000);
dialog.showErrorBox=(_title,message)=>{console.error(message);app.exit(1);};
app.once('browser-window-created',(_event,win)=>{
  win.webContents.once('did-finish-load',()=>{void check(win).catch(error=>{console.error(error.message);clearTimeout(timeout);app.exit(1);});});
});
async function check(win){
  const run=source=>win.webContents.executeJavaScript(source);
  const wait=async source=>{for(let i=0;i<400;i++){if(await run(source))return;await new Promise(r=>setTimeout(r,50));}throw new Error(`Desktop condition timed out: ${source}`);};
  await wait(`!!document.querySelector('[aria-label="首次使用指引"]')`);
  const project=await run(`window.noobi.createProject({idea:'人物候选 · 离线桌面验收',projectDirectory:${JSON.stringify(folder)},stagedCreation:true},[])`);
  const store=new CreationWorkflowStore(join(data,'creation','records'));
  const versions=new CreationVersionStore(join(data,'creation','artifacts'));
  const fixture=offlineCharacterGenerator(join(scratch,'fixture'),versions);
  const seeded=new CreationWorkflowService({store,generator:fixture});
  let state=await seeded.get(project.id);
  for(const action of ['run','confirm']){await seeded.act({projectId:project.id,operationId:creationId(),expectedRevision:state.revision,versionId:state.steps.direction.artifact?.id,action});await seeded.idle(project.id);state=await seeded.get(project.id);}
  await win.webContents.reload();await wait(`!!document.querySelector('.home-project-grid button')`);
  await run(`document.querySelector('.home-project-grid button').click()`);
  await wait(`document.querySelectorAll('.creation-candidates img').length===2&&Array.from(document.querySelectorAll('.creation-candidates img')).every(i=>i.complete&&i.naturalWidth>0)`);
  await run(`document.querySelectorAll('.creation-candidates button')[0].click()`);
  await wait(`document.querySelectorAll('.creation-candidates button')[0].textContent==='已选中'`);
  await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='确认基础人物并保存').click()`);
  await wait(`document.querySelector('.creation-status')?.textContent==='已确认'`);
  const confirmed=(await run(`window.noobi.creation.get(${JSON.stringify(project.id)})`)).value;
  assert.equal(confirmed.currentStage,'character');assert.equal(confirmed.steps.character.artifact.selectedCharacterId,'a');assert.equal(confirmed.steps.scene.status,'idle');
  assert.equal(confirmed.steps.character.confirmedVersionId,confirmed.steps.character.artifact.id);assert.equal(fixture.calls,2);
  await mkdir(evidence,{recursive:true});win.show();await new Promise(r=>setTimeout(r,350));
  await writeFile(join(evidence,'人物候选-实际桌面-离线.png'),(await win.webContents.capturePage()).toPNG());
  const reply=await run(`window.noobi.creation.act(${JSON.stringify({projectId:project.id,operationId:creationId(),expectedRevision:confirmed.revision,action:'revise',stage:'character',impactAccepted:true,prompt:'衣服改白'})})`);
  assert.equal(reply.ok,true);
  let failed;
  for(let i=0;i<100;i++){failed=(await run(`window.noobi.creation.get(${JSON.stringify(project.id)})`)).value;if(failed.error)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(failed.error.code,'GENERATION_DISABLED');assert.deepEqual(failed.steps.character.artifact,confirmed.steps.character.artifact);
  const disk=JSON.parse(await readFile(join(data,'creation','records',`${project.id}.json`),'utf8'));
  assert.equal(disk.steps.character.artifact.selectedCharacterId,'a');assert.equal(disk.steps.character.artifact.snapshotId,confirmed.steps.character.artifact.snapshotId);
  await writeFile(join(evidence,'桌面入口检查.json'),JSON.stringify({checkedAt:new Date().toISOString(),mode:'actual Electron app and IPC; offline seeded images; generation disabled',realModelCalls:0,results:['实际桌面读取两张离线候选及真实快照预览','实际按钮选择人物并保存，未调用生成','确认基础人物后停在 character，场景 idle','禁用生成时修改明确失败，旧图片仍保留','私有保存记录中的选择和图片版本一致']},null,2));
  console.log('人物实际桌面检查通过：5 项；真实模型 0 次。');clearTimeout(timeout);app.quit();
}
await import('../../dist/main/main.js');
