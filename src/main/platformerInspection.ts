import { randomUUID } from 'node:crypto';
import { mkdir, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlatformerInputs } from './creationPlatformer.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile } from './creationVersionStore.js';
import { engineDirectory } from './hostReviewEvidence.js';
import { runGodotProcess, type GodotEnvironmentService } from './godotEnvironmentService.js';
export async function inspectPlatformer(root: string, inputs: PlatformerInputs, service: GodotEnvironmentService, signal: AbortSignal): Promise<string[]> {
 signal.throwIfAborted(); const status=await service.getStatus();
 if(!status.tool.binaryPath) throw new CreationError('GODOT_REQUIRED','Godot 尚未就绪。');
 const pack=await safeCreationFile(root,'build/web/index.pck'); const dir=join(root,'.godot');await mkdir(dir,{recursive:true});
 if((await lstat(dir)).isSymbolicLink())throw new CreationError('UNSAFE_PATH','试玩检查目录无效。');
 const nonce=randomUUID(),script=join(dir,`noobi-platformer-${nonce}.gd`),input=join(dir,`noobi-platformer-${nonce}.json`);
 await writeFile(script,PLATFORMER_INSPECTION_GDSCRIPT,{flag:'wx'});await writeFile(input,JSON.stringify({...inputs,nonce}),{flag:'wx'});
 try {
  const result=await runGodotProcess(status.tool.binaryPath,['--headless','--path',root,'--main-pack',pack,'--script',script,'--',input],{cwd:root,timeoutMs:90_000});signal.throwIfAborted();
  const marker=`NOOBI_PLATFORMER_${nonce}:`,line=result.stdout.split('\n').find(x=>x.startsWith(marker)),observed=line?JSON.parse(line.slice(marker.length)):null;
  const ok=result.exitCode===0&&!result.timedOut&&!/(?:^|\n)\s*(ERROR:|SCRIPT ERROR:)/u.test(`${result.stderr}\n${result.stdout}`)&&observed?.ok===true;
  const out=await engineDirectory(root),tmp=join(out,`platformer-${nonce}.tmp`);await writeFile(tmp,JSON.stringify({schemaVersion:1,taskId:inputs.manifest.taskId,manifestSha256:await creationHash(root,'.noobi/platformer-preview.json'),ok,result,observed},null,2),{flag:'wx'});await rename(tmp,join(out,'platformer-latest.json'));
  if(!ok)throw new CreationError('PLAYABLE_CHECK_FAILED',`试玩未通过实际操作检查：${observed?.errors?.join('；')||'游戏没有正确响应操作或引擎运行出错。'} 上一版仍保留。`);
  return ['实际碰撞能挡住人物，并能跳过障碍','接触收集物后计数变化且不会重复收集','未收集齐不能完成；真实按键可收集并到达目标',`实际验证${inputs.manifest.rules.maxJumps===2?'二段跳、拒绝第三跳':'单次跳跃、拒绝空中再跳'}及落地恢复`,'R 重来恢复人物、收集物和目标状态'];
 }finally{await Promise.all([rm(script,{force:true}),rm(input,{force:true})]);}
}
export const PLATFORMER_INSPECTION_GDSCRIPT = `extends SceneTree
var cfg: Dictionary
var errors: Array[String] = []
var evidence: Dictionary = {}
var world: Node
var player: CharacterBody2D
var ground: StaticBody2D
var goal: Area2D
var counter: Label
var feedback: Label
var coins: Array[Area2D] = []
var obstacles: Array[StaticBody2D] = []
func _initialize() -> void:
    call_deferred("inspect")
func check(value: bool, why: String) -> void:
    if not value: errors.append(why)
func key(code: int, down: bool) -> void:
    var e := InputEventKey.new()
    e.keycode = code
    e.physical_keycode = code
    e.pressed = down
    Input.parse_input_event(e)
func wait(seconds: float) -> void:
    await create_timer(seconds).timeout
func tap(code: int) -> void:
    key(code, true)
    await wait(0.06)
    key(code, false)
    await wait(0.06)
func rect(body: Node2D) -> Rect2:
    for child in body.get_children():
        if child is CollisionShape2D and not child.disabled and child.shape is RectangleShape2D:
            return child.get_global_transform() * Rect2(-child.shape.size * 0.5, child.shape.size)
    return Rect2()
func place(x: float) -> void:
    var body := rect(player)
    var bottom_offset := body.end.y - player.global_position.y
    player.global_position = Vector2(x, rect(ground).position.y - bottom_offset - 0.5)
    player.velocity = Vector2.ZERO
    await wait(0.25)
func reset() -> void:
    key(KEY_D, false)
    key(KEY_A, false)
    key(KEY_SPACE, false)
    await tap(KEY_R)
    await wait(0.4)
func number() -> int:
    var re := RegEx.new()
    re.compile("[0-9]+")
    var found := re.search(counter.text)
    return int(found.get_string()) if found else -1
func finish() -> void:
    key(KEY_D, false)
    key(KEY_SPACE, false)
    print("NOOBI_PLATFORMER_" + str(cfg.nonce) + ":" + JSON.stringify({"ok": errors.is_empty(), "errors": errors, "evidence": evidence}))
    quit(0 if errors.is_empty() else 1)
func inspect() -> void:
    cfg = JSON.parse_string(FileAccess.get_file_as_string(OS.get_cmdline_user_args()[0]))
    root.size = Vector2i(int(ProjectSettings.get_setting("display/window/size/viewport_width", 1280)), int(ProjectSettings.get_setting("display/window/size/viewport_height", 720)))
    var packed := load(ProjectSettings.get_setting("application/run/main_scene")) as PackedScene
    if packed == null:
        errors.append("Main scene missing")
        finish()
        return
    world = packed.instantiate()
    root.add_child(world)
    current_scene = world
    await wait(0.6)
    var n: Dictionary = cfg.manifest.nodes
    player = world.get_node_or_null(n.player) as CharacterBody2D
    ground = world.get_node_or_null(n.ground) as StaticBody2D
    goal = world.get_node_or_null(n.goal) as Area2D
    counter = world.get_node_or_null(n.counter) as Label
    feedback = world.get_node_or_null(n.feedback) as Label
    var background = world.get_node_or_null(cfg.scene.background.node) as Sprite2D
    if player == null or ground == null or goal == null or counter == null or feedback == null or background == null:
        errors.append("Production physics nodes, HUD or background missing")
        finish()
        return
    check(background.is_visible_in_tree() and background.texture != null and background.texture.resource_path == "res://" + cfg.scene.background.path, "Approved background missing from production scene")
    check(counter.is_visible_in_tree() and feedback.is_visible_in_tree(), "Gameplay feedback is hidden")
    for path in n.obstacles:
        var obstacle = world.get_node_or_null(path) as StaticBody2D
        if obstacle == null or rect(obstacle).get_area() <= 0:
            errors.append("Solid obstacle collision missing")
        else: obstacles.append(obstacle)
    for path in n.collectibles:
        var coin = world.get_node_or_null(path) as Area2D
        if coin == null or not coin.is_visible_in_tree(): errors.append("Collectible missing or hidden at start")
        else: coins.append(coin)
    if rect(player).get_area() <= 0 or rect(ground).get_area() <= 0 or not errors.is_empty():
        errors.append("Required actual collision geometry missing")
        finish()
        return
    check(player.is_on_floor(), "Player does not stand on actual ground")
    var start := player.global_position
    key(KEY_D, true)
    await wait(0.3)
    key(KEY_D, false)
    check(player.global_position.x > start.x + 10, "Movement input has no physical effect")
    await reset()
    check(player.global_position.distance_to(start) < 5, "R does not restore spawn")
    await tap(KEY_SPACE)
    check(player.velocity.y < -20 and player.global_position.y < start.y - 5, "Space does not cause an actual jump")
    await wait(0.10)
    var before_second := player.velocity.y
    await tap(KEY_SPACE)
    var after_second := player.velocity.y
    if int(cfg.manifest.rules.maxJumps) == 2:
        check(after_second < before_second - 25, "Requested second airborne jump does not give a second impulse")
    else:
        check(after_second >= before_second - 10, "Single-jump version allows an extra airborne jump")
    await wait(0.10)
    var before_third := player.velocity.y
    await tap(KEY_SPACE)
    check(player.velocity.y >= before_third - 10, "Airborne jump limit can be exceeded")
    for i in range(150):
        if player.is_on_floor(): break
        await wait(0.02)
    check(player.is_on_floor(), "Jump does not land back on actual ground")
    await tap(KEY_SPACE)
    check(player.velocity.y < -20, "Landing does not restore jump availability")
    evidence["jumps"] = {"maxJumps": cfg.manifest.rules.maxJumps, "secondBefore": before_second, "secondAfter": after_second, "landingRestored": player.velocity.y < -20}
    await reset()
    var obstacle := obstacles[0]
    var wall := rect(obstacle)
    var half_width := rect(player).size.x * 0.5
    await place(wall.position.x - half_width - 32)
    var before_block := player.global_position.x
    key(KEY_D, true)
    await wait(0.5)
    key(KEY_D, false)
    check(player.global_position.x > before_block + 3 and rect(player).end.x <= wall.position.x + 3, "Obstacle is decorative; character walks through it")
    key(KEY_D, true)
    await tap(KEY_SPACE)
    await wait(1.1)
    key(KEY_D, false)
    check(player.global_position.x > wall.end.x, "Single jump cannot clear the obstacle")
    evidence["obstacle"] = {"left": wall.position.x, "right": wall.end.x, "landedX": player.global_position.x}
    await reset()
    await place(goal.global_position.x)
    check(goal.get_overlapping_bodies().has(player), "Player cannot contact the actual goal")
    check(feedback.text != "COMPLETE", "Goal completes before collectibles are collected")
    await reset()
    var first := coins[0]
    var before_count := number()
    await place(first.global_position.x)
    check(not first.visible and number() == before_count + 1, "Actual collectible contact does not hide it and increase count once")
    await wait(0.25)
    check(number() == before_count + 1, "Collectible counts repeatedly while overlapping")
    await reset()
    check(number() == 0 and feedback.text != "COMPLETE", "R does not reset count and completion")
    for coin in coins: check(coin.visible, "R does not restore collectibles")
    if not errors.is_empty():
        finish()
        return
    # Complete the route using genuine keyboard events from spawn, without teleports.
    var began := Time.get_ticks_msec()
    key(KEY_D, true)
    for i in range(1500):
        if feedback.text == "COMPLETE": break
        if player.is_on_floor():
            var should_jump := false
            for block in obstacles:
                var ahead := rect(block).position.x - rect(player).end.x
                if ahead > -3 and ahead < 105: should_jump = true
            if should_jump:
                key(KEY_SPACE, true)
                await wait(0.035)
                key(KEY_SPACE, false)
        await wait(0.04)
    key(KEY_D, false)
    check(feedback.text == "COMPLETE" and number() == coins.size(), "Keyboard-only route did not collect everything and reach goal")
    check(abs(player.global_position.x - goal.global_position.x) < 180, "Completion was not at the goal")
    for coin in coins: check(not coin.visible, "Route bypassed a collectible")
    evidence["route"] = {"seconds": (Time.get_ticks_msec() - began) / 1000.0, "collected": number(), "total": coins.size(), "feedback": feedback.text, "goalX": goal.global_position.x, "playerX": player.global_position.x, "keyboardOnly": true}
    await reset()
    check(player.global_position.distance_to(start) < 5 and number() == 0 and feedback.text != "COMPLETE", "Prototype cannot reset after reaching the goal")
    finish()
`;
