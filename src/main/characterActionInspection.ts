import type { ScenePreviewManifest } from './creationScene.js';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { CreationWorkflow, CreationActions } from '../shared/creation.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile } from './creationVersionStore.js';
import { engineDirectory } from './hostReviewEvidence.js';
import { runGodotProcess, type GodotEnvironmentService } from './godotEnvironmentService.js';
const { PNG } = createRequire(import.meta.url)('pngjs') as { PNG: { sync: { read(bytes: Buffer): { width: number; height: number; data: Buffer } } } };
export interface CharacterActionManifest {
  schemaVersion: 1; taskId: string; genre: 'platformer' | 'topdown';
  sourceCharacter: { id: string; path: string; sha256: string };
  spriteSheet: string; spriteFrames: string; spriteNode: string;
  frameWidth: number; frameHeight: number; columns: number; rows: number; targetFps: number;
  animations: Array<{ name: 'idle' | 'walk' | 'jump' | 'attack'; frames: number[]; fps: number; loop: boolean }>;
}
const invalid = (message: string): never => { throw new CreationError('INVALID_ACTIONS', message); };
export async function readCharacterActions(root: string, workflow: CreationWorkflow,
  hasProof: (path: string, hash: string) => Promise<boolean>, targetFps: number): Promise<CharacterActionManifest> {
  let value: CharacterActionManifest;
  try { value = JSON.parse(await readFile(await safeCreationFile(root, '.noobi/character-actions.json'), 'utf8')); }
  catch { return invalid('缺少当前人物的动作清单。'); }
  const prior = workflow.steps.character.artifact!;
  const selected = prior.candidates.find(item => item.id === prior.selectedCharacterId)!;
  const genre = workflow.steps.direction.artifact!.direction!.genre;
  if (!value || value.schemaVersion !== 1 || value.taskId !== workflow.task!.id || value.genre !== genre
    || value.sourceCharacter?.id !== selected.id || value.sourceCharacter.path !== selected.image
    || value.sourceCharacter.sha256 !== prior.lockedAssets[selected.image]
    || await creationHash(root, selected.image) !== prior.lockedAssets[selected.image]) return invalid('动作使用的人物或任务版本不一致，原人物仍保留。');
  if (!/^public\/assets\/images\/[^/]+\.png$/u.test(value.spriteSheet)
    || !/^resources\/[A-Za-z0-9_/-]+\.tres$/u.test(value.spriteFrames)
    || !/^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/u.test(value.spriteNode)) return invalid('动作素材或播放节点位置无效。');
  await safeCreationFile(root, value.spriteFrames);
  if (!await hasProof(value.spriteSheet, await creationHash(root, value.spriteSheet))) return invalid('动作图集缺少真实 AI 生成证明。');
  if (![value.frameWidth, value.frameHeight, value.columns, value.rows].every(n => Number.isInteger(n) && n > 0)
    || value.columns * value.rows > 64 || value.targetFps !== targetFps) return invalid('动作尺寸或帧率与当前项目不一致。');
  const png = PNG.sync.read(await readFile(await safeCreationFile(root, value.spriteSheet)));
  const usedWidth = value.frameWidth * value.columns, usedHeight = value.frameHeight * value.rows;
  // Generated sheets may have a few transparent trailing pixels after integer cell division.
  // Accept only that measurable padding; never silently crop visible content or resize art.
  if (png.width < usedWidth || png.height < usedHeight || png.width - usedWidth >= value.columns || png.height - usedHeight >= value.rows) return invalid('动作图集尺寸与实际图片不一致。');
  for (let y = 0; y < png.height; y++) for (let x = y < usedHeight ? usedWidth : 0; x < png.width; x++) {
    if (png.data[(y * png.width + x) * 4 + 3] > 1) return invalid('动作网格遗漏了可见内容，不能裁掉人物边缘。');
  }
  const required = ['idle', 'walk', genre === 'platformer' ? 'jump' : 'attack'];
  if (!Array.isArray(value.animations) || value.animations.length !== 3 || new Set(value.animations.map(a => a.name)).size !== 3
    || required.some(name => !value.animations.some(a => a.name === name))) return invalid('缺少待机、移动或跳跃／攻击动作。');
  for (const animation of value.animations) {
    if (!Array.isArray(animation.frames) || animation.frames.length < (animation.name === 'idle' ? 1 : 2)
      || animation.frames.length > 16 || !animation.frames.every(n => Number.isInteger(n) && n >= 0 && n < value.columns * value.rows)
      || !Number.isFinite(animation.fps) || animation.fps < 2 || animation.fps > 30 || typeof animation.loop !== 'boolean') return invalid('动作帧或播放速度无效。');
    const silhouettes = new Set(animation.frames.map(index => {
      const left = index % value.columns * value.frameWidth, top = Math.floor(index / value.columns) * value.frameHeight;
      let x0 = value.frameWidth, y0 = value.frameHeight, x1 = -1, y1 = -1;
      for (let y = 0; y < value.frameHeight; y++) for (let x = 0; x < value.frameWidth; x++) {
        if (png.data[((top + y) * png.width + left + x) * 4 + 3] > 32) { x0 = Math.min(x0,x); y0 = Math.min(y0,y); x1 = Math.max(x1,x); y1 = Math.max(y1,y); }
      }
      if (x1 < x0 || y1 < y0) return invalid('动作图集包含空白帧。');
      const hash = createHash('sha256').update(`${x1-x0+1}:${y1-y0+1}`);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const at = ((top+y)*png.width+left+x)*4;
        hash.update(png.data[at+3] > 32 ? png.data.subarray(at,at+4) : Buffer.alloc(4));
      }
      return hash.digest('hex');
    }));
    if (animation.name !== 'idle' && silhouettes.size < 2) return invalid('移动或主动作只是重复、平移同一张静态图，没有真实姿态变化。');
  }
  return value;
}
export function characterActionControls(manifest: CharacterActionManifest): CreationActions {
  return { manifest: '.noobi/character-actions.json', states: [
    { id: 'idle', label: '待机', key: '松开按键' }, { id: 'walk', label: '移动', key: manifest.genre === 'platformer' ? 'A / D' : 'W / A / S / D' },
    manifest.genre === 'platformer' ? { id: 'jump', label: '跳跃', key: '空格' } : { id: 'attack', label: '攻击', key: 'J' },
  ] };
}

