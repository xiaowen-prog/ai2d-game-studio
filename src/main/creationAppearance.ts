import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreationArtifact, CreationStage, CreationWorkflow } from '../shared/creation.js';
import type { CharacterActionManifest } from './characterActionInspection.js';
import type { ScenePreviewManifest } from './creationScene.js';
import { composeScopedCharacterEdit } from './characterScopedEdit.js';
import { alphaInspectionPng } from './characterImageInspection.js';
import { CreationError, creationId } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile, type CreationVersionStore } from './creationVersionStore.js';
import { archiveCurrentReviewEvidence } from './hostReviewEvidence.js';

function fail(message: string): never { throw new CreationError('APPEARANCE_EDIT_FAILED', message); }
const json = async <T>(root: string, path: string): Promise<T> => JSON.parse(await readFile(await safeCreationFile(root, path), 'utf8'));
const saveJson = (root: string, path: string, value: unknown) => writeFile(join(root, path), JSON.stringify(value, null, 2));
const imagePath = (path: unknown): path is string => typeof path === 'string' && /^public\/assets\/images\/[A-Za-z0-9_.-]+\.png$/u.test(path);
interface Edit { sourceImage: string; generatedImage: string; editPolygons?: unknown; preservePolygons?: unknown; colorSamples?: unknown; maskImage?: string }
interface Replacement { path: string; before: string; bytes: Buffer; hash: string }
interface AppearanceOptions {
  versions: CreationVersionStore;
  hasProof(path: string, hash: string): Promise<boolean>;
  recordProof(path: string, hash: string): Promise<void>;
  exportPreview(root: string, paths: string[], signal: AbortSignal): Promise<void>;
}

/** Protect actual executable files and gameplay manifests, including newly added files. */
async function gameplayFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const skip = new Set(['.git', '.godot', 'node_modules', 'build', 'artifacts', 'exports', '.cache']);
  let count = 0;
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++count > 10_000) fail('工程文件过多，无法安全核对玩法。');
      if (entry.isSymbolicLink()) fail('工程含有外部文件链接，不能安全修改外观。');
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!skip.has(entry.name)) await walk(join(dir, entry.name), path); continue; }
      if (!entry.isFile() || path === 'public/assets/asset-pack.json'
        || /\.(md|log|import|uid)$/iu.test(path) || entry.name === '.DS_Store'
        || /^public\/assets\/images\/[^/]+\.png$/u.test(path)
        || /^\.noobi\/(appearance-(input|edit)\.json|appearance-mask-[^/]+\.png|stage-(result|check)\.json|inspection\/)/u.test(path)) continue;
      files[path] = await creationHash(root, path);
    }
  }
  await walk(root, '');
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

