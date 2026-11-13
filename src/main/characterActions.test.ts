import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readCharacterActions, characterActionControls, type CharacterActionManifest } from './characterActionInspection.js';
import { CreationWorkflowStore, newCreation, creationId } from './creationWorkflowStore.js';
import { CreationWorkflowService } from './creationWorkflowService.js';
import { directionArtifact } from './creationArtifact.js';
import { creationHash } from './creationVersionStore.js';
import type { CreationArtifact, CreationAction, CreationWorkflow } from '../shared/creation.js';
const { PNG } = createRequire(import.meta.url)('pngjs');
const brief = { title:'剑客', genre:'topdown' as const, theme:'武侠', controls:'移动攻击', goal:'打怪', style:'像素', scope:['一人'] };
const source = 'public/assets/images/a.png', sheet = 'public/assets/images/actions.png';
function base(): CreationArtifact { return {...directionArtifact(brief),stage:'character',direction:undefined,characterPhase:'candidates',snapshotId:'snapshot',ready:true,selectedCharacterId:'a',candidates:[{id:'a',name:'青衣',image:source},{id:'b',name:'红衣',image:'public/assets/images/b.png'}],lockedAssets:{[source]:'a'.repeat(64),'public/assets/images/b.png':'b'.repeat(64)}}; }
function actions(): CreationArtifact { return {...base(),characterPhase:'actions',actions:{manifest:'.noobi/character-actions.json',states:[{id:'idle',label:'待机',key:'松开'},{id:'walk',label:'移动',key:'WASD'},{id:'attack',label:'攻击',key:'J'}]},media:[{kind:'animation',path:'resources/actions.tres',label:'人物动作'}]}; }
describe('2-3 action state boundaries',()=>{
 let root:string,store:CreationWorkflowStore,service:CreationWorkflowService;
 const generate=vi.fn<(s:CreationWorkflow)=>Promise<CreationArtifact>>();
 beforeEach(async()=>{
  root=await mkdtemp(join(tmpdir(),'action-state-'));store=new CreationWorkflowStore(root);generate.mockReset().mockResolvedValue(actions());
  service=new CreationWorkflowService({store,generator:{generate},characterActionsEnabled:true,lastEnabledStage:'character'});await service.create('project','剑客');
  await store.change('project',s=>{const d=directionArtifact(brief);s.steps.direction={status:'confirmed',artifact:d,confirmedVersionId:d.id};s.currentStage='character';s.steps.character={status:'awaiting-confirmation',artifact:base(),confirmedVersionId:null};});
 });
 afterEach(async()=>{await service.stopAll();await rm(root,{recursive:true,force:true});});
 async function act(input:Partial<CreationAction>&Pick<CreationAction,'action'>){const s=(await service.get('project'))!;await service.act({projectId:'project',expectedRevision:s.revision,operationId:creationId(),versionId:s.steps.character.artifact?.id,...input});await service.idle('project');return (await service.get('project'))!;}
 it('base confirmation is free; animate uses action task; action approval stops before scene',async()=>{
  await act({action:'confirm'});expect(generate).not.toHaveBeenCalled();const made=await act({action:'animate'});
  expect(generate.mock.calls[0][0].task?.characterPhase).toBe('actions');expect(made.steps.character.artifact?.characterPhase).toBe('actions');
  const saved=await act({action:'confirm'});expect(saved.currentStage).toBe('character');expect(saved.steps.scene.status).toBe('idle');expect(generate).toHaveBeenCalledTimes(1);
  expect(await new CreationWorkflowStore(root).get('project')).toEqual(saved);
 });
 it('failed first action generation retains candidates and retries actions rather than repainting candidates',async()=>{
  const old=(await service.get('project'))!.steps.character.artifact;generate.mockRejectedValueOnce(new Error('engine failed'));
  const failed=await act({action:'animate',prompt:'做人物动作'});expect(failed.steps.character.artifact).toEqual(old);expect(failed.task?.state).toBe('failed');
  await act({action:'run'});expect(generate.mock.calls[1][0].task).toMatchObject({characterPhase:'actions',prompt:'做人物动作'});
 });
 it('edits actions, requires reconfirmation and restores exact approved actions with no new call',async()=>{
  await act({action:'animate'});const saved=await act({action:'confirm'});const checkpoint=saved.history.find(h=>h.label==='已确认人物动作')!;
  const edited=await act({action:'revise',stage:'character',impactAccepted:true,prompt:'走路慢一点'});expect(edited.steps.character.confirmedVersionId).toBeNull();expect(generate.mock.calls[1][0].task?.characterPhase).toBe('actions');
  const restored=await act({action:'restore',impactAccepted:true,checkpointId:checkpoint.id});expect(restored.steps.character).toEqual(saved.steps.character);expect(generate).toHaveBeenCalledTimes(2);
 });
 it('returning to appearance invalidates actions without generation and preserves history',async()=>{
  await act({action:'animate'});await expect(act({action:'edit-character'})).rejects.toMatchObject({code:'IMPACT_CONFIRMATION_REQUIRED'});
  const s=await act({action:'edit-character',impactAccepted:true});expect(s.steps.character.artifact?.characterPhase).toBe('candidates');expect(s.steps.character.artifact?.media).toEqual([]);expect(s.task).toBeNull();expect(generate).toHaveBeenCalledTimes(1);expect(s.history.some(h=>h.steps.character.artifact?.characterPhase==='actions')).toBe(true);
 });
 it('requires a selected current candidate and rejects swapping characters under existing actions',async()=>{
  await expect(act({action:'animate',versionId:'outdated'})).rejects.toMatchObject({code:'NOT_CONFIRMABLE'});await act({action:'animate'});
  await expect(act({action:'select',candidateId:'b',impactAccepted:true})).rejects.toMatchObject({code:'ACTIONS_REQUIRE_RESET'});expect(generate).toHaveBeenCalledTimes(1);
 });
});
describe('2-3 real-file action integrity',()=>{
 let root:string,s:CreationWorkflow,m:CharacterActionManifest,png:any;
 beforeEach(async()=>{
  root=await mkdtemp(join(tmpdir(),'action-files-'));for(const d of ['.noobi','resources','public/assets/images'])await mkdir(join(root,d),{recursive:true});
  await writeFile(join(root,source),'original');await writeFile(join(root,'resources/actions.tres'),'[gd_resource type="SpriteFrames"]');
  s=newCreation('project','剑客');const d=directionArtifact(brief);s.steps.direction={status:'confirmed',artifact:d,confirmedVersionId:d.id};s.steps.character.artifact=base();s.steps.character.artifact.lockedAssets[source]=await creationHash(root,source);s.currentStage='character';
  s.task={id:'task',stage:'character',characterPhase:'actions',operationId:'operation',prompt:'',startedAt:new Date().toISOString(),state:'running',baseVersionId:null,error:null};
  png=new PNG({width:32,height:16});for(let cell=0;cell<8;cell++)for(let y=2;y<6;y++)for(let x=2;x<5;x++)png.data.set([100+cell*10,80,70,255],((Math.floor(cell/4)*8+y)*32+cell%4*8+x)*4);
  m={schemaVersion:1,taskId:'task',genre:'topdown',sourceCharacter:{id:'a',path:source,sha256:s.steps.character.artifact.lockedAssets[source]},spriteSheet:sheet,spriteFrames:'resources/actions.tres',spriteNode:'Player/Sprite',frameWidth:8,frameHeight:8,columns:4,rows:2,targetFps:60,animations:[{name:'idle',frames:[0,1],fps:4,loop:true},{name:'walk',frames:[2,3,4],fps:8,loop:true},{name:'attack',frames:[5,6,7],fps:6,loop:false}]};
 });
 afterEach(()=>rm(root,{recursive:true,force:true}));
 async function check(proof=true){await writeFile(join(root,sheet),PNG.sync.write(png));await writeFile(join(root,'.noobi/character-actions.json'),JSON.stringify(m));return readCharacterActions(root,s,async()=>proof,60);}
 it('accepts current generated poses and derives controls from the approved view',async()=>{expect(await check()).toEqual(m);expect(characterActionControls(m).states[2].key).toBe('J');m.genre='platformer';expect(characterActionControls(m).states[2].key).toBe('空格');});
 it('rejects old task reports and source substitution',async()=>{m.taskId='old';await expect(check()).rejects.toMatchObject({code:'INVALID_ACTIONS'});m.taskId='task';await writeFile(join(root,source),'changed');await expect(check()).rejects.toMatchObject({code:'INVALID_ACTIONS'});});
 it('requires private generation proof and actual grid dimensions',async()=>{await expect(check(false)).rejects.toMatchObject({code:'INVALID_ACTIONS'});m.frameWidth=9;await expect(check()).rejects.toMatchObject({code:'INVALID_ACTIONS'});});
 it('rejects missing primary and duplicate static poses',async()=>{m.animations[2].name='jump';await expect(check()).rejects.toMatchObject({code:'INVALID_ACTIONS'});m.animations[2].name='attack';m.animations[1].frames=[2,2];await expect(check()).rejects.toMatchObject({code:'INVALID_ACTIONS'});});
 it('accepts only tiny transparent padding and rejects clipped visible art',async()=>{const padded=new PNG({width:33,height:17});for(let y=0;y<16;y++)png.data.copy(padded.data,y*33*4,y*32*4,(y+1)*32*4);png=padded;expect(await check()).toEqual(m);png.data[(16*33+32)*4+3]=255;await expect(check()).rejects.toMatchObject({code:'INVALID_ACTIONS'});});
 it('rejects blank poses and a changed target frame rate',async()=>{png.data.fill(0);await expect(check()).rejects.toMatchObject({code:'INVALID_ACTIONS'});m.targetFps=30;await expect(check()).rejects.toMatchObject({code:'INVALID_ACTIONS'});});
});