/** Host-owned inspection runs the exported scene through the existing bounded Godot runner. */
export async function inspectCharacterActionPlayback(root: string, manifest: CharacterActionManifest, service: GodotEnvironmentService, signal: AbortSignal, scene?: ScenePreviewManifest): Promise<string[]> {
  signal.throwIfAborted();
  const status = await service.getStatus();
  if (!status.tool.binaryPath) throw new CreationError('GODOT_REQUIRED', 'Godot 尚未就绪。');
  const pack = await safeCreationFile(root, 'build/web/index.pck');
  const directory = join(root, '.godot'); await mkdir(directory, { recursive: true });
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new CreationError('UNSAFE_PATH', '人物检查目录无效。');
  const nonce = randomUUID(); const script = join(directory, `noobi-actions-${nonce}.gd`), input = join(directory, `noobi-actions-${nonce}.json`);
  await writeFile(script, ACTION_INSPECTION_GDSCRIPT, { flag: 'wx' });
  await writeFile(input, JSON.stringify({ ...manifest, nonce, ...(scene ? { scene } : {}) }), { flag: 'wx' });
  try {
    const result = await runGodotProcess(status.tool.binaryPath, ['--headless', '--path', root, '--main-pack', pack, '--script', script, '--', input], { cwd: root, timeoutMs: 30_000 });
    signal.throwIfAborted();
    const line = result.stdout.split('\n').find(line => line.startsWith(`NOOBI_ACTIONS_${nonce}:`));
    const observed = line ? JSON.parse(line.slice(`NOOBI_ACTIONS_${nonce}:`.length)) : null;
    const ok = result.exitCode === 0 && !result.timedOut && !/(?:^|\n)\s*(ERROR:|SCRIPT ERROR:)/u.test(`${result.stderr}\n${result.stdout}`) && observed?.ok === true;
    const output = await engineDirectory(root);
    const temporary = join(output, `actions-${nonce}.tmp`);
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, taskId: scene?.taskId ?? manifest.taskId, manifestSha256: await creationHash(root, scene ? '.noobi/scene-preview.json' : '.noobi/character-actions.json'), ok, result, observed }, null, 2), { flag: 'wx' });
    await rename(temporary, join(output, scene ? 'scene-latest.json' : 'actions-latest.json'));
    if (!ok) throw new CreationError('ACTION_PLAYBACK_FAILED', `人物动作未通过实际播放检查：${observed?.errors?.join('；') || '动作没有响应按键、帧未变化，或引擎运行出错。'} 原人物和上一版仍保留。`);
    return [...(scene ? ['真实场景背景已接入，人物可见且比例可检查'] : []), '导出工程中的人物实际响应移动和主动作按键', '移动及主动作均播放不同姿态帧', '松开按键可回到待机'];
  } finally { await Promise.all([rm(script,{force:true}),rm(input,{force:true})]); }
}

