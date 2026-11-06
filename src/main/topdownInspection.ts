import { randomUUID } from 'node:crypto';
import { mkdir, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TopdownInputs } from './creationTopdown.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile } from './creationVersionStore.js';
import { engineDirectory } from './hostReviewEvidence.js';
import { runGodotProcess, type GodotEnvironmentService } from './godotEnvironmentService.js';

/** Runtime binding checks only. Human gameplay acceptance remains with the user. */
export async function inspectTopdownBindings(root: string, inputs: TopdownInputs, service: GodotEnvironmentService, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  const status = await service.getStatus();
  if (!status.tool.binaryPath) throw new CreationError('GODOT_REQUIRED', 'Godot 尚未就绪。');
  const pack = await safeCreationFile(root, 'build/web/index.pck');
  const directory = join(root, '.godot');
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new CreationError('UNSAFE_PATH', '试玩检查目录无效。');
  const nonce = randomUUID(), script = join(directory, `noobi-topdown-${nonce}.gd`), input = join(directory, `noobi-topdown-${nonce}.json`);
  await writeFile(script, TOPDOWN_BINDINGS_GDSCRIPT, { flag: 'wx' });
  await writeFile(input, JSON.stringify({ ...inputs, nonce }), { flag: 'wx' });
  try {
    const result = await runGodotProcess(status.tool.binaryPath, ['--headless', '--path', root, '--main-pack', pack, '--script', script, '--', input], { cwd: root, timeoutMs: 20_000 });
    signal.throwIfAborted();
    const marker = `NOOBI_TOPDOWN_${nonce}:`, line = result.stdout.split('\n').find(value => value.startsWith(marker));
    const observed = line ? JSON.parse(line.slice(marker.length)) : null;
    const ok = result.exitCode === 0 && !result.timedOut && !/(?:^|\n)\s*(ERROR:|SCRIPT ERROR:)/u.test(`${result.stderr}\n${result.stdout}`) && observed?.ok === true;
    const out = await engineDirectory(root), temporary = join(out, `topdown-${nonce}.tmp`);
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, taskId: inputs.manifest.taskId, manifestSha256: await creationHash(root, '.noobi/topdown-preview.json'), ok, scope: 'engine-bindings-only', manualGameplayAcceptance: 'pending', result, observed }, null, 2), { flag: 'wx' });
    await rename(temporary, join(out, 'topdown-latest.json'));
    if (!ok) throw new CreationError('PLAYABLE_CHECK_FAILED', '俯视试玩的人物、墙、剑气或提示未正确接入，上一版仍保留。');
    return ['俯视人物、实体墙、练习目标和剑气资源已接入实际工程', '已确认背景与人物动作资源保留；攻击和反弹效果待你试玩确认'];
  } finally { await Promise.all([rm(script, { force: true }), rm(input, { force: true })]); }
}

export const TOPDOWN_BINDINGS_GDSCRIPT = `extends SceneTree
var errors: Array[String] = []
func _initialize() -> void:
    call_deferred("inspect")
func check(value: bool, message: String) -> void:
    if not value: errors.append(message)
func collision(body: Node) -> bool:
    if body == null: return false
    for child in body.get_children():
        if child is CollisionShape2D and child.shape != null and not child.disabled: return true
    return false
func inspect() -> void:
    var cfg: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(OS.get_cmdline_user_args()[0]))
    root.size = Vector2i(int(ProjectSettings.get_setting("display/window/size/viewport_width",1280)),int(ProjectSettings.get_setting("display/window/size/viewport_height",720)))
    var packed = load(ProjectSettings.get_setting("application/run/main_scene")) as PackedScene
    if packed == null:
        errors.append("Main scene missing")
    else:
        var world: Node = packed.instantiate()
        root.add_child(world)
        current_scene = world
        await create_timer(0.25).timeout
        var n: Dictionary = cfg.manifest.nodes
        var player = world.get_node_or_null(n.player) as CharacterBody2D
        check(player != null and collision(player), "Actual player collision missing")
        var sprite = world.get_node_or_null(cfg.actions.spriteNode) as AnimatedSprite2D
        check(sprite != null and sprite.is_visible_in_tree() and sprite.sprite_frames != null, "Approved character missing")
        var background = world.get_node_or_null(cfg.scene.background.node) as Sprite2D
        check(background != null and background.is_visible_in_tree() and background.texture != null and background.texture.resource_path == "res://" + cfg.scene.background.path, "Approved background missing")
        for path in n.walls:
            var wall = world.get_node_or_null(path) as StaticBody2D
            check(wall != null and wall.collision_layer != 0 and collision(wall), "Solid wall missing")
        for path in n.targets:
            var target = world.get_node_or_null(path) as StaticBody2D
            check(target != null and target.is_visible_in_tree() and target.collision_layer != 0 and collision(target), "Visible target collision missing")
        check(world.get_node_or_null(n.projectiles) is Node2D, "Projectile container missing")
        for path in [n.counter,n.feedback]:
            var label = world.get_node_or_null(path) as Label
            check(label != null and label.is_visible_in_tree() and not label.text.is_empty(), "Visible gameplay feedback missing")
        var projectile_packed = load("res://" + str(cfg.manifest.projectileScene)) as PackedScene
        if projectile_packed == null:
            errors.append("Projectile resource missing")
        else:
            var projectile: Node = projectile_packed.instantiate()
            var projectile_body = projectile as CharacterBody2D
            check(projectile_body != null and collision(projectile_body) and projectile_body.get_script() != null and projectile_body.collision_mask != 0, "Scripted physical projectile missing")
            projectile.free()
    print("NOOBI_TOPDOWN_" + str(cfg.nonce) + ":" + JSON.stringify({"ok":errors.is_empty(),"errors":errors,"manualGameplayAcceptance":"pending"}))
    quit(0 if errors.is_empty() else 1)
`;
