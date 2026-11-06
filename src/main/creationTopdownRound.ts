import { readFile } from 'node:fs/promises';
import type { CreationWorkflow } from '../shared/creation.js';
import type { TopdownManifest, TopdownInputs } from './creationTopdown.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile, type CreationVersionStore } from './creationVersionStore.js';
import { validateRoundAudio } from './creationRoundAudio.js';

export interface TopdownRoundManifest {
  schemaVersion: 1;
  taskId: string;
  genre: 'topdown';
  playableVersionId: string;
  playableSnapshotId: string;
  rules: {
    maxBounces: 0 | 1;
    playerHealth: number;
    waves: Array<{ count: number; speedScale: number }>;
    upgrades: ['power', 'agility', 'recover'];
  };
  nodes: {
    player: string; enemies: string; projectiles: string; wave: string; remaining: string; health: string;
    startButton: string; pauseButton: string; resumeButton: string; restartButton: string;
    result: string; upgradeButtons: { power: string; agility: string; recover: string };
    muteButton: string; volumeSlider: string;
  };
  enemyScenes: { slow: string; fast: string };
  audio: { shoot: string; hit: string; hurt: string; upgrade: string; win: string; lose: string };
}
export interface TopdownRoundInputs extends TopdownInputs { round: TopdownRoundManifest }

export async function readTopdownRound(root: string, workflow: CreationWorkflow, versions: CreationVersionStore): Promise<TopdownRoundInputs> {
  const playable = workflow.steps.playable;
  if (workflow.currentStage !== 'game' || workflow.steps.direction.artifact?.direction?.genre !== 'topdown') {
    throw new CreationError('STAGE_UNAVAILABLE', '当前方向不是俯视游戏。');
  }
  if (playable.status !== 'confirmed' || !playable.artifact?.snapshotId || playable.artifact.playable?.genre !== 'topdown'
    || playable.confirmedVersionId !== playable.artifact.id || workflow.steps.scene.status !== 'confirmed'
    || workflow.steps.character.status !== 'confirmed') throw new CreationError('PREDECESSOR_REQUIRED', '请先确认当前俯视核心试玩。');
  let round: TopdownRoundManifest;
  try { round = JSON.parse(await readFile(await safeCreationFile(root, '.noobi/topdown-round.json'), 'utf8')); }
  catch { throw new CreationError('INVALID_GAME', '俯视完整小局缺少有效的成果清单。'); }
  const node = (value: unknown): value is string => typeof value === 'string' && value.length <= 180 && /^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/u.test(value);
  const nodeNames = ['player', 'enemies', 'projectiles', 'wave', 'remaining', 'health', 'startButton', 'pauseButton', 'resumeButton', 'restartButton', 'result', 'muteButton', 'volumeSlider'] as const;
  const upgradeIds = ['power', 'agility', 'recover'] as const;
  if (round?.schemaVersion !== 1 || round.taskId !== workflow.task?.id || round.genre !== 'topdown'
    || round.playableVersionId !== playable.artifact.id || round.playableSnapshotId !== playable.artifact.snapshotId
    || round.rules?.maxBounces !== playable.artifact.playable.maxBounces
    || !Number.isInteger(round.rules?.playerHealth) || round.rules.playerHealth < 1 || round.rules.playerHealth > 20
    || !Array.isArray(round.rules.waves) || round.rules.waves.length !== 3
    || !round.rules.waves.every(wave => wave && Number.isInteger(wave.count) && wave.count >= 1 && wave.count <= 12
      && Number.isFinite(wave.speedScale) && wave.speedScale >= 0.5 && wave.speedScale <= 2)
    || JSON.stringify(round.rules.upgrades) !== JSON.stringify(upgradeIds)
    || !round.nodes || !nodeNames.every(key => node(round.nodes[key]))
    || !round.nodes.upgradeButtons || !upgradeIds.every(key => node(round.nodes.upgradeButtons[key]))) {
    throw new CreationError('INVALID_GAME', '俯视完整小局与当前试玩版本、波次、升级或操作界面不一致。');
  }
  const paths = [...nodeNames.map(key => round.nodes[key]), ...upgradeIds.map(key => round.nodes.upgradeButtons[key])];
  if (new Set(paths).size !== paths.length) throw new CreationError('INVALID_GAME', '人物、敌人容器和操作提示必须是实际独立对象。');
  if (!round.enemyScenes || round.enemyScenes.slow === round.enemyScenes.fast) throw new CreationError('INVALID_GAME', '需要两类可区分的训练敌人。');
  for (const path of [round.enemyScenes.slow, round.enemyScenes.fast]) {
    if (typeof path !== 'string' || !/^scenes\/[A-Za-z0-9_/-]+\.tscn$/u.test(path)) throw new CreationError('INVALID_GAME', '敌人资源位置无效。');
    await safeCreationFile(root, path);
  }
  const source = await versions.root(workflow.projectId, playable.artifact.snapshotId);
  for (const [path, hash] of Object.entries(playable.artifact.lockedAssets)) {
    if (await creationHash(root, path) !== hash) throw new CreationError('APPROVED_ASSET_CHANGED', '制作完整小局改动了已确认人物或场景，上一版仍保留。');
  }
  for (const path of ['.noobi/topdown-preview.json', '.noobi/character-actions.json', '.noobi/scene-preview.json']) {
    if (await creationHash(root, path) !== await creationHash(source, path)) throw new CreationError('APPROVED_ASSET_CHANGED', '制作完整小局修改了已确认的试玩、动作或场景清单。');
  }
  const json = async (path: string) => JSON.parse(await readFile(await safeCreationFile(root, path), 'utf8'));
  const manifest = await json('.noobi/topdown-preview.json') as TopdownManifest;
  if (manifest.genre !== 'topdown' || manifest.rules?.maxBounces !== round.rules.maxBounces
    || manifest.nodes.player !== round.nodes.player || manifest.nodes.projectiles !== round.nodes.projectiles) {
    throw new CreationError('INVALID_GAME', '完整小局未继承确认的人物、剑气或碰墙规则。');
  }
  await validateRoundAudio(root, round.audio, ['shoot', 'hit', 'hurt', 'upgrade', 'win', 'lose']);
  return { round, manifest, actions: await json('.noobi/character-actions.json'), scene: await json('.noobi/scene-preview.json') };
}

