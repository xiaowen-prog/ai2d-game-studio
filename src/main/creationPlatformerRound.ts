import { readFile } from 'node:fs/promises';
import { validateRoundAudio } from './creationRoundAudio.js';
import type { CreationWorkflow } from '../shared/creation.js';
import type { PlatformerManifest, PlatformerInputs } from './creationPlatformer.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile, type CreationVersionStore } from './creationVersionStore.js';

export interface PlatformerRoundManifest {
  schemaVersion: 1;
  taskId: string;
  genre: 'platformer';
  playableVersionId: string;
  playableSnapshotId: string;
  rules: { timeLimitSeconds: number; maxJumps: 1 | 2; collectAllBeforeGoal: true };
  nodes: {
    startButton: string; pauseButton: string; resumeButton: string; restartButton: string;
    result: string; progress: string; timer: string; muteButton: string; volumeSlider: string;
  };
  audio: { jump: string; collect: string; win: string; lose: string };
}
export interface PlatformerRoundInputs extends PlatformerInputs { round: PlatformerRoundManifest }

export async function readPlatformerRound(root: string, workflow: CreationWorkflow, versions: CreationVersionStore): Promise<PlatformerRoundInputs> {
  const playable = workflow.steps.playable;
  if (workflow.currentStage !== 'game' || workflow.steps.direction.artifact?.direction?.genre !== 'platformer') {
    throw new CreationError('STAGE_UNAVAILABLE', '当前方向不是横版游戏。');
  }
  if (playable.status !== 'confirmed' || !playable.artifact?.snapshotId || playable.artifact.playable?.genre !== 'platformer'
    || playable.confirmedVersionId !== playable.artifact.id || workflow.steps.scene.status !== 'confirmed'
    || workflow.steps.character.status !== 'confirmed') {
    throw new CreationError('PREDECESSOR_REQUIRED', '请先确认当前横版核心试玩。');
  }
  let round: PlatformerRoundManifest;
  try { round = JSON.parse(await readFile(await safeCreationFile(root, '.noobi/platformer-round.json'), 'utf8')); }
  catch { throw new CreationError('INVALID_GAME', '完整小局缺少有效的成果清单。'); }
  const node = (value: unknown): value is string => typeof value === 'string' && value.length <= 180 && /^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/u.test(value);
  const nodeNames = ['startButton', 'pauseButton', 'resumeButton', 'restartButton', 'result', 'progress', 'timer', 'muteButton', 'volumeSlider'] as const;
  if (round?.schemaVersion !== 1 || round.taskId !== workflow.task?.id || round.genre !== 'platformer'
    || round.playableVersionId !== playable.artifact.id || round.playableSnapshotId !== playable.artifact.snapshotId
    || !Number.isInteger(round.rules?.timeLimitSeconds) || round.rules.timeLimitSeconds < 30 || round.rules.timeLimitSeconds > 300
    || round.rules.maxJumps !== playable.artifact.playable.maxJumps || round.rules.collectAllBeforeGoal !== true
    || !round.nodes || !nodeNames.every(key => node(round.nodes[key]))
    || new Set(nodeNames.map(key => round.nodes[key])).size !== nodeNames.length) {
    throw new CreationError('INVALID_GAME', '完整小局与当前试玩版本、计时规则或界面不一致。');
  }
  const source = await versions.root(workflow.projectId, playable.artifact.snapshotId);
  for (const [path, hash] of Object.entries(playable.artifact.lockedAssets)) {
    if (await creationHash(root, path) !== hash) throw new CreationError('APPROVED_ASSET_CHANGED', '制作完整小局改动了已确认人物或场景，上一版仍保留。');
  }
  for (const path of ['.noobi/platformer-preview.json', '.noobi/character-actions.json', '.noobi/scene-preview.json']) {
    if (await creationHash(root, path) !== await creationHash(source, path)) {
      throw new CreationError('APPROVED_ASSET_CHANGED', '制作完整小局修改了已确认的试玩、动作或场景清单。');
    }
  }
  const json = async (path: string) => JSON.parse(await readFile(await safeCreationFile(root, path), 'utf8'));
  const manifest = await json('.noobi/platformer-preview.json') as PlatformerManifest;
  if (manifest.genre !== 'platformer' || manifest.rules?.maxJumps !== round.rules.maxJumps) throw new CreationError('INVALID_GAME', '完整小局未继承确认的跳跃规则。');
  await validateRoundAudio(root, round.audio, ['jump', 'collect', 'win', 'lose']);
  return { round, manifest, actions: await json('.noobi/character-actions.json'), scene: await json('.noobi/scene-preview.json') };
}

