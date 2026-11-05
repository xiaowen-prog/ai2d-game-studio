// Explicit offline fixtures. No account, Codex runtime or network model is imported here.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreationWorkflow } from '../../src/shared/creation.js';
import { directionArtifact, readCreationArtifact } from '../../src/main/creationArtifact.js';
import { CreationVersionStore } from '../../src/main/creationVersionStore.js';
import { CreationError } from '../../src/main/creationWorkflowStore.js';
const { PNG } = createRequire(import.meta.url)('pngjs');

export function fixtureImage(variant: number, white = false): Buffer {
  const png = new PNG({ width: 320, height: 360 }); png.data.fill(0);
  const rect = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let yy=y;yy<y+h;yy++) for (let xx=x;xx<x+w;xx++) { const i=(yy*320+xx)*4; png.data[i]=color[0];png.data[i+1]=color[1];png.data[i+2]=color[2];png.data[i+3]=255; }
  };
  const cloth=white?[230,230,219]:variant===0?[49,119,150]:[165,71,61];
  rect(132,70,56,25,[43,43,40]); if(variant===0)rect(151,50,24,23,[43,43,40]);
  rect(139,95,43,44,[223,179,139]);rect(169,108,6,6,[33,32,30]);
  rect(126,144,70,100,cloth);rect(108,154,18,62,cloth);rect(196,154,18,62,cloth);
  rect(124,244,28,52,[46,57,59]);rect(171,244,28,52,[46,57,59]);
  rect(116,296,38,12,[35,37,38]);rect(170,296,38,12,[35,37,38]);
  rect(126,214,70,12,[210,176,85]);rect(228,122,8,126,[170,183,186]);rect(215,240,34,8,[191,151,76]);rect(228,248,8,27,[68,55,41]);
  return PNG.sync.write(png);
}

export function offlineCharacterGenerator(data: string, versions: CreationVersionStore) {
  let calls=0;
  return { get calls(){ return calls; }, async generate(state: CreationWorkflow, signal: AbortSignal) {
    calls++; await new Promise(r=>setTimeout(r,250)); signal.throwIfAborted();
    const prompt=state.task?.prompt ?? '';
    if(prompt.includes('模拟失败'))throw new CreationError('OFFLINE_FAILURE','离线模拟失败：原来的人物保留，可以重试或恢复。');
    if(state.currentStage==='direction')return directionArtifact({title:'竹林剑客 · 离线示例',genre:state.idea.includes('横版')?'platformer':'topdown',theme:'武侠竹林',controls:'方向键移动',goal:'击败敌人',style:'清晰像素',scope:['一个主角、一张地图']});
    if(state.idea.includes('模拟未出图'))throw new CreationError('CHARACTER_NOT_GENERATED','AI 这次没有生成人物图片。已确认的方向和历史版本仍保留，可以重试人物制作。');
    const source=join(data,'source');await mkdir(source,{recursive:true});
    const root=await versions.prepare(state.projectId,state.task!.id,source,state.workingSnapshotId);
    await mkdir(join(root,'.noobi'),{recursive:true});await mkdir(join(root,'public/assets/images'),{recursive:true});
    const prior=state.steps.character.artifact;
    const selected=prior?.selectedCharacterId ?? null;
    const candidates=prior?structuredClone(prior.candidates):[
      {id:'a',name:'青衣剑客 · 示例',description:'束发、青衣、长剑',image:'public/assets/images/a.png'},
      {id:'b',name:'红衣剑客 · 示例',description:'短发、红衣、长剑',image:'public/assets/images/b.png'},
    ];
    if(!prior)for(let i=0;i<2;i++)await writeFile(join(root,candidates[i].image),fixtureImage(i));
    if(selected){const i=candidates.findIndex(c=>c.id===selected);const c=candidates[i];
      c.image=`public/assets/images/${selected}-${state.task!.id}.png`;c.description='白衣，原发型与长剑保留（离线示例）';
      await writeFile(join(root,c.image),fixtureImage(i,true));}
    await writeFile(join(root,'.noobi/stage-result.json'),JSON.stringify({title:'人物候选 · 离线示例',summary:'以下图片由测试脚本绘制，仅检查交互，不是 AI 生成效果。',changes:selected?['衣服改白，另一个候选保留（离线示例）']:[],ready:false,candidates,selectedCharacterId:selected,media:[],lockedAssets:[]}));
    const artifact=await readCreationArtifact(root,state,async()=>true,true);
    artifact.checks=['离线预置图片，不具备真实生成凭证，不作为 AI 验收'];
    artifact.snapshotId=await versions.save(state.projectId,root);signal.throwIfAborted();return artifact;
  }};
}
