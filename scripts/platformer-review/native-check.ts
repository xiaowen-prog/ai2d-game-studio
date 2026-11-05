// Synthetic engineering fixture only, not an AI product sample.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { GodotEnvironmentService } from '../../src/main/godotEnvironmentService.js';
import { inspectPlatformer } from '../../src/main/platformerInspection.js';
import type { PlatformerInputs } from '../../src/main/creationPlatformer.js';
const root=resolve('.noobi-private/platformer-review/native-fixture');for(const dir of ['scripts','scenes','.noobi','public/assets/images','build/web'])await mkdir(join(root,dir),{recursive:true});
await copyFile(resolve('.noobi-private/scene-review/native-fixture/public/assets/images/background.png'),join(root,'public/assets/images/background.png'));
await copyFile(resolve('.noobi-private/scene-review/native-fixture/export_presets.cfg'),join(root,'export_presets.cfg'));
await writeFile(join(root,'project.godot'),`config_version=5
[application]
config/name="Engineering fixture NOT AI"
run/main_scene="res://scenes/main.tscn"
[display]
window/size/viewport_width=1280
window/size/viewport_height=720
[rendering]
renderer/rendering_method="gl_compatibility"
`);
await writeFile(join(root,'scenes/main.tscn'),`[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://scripts/main.gd" id="1"]
[node name="World" type="Node2D"]
script = ExtResource("1")
`);
const player=`extends CharacterBody2D
var jumps := 0
var allowed := 2
var requested := false
func _physics_process(delta: float) -> void:
    if is_on_floor(): jumps = 0
    if requested and jumps < allowed:
        velocity.y = -580
        jumps += 1
    requested = false
    velocity.y += 1500 * delta
    velocity.x = (float(Input.is_physical_key_pressed(KEY_D)) - float(Input.is_physical_key_pressed(KEY_A))) * 190
    move_and_slide()
func _input(event: InputEvent) -> void:
    if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_SPACE:
        requested = true
`;
const main=`extends Node2D
var player: CharacterBody2D
var counter: Label
var feedback: Label
var coins: Array[Area2D] = []
var score := 0
func collision(body: Node2D, size: Vector2) -> void:
    var c := CollisionShape2D.new()
    var shape := RectangleShape2D.new()
    shape.size = size
    c.shape = shape
    body.add_child(c)
func _ready() -> void:
    var bg := Sprite2D.new()
    bg.name = "SceneBackground"
    bg.texture = load("res://public/assets/images/background.png")
    bg.scale = Vector2(20,20)
    bg.position = Vector2(640,360)
    bg.z_index = -10
    add_child(bg)
    var floor := StaticBody2D.new()
    floor.name = "Ground"
    floor.position = Vector2(650,320)
    collision(floor,Vector2(1600,40))
    add_child(floor)
    var block := StaticBody2D.new()
    block.name = "Obstacle"
    block.position = Vector2(600,275)
    collision(block,Vector2(60,50))
    add_child(block)
    player = CharacterBody2D.new()
    player.name = "Player"
    player.set_script(load("res://scripts/player.gd"))
    collision(player,Vector2(20,40))
    player.position = Vector2(80,280)
    add_child(player)
    counter = Label.new()
    counter.name = "Counter"
    add_child(counter)
    feedback = Label.new()
    feedback.name = "Feedback"
    feedback.position.y = 30
    add_child(feedback)
    for i in range(2):
        var coin := Area2D.new()
        coin.name = "Coin" + str(i)
        coin.position = Vector2(300 if i == 0 else 850,280)
        collision(coin,Vector2(20,30))
        add_child(coin)
        coins.append(coin)
        coin.body_entered.connect(collect.bind(coin))
    var goal := Area2D.new()
    goal.name = "Goal"
    goal.position = Vector2(1200,260)
    collision(goal,Vector2(48,80))
    add_child(goal)
    goal.body_entered.connect(finish)
    reset()
func collect(body: Node2D, coin: Area2D) -> void:
    if body == player and coin.visible:
        coin.visible = false
        score += 1
        counter.text = str(score) + "/2"
func finish(body: Node2D) -> void:
    if body == player and score == 2: feedback.text = "COMPLETE"
func reset() -> void:
    player.position = Vector2(80,280)
    player.velocity = Vector2.ZERO
    player.jumps = 0
    score = 0
    counter.text = "0/2"
    feedback.text = "Playing"
    for coin in coins: coin.visible = true
func _input(event: InputEvent) -> void:
    if event is InputEventKey and event.pressed and event.physical_keycode == KEY_R: reset()
`;
await writeFile(join(root,'scripts/player.gd'),player);await writeFile(join(root,'scripts/main.gd'),main);
const inputs={manifest:{schemaVersion:1,taskId:'fixture',genre:'platformer',sceneVersionId:'fixture',sceneSnapshotId:'fixture',nodes:{player:'Player',ground:'Ground',obstacles:['Obstacle'],collectibles:['Coin0','Coin1'],goal:'Goal',counter:'Counter',feedback:'Feedback'},rules:{maxJumps:2,resetOnLanding:true}},actions:{},scene:{background:{node:'SceneBackground',path:'public/assets/images/background.png'}}} as PlatformerInputs;
await writeFile(join(root,'.noobi/platformer-preview.json'),JSON.stringify(inputs.manifest));
const service=new GodotEnvironmentService({storageFile:join(root,'environment.json')});await service.init();
async function build(){for(const kind of ['import','validate','export'] as const){const r=await service.execute(kind==='export'?{kind,projectPath:root,preset:'Web',outputPath:join(root,'build/web/index.html')}:{kind,projectPath:root});assert.equal(r.ok,true,`${kind}: ${r.stderr}\n${r.stdout}`);}}
await build();console.log(JSON.stringify({fixtureOnly:true,passed:true,checks:await inspectPlatformer(root,inputs,service,new AbortController().signal)}));await copyFile(join(root,'artifacts/engine/platformer-latest.json'),join(root,'positive.json'));
for(const mode of ['decorative-obstacle','unlimited-jump']){
 await writeFile(join(root,'scripts/main.gd'),mode==='decorative-obstacle'?main.replace('    block.name = "Obstacle"','    block.name = "Obstacle"\n    block.collision_layer = 0'):main);
 await writeFile(join(root,'scripts/player.gd'),mode==='unlimited-jump'?player.replace('allowed := 2','allowed := 99'):player);
 await build();await assert.rejects(inspectPlatformer(root,inputs,service,new AbortController().signal),{code:'PLAYABLE_CHECK_FAILED'});console.log(JSON.stringify({fixtureOnly:true,passed:true,rejected:mode}));
}
await writeFile(join(root,'scripts/main.gd'),main);await writeFile(join(root,'scripts/player.gd'),player);
