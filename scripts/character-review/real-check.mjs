// Explicitly authorized subscription-only character smoke, never called by kit.sh / offline checks.
// Planned: initial pair + one referenced edit; at most 8 text turns, no automatic repair.
import { app, dialog } from 'electron';
import { appendFile, chmod, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { CodexAppServer } from '../../dist/main/codexAppServer.js';
import { CreationWorkflowStore, checkpoint } from '../../dist/main/creationWorkflowStore.js';
import { directionArtifact } from '../../dist/main/creationArtifact.js';
import { CreationVersionStore, creationHash } from '../../dist/main/creationVersionStore.js';
const { PNG } = createRequire(import.meta.url)('pngjs');

const reuse=process.env.NOOBI_CHARACTER_REUSE_LATEST==='1',maxText=reuse?4:8,maxImages=reuse?1:3;
if(process.env.NOOBI_APPROVED_CHARACTER_SMOKE!==(reuse?'4-text-1-image-subscription':'8-text-3-images-subscription'))throw new Error('人物真实测试未获明确调用范围授权；未调用模型');
if(process.env.OPENAI_API_KEY)throw new Error('API Key billing is not authorized');
const source=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'auth.json');
const auth=JSON.parse(await readFile(source,'utf8'));
if(auth.auth_mode!=='chatgpt'||auth.OPENAI_API_KEY||!auth.tokens)throw new Error('需要已有 ChatGPT 订阅登录；不自动登录、购买或充值');
const runRoot=resolve('.noobi-private',`character-real-${Date.now()}`);
const data=join(runRoot,'user-data'),authHome=join(data,'codex-home'),folder=join(runRoot,'武侠人物验证');
const evidenceRoot=resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-2');
const evidence=join(evidenceRoot,`修复复验-${Date.now()}`);
let reusedProject=null,baselineEvidence=null,baselineImage=null,scopedEdit=null;
console.log(`本次真实验收证据：${evidence}`);
await mkdir(folder,{recursive:true});await mkdir(evidence,{recursive:true});
if(reuse){
  const previous=JSON.parse(await readFile(join(evidenceRoot,'真实调用检查.json'),'utf8'));
  baselineEvidence=previous.evidenceDirectory;
  baselineImage=previous.scopedEdit?.sourceImage??null;
  await mkdir(data,{recursive:true});
  for(const file of ['creation','image-generation-attestations.json','asset-plans.json'])await cp(join(previous.stateDirectory,file),join(data,file),{recursive:true});
  const projects=JSON.parse(await readFile(join(previous.stateDirectory,'projects.json'),'utf8'));
  assert.equal(projects.projects.length,1);reusedProject=projects.projects[0];
  await cp(reusedProject.root,folder,{recursive:true});reusedProject.root=folder;
  projects.settings.defaultWorkspace=join(data,'projects');
  await writeFile(join(data,'projects.json'),JSON.stringify(projects));
  console.log('复用上一轮真实候选与原始生成凭证；本次只做一次原图修改。');
}
await mkdir(authHome,{recursive:true,mode:0o700});await copyFile(source,join(authHome,'auth.json'));await chmod(join(authHome,'auth.json'),0o600);
app.setAppPath(resolve('.'));process.env.NOOBI_USER_DATA_DIR=data;
delete process.env.NOOBI_DISABLE_GENERATION;delete process.env.NOOBI_SMOKE_CAPTURE;delete process.env.NOOBI_RENDERER_URL;
const records=[],images=[],previewCalls=[],clients=new Set();let closing=false,logicalPhase='初次候选',testWindow=null;
const originalStart=CodexAppServer.prototype.start,originalTurn=CodexAppServer.prototype.startTurn;
CodexAppServer.prototype.start=function(){
  if(!clients.has(this)){
    clients.add(this);
    this.on('serverRequest',request=>{
      if(request.method==='item/tool/call'&&request.params?.tool==='noobi_character_edit_preview')
        previewCalls.push({time:new Date().toISOString(),threadId:request.params.threadId});
    });
    this.on('notification',({method,params})=>{
      const record=[...records].reverse().find(r=>r.threadId===params?.threadId);
      if(record){
        if(method==='thread/tokenUsage/updated')record.usage=params.tokenUsage?.last;
        if(method==='turn/started')record.turnId=params.turn?.id??record.turnId;
        if(method==='item/agentMessage/delta'&&record.firstMs===null)record.firstMs=Date.now()-record.started;
        if(method==='turn/completed'){record.elapsedMs=Date.now()-record.started;record.status=params.turn?.status;}
      }
      if(method==='item/started'&&params?.item?.type==='imageGeneration'){
        images.push({id:params.item.id,started:Date.now(),phase:logicalPhase,status:'started'});
        console.log(`图片任务 ${images.length}/${maxImages}：${logicalPhase}`);
        if(images.length>maxImages)void finish(new Error('图片调用超过本次计划，已停止，不自动重试'));
      }
      if(method==='item/completed'&&params?.item?.type==='imageGeneration'){
        const row=images.find(i=>i.id===params.item.id);if(row){row.status=params.item.status;row.elapsedMs=Date.now()-row.started;}
      }
    });
  }
  return originalStart.call(this);
};
CodexAppServer.prototype.startTurn=async function(options){
  assert.ok(records.length<maxText,'文字调用范围已用完');
  assert.equal(this.status.account?.type,'chatgpt');assert.equal(this.status.account?.planType,'pro');
  const model=options.model??this.status.models.find(m=>m.isDefault)?.model;
  assert.ok(model,'必须记录本次实际选择的模型');
  const record={model,phase:logicalPhase,threadId:options.threadId,turnId:'-',started:Date.now(),usage:null,firstMs:null,elapsedMs:0,status:'started'};
  records.push(record);console.log(`文字处理 ${records.length}/${maxText}：${logicalPhase}，${record.model}`);record.turnId=await originalTurn.call(this,{...options,model:record.model});return record.turnId;
};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});
dialog.showErrorBox=(_title,message)=>{void finish(new Error(message));};
const timeout=setTimeout(()=>{void finish(new Error('人物真实测试超时，停止且不重试'));},20*60_000);
async function finish(error){
  if(closing)return;closing=true;clearTimeout(timeout);
  if(error&&testWindow&&!testWindow.isDestroyed()){await writeFile(join(evidence,'人物-真实失败.png'),(await testWindow.webContents.capturePage()).toPNG()).catch(()=>undefined);}
  for(const runtime of clients)await runtime.stop().catch(()=>undefined);
  const actualTools=[];
  const collect=async dir=>{for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
    const path=join(dir,entry.name);if(entry.isDirectory())await collect(path);
    else if(entry.name.endsWith('.jsonl'))for(const line of (await readFile(path,'utf8')).split('\n')){try{
      const r=JSON.parse(line),p=r.payload??{},code=p.input??p.arguments??'';
      if(r.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)&&typeof code==='string'&&(code.includes('image_gen__imagegen')||code.includes('referenced_image_paths')))
        actualTools.push({time:r.timestamp,tool:p.name,code});
    }catch{}}}};
  await collect(join(authHome,'sessions'));await writeFile(join(evidence,'图片工具实调.json'),JSON.stringify(actualTools,null,2));
  await rm(authHome,{recursive:true,force:true});
  if(!records.length)await writeFile(join(evidence,'启动检查.json'),JSON.stringify({error:error?.message??null,textTurns:0,imageCalls:images.length,authRemoved:true},null,2));
  if(records.length){
    const log=join(evidence,'冒烟记录.md');
    try{await readFile(log);}catch{await writeFile(log,`# 冒烟记录（脚本自动写入，不得手填）\n- 产品：AI2D游戏制作平台\n- 阶段：阶段2-2\n- 模型：OpenAI / ${records[0].model}\n- 说明：现有订阅测试；结构/保存通过与图片外观人工审查分开记录。\n\n| 时间 | 链路 | 请求 ID | 输入 token | 输出 token | 首字耗时 | 总耗时 | 结构校验 | 重试次数 | 结果 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`);}
    for(const row of records){const time=new Date(row.started).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'});
      await appendFile(log,`| ${time} | ${row.phase} | ${row.turnId} | ${row.usage?.inputTokens??'-'} | ${row.usage?.outputTokens??'-'} | ${row.firstMs===null?'-':(row.firstMs/1000).toFixed(2)+'s'} | ${(row.elapsedMs/1000).toFixed(2)}s | ${error?'未通过':'首测合规'} | 0 | ${error?'失败':'通过'} |\n`);}
    await writeFile(join(evidence,'真实调用检查.json'),JSON.stringify({checkedAt:new Date().toISOString(),result:error?'失败':'结构及交互通过，图片质量待查看',error:error?.message??null,evidenceDirectory:evidence,textTurns:records.length,imageCalls:images.length,records,images,previewCalls,authRemoved:true,stateDirectory:data,usedExistingCandidates:reuse,baselineEvidence,scopedEdit},null,2));
    await copyFile(log,join(evidenceRoot,'冒烟记录.md'));
    await copyFile(join(evidence,'真实调用检查.json'),join(evidenceRoot,'真实调用检查.json'));
  }
  console.log(error?error.message:'人物生成与修改链路已完成；请对照图片验收外观保持。');app.exit(error?1:0);
}
app.once('browser-window-created',(_event,win)=>{testWindow=win;win.webContents.once('did-finish-load',()=>{void check(win).then(()=>finish(),finish);});});
async function check(win){
  const run=source=>win.webContents.executeJavaScript(source);
  const wait=async(source,limit=600)=>{for(let i=0;i<limit;i++){if(closing)throw new Error('已停止');if(await run(source))return;await new Promise(r=>setTimeout(r,100));}throw new Error('等待当前人物操作超时');};
  const click=async label=>{await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);};
  const capture=async name=>{win.show();await new Promise(r=>setTimeout(r,350));await writeFile(join(evidence,name),(await win.webContents.capturePage()).toPNG());};
  await wait(`!!document.querySelector('textarea[aria-label="描述你想制作的游戏"]')`);
  const boot=await run('window.noobi.bootstrap()');assert.equal(boot.runtime.account?.type,'chatgpt');assert.equal(boot.runtime.account?.planType,'pro');
  assert.equal(boot.runtime.capabilities.imageGeneration,true,'当前账户没有可用图片能力，停止，不切换付费 API');
  // A fixed approved brief is test input, not a claimed new direction-model output.
  const project=reusedProject??await run(`window.noobi.createProject({idea:'武侠2D俯视打怪：束发剑客、青色或红色长衣、单手长剑、像素风',projectDirectory:${JSON.stringify(folder)},stagedCreation:true},[])`);
  const store=new CreationWorkflowStore(join(data,'creation','records'));
  if(!reuse)await store.change(project.id,s=>{const a=directionArtifact({title:'竹林剑客',genre:'topdown',theme:'武侠竹林',controls:'方向键移动，自动发射剑气',goal:'击败三波敌人',style:'清晰像素风；束发侠客、长衣、单手长剑',scope:['一个主角、一张地图']});s.steps.direction={status:'confirmed',artifact:a,confirmedVersionId:a.id};checkpoint(s,'测试输入：已确认方向');s.currentStage='character';});
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});
  await wait(`!!document.querySelector('.home-project-grid button')`);await run(`document.querySelector('.home-project-grid button').click()`);
  await wait(`!!document.getElementById('creation-history')`);
  const state=async()=>{const r=await run(`window.noobi.creation.get(${JSON.stringify(project.id)})`);assert.equal(r.ok,true);return r.value;};
  if(reuse){
    const old=await state();const baseline=old.history.find(h=>h.stage==='character'&&h.steps.character.status==='awaiting-confirmation'&&h.steps.character.artifact?.selectedCharacterId&&(!baselineImage||h.steps.character.artifact.candidates.some(c=>c.id===h.steps.character.artifact.selectedCharacterId&&c.image===baselineImage)));
    assert.ok(baseline,'缺少可恢复的真实人物基线');
    await run(`(()=>{const e=document.getElementById('creation-history');e.value=${JSON.stringify(baseline.id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('恢复这个版本');await click('确认影响，继续');
    await wait(`document.querySelector('.creation-status')?.textContent==='待确认'`);
  }else{
    await click('开始人物');
    await wait(`document.querySelector('.creation-status')?.textContent==='待确认'||!!document.querySelector('.creation-error')`,6000);
  }
  let first=await state();if(first.error)throw new Error(`人物生成失败：${first.error.message}`);
  await wait(`document.querySelectorAll('.creation-candidates img').length===2&&Array.from(document.querySelectorAll('.creation-candidates img')).every(i=>i.complete&&i.naturalWidth>0)`);
  assert.equal(first.steps.character.artifact.candidates.length,2);assert.equal(first.steps.character.artifact.characterPhase,'candidates');assert.equal(first.steps.scene.status,'idle');
  await capture('人物-真实初稿.png');
  await run(`document.querySelectorAll('.creation-candidates button')[0].click()`);await wait(`document.querySelectorAll('.creation-candidates button')[0].textContent==='已选中'`);
  first=await state();const original=first.steps.character.artifact;
  const baselineCheckpoint=[...first.history].reverse().find(h=>h.steps.character.status==='awaiting-confirmation'&&JSON.stringify(h.steps.character.artifact)===JSON.stringify(original));
  assert.ok(baselineCheckpoint,'恢复目标必须是当前选中的完整人物版本，不能取最近一条失败记录');
  const saved=baselineCheckpoint.id;
  const count=records.length;logicalPhase='选中人物原图编辑';
  await run(`(()=>{const e=document.getElementById('creation-request');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'只把选中人物的衣服改成白色，保留原来的发型、面孔、武器、姿势和视角；另一个候选完全保持不变。');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('发送修改');await wait(`document.querySelector('.creation-status')?.textContent==='制作中'`);
  await wait(`document.querySelector('.creation-status')?.textContent==='待确认'||!!document.querySelector('.creation-error')`,6000);
  const second=await state();if(second.error)throw new Error(`人物修改失败：${second.error.message}`);
  assert.ok(previewCalls.length>0&&previewCalls.length<=3,'制作 AI 必须实际预览最终局部编辑结果');
  const changed=second.steps.character.artifact;const selected=original.selectedCharacterId;
  const other=original.candidates.find(c=>c.id!==selected),before=original.candidates.find(c=>c.id===selected),after=changed.candidates.find(c=>c.id===selected);
  assert.deepEqual(changed.candidates.find(c=>c.id===other.id),other);assert.equal(changed.lockedAssets[other.image],original.lockedAssets[other.image]);assert.notEqual(changed.lockedAssets[after.image],original.lockedAssets[before.image]);
  assert.ok(records.length>count);assert.ok(images.length>0,'没有观察到真实图片生成事件，不能算通过');
  const versions=new CreationVersionStore(join(data,'creation/artifacts'));
  const finalRoot=await versions.root(project.id,changed.snapshotId);
  const oldRoot=await versions.root(project.id,original.snapshotId);
  const proof=JSON.parse(await readFile(join(finalRoot,'.noobi/character-edit-proof.json'),'utf8'));
  const host=JSON.parse(await readFile(join(finalRoot,'.noobi/stage-check.json'),'utf8'));
  assert.equal(host.taskId,second.task.id);assert.equal(proof.taskId,second.task.id);
  assert.equal(host.resultSha256,await creationHash(finalRoot,'.noobi/stage-result.json'));
  assert.equal(proof.outputImage,after.image);assert.equal(proof.changedOutsideRegion,0);
  const a=PNG.sync.read(await readFile(join(oldRoot,before.image))),b=PNG.sync.read(await readFile(join(finalRoot,after.image)));
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  // Independent fixed ROI for this existing top-down sample's head/topknot; not a production mask.
  let changedHeadPixels=0;
  for(let y=0;y<Math.floor(a.height*0.30);y++)for(let x=0;x<a.width;x++){
    const i=(y*a.width+x)*4;if(!a.data.subarray(i,i+4).equals(b.data.subarray(i,i+4)))changedHeadPixels++;
  }
  assert.equal(changedHeadPixels,0,'头顶及发梢区域出现不该发生的像素变化');
  scopedEdit={...proof,changedHeadPixels,currentTaskEvidence:true};
  await writeFile(join(evidence,'局部保护检查.json'),JSON.stringify(scopedEdit,null,2));
  for(const [source,name]of [[proof.inspectionPreview,'人物-白衣检查预览.png'],[proof.maskPreview,'人物-修改范围.png']])await copyFile(join(finalRoot,source),join(evidence,name));
  await click('确认基础人物并保存');await wait(`document.querySelector('.creation-status')?.textContent==='已确认'`);
  const approved=await state();assert.equal(approved.currentStage,'character');assert.equal(approved.steps.scene.status,'idle');
  await capture('人物-真实修改确认.png');const finalCalls=records.length;
  await run(`(()=>{const e=document.getElementById('creation-history');e.value=${JSON.stringify(saved)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('恢复这个版本');await click('确认影响，继续');
  await wait(`document.querySelector('.creation-status')?.textContent==='待确认'`);assert.deepEqual((await state()).steps.character.artifact,original);assert.equal(records.length,finalCalls);
  await capture('人物-真实恢复.png');
  await writeFile(join(evidence,'真实人物样例.md'),`# 人物候选真实测试\n\n${reuse?'复用上一轮真实生成的两个候选及原始凭证，本轮没有重新生成候选。':'本轮真实生成两个候选。'}选择第一个，真实调用图片工具修改白衣，然后确认与恢复。\n\n宿主检查：修改图不同；另一个候选完全不变；本轮检查任务与成果匹配；头顶及发梢区域逐像素不变；确认及恢复无额外生成。\n\n请对照 [初稿](人物-真实初稿.png)、[修改确认](人物-真实修改确认.png)、[恢复](人物-真实恢复.png) 和 [修改范围](人物-修改范围.png)。自动检查通过不代表所有题材和任意局部修改都已验证。\n\n文字处理 ${records.length} 次；图片任务 ${images.length} 次；未自动修复重试。\n`);
}
await import('../../dist/main/main.js');
