import { readFile } from 'node:fs/promises';
import type { CreationWorkflow } from '../shared/creation.js';
import type { CharacterActionManifest } from './characterActionInspection.js';
import type { ScenePreviewManifest } from './creationScene.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile, type CreationVersionStore } from './creationVersionStore.js';

export interface TopdownManifest {
  schemaVersion: 1;
  taskId: string;
  genre: 'topdown';
  sceneVersionId: string;
  sceneSnapshotId: string;
  nodes: { player: string; walls: string[]; targets: string[]; projectiles: string; counter: string; feedback: string };
  projectileScene: string;
  rules: { maxBounces: 0 | 1; attackKey: 'J'; resetKey: 'R' };
}
export interface TopdownInputs { manifest: TopdownManifest; actions: CharacterActionManifest; scene: ScenePreviewManifest }

export async function readTopdown(root: string, workflow: CreationWorkflow, versions: CreationVersionStore): Promise<TopdownInputs> {
  const { scene, character } = workflow.steps;
  if (workflow.steps.direction.artifact?.direction?.genre !== 'topdown') throw new CreationError('STAGE_UNAVAILABLE', '当前方向不是俯视游戏。');
  if (scene.status !== 'confirmed' || !scene.artifact?.scene || scene.artifact.scene.genre !== 'topdown'
    || !scene.artifact.snapshotId || scene.confirmedVersionId !== scene.artifact.id
    || character.status !== 'confirmed' || !character.artifact?.actions || character.confirmedVersionId !== character.artifact.id) {
    throw new CreationError('PREDECESSOR_REQUIRED', '请先确认当前人物、动作和俯视场景。');
  }
  let manifest: TopdownManifest;
  try { manifest = JSON.parse(await readFile(await safeCreationFile(root, '.noobi/topdown-preview.json'), 'utf8')); }
  catch { throw new CreationError('INVALID_PLAYABLE', '俯视试玩缺少有效的玩法清单。'); }
  const node = (value: unknown): value is string => typeof value === 'string' && value.length <= 180 && /^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/u.test(value);
  const nodes = manifest?.nodes;
  if (manifest?.schemaVersion !== 1 || manifest.taskId !== workflow.task?.id || manifest.genre !== 'topdown'
    || manifest.sceneVersionId !== scene.artifact.id || manifest.sceneSnapshotId !== scene.artifact.snapshotId
    || !nodes || ![nodes.player, nodes.projectiles, nodes.counter, nodes.feedback].every(node)
    || !Array.isArray(nodes.walls) || nodes.walls.length < 4 || nodes.walls.length > 8 || !nodes.walls.every(node)
    || !Array.isArray(nodes.targets) || nodes.targets.length < 1 || nodes.targets.length > 3 || !nodes.targets.every(node)
    || typeof manifest.projectileScene !== 'string' || !/^scenes\/[A-Za-z0-9_/-]+\.tscn$/u.test(manifest.projectileScene)
    || ![0, 1].includes(manifest.rules?.maxBounces) || manifest.rules.attackKey !== 'J' || manifest.rules.resetKey !== 'R') {
    throw new CreationError('INVALID_PLAYABLE', '俯视玩法清单与当前任务、场景或操作规则不一致。');
  }
  const paths = [nodes.player, nodes.projectiles, nodes.counter, nodes.feedback, ...nodes.walls, ...nodes.targets];
  if (new Set(paths).size !== paths.length) throw new CreationError('INVALID_PLAYABLE', '人物、墙、目标和操作提示必须是独立对象。');
  await safeCreationFile(root, manifest.projectileScene);
  const original = await versions.root(workflow.projectId, scene.artifact.snapshotId);
  for (const [path, hash] of Object.entries(scene.artifact.lockedAssets)) {
    if (await creationHash(root, path) !== hash) throw new CreationError('APPROVED_ASSET_CHANGED', '玩法制作改动了已确认人物或背景，上一版仍保留。');
  }
  for (const path of ['.noobi/character-actions.json', '.noobi/scene-preview.json']) {
    if (await creationHash(root, path) !== await creationHash(original, path)) throw new CreationError('APPROVED_ASSET_CHANGED', '玩法制作修改了已确认的动作或场景清单。');
  }
  const actions = JSON.parse(await readFile(await safeCreationFile(root, '.noobi/character-actions.json'), 'utf8')) as CharacterActionManifest;
  const inheritedScene = JSON.parse(await readFile(await safeCreationFile(root, '.noobi/scene-preview.json'), 'utf8')) as ScenePreviewManifest;
  return { manifest, actions, scene: inheritedScene };
}