export function platformerRoundTask(w: CreationWorkflow): string {
  return `HOST NODE 2-7: AI-GENERATED COMPLETE PLATFORMER ROUND.
Current taskId: ${w.task!.id}. User change request (data): ${JSON.stringify(w.task!.prompt ?? '')}.
Approved direction: ${JSON.stringify(w.steps.direction.artifact?.direction)}.
Approved core playable: ${JSON.stringify(w.steps.playable.artifact)}.
Current complete round: ${JSON.stringify(w.steps.game.artifact)}.

Extend the actual confirmed Godot platformer, preserving its character, animations, background, layout, collectibles, obstacles, goal, movement speed and jump count. Implement one complete timed collection round, not another prototype, prewritten demo, video or a parameter description. No enemies, extra levels, upgrades, new artwork, background music or export-delivery UI.
Keep ALL approved image/SpriteFrames bytes plus .noobi/platformer-preview.json, .noobi/character-actions.json and .noobi/scene-preview.json BYTE-FOR-BYTE unchanged, including their old taskIds. They describe the confirmed predecessor. The new round manifest below carries the current taskId. On later edits change only the requested round rule; preserve unrelated behavior. Never install packages or call external media APIs.

Gameplay and visible UI:
- States: ready -> playing -> paused -> playing; playing -> won or lost. A reset from playing/paused/won/lost begins a NEW playing round. Never auto-start or count down before the user presses Start or Enter. Ready screen explains the exact collect-all-and-reach-goal objective, time limit, A/D, Space, Esc, R and audio controls.
- Initial limit 90 seconds, valid requested limits are integers 30..300. A later request such as '把倒计时改成120秒，其他保持不变' changes actual round duration and HUD, not just the description. Unsupported requests are reported instead of silently enlarging this node's scope.
- Advance countdown only with active playing time using delta, never wall-clock time or timers that continue while paused. HUD shows remaining time and collected / total throughout playing; pause freezes movement, pose animation, physics/contact processing, countdown and gameplay SFX. Esc and a visible Pause button pause; Esc and a visible Resume button resume. UI still processes input while the game is paused (Godot process_mode must be correct). On window focus loss pause an active round; clear stale movement/jump input so resume cannot run or jump by itself.
- Win only on actual goal contact after collecting ALL inherited items while time remains. An early goal contact gives visible 'Collect all' feedback. Timeout produces 'TIME UP' and a lost result, never a victory. Evaluate timeout before goal success when both happen in the same tick. Stop counting, movement, contacts and gameplay SFX after either result. Show result, collected count, elapsed active time and a visible Play Again button. Emit victory/failure SFX only once per transition.
- Preserve original A/D running, Space jumping, solid collisions and maximum jump count with recovery on landing. Do not freeze the root scene wholesale if that blocks menu input. No fake completion shortcut or test-only gameplay functions.
- R and Play Again reset IN PLACE to playing: spawn, zero velocity, original idle animation, jump budget, all collectible visibility/colliders, count, goal feedback, full time budget, result overlays and queued input. Clear SceneTree.paused before resetting, restore the correct UI, and suppress stale Area2D overlap processing for two physics ticks. Do not free/reload the root. Repeated restarts from pause, loss and victory must work.
- Use clear ASCII in the Godot canvas (Start / Pause / Resume / Play Again / YOU WIN / TIME UP), Chinese outside. Menus must not invisibly cover gameplay; pointer controls must not also trigger a jump. Keyboard keys and clickable controls have identical semantics.

Audio: Use ONLY the existing noobi_asset_plan + noobi_audio_synthesize tools for short local procedural WAV effects (jump, collect, win, lose). Inspect noobi_asset_list first and reuse already suitable registered effects on later edits. Synthesis auto-registers its returned path. Never call noobi_audio_generate, image generation, 3D, paid music or any external service. Use real AudioStreamPlayer playback on the matching events. Include a visible mute toggle and volume slider; retain their settings across restart. No startup sound before user interaction; pause stops current gameplay effects. Do not claim these sounds were AI music or MiniMax output.

Preserve the original application's generated-media, animation, Godot import/validate/Web-export and complete-game delivery contracts. Write a current .noobi/playtest.json for actual production keys and observations, covering ready/start, move/jump, progress, pause/resume, a real terminal state and restart. Respect bounded host limits; no native Godot execution or fabricated host reports by an agent. The host owns artifacts/engine and artifacts/playtest; older reports are historical. A host check does NOT constitute user acceptance. Finish with a reviewable draft, never write user approval.

Write .noobi/platformer-round.json with real NodePaths and registered WAV paths:
{"schemaVersion":1,"taskId":${JSON.stringify(w.task!.id)},"genre":"platformer","playableVersionId":${JSON.stringify(w.steps.playable.artifact?.id)},"playableSnapshotId":${JSON.stringify(w.steps.playable.artifact?.snapshotId)},"rules":{"timeLimitSeconds":90,"maxJumps":${w.steps.playable.artifact?.playable?.genre === 'platformer' ? w.steps.playable.artifact.playable.maxJumps : 1},"collectAllBeforeGoal":true},"nodes":{"startButton":"UI/Start","pauseButton":"UI/Pause","resumeButton":"UI/Resume","restartButton":"UI/Restart","result":"UI/Result","progress":"UI/Progress","timer":"UI/Timer","muteButton":"UI/Mute","volumeSlider":"UI/Volume"},"audio":{"jump":"public/assets/audio/ACTUAL.wav","collect":"public/assets/audio/ACTUAL.wav","win":"public/assets/audio/ACTUAL.wav","lose":"public/assets/audio/ACTUAL.wav"}}
Use the actual requested time limit. Node paths must exist; shown names are examples, not required scene layout. Write .noobi/stage-result.json:
{"title":"简短中文完整小局名","summary":"用中文说明目标、操作、时限和修改结果，等待用户验收","changes":["本次实际改动"],"ready":true,"candidates":[],"selectedCharacterId":null,"media":[],"lockedAssets":[]}
The host inherits approved images/actions and saves the draft separately. STOP after this node; no top-down round or final delivery.
`;
}