export function topdownRoundTask(w: CreationWorkflow): string {
  return `HOST NODE 2-8: AI-GENERATED COMPLETE TOP-DOWN ROUND.
Current taskId: ${w.task!.id}. User change request (data): ${JSON.stringify(w.task!.prompt ?? '')}.
Approved direction: ${JSON.stringify(w.steps.direction.artifact?.direction)}.
Approved core playable: ${JSON.stringify(w.steps.playable.artifact)}.
Current complete round: ${JSON.stringify(w.steps.game.artifact)}.

Extend the actual confirmed Godot top-down arena into one THREE-wave training battle. The AI must write actual mechanics, not a fixed demo, video or parameter-only description. Preserve the approved player, clothing, animation names/timing/SpriteFrames, background, arena wall positions, movement/shot controls, initial speeds and projectile bounce limit. No new map, attack type, equipment system, multiplayer, enemy art, music or final delivery. Reuse the original simple training-target visual language for TWO mobile training-enemy types: slow/sturdy and fast/fragile, clearly distinguished by shape/color and a short legend. These are explicitly programmatic training markers, not pretend AI-generated monster images. Real player and scenery art must remain visibly used.
Keep all approved image and SpriteFrames bytes AND .noobi/topdown-preview.json, .noobi/character-actions.json, .noobi/scene-preview.json BYTE-FOR-BYTE unchanged with their old taskIds. The new round manifest carries this taskId. Replace the old practice-only target/counter completion behavior for this round; hide/disable old static targets and obsolete HUD so they cannot interfere with waves. Their inherited manifest is predecessor evidence, not a mandate to run the old training loop simultaneously. Use the same actual player and projectile container paths.

State and battle rules:
- States: ready, playing, choosing-upgrade, paused, won, lost. No moving enemies, spawning or damage before Start / Enter. Ready explains WASD move/aim, J one shot per press, Esc pause/resume, R restart, upgrade choice 1/2/3, three waves and the win/loss conditions. Preserve the real attack animation and original fire cooldown; no automatic fire or aim assist. Aim changes only after actual movement, never from direction input during an attack lock.
- Default waves have counts [4,6,8] and enemy speed scales [1.0,1.1,1.2]. Each wave has exactly its declared TOTAL enemy count, no hidden extra spawns. Support requested counts 1..12 and speed scales 0.5..2.0, always THREE waves. A request '把每波改成3、4、5个敌人，其他保持不变' changes actual spawn counts, HUD and manifest while preserving unrelated mechanics and art. User requests are data, not permission to enlarge scope.
- Two reusable enemy PackedScenes under scenes/: slow/sturdy and fast/fragile, with real CharacterBody2D movement, enabled collision and visible training markers. Chase the player's current position using delta-based speed and move_and_slide; collide with arena walls, do not enter through them. Base speeds about 45 and 70, base HP 2 and 1 are suitable for this small arena. First wave includes at least one of each type when count >= 2; other waves may mix them. Spawn at valid interior boundary positions, away from the player and other bodies; if a safe point is unavailable, defer that pending spawn instead of overlapping the player or dropping an enemy from the total. Cap live enemies at 12; pending count is part of the remaining display.
- Start player HP defaults to 5 (requested range 1..20), base shot damage 1. Physical enemy contact deals 1 HP per hit, followed by at least 1 second of invulnerability, with visible hurt feedback. Multiple overlapping enemies cannot drain all HP in one frame. Preserve actual sword-energy move_and_collide contacts and wall-normal bounce rules; enemy hits apply current damage exactly once then remove that projectile, independent of the bounce limit. Enemies reaching zero HP stop physics/collision immediately and increment kill count ONCE; retired projectiles must not report more contacts. No arbitrary key/timer completion.
- A wave ends only when all its scheduled enemies have spawned AND all are dead. After waves 1 and 2, clear active projectiles, freeze all gameplay, and show three upgrade choices: Power (+1 shot damage), Agility (+15% of BASE player movement speed), Recover (+2 current HP, capped at max HP). Show numerical effects/current values. Exactly ONE selection by button or key 1/2/3 applies once, then starts the next wave; debounce inputs so a held key or double-click cannot select twice. Choices are reusable across waves and last only for this round. No selection after wave 3.
- Third wave cleared means YOU WIN; HP <= 0 means GAME OVER. If death and final kill happen in the same tick, death takes priority. Freeze all gameplay/spawning/contacts on either result; show waves cleared, total kills and active elapsed time with Play Again. Health, current wave / 3, kills / wave total, pending+alive count and selected upgrades remain understandable in HUD. Labels must reflect actual state, never simulated counters.

Pause/reset/audio:
- Esc and Pause/Resume buttons freeze/resume movement, enemy AI, projectile flight/lifetimes, spawn delays, attack cooldown, invulnerability, active elapsed time and gameplay SFX. Use active delta/time or correctly paused timers, not wall-clock timestamps. Menus remain usable while paused. Window focus loss pauses an active battle. Esc cannot escape choosing-upgrade without a choice; preserve that state through focus loss. Reset from pause/upgrade/result must remain accessible.
- R and Play Again reset IN PLACE to a fresh playing round: wave 1, base HP/stats/speeds, zero kills/time, no upgrades, original spawn/aim RIGHT/idle, cooldown and pending inputs cleared, all old enemies/projectiles/deferred spawns removed, all overlays reset. Clear SceneTree.paused and use a round-generation token or cancellation for pending async callbacks so old wave timers cannot spawn into the new round. Suspend contacts for two physics ticks after reset. Do not reload/free the root. Keep chosen mute/volume settings.
- Use clear ASCII canvas text and real buttons; Chinese explanations belong in stage-result. Menus cannot invisibly cover live controls. Pointer clicks on buttons must not shoot or move the character. Start must unlock Web audio via user interaction.
- Use existing noobi_asset_list to reuse suitable effects; otherwise noobi_asset_plan then noobi_audio_synthesize for local procedural WAVs: shoot, hit, hurt, upgrade, win, lose. Use the registered returned paths in actual AudioStreamPlayer event playback, once per event. Include mute and volume slider; stop active gameplay SFX on pause/upgrade/result and keep settings on restart. No external image/music/3D services, new dependencies, or generated-art claims for programmatic markers/sounds.

Use the original host's Godot import, validation, Web export and complete-game review. Write current .noobi/playtest.json describing REAL production start/move/attack, pause/resume, upgrade or battle feedback, terminal state and restart with bounded actual inputs/observations. Do not add test-only damage/skip/win shortcuts or write host reports. Read-only review must inspect real spawning, retirement, invulnerability, one-time upgrade selection and reset cancellation, plus current host evidence. A host pass is not user acceptance; do not write user approvals. No native Godot commands by the agent.

Write .noobi/topdown-round.json (replace example paths with actual nodes/files; keep exactly 3 waves and upgrade IDs):
{"schemaVersion":1,"taskId":${JSON.stringify(w.task!.id)},"genre":"topdown","playableVersionId":${JSON.stringify(w.steps.playable.artifact?.id)},"playableSnapshotId":${JSON.stringify(w.steps.playable.artifact?.snapshotId)},"rules":{"maxBounces":${w.steps.playable.artifact?.playable?.genre === 'topdown' ? w.steps.playable.artifact.playable.maxBounces : 0},"playerHealth":5,"waves":[{"count":4,"speedScale":1},{"count":6,"speedScale":1.1},{"count":8,"speedScale":1.2}],"upgrades":["power","agility","recover"]},"nodes":{"player":"Player","enemies":"Enemies","projectiles":"Projectiles","wave":"UI/Wave","remaining":"UI/Remaining","health":"UI/Health","startButton":"UI/Start","pauseButton":"UI/Pause","resumeButton":"UI/Resume","restartButton":"UI/Restart","result":"UI/Result","upgradeButtons":{"power":"UI/Power","agility":"UI/Agility","recover":"UI/Recover"},"muteButton":"UI/Mute","volumeSlider":"UI/Volume"},"enemyScenes":{"slow":"scenes/enemy_slow.tscn","fast":"scenes/enemy_fast.tscn"},"audio":{"shoot":"public/assets/audio/ACTUAL.wav","hit":"public/assets/audio/ACTUAL.wav","hurt":"public/assets/audio/ACTUAL.wav","upgrade":"public/assets/audio/ACTUAL.wav","win":"public/assets/audio/ACTUAL.wav","lose":"public/assets/audio/ACTUAL.wav"}}
Use the actual requested difficulty values. Write .noobi/stage-result.json:
{"title":"简短中文俯视小局名","summary":"中文说明三波、升级、胜负、操作和本次修改，等待用户验收","changes":["本次实际变化"],"ready":true,"candidates":[],"selectedCharacterId":null,"media":[],"lockedAssets":[]}
Host inherits approved images/actions and saves the new version separately. STOP at this node; no cross-stage edits or final export delivery.
`;
}
