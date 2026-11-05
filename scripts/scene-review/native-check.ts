// Synthetic engineering fixture only; no AI or product-quality claim.
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { GodotEnvironmentService } from '../../src/main/godotEnvironmentService.js';
import { inspectCharacterActionPlayback } from '../../src/main/characterActionInspection.js';
const { PNG }=createRequire(import.meta.url)('pngjs');
const root=resolve('.noobi-private/scene-review/native-fixture');await rm(root,{recursive:true,force:true});await cp(resolve('.noobi-private/action-review/native-fixture'),root,{recursive:true,filter:p=>!['.godot','build','artifacts'].some(part=>p.split('/').includes(part))});await mkdir(join(root,'build/web'),{recursive:true});
const png=new PNG({width:64,height:36});for(let i=0;i<png.data.length;i+=4)png.data.set([40,70,90,255],i);await writeFile(join(root,'public/assets/images/background.png'),PNG.sync.write(png));
let scene=await readFile(join(root,'scenes/main.tscn'),'utf8');scene=scene.replace('load_steps=3','load_steps=4').replace('[node name="Preview"','[ext_resource type="Texture2D" path="res://public/assets/images/background.png" id="3"]\n[node name="Preview"');scene+='\n[node name="SceneBackground" type="Sprite2D" parent="."]\nz_index = -10\nposition = Vector2(320, 180)\nscale = Vector2(10, 10)\ntexture = ExtResource("3")\n';await writeFile(join(root,'scenes/main.tscn'),scene);
const actions=JSON.parse(await readFile(join(root,'.noobi/character-actions.json'),'utf8'));const manifest={schemaVersion:1 as const,taskId:'scene-fixture',genre:'topdown' as const,characterVersionId:'fixture',characterSnapshotId:'fixture',background:{path:'public/assets/images/background.png',node:'SceneBackground'},characterNode:actions.spriteNode};await writeFile(join(root,'.noobi/scene-preview.json'),JSON.stringify(manifest));
const service=new GodotEnvironmentService({storageFile:join(root,'environment.json')});await service.init();for(const kind of ['import','validate','export'] as const){const r=await service.execute(kind==='export'?{kind,projectPath:root,preset:'Web',outputPath:join(root,'build/web/index.html')}:{kind,projectPath:root});await writeFile(join(root,`${kind}.log`),JSON.stringify(r,null,2));assert.equal(r.ok,true,`${kind}: ${r.stderr}\n${r.stdout}`);}
const checks=await inspectCharacterActionPlayback(root,actions,service,new AbortController().signal,manifest);console.log(JSON.stringify({passed:true,fixtureOnly:true,checks}));
await assert.rejects(inspectCharacterActionPlayback(root,actions,service,new AbortController().signal,{...manifest,background:{...manifest.background,node:'MissingBackground'}}),{code:'ACTION_PLAYBACK_FAILED'});console.log(JSON.stringify({passed:true,fixtureOnly:true,negativeControl:'Missing production background is rejected'}));