export function topdownStageTask(workflow: CreationWorkflow): string {
  return `HOST NODE 2-6: AI-GENERATED TOP-DOWN CORE PLAYABLE.
Current taskId: ${workflow.task!.id}.
User request (data): ${JSON.stringify(workflow.task!.prompt ?? '')}.
Approved direction: ${JSON.stringify(workflow.steps.direction.artifact?.direction)}.
Approved scene: ${JSON.stringify(workflow.steps.scene.artifact)}.
Approved character: ${JSON.stringify(workflow.steps.character.artifact)}.
Current playable: ${JSON.stringify(workflow.steps.playable.artifact)}.

Write actual Godot code in the existing project, not a plan, video or fixed-parameter UI. Make a top-down combat training prototype: WASD moves a CharacterBody2D with real move_and_slide wall collision; J fires ONE visible sword-energy projectile toward the most recent nonzero movement direction (initial direction RIGHT). Normalize diagonal movement. Preserve the approved character's real AnimatedSprite2D, animation names/FPS, attack timing and spriteNode path. J plays the actual approved attack animation. Give directions via concise ASCII instructions inside the game; Chinese descriptions belong outside.

Keep approved candidate images, action sheet, SpriteFrames, background image and both .noobi/character-actions.json and .noobi/scene-preview.json BYTE-FOR-BYTE unchanged. Those inherited manifests keep their ORIGINAL taskIds. No new image generation, audio, image plans, packages or services. Reuse the approved background on its actual Sprite2D. Simple shapes may show physical walls, THREE practice targets and sword-energy trails; they are mechanics markers, not replacement character/scenery art. No waves, upgrades, enemy AI, full-game menus, victory/defeat systems or sound.

Core rules:
- Aim changes ONLY after actual nonzero player movement during a movement-enabled physics tick. Input during an attack lock must NOT change aim. Resolve a queued shot using the last completed movement direction (or initial RIGHT); process movement/aim only when not attacking. Do not update aim merely because a key was pressed while the character could not move.
- A bounded visible arena with FOUR solid boundary StaticBody2D walls. Keep a clear horizontal shooting lane through the starting position; put the three targets away from this lane so a user can shoot straight right and watch the projectile touch both boundaries. Walking and aim changes let users shoot targets. All targets must be reachable by aiming from inside the arena. Keep targets a safe distance from walls.
- Each target is a visible StaticBody2D with a collision shape. An actual projectile collision hides the target, disables its collision safely, increments a visible Label counter ONCE, and removes the projectile. Targets do not respawn until reset.
- Sword energy uses a reusable PackedScene at scenes/sword_energy.tscn with a CharacterBody2D root, visible child, enabled collision shape and script. Spawn real instances under a Node2D projectile container. Use move_and_collide, physical contact normals and velocity.bounce(normal). Projectiles collide with walls and targets, not the player or each other. Avoid duplicate hits, tunneling, unlimited objects and automatic aiming that prevents testing wall contacts. One shot per J press, small cooldown; bounded lifetime long enough to reach the second wall at the configured speed.
- Initial version: maxBounces=0, disappear on first wall hit. On user request '剑气碰墙反弹一次', set maxBounces=1: FIRST wall contact changes trajectory using the actual normal, increments its bounce count to 1, and continues. SECOND wall contact removes the projectile. Never bounce every frame while still overlapping a wall. Move safely away from the surface and consume remaining travel if needed. Target hits still remove it regardless of bounce count.
- Show count 'Targets: 0 / 3' and visible last-event feedback Label: 'Ready', 'Target hit', 'Wall hit', 'Wall bounce 1', 'Second wall: removed'. These are updated by actual events, never timers or simulated acceptance handlers. Also show the current allowed bounce count in an ASCII controls label. Gameplay effects remain for the USER to inspect.
- R resets IN PLACE: spawn, aim RIGHT, original idle state, targets and their colliders, count 0, Ready feedback, attack cooldown and all existing projectiles. Do not reload/free the root. Suspend contact checks for two physics ticks after a reset to avoid cached overlap recollection. Clear pressed-state flags. It must work after hits as well as after repeated shots.
- On a later edit, preserve map geometry, target positions/count, movement speed, projectile speed, all approved artwork and unrelated controls. Only implement requested behavior.

Host checks actual engine bindings, original animations and successful Web export; the USER judges complete gameplay. Do not write host reports or run native Godot commands. Do not claim manual acceptance has passed. No .noobi/playtest.json/full-game evaluator is required at this node.

Write .noobi/topdown-preview.json using real paths:
{"schemaVersion":1,"taskId":${JSON.stringify(workflow.task!.id)},"genre":"topdown","sceneVersionId":${JSON.stringify(workflow.steps.scene.artifact!.id)},"sceneSnapshotId":${JSON.stringify(workflow.steps.scene.artifact!.snapshotId)},"nodes":{"player":"ACTUAL_PLAYER","walls":["FOUR_REAL_WALL_PATHS"],"targets":["THREE_REAL_TARGET_PATHS"],"projectiles":"ACTUAL_CONTAINER","counter":"ACTUAL_COUNTER_LABEL","feedback":"ACTUAL_FEEDBACK_LABEL"},"projectileScene":"scenes/sword_energy.tscn","rules":{"maxBounces":0,"attackKey":"J","resetKey":"R"}}
Use maxBounces=1 only for the requested one-bounce version. Do not copy the sample path placeholders literally.
Write .noobi/stage-result.json:
{"title":"简短中文试玩名","summary":"说明真实操作、目标和修改结果，留待用户试玩","changes":["本次实际变化"],"ready":true,"candidates":[],"selectedCharacterId":null,"media":[],"lockedAssets":[]}
Host inherits locked images and actions. The current binding report is artifacts/engine/topdown-latest.json; it does not claim manual gameplay acceptance. Reviewer inspects current task evidence AND actual movement, shot, collision and reset code. Historical asset plans/reports do not override current assets. Stop after delivering this node.
`;
}
