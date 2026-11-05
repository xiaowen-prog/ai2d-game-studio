// Read geometry from the actual exported game for keyboard-only Web replay.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { runGodotProcess, GodotEnvironmentService } from '../../src/main/godotEnvironmentService.js';
const latest=JSON.parse(await readFile(resolve('.noobi-private/platformer-review/latest-platformer.json'),'utf8'));assert.equal(latest.passed,true);
const root=join(latest.stateDirectory,'creation/artifacts',latest.projectId,'versions',latest.finalArtifact.snapshotId,'game');
const script=resolve('.noobi-private/platformer-review/web-route-probe.gd');
await writeFile(script,`extends SceneTree
func _initialize() -> void:
    call_deferred("probe")
func probe() -> void:
    root.size = Vector2i(1280,720)
    var config: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(OS.get_cmdline_user_args()[0]))
    var scene = load(ProjectSettings.get_setting("application/run/main_scene")).instantiate()
    root.add_child(scene)
    await create_timer(0.6).timeout
    var player: CharacterBody2D = scene.get_node(config.nodes.player)
    var start := player.global_position
    var front := 0.0
    for c in player.get_children():
        if c is CollisionShape2D and c.shape is RectangleShape2D:
            var r: Rect2 = c.get_global_transform() * Rect2(-c.shape.size * 0.5,c.shape.size)
            front = r.end.x - start.x
    var blocks: Array = []
    for path in config.nodes.obstacles:
        var block = scene.get_node(path)
        for c in block.get_children():
            if c is CollisionShape2D and c.shape is RectangleShape2D:
                var r: Rect2 = c.get_global_transform() * Rect2(-c.shape.size * 0.5,c.shape.size)
                blocks.append({"left":r.position.x,"right":r.end.x})
    var e := InputEventKey.new()
    e.physical_keycode = KEY_D
    e.keycode = KEY_D
    e.pressed = true
    Input.parse_input_event(e)
    await create_timer(0.2).timeout
    var goal: Node2D = scene.get_node(config.nodes.goal)
    print("WEB_ROUTE:" + JSON.stringify({"startX":start.x,"speed":player.velocity.x,"front":front,"obstacles":blocks,"goalX":goal.global_position.x}))
    quit()
`);
const service=new GodotEnvironmentService({storageFile:resolve('.noobi-private/platformer-review/probe-environment.json')});await service.init();const status=await service.getStatus();assert.ok(status.tool.binaryPath);
const r=await runGodotProcess(status.tool.binaryPath,['--headless','--path',root,'--main-pack',join(root,'build/web/index.pck'),'--script',script,'--',join(root,'.noobi/platformer-preview.json')],{cwd:root,timeoutMs:15_000});assert.equal(r.exitCode,0,r.stderr);const line=r.stdout.split('\n').find(x=>x.startsWith('WEB_ROUTE:'));assert.ok(line);const geometry=JSON.parse(line.slice(10));assert.ok(geometry.speed>0&&geometry.obstacles.length>0);await writeFile(join(latest.evidenceDirectory,'网页路线几何.json'),JSON.stringify({checkedAt:new Date().toISOString(),geometry},null,2));console.log(JSON.stringify(geometry));
