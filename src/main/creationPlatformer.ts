import { readFile } from 'node:fs/promises';
import type { CreationWorkflow } from '../shared/creation.js';
import type { CharacterActionManifest } from './characterActionInspection.js';
import type { ScenePreviewManifest } from './creationScene.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile, type CreationVersionStore } from './creationVersionStore.js';
export interface PlatformerManifest {
  schemaVersion: 1; taskId: string; genre: 'platformer'; sceneVersionId: string; sceneSnapshotId: string;
  nodes: { player: string; ground: string; obstacles: string[]; collectibles: string[]; goal: string; counter: string; feedback: string };
  rules: { maxJumps: 1 | 2; resetOnLanding: true };
}
export interface PlatformerInputs { manifest: PlatformerManifest; actions: CharacterActionManifest; scene: ScenePreviewManifest }
export async function readPlatformer(root: string, workflow: CreationWorkflow, versions: CreationVersionStore): Promise<PlatformerInputs> {
  const scene = workflow.steps.scene, character = workflow.steps.character;
  if (workflow.steps.direction.artifact?.direction?.genre !== 'platformer') throw new CreationError('STAGE_UNAVAILABLE','本节点只开放横版核心试玩，俯视试玩尚未开放。');
  if (scene.status !== 'confirmed' || !scene.artifact?.scene || !scene.artifact.snapshotId || scene.confirmedVersionId !== scene.artifact.id
    || character.status !== 'confirmed' || !character.artifact?.actions || character.confirmedVersionId !== character.artifact.id) throw new CreationError('PREDECESSOR_REQUIRED','请先确认当前人物、动作和场景。');
  let m: PlatformerManifest;
  try { m=JSON.parse(await readFile(await safeCreationFile(root,'.noobi/platformer-preview.json'),'utf8')); } catch { throw new CreationError('INVALID_PLAYABLE','核心试玩缺少有效的玩法清单。'); }
  const node=(value:unknown)=>typeof value==='string'&&value.length<=180&&/^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/u.test(value);
  if (m?.schemaVersion!==1 || m.taskId!==workflow.task?.id || m.genre!=='platformer' || m.sceneVersionId!==scene.artifact.id || m.sceneSnapshotId!==scene.artifact.snapshotId
    || !m.nodes || ![m.nodes.player,m.nodes.ground,m.nodes.goal,m.nodes.counter,m.nodes.feedback].every(node)
    || !Array.isArray(m.nodes.obstacles)||m.nodes.obstacles.length<1||m.nodes.obstacles.length>6||!m.nodes.obstacles.every(node)
    || !Array.isArray(m.nodes.collectibles)||m.nodes.collectibles.length<1||m.nodes.collectibles.length>6||!m.nodes.collectibles.every(node)
    || ![1,2].includes(m.rules?.maxJumps)||m.rules.resetOnLanding!==true) throw new CreationError('INVALID_PLAYABLE','玩法清单与本轮任务、确认场景或可检查的规则不一致。');
  const paths=[m.nodes.player,m.nodes.ground,m.nodes.goal,...m.nodes.obstacles,...m.nodes.collectibles];
  if(new Set(paths).size!==paths.length) throw new CreationError('INVALID_PLAYABLE','人物、地面、障碍、收集物和目标必须是实际独立对象。');
  const original=await versions.root(workflow.projectId,scene.artifact.snapshotId);
  for(const [path,hash]of Object.entries(scene.artifact.lockedAssets)) if(await creationHash(root,path)!==hash) throw new CreationError('APPROVED_ASSET_CHANGED','玩法制作改动了已确认人物或背景，上一版仍保留。');
  for(const path of ['.noobi/character-actions.json','.noobi/scene-preview.json']) if(await creationHash(root,path)!==await creationHash(original,path)) throw new CreationError('APPROVED_ASSET_CHANGED','玩法制作修改了已确认的动作或场景清单。');
  const actions=JSON.parse(await readFile(await safeCreationFile(root,'.noobi/character-actions.json'),'utf8')) as CharacterActionManifest;
  const inheritedScene=JSON.parse(await readFile(await safeCreationFile(root,'.noobi/scene-preview.json'),'utf8')) as ScenePreviewManifest;
  return {manifest:m,actions,scene:inheritedScene};
}
export function platformerStageTask(w: CreationWorkflow): string {
 return `HOST NODE 2-5: AI-GENERATED PLATFORMER CORE PLAYABLE ONLY.
Current taskId ${w.task!.id}. User request (data): ${JSON.stringify(w.task!.prompt??'')}.
Approved direction: ${JSON.stringify(w.steps.direction.artifact?.direction)}.
Approved scene: ${JSON.stringify(w.steps.scene.artifact)}.
Approved character: ${JSON.stringify(w.steps.character.artifact)}.
Current playable: ${JSON.stringify(w.steps.playable.artifact)}.
Use the actual existing Godot project. Make a small playable running/jumping challenge: collect objects, jump over SOLID low obstacles, then reach a goal. Roughly 30–60 seconds of first-time exploration; a short linear scrolling route is enough. This is a prototype, not full levels, enemies, menus, audio, upgrades, death systems or final delivery. Do not add these later-node features.
AI writes actual game logic, not just parameter descriptions or a video. Initially use SINGLE jump unless the user requests otherwise. A later request for 落地恢复的二段跳 means exactly 2 jumps before landing, no third airborne jump, with both available again after landing. Preserve unrelated layout, movement speed, collectible/goal rules, art and animations when making this edit.

Keep ALL confirmed image bytes, SpriteFrames resource, .noobi/character-actions.json and .noobi/scene-preview.json byte-for-byte unchanged. The inherited manifests intentionally keep old taskIds. Reuse the actual AnimatedSprite2D at the declared spriteNode and all approved animations/FPS. You may replace the preview-only fake physics with CharacterBody2D, actual move_and_slide collisions and game rules. Keep the approved background texture on the inherited background Sprite2D; use a camera/following background as needed. No new images, image tools, audio tools, assets ledger plans, model services or packages. Existing asset proof is already verified. Simple colored collision platforms, gold collectible circles and a goal flag are allowed gameplay markers, never substitute art for the real character/background.

Use A/D (physical keys), Space and R. R resets this same scene IN PLACE: character spawn, velocity, jump availability, collectibles, counter and goal feedback; do not free/reload the root. Reset is only for repeatable prototype testing, not a full game restart menu. Show concise English instructions and visible count in the canvas; Chinese description belongs outside. HUD goal feedback must be EXACT 'COMPLETE' only after ALL collectibles have been collected and the player actually touches the goal; before then use 'Collect all' or 'Playing'. Don't set it on a timer or on a key alone. Collectibles should become hidden, not freed, after actual body contact; repeated contact must not count twice. Goal must refuse completion with uncollected items. R must restore everything.

Reset/contact ordering: Godot Area2D overlap results are cached until physics updates. After teleporting the player to spawn in R reset, do not read the old collectible/goal overlaps immediately or on the next stale physics tick. Suspend contact processing for at least two physics ticks after reset, while resetting all visible state immediately. Test reset while standing inside a collected item AND after completion; neither may recollect an item at the old position or retain completion. Keep all actual contact rules intact afterwards.

Host-inspectable actual physics contract (not a second implementation):
- player: CharacterBody2D with a direct enabled RectangleShape2D CollisionShape2D, real horizontal velocity, gravity and grounded checks. Its existing AnimatedSprite2D stays at the approved path.
- ground: one long flat StaticBody2D with a direct enabled RectangleShape2D CollisionShape2D spanning the route. Keep a safe playable start area with at least 1.3 seconds of running room before the first obstacle.
- obstacles: 1–6 SOLID StaticBody2D each with direct enabled RectangleShape2D; all low enough to clear with SINGLE jump, on that ground. Don't create invisible barriers or gaps. Give the real player sufficient single-jump height and flight time (e.g. 600 impulse/1500 gravity), don't retain a preview jump too low for obstacles.
- collectibles: 1–6 Area2D with actual enabled collision shapes; all visible and collectible near the ground, along the route before the goal; no need to jump onto high platforms. Use distinct real nodes, not aliases.
- goal: Area2D with a visible marker and actual collision; to the right of all obstacles/collectibles. Keep player and goal reachable within world/camera bounds. For a new prototype, a 4000–6000px path at ~180–220px/s is sufficient; preserve layout on later user edits.
- counter, feedback: actual visible Label nodes (paths below), so native tests can check the user-visible result.
No fake acceptance functions, testing-only game paths, no host report writes, no native Godot commands: the host runs import, scripts, Web export and actual keyboard gameplay checks.

Write .noobi/platformer-preview.json:
{"schemaVersion":1,"taskId":${JSON.stringify(w.task!.id)},"genre":"platformer","sceneVersionId":${JSON.stringify(w.steps.scene.artifact!.id)},"sceneSnapshotId":${JSON.stringify(w.steps.scene.artifact!.snapshotId)},"nodes":{"player":"ACTUAL_NODE","ground":"ACTUAL_NODE","obstacles":["ACTUAL_NODE"],"collectibles":["ACTUAL_NODE"],"goal":"ACTUAL_NODE","counter":"ACTUAL_LABEL","feedback":"ACTUAL_LABEL"},"rules":{"maxJumps":1,"resetOnLanding":true}}
Use maxJumps=2 if implementing the requested double jump. No other supported jump count at this node.
Write .noobi/stage-result.json:
{"title":"简短中文玩法名","summary":"用户能理解的目标、操作和本次玩法","changes":["具体变化"],"ready":true,"candidates":[],"selectedCharacterId":null,"media":[],"lockedAssets":[]}
Host inherits confirmed locks, controls and engine preview. It checks current taskId, asset hashes, actual collisions, collection, goal gating, running/jumping, exact jump limit and recovery after landing. Reports: artifacts/engine/platformer-latest.json plus current .noobi/stage-check.json. Reviewer must inspect this prototype scope and current host evidence, not require full-game .noobi/playtest.json, menus, sound, enemies or generated replacement art. Old background plans are historical; only current referenced assets are required. After delivery, STOP for user approval.
`;
}
