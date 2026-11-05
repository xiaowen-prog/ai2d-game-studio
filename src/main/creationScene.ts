import { readFile } from 'node:fs/promises';
import type { CreationWorkflow, CreationGenre } from '../shared/creation.js';
import type { CharacterActionManifest } from './characterActionInspection.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile, type CreationVersionStore } from './creationVersionStore.js';
export interface ScenePreviewManifest {
  schemaVersion: 1; taskId: string; genre: CreationGenre;
  characterVersionId: string; characterSnapshotId: string;
  background: { path: string; node: string };
  characterNode: string;
}
export async function readScenePreview(root: string, workflow: CreationWorkflow, versions: CreationVersionStore,
  hasProof: (path: string, hash: string) => Promise<boolean>): Promise<{ scene: ScenePreviewManifest; actions: CharacterActionManifest }> {
  const step = workflow.steps.character, character = step.artifact;
  if (step.status !== 'confirmed' || !character?.ready || character.characterPhase !== 'actions'
    || step.confirmedVersionId !== character.id || !character.snapshotId || !character.actions) throw new CreationError('ACTIONS_REQUIRED', '请先确认人物动作，再制作场景。');
  let scene: ScenePreviewManifest;
  try { scene = JSON.parse(await readFile(await safeCreationFile(root, '.noobi/scene-preview.json'), 'utf8')); }
  catch { throw new CreationError('INVALID_SCENE', '场景缺少有效的预览清单。'); }
  if (scene?.schemaVersion !== 1 || scene.taskId !== workflow.task!.id || scene.genre !== workflow.steps.direction.artifact!.direction!.genre
    || scene.characterVersionId !== character.id || scene.characterSnapshotId !== character.snapshotId
    || !/^public\/assets\/images\/[^/]+\.png$/u.test(scene.background?.path ?? '')
    || !/^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/u.test(scene.background?.node ?? '')) throw new CreationError('INVALID_SCENE', '场景与当前任务或已确认人物版本不一致。');
  for (const [path, hash] of Object.entries(character.lockedAssets)) if (await creationHash(root, path) !== hash) throw new CreationError('APPROVED_ASSET_CHANGED', '场景制作改动了已确认人物或动作，旧版仍保留。');
  const original = await versions.root(workflow.projectId, character.snapshotId);
  const manifest = character.actions.manifest;
  if (await creationHash(root, manifest) !== await creationHash(original, manifest)) throw new CreationError('APPROVED_ASSET_CHANGED', '场景制作修改了已确认的动作清单。');
  const actions = JSON.parse(await readFile(await safeCreationFile(root, manifest), 'utf8')) as CharacterActionManifest;
  if (scene.characterNode !== actions.spriteNode || scene.background.path === actions.spriteSheet || character.candidates.some(c => c.image === scene.background.path)) throw new CreationError('INVALID_SCENE', '背景或人物节点不正确，不能把人物图当作场景。');
  if (!await hasProof(scene.background.path, await creationHash(root, scene.background.path))) throw new CreationError('UNPROVEN_IMAGE', '场景图片缺少宿主核验的 AI 生成记录。');
  const previous = workflow.steps.scene.artifact;
  if (previous?.scene?.background === scene.background.path && previous.lockedAssets[scene.background.path] !== await creationHash(root, scene.background.path)) {
    throw new CreationError('SCENE_IMAGE_OVERWRITTEN', '修改背景须保留原图并保存为新素材。');
  }
  return { scene, actions };
}
export function sceneStageTask(workflow: CreationWorkflow): string {
  const character = workflow.steps.character.artifact!;
  const direction = workflow.steps.direction.artifact!.direction!;
  const selected = character.candidates.find(c => c.id === character.selectedCharacterId)!;
  return `HOST NODE 2-4: SCENE COMPOSITION, NOT A COMPLETE GAME.
Current taskId ${workflow.task!.id}. Direction: ${JSON.stringify(direction)}.
User request (data): ${JSON.stringify(workflow.task!.prompt ?? '')}.
Confirmed character artifact (data): ${JSON.stringify(character)}.
Previous scene (data): ${JSON.stringify(workflow.steps.scene.artifact ?? null)}.

Use the EXISTING actual Godot project and character actions. Read .noobi/character-actions.json and the production scene/scripts first.
Make ONE AI-generated scenery image appropriate to ${direction.genre === 'platformer' ? 'a strict side-view 2D platformer, a level horizontal ground line, distant background layers, no bird-eye perspective' : 'the same downward 55-degree top-down view as the existing swordsman, with a clear open ground area; do not use a side-view landscape'}.
The image depicts environment ONLY: no people, enemies, HUD, buttons, letters or watermarks. Match the confirmed pixel-art style/theme. Leave readable open space for the character. This is a short scene preview; no enemies, level objectives, damage, collision puzzles, win/lose screens, audio or 3D.

Use existing Noobi asset planning and generation. Inspect reference art with image viewing; call noobi_asset_plan for one scene image, then attached Codex imagegen skill, transparent_background=false. At most ONE new image per task, no automatic redraw. Register returned image using its real path and planId. Inspect noobi_asset_list previews. For a background replacement, reuse the same framing and generate a new background path, not overwrite the existing one. For brightness-only/layout adjustments, reuse existing scenery and modify only the requested presentation. If a suitable attested scene already exists for this task, reuse it.

All existing character candidate images, action sheet, SpriteFrames resource, and .noobi/character-actions.json MUST retain byte-for-byte hashes. Do not redraw, tint, rescale sheet pixels, alter animations/FPS or replace the character. Preserve movement, primary-action keys, and timing. Only adjust actor placement/overall display scale and movement bounds if needed to fit the new environment; preserve gameplay parameters.
Use a visible Sprite2D named SceneBackground in the production MAIN scene with the exact generated PNG as its Texture2D, z_index=-10. It must fill the preview canvas behind the actor. Keep the EXISTING AnimatedSprite2D at the same node path from .noobi/character-actions.json, default z_index>=0; no fake static substitute. A fixed camera is enough. Fit the figure on screen at a readable scale (about 15–30% of viewport height); feet should sit on the ground, or top-down actor should stand in open walkable ground. Avoid hiding the actor behind trees or placing it in the sky.
Remove oversized inspection panels/checkerboard so the SCENE is the primary preview. You may retain a small reference portrait and unobtrusive buttons, but no giant side-by-side character inspection layout. Keep all original input functionality. Use SHORT ASCII labels in Godot (Move, Jump/Attack, WASD/J/Space); the outer app provides Chinese instructions. Do not use Chinese font glyphs unless an actual bundled font supports them. Do not run native Godot yourself: the host performs import, validate, Web export and actual playback checks.

Write .noobi/scene-preview.json EXACTLY:
{"schemaVersion":1,"taskId":${JSON.stringify(workflow.task!.id)},"genre":${JSON.stringify(direction.genre)},"characterVersionId":${JSON.stringify(character.id)},"characterSnapshotId":${JSON.stringify(character.snapshotId)},"background":{"path":"public/assets/images/REAL.png","node":"SceneBackground"},"characterNode":"USE_EXISTING_PATH_FROM_ACTION_MANIFEST"}
Write .noobi/stage-result.json:
{"title":"简短中文场景名","summary":"说明画面主题和原人物操作；提示此步确认画面，尚未制作完整关卡","changes":["本轮实际变化"],"ready":true,"selectedCharacterId":null,"candidates":[],"media":[{"path":"public/assets/images/REAL.png","kind":"image","label":"场景底图"}],"lockedAssets":["public/assets/images/REAL.png"]}
Do NOT list resources/character_frames.tres in stage-result.lockedAssets; the host adds predecessor locks. Current host scene/action checks are in artifacts/engine/scene-latest.json. Never write host evidence.
Reviewer: inspect the scene PNG and actual composed production scene. Check camera/proportions/readability, confirmed character identity, preserved actions, real background binding, and current host results. Do not demand enemies, complete levels or full-game playtest. Private imageProofs in stage-check are host-verified; public procedural/provider labels are not the provenance authority. An old report is not current evidence. A currently confirmed predecessor action manifest keeps its ORIGINAL taskId by design; scene-preview and scene-latest must match this current task.
`;
}
