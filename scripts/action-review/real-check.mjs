// Explicit 2-3 acceptance: existing ChatGPT Pro only, no API key or auto repair.
import { app, dialog } from 'electron';
import { copyFile, cp, mkdir, readFile, writeFile, chmod, rm, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { CodexAppServer } from '../../dist/main/codexAppServer.js';
import { CreationWorkflowStore, checkpoint } from '../../dist/main/creationWorkflowStore.js';
import { CreationVersionStore, creationHash } from '../../dist/main/creationVersionStore.js';
import { directionArtifact } from '../../dist/main/creationArtifact.js';
const mode=process.env.NOOBI_ACTION_VIEW??'topdown',isTop=mode==='topdown',reuse=process.env.NOOBI_ACTION_REUSE==='1';
if(process.env.NOOBI_APPROVED_ACTION_SMOKE!=='subscription-only')throw Error('No authorization for real action test');
if(process.env.OPENAI_API_KEY)throw Error('API billing is not authorized');
const authSource=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'auth.json');
const auth=JSON.parse(await readFile(authSource,'utf8'));
if(auth.auth_mode!=='chatgpt'||auth.OPENAI_API_KEY||!auth.tokens)throw Error('Existing subscription login required');
const root=resolve('.noobi-private/action-review',`${mode}-${Date.now()}`),data=join(root,'user-data'),folder=join(root,'人物动作'),authHome=join(data,'codex-home');
const evidence=resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-3',`${mode}-${Date.now()}`);
await mkdir(folder,{recursive:true});await mkdir(evidence,{recursive:true});await mkdir(data,{recursive:true});
let project=null;
if(isTop||reuse){
 const previous=JSON.parse(await readFile(reuse?resolve('.noobi-private/action-review',`latest-${mode}.json`):resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-2/真实调用检查.json'),'utf8'));
 for(const file of ['creation','image-generation-attestations.json','asset-plans.json'])await cp(join(previous.stateDirectory,file),join(data,file),{recursive:true});
 const projects=JSON.parse(await readFile(join(previous.stateDirectory,'projects.json'),'utf8'));assert.equal(projects.projects.length,1);project=projects.projects[0];await cp(project.root,folder,{recursive:true});project.root=folder;projects.settings.defaultWorkspace=join(data,'projects');await writeFile(join(data,'projects.json'),JSON.stringify(projects));
 if(reuse){const store=new CreationWorkflowStore(join(data,'creation/records'));const old=await store.get(project.id);assert.equal(old.task.state,'failed');const versions=new CreationVersionStore(join(data,'creation/artifacts'));const saved=await versions.save(project.id,join(data,'creation/artifacts',project.id,'runs',old.task.id));await store.change(project.id,s=>{s.workingSnapshotId=saved;});}
}
await mkdir(authHome,{recursive:true,mode:0o700});await copyFile(authSource,join(authHome,'auth.json'));await chmod(join(authHome,'auth.json'),0o600);
app.setAppPath(resolve('.'));process.env.NOOBI_USER_DATA_DIR=data;delete process.env.NOOBI_DISABLE_GENERATION;delete process.env.NOOBI_RENDERER_URL;
const maxText=isTop?6:6,maxImages=reuse?(isTop?0:1):(isTop?1:3),records=[],images=[],clients=new Set(),steps=[];
let phase=isTop?'俯视人物动作':'横版基础人物',closing=false,window=null,baseline=null,finalArtifact=null;
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
 await writeFile(join(evidence,'真实调用检查.json'),JSON.stringify(result,null,2));await writeFile(resolve('.noobi-private/action-review',`latest-${mode}.json`),JSON.stringify(result,null,2));
 await writeFile(join(evidence,'冒烟记录.md'),`# 冒烟记录（脚本自动写入）\n\n- 模型：OpenAI / ${records[0]?.model??'无调用'}\n现有订阅；无新增付费 API，无自动修复。${mode}。\n\n| 时间 | 链路 | 请求 ID | 输入 token | 输出 token | 首字耗时 | 总耗时 | 结构校验 | 重试次数 | 结果 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`+records.map(r=>`| ${new Date(r.started).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})} | ${r.phase} | ${r.turnId} | ${r.usage?.inputTokens??'-'} | ${r.usage?.outputTokens??'-'} | ${r.firstMs??'-'} ms | ${r.elapsedMs} ms | ${error?'未通过':'通过'} | 0 | ${error?'失败':'通过'} |`).join('\n')+'\n');
 console.log(JSON.stringify({passed:!error,error:error?.message,evidence,text:records.length,images:images.length}));app.exit(error?1:0);
}
async function check(win){window=win;const run=s=>win.webContents.executeJavaScript(s);
 const wait=async(s,limit=600)=>{for(let i=0;i<limit;i++){if(closing)throw Error('Stopped');if(await run(s))return;await new Promise(r=>setTimeout(r,100));}throw Error(`Wait timeout: ${s.slice(0,100)}`);};
 const click=async label=>{await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);};
 const capture=async name=>{win.show();await new Promise(r=>setTimeout(r,250));await writeFile(join(evidence,name),(await win.webContents.capturePage()).toPNG());};
 const state=async()=>{const r=await run(`window.noobi.creation.get(${JSON.stringify(project.id)})`);assert.equal(r.ok,true);return r.value;};
 const idle=async()=>{await wait(`document.querySelector('.creation-status')?.textContent==='待确认'||!!document.querySelector('.creation-error')`,9000);const s=await state();if(s.error)throw Error(s.error.message);return s;};
 await wait(`!!document.querySelector('textarea[aria-label="描述你想制作的游戏"]')`);const boot=await run('window.noobi.bootstrap()');assert.equal(boot.runtime.account?.planType,'pro');assert.equal(boot.runtime.capabilities.imageGeneration,true);
 if(!project){project=await run(`window.noobi.createProject({idea:'2D横版跳跃，蓝色短发探险女孩，黄色短外套，像素风',projectDirectory:${JSON.stringify(folder)},stagedCreation:true},[])`);const store=new CreationWorkflowStore(join(data,'creation/records'));await store.change(project.id,s=>{const a=directionArtifact({title:'林间探险',genre:'platformer',theme:'轻松探险',controls:'A/D移动，空格跳跃',goal:'抵达终点',style:'侧面完整全身像素风；蓝色短发、黄色短外套、深色长裤',scope:['一名主角，一个小关卡']});s.steps.direction={status:'confirmed',artifact:a,confirmedVersionId:a.id};checkpoint(s,'固定验收方向输入，非本轮AI产物');s.currentStage='character';});}
 await new Promise(r=>{win.webContents.once('did-finish-load',r);win.webContents.reload();});await wait(`!!document.querySelector('.home-project-grid button')`);await run(`document.querySelector('.home-project-grid button').click()`);await wait(`!!document.getElementById('creation-history')`);
 if(!isTop){if(reuse){await run(`(()=>{const e=document.getElementById('creation-request');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'复用工作区已有的两张真实横版候选，不重新生图；补齐人物清单，重新检查。');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('发送修改');}else await click('开始人物');await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);await idle();await wait(`document.querySelectorAll('.creation-candidates img').length===2`);await run(`document.querySelectorAll('.creation-candidates button')[0].click()`);}
 let s=await state();assert.equal(s.steps.character.artifact.characterPhase,'candidates');assert.ok(s.steps.character.artifact.selectedCharacterId);
 if(!(reuse&&isTop)){if(s.steps.character.status!=='confirmed')await click('确认基础人物并保存');await wait(`document.querySelector('.creation-status')?.textContent==='已确认'`);}
 baseline=(await state()).steps.character.artifact;phase=isTop?'俯视人物动作':'横版人物动作';await capture('01-基础人物.png');if(reuse&&isTop){await run(`(()=>{const e=document.getElementById('creation-request');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'复用工作区已有真实动作图集、资源和预览，不重新生图。检查动作清单并更新为当前任务编号；图集1774×887，4×2格443×443，余边仅透明像素和1/255透明噪点。保持实际人物、操作及三种动作。上一轮动作实际播放与人物一致性已通过；预览缺少中文字体，请把Godot画布内所有文字改成短英文（Idle/Walk/Attack、WASD/J、Original），中文说明留在宿主界面，避免缺字；不要下载字体。');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('发送修改');}else await click('制作人物动作');await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);s=await idle();
 let a=s.steps.character.artifact;assert.equal(a.characterPhase,'actions');assert.deepEqual(a.candidates,baseline.candidates);for(const c of baseline.candidates)assert.equal(a.lockedAssets[c.image],baseline.lockedAssets[c.image]);assert.equal(s.steps.scene.status,'idle');
 const versions=new CreationVersionStore(join(data,'creation/artifacts'));let artifactRoot=await versions.root(project.id,a.snapshotId);let manifest=JSON.parse(await readFile(join(artifactRoot,'.noobi/character-actions.json'),'utf8'));
 const native=JSON.parse(await readFile(join(artifactRoot,'artifacts/engine/actions-latest.json'),'utf8'));assert.equal(native.ok,true);assert.equal(native.taskId,s.task.id);assert.ok(reuse&&isTop||images.some(i=>i.phase===phase));
 await wait(`!!document.querySelector('.creation-playable iframe')||!!document.querySelector('iframe')`);await new Promise(r=>setTimeout(r,5000));await capture('02-动作预览.png');
 await copyFile(join(artifactRoot,manifest.spriteSheet),join(evidence,'动作图集.png'));await copyFile(join(artifactRoot,manifest.sourceCharacter.path),join(evidence,'原人物.png'));await copyFile(join(artifactRoot,'artifacts/engine/actions-latest.json'),join(evidence,'动作实际检查.json'));
 steps.push('真实AI动作与实际Godot按键检查通过');const originalActions=a,originalManifest=manifest;const beforeImages=images.length;
 if(isTop){
  phase='走路速度修改';await run(`(()=>{const e=document.getElementById('creation-request');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'只把走路动画播放速度降低一半，移动速度保持不变，其他动作和人物外观完全不变；复用现有动作图集，不要重新生图。');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('发送修改');await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);s=await idle();a=s.steps.character.artifact;artifactRoot=await versions.root(project.id,a.snapshotId);manifest=JSON.parse(await readFile(join(artifactRoot,'.noobi/character-actions.json'),'utf8'));
  assert.equal(images.length,beforeImages);assert.equal(a.lockedAssets[manifest.spriteSheet],originalActions.lockedAssets[originalManifest.spriteSheet]);assert.equal(manifest.animations.find(x=>x.name==='walk').fps,originalManifest.animations.find(x=>x.name==='walk').fps/2);for(const name of ['idle','attack'])assert.deepEqual(manifest.animations.find(x=>x.name===name),originalManifest.animations.find(x=>x.name===name));steps.push('速度修改复用原图，其他动作保持');
 }
 await click('确认人物动作并保存');await wait(`document.querySelector('.creation-status')?.textContent==='已确认'`);const saved=await state();assert.equal(saved.currentStage,'character');assert.equal(saved.steps.scene.status,'idle');const savedCheckpoint=saved.history.find(h=>h.steps.character.status==='confirmed'&&h.steps.character.artifact?.id===a.id);assert.ok(savedCheckpoint);await capture('03-确认保存.png');const count=records.length;
 await click('返回修改人物形象');await click('确认影响，继续');await wait(`document.querySelector('.creation-status')?.textContent==='待确认'`);assert.equal((await state()).steps.character.artifact.characterPhase,'candidates');
 await run(`(()=>{const e=document.getElementById('creation-history');e.value=${JSON.stringify(savedCheckpoint.id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('恢复这个版本');await click('确认影响，继续');await wait(`document.querySelector('.creation-status')?.textContent==='已确认'`);assert.deepEqual((await state()).steps.character,saved.steps.character);assert.equal(records.length,count);steps.push('动作确认、返回形象及恢复通过，无额外模型调用');
 finalArtifact=(await state()).steps.character.artifact;await capture('04-恢复动作.png');await writeFile(join(evidence,'最终状态.json'),JSON.stringify(await state(),null,2));
}
app.once('browser-window-created',(_e,win)=>win.webContents.once('did-finish-load',()=>void check(win).then(()=>finish(),finish)));
console.log(JSON.stringify({root,data,evidence,mode}));await import('../../dist/main/main.js');