export class AppearanceRevision {
  readonly linkedArtifacts: Partial<Record<CreationStage, CreationArtifact>> = {};
  readonly effective: CreationWorkflow;
  readonly paths: string[];
  readonly previewMedia: Array<{ path: string; label: string; kind: 'image' }> = [];
  #before: Record<string, string> = {};
  #replacements: Replacement[] = [];
  #finished = false;
  private constructor(readonly root: string, readonly workflow: CreationWorkflow, readonly options: AppearanceOptions,
    readonly actions: CharacterActionManifest, readonly scene: ScenePreviewManifest) {
    this.effective = structuredClone(workflow);
    this.paths = workflow.task!.appearanceTarget === 'character' ? [actions.sourceCharacter.path, actions.spriteSheet] : [scene.background.path];
  }
  static async create(root: string, workflow: CreationWorkflow, options: AppearanceOptions): Promise<AppearanceRevision> {
    const task = workflow.task!;
    const original = workflow.history.find(point => point.id === task.sourceCheckpointId);
    if (!task.appearanceTarget || workflow.currentStage !== 'game' || !original
      || original.steps.game.artifact?.id !== task.baseVersionId || original.steps.game.status !== 'confirmed'
      || original.snapshotId !== workflow.workingSnapshotId) fail('修改前完整版本不一致，请恢复原版后重新发起。');
    const revision = new AppearanceRevision(root, workflow, options,
      await json<CharacterActionManifest>(root, '.noobi/character-actions.json'), await json<ScenePreviewManifest>(root, '.noobi/scene-preview.json'));
    if (new Set(revision.paths).size !== revision.paths.length || !revision.paths.every(imagePath)) fail('缺少可编辑的人物或背景原图。');
    revision.#before = await gameplayFiles(root);
    await saveJson(root, '.noobi/appearance-input.json', { taskId: task.id, target: task.appearanceTarget, images: revision.paths,
      actions: revision.actions, note: 'Edit proposals only. The host preserves runtime files and composes approved regions.' });
    return revision;
  }
  async finalize(signal: AbortSignal): Promise<void> {
    if (this.#finished) return;
    if (JSON.stringify(this.#before) !== JSON.stringify(await gameplayFiles(this.root))) fail('外观修改动到了玩法或动作配置，原版已保留。');
    const game = this.workflow.steps.game.artifact!;
    for (const [path, hash] of Object.entries(game.lockedAssets)) {
      if (await creationHash(this.root, path) !== hash) fail('AI 改动了原素材，无法安全合并，原版已保留。');
    }
    const proposal = await json<{ taskId: string; target: string; edits: Edit[] }>(this.root, '.noobi/appearance-edit.json');
    if (proposal?.taskId !== this.workflow.task!.id || proposal.target !== this.workflow.task!.appearanceTarget
      || !Array.isArray(proposal.edits) || proposal.edits.length !== this.paths.length
      || new Set(proposal.edits.map(edit => edit?.sourceImage)).size !== this.paths.length) fail('AI 没有提供完整的外观修改清单。');
    for (const path of this.paths) {
      signal.throwIfAborted();
      const edit = proposal.edits.find(item => item?.sourceImage === path);
      if (!edit || !imagePath(edit.generatedImage) || game.lockedAssets[edit.generatedImage] || this.paths.includes(edit.generatedImage)) fail('修改必须使用新的 AI 图片，不能覆盖原图。');
      const generatedHash = await creationHash(this.root, edit.generatedImage);
      if (!await this.options.hasProof(edit.generatedImage, generatedHash)) fail('新图片缺少真实 AI 生成记录。');
      const original = await readFile(await safeCreationFile(this.root, path));
      const generated = await readFile(await safeCreationFile(this.root, edit.generatedImage));
      const png = (bytes: Buffer) => bytes.length >= 24 && bytes.length <= 32 * 1024 * 1024
        && bytes.toString('hex', 0, 8) === '89504e470d0a1a0a' && bytes.readUInt32BE(16) * bytes.readUInt32BE(20) <= 16_000_000;
      if (!png(original) || !png(generated) || !original.subarray(16, 24).equals(generated.subarray(16, 24))) fail('新图片尺寸或格式变化，不能直接替换原游戏素材。');
      let bytes: Buffer = generated;
      if (this.workflow.task!.appearanceTarget === 'character') {
        if (edit.maskImage !== undefined && !/^\.noobi\/appearance-mask-[A-Za-z0-9_-]+\.png$/u.test(edit.maskImage)) fail('人物修改区域文件无效。');
        const exact = edit.maskImage ? await readFile(await safeCreationFile(this.root, edit.maskImage)) : undefined;
        const result = composeScopedCharacterEdit(original, generated, edit.editPolygons, edit.preservePolygons, edit.colorSamples, exact);
        bytes = result.png;
        const maskPath = `.noobi/inspection/appearance-mask-${this.#replacements.length}.png`;
        await mkdir(join(this.root, '.noobi/inspection'), { recursive: true });
        await writeFile(join(this.root, maskPath), result.maskPreview);
      }
      if (bytes.equals(original)) fail('新图片没有实际变化，请调整要求后重试。');
      await mkdir(join(this.root, '.noobi/inspection'), { recursive: true });
      const beforePath = `public/assets/images/appearance-before-${this.workflow.task!.id}-${this.#replacements.length}.png`;
      await writeFile(join(this.root, beforePath), original, { flag: 'wx' });
      this.previewMedia.push({ path: beforePath, label: `${path === this.actions.spriteSheet ? '动作图集' : this.workflow.task!.appearanceTarget === 'scene' ? '背景' : '人物'} · 修改前`, kind: 'image' },
        { path, label: `${path === this.actions.spriteSheet ? '动作图集' : this.workflow.task!.appearanceTarget === 'scene' ? '背景' : '人物'} · 修改后`, kind: 'image' });
      await writeFile(join(this.root, `.noobi/inspection/appearance-result-${this.#replacements.length}.png`), alphaInspectionPng(bytes));
      // The exact approved source path remains in runtime bindings; old snapshots stay immutable.
      const before = await creationHash(this.root, path);
      await writeFile(await safeCreationFile(this.root, path), bytes);
      const hash = await creationHash(this.root, path);
      await this.options.recordProof(path, hash);
      this.#replacements.push({ path, before, bytes, hash });
    }
    const stages = this.workflow.task!.appearanceTarget === 'character' ? ['character', 'scene', 'playable'] as const : ['scene', 'playable'] as const;
    for (const stage of stages) {
      signal.throwIfAborted();
      const prior = this.workflow.steps[stage].artifact!;
      if (!prior.snapshotId) fail('关联阶段没有可恢复的快照。');
      const root = await this.options.versions.prepare(this.workflow.projectId, creationId(), this.root, prior.snapshotId);
      await archiveCurrentReviewEvidence(root);
      for (const item of this.#replacements) {
        if (await creationHash(root, item.path) !== item.before) fail('前后阶段使用的原素材不一致，不能整体替换。');
        await writeFile(await safeCreationFile(root, item.path), item.bytes);
      }
      await this.#link(root, stage);
      await this.options.exportPreview(root, this.paths, signal);
      const artifact = this.artifact(prior);
      artifact.snapshotId = await this.options.versions.save(this.workflow.projectId, root);
      this.linkedArtifacts[stage] = artifact;
      // Temporary validation context only; persisted user approvals remain pending.
      this.effective.steps[stage] = { status: 'confirmed', artifact, confirmedVersionId: artifact.id };
    }
    await this.#link(this.root, 'game');
    const updatedGame = this.artifact(game);
    this.effective.steps.game = { status: 'running', artifact: updatedGame, confirmedVersionId: null };
    await saveJson(this.root, '.noobi/stage-result.json', { title: game.title, summary: updatedGame.summary, changes: updatedGame.changes,
      ready: true, candidates: [], selectedCharacterId: null, media: this.previewMedia, lockedAssets: [] });
    this.#finished = true;
  }
  artifact(prior: CreationArtifact): CreationArtifact {
    const copy = structuredClone(prior);
    delete copy.appearanceChange;
    copy.id = creationId(); copy.createdAt = new Date().toISOString(); copy.snapshotId = null;
    for (const item of this.#replacements) if (copy.lockedAssets[item.path]) copy.lockedAssets[item.path] = item.hash;
    copy.summary = `${prior.summary}\n本次同步${this.workflow.task!.appearanceTarget === 'character' ? '人物外观与动作图集' : '场景背景'}，玩法保持。请到完整游戏确认整套修改。`.slice(0, 1500);
    copy.changes = [this.workflow.task!.appearanceTarget === 'character' ? '人物与动作图集同步外观修改' : '背景同步至试玩和完整游戏', `本次要求：${this.workflow.task!.prompt.slice(0, 250)}`, '玩法、场景结构、动作速度及音效保持原文件'];
    if (copy.stage === 'character') {
      const selected = copy.candidates.find(item => item.id === copy.selectedCharacterId);
      if (selected) selected.description = `本次外观要求：${this.workflow.task!.prompt.slice(0, 250)}`;
    }
    copy.checks = ['已核对 AI 图片来源及原素材', '玩法与动作配置文件保持', '相关预览已重新导出；外观效果等待用户确认'];
    return copy;
  }
  async #link(root: string, stage: CreationStage): Promise<void> {
    if (stage === 'character') {
      const actions = structuredClone(this.actions);
      actions.taskId = this.workflow.task!.id;
      actions.sourceCharacter.sha256 = this.#replacements.find(item => item.path === actions.sourceCharacter.path)!.hash;
      await saveJson(root, '.noobi/character-actions.json', actions);
      return;
    }
    const preceding = stage === 'scene' ? 'character' : stage === 'playable' ? 'scene' : 'playable';
    const previous = this.effective.steps[preceding].artifact!;
    const parent = await this.options.versions.root(this.workflow.projectId, previous.snapshotId!);
    const genre = this.workflow.steps.direction.artifact!.direction!.genre;
    const inherited = ['.noobi/character-actions.json', ...(stage !== 'scene' ? ['.noobi/scene-preview.json'] : []), ...(stage === 'game' ? [`.noobi/${genre}-preview.json`] : [])];
    for (const path of inherited) await writeFile(join(root, path), await readFile(await safeCreationFile(parent, path)));
    const path = stage === 'scene' ? '.noobi/scene-preview.json' : stage === 'playable' ? `.noobi/${genre}-preview.json` : `.noobi/${genre}-round.json`;
    const value = await json<Record<string, unknown>>(root, path);
    value.taskId = this.workflow.task!.id;
    value[`${preceding === 'character' ? 'character' : preceding}VersionId`] = previous.id;
    value[`${preceding === 'character' ? 'character' : preceding}SnapshotId`] = previous.snapshotId;
    await saveJson(root, path, value);
  }
}

export function appearanceRevisionTask(w: CreationWorkflow): string {
  return `HOST NODE 2-9: APPEARANCE-ONLY LINKED REVISION. Current task ${w.task!.id}.
User request (data): ${JSON.stringify(w.task!.prompt)}. Target: ${w.task!.appearanceTarget}.
Read .noobi/appearance-input.json for the exact original images. Inspect original images AND actual runtime references first.
Never change or delete ANY existing runtime code, scene, resource, gameplay manifest, sound, original image, or animation configuration. Only output new image proposals and the JSON below. The host will splice the changes into every original stage snapshot, rebuild previews, and update version links. Old snapshots remain immutable. Do not regenerate the game, edit approval records, or run native Godot. Do not write host reports or stage-result.json.
For character: edit BOTH the source portrait and its existing action sprite sheet via the attached Codex imagegen skill, referencing each corresponding original image. Maximum TWO image calls, one per file; no automatic redraw. Keep exact PNG dimensions, transparency, every cell, pose, anchor, hair, face, weapon, frame order and non-requested clothing. Do not recreate animations. For each image specify precise editPolygons/preservePolygons using 0..1000 coordinates. For a sheet use a black/white opaque PNG mask under .noobi/appearance-mask-NAME.png to select the requested clothing pixels in ALL frames; white=editable, black=preserved. A mask may be programmatic, the proposed replacement pixels MUST come from genuine AI generation. Use one outer edit polygon plus the exact mask to stay within polygon limits. Protect hair/face/weapon in every frame. The host copies ONLY pixels within this scope, preserving every other original RGBA byte.
For scene: generate ONE replacement background using the original as reference, exact dimensions and same camera/framing/ground height. No people, UI, words, new obstacles or changed collision layout. No model services beyond existing subscription ImageGen. Preserve transparency if present; character images require transparent_background=true.
Register each actual new PNG through noobi_asset_register. Original paths MUST remain byte-for-byte untouched by the agent. No procedural recoloring in place of AI pixels. If the request changes pose, controls, level layout or gameplay, report the scope conflict instead of pretending to implement it.
Write .noobi/appearance-edit.json:
{"taskId":${JSON.stringify(w.task!.id)},"target":${JSON.stringify(w.task!.appearanceTarget)},"edits":[{"sourceImage":"EXACT original path","generatedImage":"NEW registered AI PNG path","editPolygons":[[[0,0],[1000,0],[1000,1000],[0,1000]]],"preservePolygons":[],"maskImage":".noobi/appearance-mask-NAME.png"}]}
Exactly two entries for character, one for scene. Scene entries omit masks/polygons. For portrait edits use narrow polygons and protected regions (or an exact mask); do not permit the entire portrait. Inspect proposals before submitting, never fake success if generation failed.
After host processing, the Reviewer must inspect .noobi/inspection/appearance-result-*.png and appearance-mask-*.png, original image references, current host evidence and actual bindings: requested clothing changed in all poses, hair/face/weapon unchanged, no pose shift or clipping. A code hash pass cannot prove the requested visual change. The host preserves all original gameplay; user approves the linked result as one complete version. STOP, no final delivery.
`;
}