export const ACTION_INSPECTION_GDSCRIPT = `extends SceneTree
var cfg: Dictionary
var failures: Array[String] = []
var evidence: Dictionary = {}
var actor: AnimatedSprite2D
func _initialize() -> void:
    call_deferred("inspect")
func check(value: bool, message: String) -> void:
    if not value: failures.append(message)
func key(code: int, pressed: bool) -> void:
    var event := InputEventKey.new()
    event.keycode = code
    event.physical_keycode = code
    event.pressed = pressed
    Input.parse_input_event(event)
func sample(name: String, code: int) -> void:
    var frames: Dictionary = {}
    var positions: Array = []
    if code != 0: key(code, true)
    for i in range(48):
        await create_timer(0.02).timeout
        if is_instance_valid(actor) and String(actor.animation) == name:
            frames[str(actor.frame)] = true
            positions.append([actor.global_position.x, actor.global_position.y])
    if code != 0: key(code, false)
    evidence[name] = {"frames": frames.keys(), "positions": positions}
    check(frames.size() >= (1 if name == "idle" else 2), name + " did not play distinct frames in response to input")
    if name == "walk" and positions.size() > 1:
        check(Vector2(positions[0][0], positions[0][1]).distance_to(Vector2(positions[-1][0], positions[-1][1])) > 1, "Moving input did not move the character")
    await create_timer(0.2).timeout
func inspect() -> void:
    # Headless custom SceneTree defaults to 64x64; use the exported game viewport.
    root.size = Vector2i(int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)), int(ProjectSettings.get_setting("display/window/size/viewport_height", 648)))
    cfg = JSON.parse_string(FileAccess.get_file_as_string(OS.get_cmdline_user_args()[0]))
    var packed := load(ProjectSettings.get_setting("application/run/main_scene")) as PackedScene
    if packed == null:
        failures.append("Main scene missing")
        finish()
        return
    var scene := packed.instantiate()
    root.add_child(scene)
    await process_frame
    await create_timer(0.3).timeout
    actor = scene.get_node_or_null(NodePath(cfg.spriteNode)) as AnimatedSprite2D
    if actor == null:
        failures.append("Production AnimatedSprite2D missing")
        finish()
        return
    check(actor.is_visible_in_tree() and actor.modulate.a > 0.9 and actor.self_modulate.a > 0.9, "Character is hidden")
    if cfg.has("scene"):
        var background = scene.get_node_or_null(NodePath(cfg.scene.background.node)) as Sprite2D
        if background == null:
            failures.append("Actual scene background Sprite2D missing")
        else:
            check(background.is_visible_in_tree() and background.modulate.a > 0.9 and background.self_modulate.a > 0.9, "Scene background is hidden")
            check(background.texture != null and background.texture.resource_path == "res://" + cfg.scene.background.path, "Actual scene does not use declared background")
            check(background.z_index < actor.z_index, "Background covers the character")
            var visible := root.get_visible_rect()
            var area: Rect2 = background.get_global_transform_with_canvas() * background.get_rect()
            var frame_texture := actor.sprite_frames.get_frame_texture(actor.animation, actor.frame)
            if frame_texture == null:
                failures.append("Character has no visible frame")
                finish()
                return
            var frame_size := frame_texture.get_size()
            var origin := actor.offset - (frame_size * 0.5 if actor.centered else Vector2.ZERO)
            var body: Rect2 = actor.get_global_transform_with_canvas() * Rect2(origin, frame_size)
            check(area.intersection(visible).get_area() >= visible.get_area() * 0.8, "Background does not fill the scene preview")
            check(visible.encloses(body) and body.size.y >= 24 and body.size.y <= visible.size.y * 0.65, "Character is off-screen or wrongly sized")
            evidence["scene"] = {"background": cfg.scene.background.path, "backgroundRect": str(area), "characterRect": str(body), "viewport": str(visible)}
    check(actor.sprite_frames != null and actor.sprite_frames.resource_path == "res://" + cfg.spriteFrames, "Production scene does not use declared SpriteFrames")
    if actor.sprite_frames == null:
        finish()
        return
    for animation: Dictionary in cfg.animations:
        var name: String = animation.name
        var frames: Array = animation.frames
        check(actor.sprite_frames.has_animation(name), "Missing animation " + name)
        if not actor.sprite_frames.has_animation(name): continue
        check(actor.sprite_frames.get_frame_count(name) == frames.size(), "Wrong frame count " + name)
        check(abs(actor.sprite_frames.get_animation_speed(name) - float(animation.fps)) < 0.01, "Wrong animation speed " + name)
        for i in range(min(frames.size(), actor.sprite_frames.get_frame_count(name))):
            var texture := actor.sprite_frames.get_frame_texture(name, i) as AtlasTexture
            if texture == null:
                failures.append("Frame is not a cropped atlas region")
                continue
            var index: int = int(frames[i])
            var expected := Rect2((index % int(cfg.columns)) * int(cfg.frameWidth), (index / int(cfg.columns)) * int(cfg.frameHeight), int(cfg.frameWidth), int(cfg.frameHeight))
            check(texture.atlas.resource_path == "res://" + cfg.spriteSheet and texture.region == expected, "Wrong texture or crop " + name)
    await sample("idle", 0)
    await sample("walk", KEY_D)
    await sample("jump" if cfg.genre == "platformer" else "attack", KEY_SPACE if cfg.genre == "platformer" else KEY_J)
    await sample("idle", 0)
    finish()
func finish() -> void:
    print("NOOBI_ACTIONS_" + str(cfg.nonce) + ":" + JSON.stringify({"ok": failures.is_empty(), "errors": failures, "states": evidence}))
    quit(0 if failures.is_empty() else 1)
`;
