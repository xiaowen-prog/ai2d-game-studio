// Deterministic engineering fixture; deliberately not an AI-generated product sample.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { GodotEnvironmentService } from '../../src/main/godotEnvironmentService.js';
import { inspectCharacterActionPlayback, type CharacterActionManifest } from '../../src/main/characterActionInspection.js';
const { PNG } = createRequire(import.meta.url)('pngjs');
const root = resolve('.noobi-private/action-review/native-fixture');
for (const dir of ['scenes','scripts','resources','public/assets/images','.noobi','build/web']) await mkdir(join(root,dir),{recursive:true});
await writeFile(join(root,'project.godot'),`config_version=5
[application]
config/name="Action engineering fixture (not AI)"
run/main_scene="res://scenes/main.tscn"
[display]
window/size/viewport_width=640
window/size/viewport_height=360
[rendering]
renderer/rendering_method="gl_compatibility"
`);
await copyFile(resolve('.noobi-private/baseline-audit-ccc273e/real-1793867789612/星光收集/export_presets.cfg'),join(root,'export_presets.cfg'));
const png = new PNG({width:256,height:128});
for (let cell=0;cell<8;cell++) for(let y=15;y<55;y++)for(let x=15;x<48;x++) {
 const at=((Math.floor(cell/4)*64+y)*256+cell%4*64+x)*4;
 if((y>38&&x<26+cell*2)||(y<25&&x>42-cell))continue;
 png.data.set([80+cell*17,170,220,255],at);
}
await writeFile(join(root,'public/assets/images/fixture.png'),PNG.sync.write(png));
const specs = [{name:'idle',frames:[0,1],fps:4,loop:true},{name:'walk',frames:[2,3,4],fps:8,loop:true},{name:'attack',frames:[5,6,7],fps:6,loop:false}];
const resource = `[gd_resource type="SpriteFrames" load_steps=10 format=3]\n[ext_resource type="Texture2D" path="res://public/assets/images/fixture.png" id="1"]\n`
 + Array.from({length:8},(_,i)=>`[sub_resource type="AtlasTexture" id="f${i}"]\natlas = ExtResource("1")\nregion = Rect2(${i%4*64}, ${Math.floor(i/4)*64}, 64, 64)\n`).join('\n')
 + '\n[resource]\nanimations = ['+specs.map(a=>`{"frames": [${a.frames.map(i=>`{"duration": 1.0, "texture": SubResource("f${i}")}`).join(',')}], "loop": ${a.loop}, "name": &"${a.name}", "speed": ${a.fps}.0}`).join(',')+']\n';
await writeFile(join(root,'resources/character_frames.tres'),resource);
await writeFile(join(root,'scenes/main.tscn'),`[gd_scene load_steps=3 format=3]
[ext_resource type="Script" path="res://scripts/main.gd" id="1"]
[ext_resource type="SpriteFrames" path="res://resources/character_frames.tres" id="2"]
[node name="Preview" type="Node2D"]
script = ExtResource("1")
[node name="Player" type="Node2D" parent="."]
position = Vector2(240, 180)
[node name="AnimatedSprite2D" type="AnimatedSprite2D" parent="Player"]
sprite_frames = ExtResource("2")
animation = &"idle"
`);
await writeFile(join(root,'scripts/main.gd'),`extends Node2D
@onready var actor: AnimatedSprite2D = $Player/AnimatedSprite2D
var primary := false
func _ready() -> void:
    actor.animation_finished.connect(finish)
    actor.play("idle")
func _input(event: InputEvent) -> void:
    if event is InputEventKey and event.pressed and event.keycode == KEY_J and not event.echo:
        primary = true
        actor.play("attack")
func _process(delta: float) -> void:
    if primary: return
    if Input.is_key_pressed(KEY_D):
        actor.play("walk")
        $Player.position.x += 40 * delta
    else: actor.play("idle")
func finish() -> void:
    primary = false
    actor.play("idle")
`);
const manifest = {schemaVersion:1,taskId:'fixture-task',genre:'topdown',sourceCharacter:{id:'fixture',path:'public/assets/images/fixture.png',sha256:'fixture'},spriteSheet:'public/assets/images/fixture.png',spriteFrames:'resources/character_frames.tres',spriteNode:'Player/AnimatedSprite2D',frameWidth:64,frameHeight:64,columns:4,rows:2,targetFps:60,animations:specs} as CharacterActionManifest;
await writeFile(join(root,'.noobi/character-actions.json'),JSON.stringify(manifest));
const service = new GodotEnvironmentService({storageFile:join(root,'environment.json')}); await service.init();
for(const kind of ['import','validate','export'] as const) {
 const result = await service.execute(kind==='export'?{kind,projectPath:root,preset:'Web',outputPath:join(root,'build/web/index.html')}:{kind,projectPath:root});
 await writeFile(join(root,`${kind}.log`),JSON.stringify(result,null,2)); if(!result.ok)throw new Error(`${kind}: ${result.stderr}\n${result.stdout}`);
}
const result=await inspectCharacterActionPlayback(root,manifest,service,new AbortController().signal);
console.log(JSON.stringify({passed:true,fixtureOnly:true,checks:result}));
// Negative control: declared resources still exist, but production ignores inputs.
const original = await readFile(join(root,'scripts/main.gd'),'utf8');
await writeFile(join(root,'scripts/main.gd'),`extends Node2D\nfunc _ready() -> void:\n    $Player/AnimatedSprite2D.play("idle")\n`);
try {
 for(const kind of ['import','export'] as const){
  const check=await service.execute(kind==='export'?{kind,projectPath:root,preset:'Web',outputPath:join(root,'build/web/index.html')}:{kind,projectPath:root});
  if(!check.ok)throw new Error(`Negative fixture ${kind} failed before inspection`);
 }
 let rejected=false;
 try{await inspectCharacterActionPlayback(root,manifest,service,new AbortController().signal);}catch(error){if((error as {code?:string}).code==='ACTION_PLAYBACK_FAILED')rejected=true;else throw error;}
 if(!rejected)throw new Error('Input-disconnected animation incorrectly passed');
 console.log(JSON.stringify({passed:true,fixtureOnly:true,negativeControl:'Declared frames without actual input response are rejected'}));
}finally{await writeFile(join(root,'scripts/main.gd'),original);}
