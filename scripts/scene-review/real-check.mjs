// Explicit 2-4 acceptance: existing ChatGPT Pro only, no API key or auto repair.
import { app, dialog } from 'electron';
import { copyFile, cp, mkdir, readFile, writeFile, chmod, rm, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { CodexAppServer } from '../../dist/main/codexAppServer.js';
import { CreationWorkflowStore, checkpoint } from '../../dist/main/creationWorkflowStore.js';
import { CreationVersionStore, creationHash } from '../../dist/main/creationVersionStore.js';
import { directionArtifact } from '../../dist/main/creationArtifact.js';
const mode=process.env.NOOBI_SCENE_VIEW??'topdown',isTop=mode==='topdown',reuse=true;
if(process.env.NOOBI_APPROVED_SCENE_SMOKE!=='subscription-only')throw Error('No authorization for real scene test');
if(process.env.OPENAI_API_KEY)throw Error('API billing is not authorized');
const authSource=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'auth.json');
const auth=JSON.parse(await readFile(authSource,'utf8'));
if(auth.auth_mode!=='chatgpt'||auth.OPENAI_API_KEY||!auth.tokens)throw Error('Existing subscription login required');
const root=resolve('.noobi-private/scene-review',`${mode}-${Date.now()}`),data=join(root,'user-data'),folder=join(root,'场景预览'),authHome=join(data,'codex-home');
const evidence=resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-4',`${mode}-${Date.now()}`);
await mkdir(folder,{recursive:true});await mkdir(evidence,{recursive:true});await mkdir(data,{recursive:true});
let project=null;
const previous=JSON.parse(await readFile(resolve('.noobi-private/action-review',`latest-${mode}.json`),'utf8'));assert.equal(previous.passed,true);
for(const file of ['creation','image-generation-attestations.json','asset-plans.json'])await cp(join(previous.stateDirectory,file),join(data,file),{recursive:true,filter:path=>!path.split('/').includes('runs')});
const projects=JSON.parse(await readFile(join(previous.stateDirectory,'projects.json'),'utf8'));assert.equal(projects.projects.length,1);project=projects.projects[0];await cp(project.root,folder,{recursive:true});project.root=folder;projects.settings.defaultWorkspace=join(data,'projects');await writeFile(join(data,'projects.json'),JSON.stringify(projects));
await mkdir(authHome,{recursive:true,mode:0o700});await copyFile(authSource,join(authHome,'auth.json'));await chmod(join(authHome,'auth.json'),0o600);
app.setAppPath(resolve('.'));process.env.NOOBI_USER_DATA_DIR=data;delete process.env.NOOBI_DISABLE_GENERATION;delete process.env.NOOBI_RENDERER_URL;
const maxText=isTop?6:3,maxImages=isTop?2:1,records=[],images=[],clients=new Set(),steps=[];
let phase=isTop?'俯视场景生成':'横版场景生成',closing=false,window=null,baseline=null,finalArtifact=null;
const originalStart=CodexAppServer.prototype.start,originalTurn=CodexAppServer.prototype.startTurn;
CodexAppServer.prototype.start=function(){if(!clients.has(this)){clients.add(this);this.on('notification',({method,params})=>{
 const row=[...records].reverse().find(r=>r.threadId===params?.threadId);
 if(row){if(method==='turn/started')row.turnId=params.turn?.id;if(method==='thread/tokenUsage/updated')row.usage=params.tokenUsage?.last;if(method==='item/agentMessage/delta'&&!row.firstMs)row.firstMs=Date.now()-row.started;if(method==='turn/completed'){row.elapsedMs=Date.now()-row.started;row.status=params.turn?.status;}}
 if(method==='item/started'&&params?.item?.type==='imageGeneration'){images.push({id:params.item.id,phase,started:Date.now(),status:'started'});console.log(`Image ${images.length}/${maxImages} ${phase}`);if(images.length>maxImages)void finish(Error('Image budget exceeded; stopped'));}
 if(method==='item/completed'&&params?.item?.type==='imageGeneration'){const i=images.find(r=>r.id===params.item.id);if(i){i.status=params.item.status;i.elapsedMs=Date.now()-i.started;}}
 });}return originalStart.call(this);};
CodexAppServer.prototype.startTurn=async function(options){assert.ok(records.length<maxText,'Text budget reached');assert.equal(this.status.account?.type,'chatgpt');assert.equal(this.status.account?.planType,'pro');const model=options.model??this.status.models.find(m=>m.isDefault)?.model;assert.ok(model);const row={phase,model,threadId:options.threadId,started:Date.now(),turnId:'pending',status:'started',usage:null,firstMs:null,elapsedMs:0};records.push(row);console.log(`Text ${records.length}/${maxText} ${phase} ${model}`);row.turnId=await originalTurn.call(this,{...options,model});return row.turnId;};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});dialog.showErrorBox=(_t,message)=>void finish(Error(message));
const timeout=setTimeout(()=>void finish(Error('Real test timed out; no auto retry')),20*60_000);
async function finish(error){if(closing)return;closing=true;clearTimeout(timeout);
 if(error&&window&&!window.isDestroyed())await writeFile(join(evidence,'失败界面.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{});
 for(const client of clients)await client.stop().catch(()=>{});
 await rm(join(authHome,'auth.json'),{force:true});
 const result={checkedAt:new Date().toISOString(),mode,passed:!error,error:error?.message??null,stateDirectory:data,projectId:project?.id,evidenceDirectory:evidence,root,textTurns:records.length,imageCalls:images.length,records,images,steps,baseline,finalArtifact,authRemoved:true,reusedGeneratedMaterial:reuse};
 await writeFile(join(evidence,'真实调用检查.json'),JSON.stringify(result,null,2));await writeFile(resolve('.noobi-private/scene-review',`latest-${mode}.json`),JSON.stringify(result,null,2));
 await writeFile(join(evidence,'冒烟记录.md'),`# 冒烟记录（脚本自动写入）\n\n- 模型：OpenAI / ${records[0]?.model??'无调用'}\n现有订阅；无新增付费 API，无自动修复。${mode}。\n\n| 时间 | 链路 | 请求 ID | 输入 token | 输出 token | 首字耗时 | 总耗时 | 结构校验 | 重试次数 | 结果 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`+records.map(r=>`| ${new Date(r.started).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})} | ${r.phase} | ${r.turnId} | ${r.usage?.inputTokens??'-'} | ${r.usage?.outputTokens??'-'} | ${r.firstMs??'-'} ms | ${r.elapsedMs} ms | ${error?'未通过':'通过'} | 0 | ${error?'失败':'通过'} |`).join('\n')+'\n');
 console.log(JSON.stringify({passed:!error,error:error?.message,evidence,text:records.length,images:images.length}));app.exit(error?1:0);
}
async function check(win){window=win;const run=s=>win.webContents.executeJavaScript(s);
 const wait=async(s,limit=600)=>{for(let i=0;i<limit;i++){if(closing)throw Error('Stopped');if(await run(s))return;await new Promise(r=>setTimeout(r,100));}throw Error(`Wait timeout: ${s.slice(0,120)}`);};
 const click=async label=>{await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);};
 const capture=async name=>{win.show();await new Promise(r=>setTimeout(r,200));await writeFile(join(evidence,name),(await win.webContents.capturePage()).toPNG());};
 const state=async()=>{const r=await run(`window.noobi.creation.get(${JSON.stringify(project.id)})`);assert.equal(r.ok,true);return r.value;};
 const idle=async()=>{await wait(`document.querySelector('.creation-status')?.textContent==='待确认'||!!document.querySelector('.creation-error')`,9000);const s=await state();if(s.error)throw Error(s.error.message);assert.equal(s.task.state,'succeeded');return s;};
 const type=async text=>run(`(()=>{const e=document.getElementById('creation-request');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await wait(`!!document.querySelector('.home-project-grid button')`);const boot=await run('window.noobi.bootstrap()');assert.equal(boot.runtime.account?.planType,'pro');assert.equal(boot.runtime.capabilities.imageGeneration,true);
 await run(`document.querySelector('.home-project-grid button').click()`);await wait(`!!document.getElementById('creation-history')`);
 let s=await state();baseline=s.steps.character.artifact;assert.equal(s.steps.character.status,'confirmed');assert.equal(baseline.characterPhase,'actions');assert.equal(records.length,0);
 await capture('01-已确认人物.png');await click('开始制作场景');await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);s=await idle();
 const versions=new CreationVersionStore(join(data,'creation/artifacts'));const originalRoot=await versions.root(project.id,baseline.snapshotId);
 async function verifyScene(state){const a=state.steps.scene.artifact;assert.ok(a.scene);assert.equal(state.currentStage,'scene');assert.equal(state.steps.playable.status,'idle');assert.deepEqual(state.steps.character.artifact,baseline);for(const [p,h]of Object.entries(baseline.lockedAssets))assert.equal(a.lockedAssets[p],h);
  const r=await versions.root(project.id,a.snapshotId);assert.equal(await creationHash(r,baseline.actions.manifest),await creationHash(originalRoot,baseline.actions.manifest));const check=JSON.parse(await readFile(join(r,'artifacts/engine/scene-latest.json'),'utf8'));assert.equal(check.ok,true);assert.equal(check.taskId,state.task.id);assert.ok(check.observed.states.scene);return {artifact:a,root:r};}
 let first=await verifyScene(s);assert.equal(images.length,1);await wait(`!!document.querySelector('iframe')`);await new Promise(r=>setTimeout(r,3500));await run(`document.querySelector('iframe').scrollIntoView({block:'center'})`);await capture('02-首版场景.png');await copyFile(join(first.root,first.artifact.scene.background),join(evidence,'首版场景底图.png'));steps.push('真实AI场景接入原人物，真实引擎动作检查通过');
 if(isTop){phase='竹林改成雪山';await type('把背景改成雪山脚下的开阔雪地，远处有松树和雪山。保持原来的俯视角、人物大小、发型、衣服、武器、所有动作及操作完全不变，只替换背景。');await click('发送修改');await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);s=await idle();const edited=await verifyScene(s);assert.equal(images.length,2);assert.notEqual(edited.artifact.scene.background,first.artifact.scene.background);assert.notEqual(edited.artifact.lockedAssets[edited.artifact.scene.background],first.artifact.lockedAssets[first.artifact.scene.background]);await copyFile(join(edited.root,edited.artifact.scene.background),join(evidence,'修改后场景底图.png'));steps.push('真实背景替换，人物及动作文件完全保持');}
 await click('确认场景并保存');await wait(`document.querySelector('.creation-status')?.textContent==='已确认'`);const saved=await state();assert.equal(saved.currentStage,'scene');assert.equal(saved.steps.playable.status,'idle');const savedCheckpoint=[...saved.history].reverse().find(h=>h.stage==='scene'&&h.steps.scene.status==='confirmed'&&h.steps.scene.artifact?.id===saved.steps.scene.artifact.id);assert.ok(savedCheckpoint);const firstCheckpoint=saved.history.find(h=>h.stage==='scene'&&h.steps.scene.artifact?.id===first.artifact.id);assert.ok(firstCheckpoint);const calls=records.length;
 async function restore(id){await run(`(()=>{const e=document.getElementById('creation-history');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('恢复这个版本');await click('确认影响，继续');await new Promise(r=>setTimeout(r,300));}
 await restore(firstCheckpoint.id);assert.deepEqual((await state()).steps.scene.artifact,first.artifact);await restore(savedCheckpoint.id);assert.deepEqual((await state()).steps.scene,saved.steps.scene);assert.equal(records.length,calls);steps.push('场景确认、历史恢复通过，无新调用，未进入玩法');
 finalArtifact=(await state()).steps.scene.artifact;await wait(`!!document.querySelector('iframe')`);await new Promise(r=>setTimeout(r,3000));await run(`document.querySelector('iframe').scrollIntoView({block:'center'})`);await capture('03-确认恢复场景.png');await writeFile(join(evidence,'最终状态.json'),JSON.stringify(await state(),null,2));
}
app.once('browser-window-created',(_e,win)=>win.webContents.once('did-finish-load',()=>void check(win).then(()=>finish(),finish)));
console.log(JSON.stringify({root,data,evidence,mode}));await import('../../dist/main/main.js');
