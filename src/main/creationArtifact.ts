import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreationArtifact, CreationDirection, CreationWorkflow } from '../shared/creation.js';
import { CreationError, creationId } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile } from './creationVersionStore.js';

export function parseCreationJson(text: string): Record<string, unknown> {
  if (typeof text !== 'string' || text.length > 100_000) throw new CreationError('INVALID_OUTPUT', 'AI 返回内容过长或无效。');
  const body = text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new CreationError('INVALID_OUTPUT', 'AI 没有返回有效的成果格式，请重试本阶段。'); }
}
function text(value: unknown, label: string, limit = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new CreationError('INVALID_OUTPUT', `成果缺少有效的${label}。`);
  return value.trim();
}
export function parseCreationDirection(raw: string): CreationDirection {
  const data = parseCreationJson(raw);
  if (!['platformer', 'topdown'].includes(data.genre as string)) throw new CreationError('OUT_OF_SCOPE', '方向需收束为横版闯关或俯视打怪。');
  if (!Array.isArray(data.scope) || data.scope.length < 1 || data.scope.length > 8) throw new CreationError('INVALID_OUTPUT', '请让 AI 说明本次游戏的规模。');
  return { title: text(data.title, '名称', 80), genre: data.genre as CreationDirection['genre'],
    theme: text(data.theme, '主题'), controls: text(data.controls, '操作'), goal: text(data.goal, '目标'),
    style: text(data.style, '风格'), scope: data.scope.map((item) => text(item, '规模', 300)) };
}
export function directionArtifact(direction: CreationDirection): CreationArtifact {
  return { id: creationId(), stage: 'direction', title: direction.title, summary: direction.goal,
    changes: [], createdAt: new Date().toISOString(), direction, candidates: [], selectedCharacterId: null,
    media: [], ready: true, snapshotId: null, checks: ['制作方向结构有效；等待用户确认'], lockedAssets: {} };
}

export async function readCreationArtifact(root: string, workflow: CreationWorkflow, hasProof: (path: string, hash: string) => Promise<boolean>, candidatesOnly = false): Promise<CreationArtifact> {
  const stage = workflow.currentStage;
  const resultFile = await safeCreationFile(root, '.noobi/stage-result.json');
  const result = parseCreationJson(await readFile(resultFile, 'utf8'));
  if (!Array.isArray(result.changes) || result.changes.length > 12 || !Array.isArray(result.media)
    || result.media.length > 20 || !Array.isArray(result.candidates) || !Array.isArray(result.lockedAssets)
    || result.lockedAssets.length > 100 || typeof result.ready !== 'boolean') {
    throw new CreationError('INVALID_OUTPUT', 'AI 成果清单不完整，请修复后再交付。');
  }
  const artifact: CreationArtifact = {
    id: creationId(), stage, title: text(result.title, '标题', 120), summary: text(result.summary, '说明', 1500),
    changes: result.changes.map((item) => text(item, '改动', 400)), createdAt: new Date().toISOString(),
    candidates: [], selectedCharacterId: typeof result.selectedCharacterId === 'string' ? result.selectedCharacterId : null,
    media: [], ready: result.ready, snapshotId: null, checks: [], lockedAssets: {},
  };
  for (const item of result.candidates) {
    const value = item as Record<string, unknown>;
    artifact.candidates.push({ id: text(value?.id, '人物编号', 80), name: text(value?.name, '人物名称', 100), image: text(value?.image, '人物图片', 512),
      ...(value?.description !== undefined ? { description: text(value.description, '人物特点', 300) } : {}) });
  }
  for (const item of result.media) {
    const value = item as Record<string, unknown>;
    if (!value || !['image', 'animation'].includes(value.kind as string)) throw new CreationError('INVALID_OUTPUT', '成果媒体类型无效。');
    const path = text(value.path, '素材位置', 512);
    await safeCreationFile(root, path);
    artifact.media.push({ path, label: text(value.label, '素材名称', 100), kind: value.kind as 'image' | 'animation' });
  }
  const incomingLocks = new Set(result.lockedAssets.map((item) => text(item, '引用文件', 512)));
  for (const candidate of artifact.candidates) incomingLocks.add(candidate.image);
  for (const file of incomingLocks) {
    if (!/^public\/assets\/.+\.(png|jpe?g|webp|tres)$/iu.test(file)) throw new CreationError('INVALID_OUTPUT', '确认素材须保存在项目素材目录。');
    artifact.lockedAssets[file] = await creationHash(root, file);
  }
  if (stage === 'character') {
    if (artifact.candidates.length !== 2 || new Set(artifact.candidates.map((item) => item.id)).size !== 2
      || new Set(artifact.candidates.map((item) => artifact.lockedAssets[item.image])).size !== 2) {
      throw new CreationError('INVALID_OUTPUT', '人物阶段需要两个不同的真实候选。');
    }
    for (const candidate of artifact.candidates) {
      if (!/^public\/assets\/images\/[^/]+\.(png|jpe?g|webp)$/iu.test(candidate.image)) throw new CreationError('INVALID_OUTPUT', '人物候选必须是素材目录中的真实图片。');
      if (!await hasProof(candidate.image, artifact.lockedAssets[candidate.image])) throw new CreationError('UNPROVEN_IMAGE', '人物图片缺少真实生成记录。');
    }
    artifact.checks.push('两张候选图片的当前文件摘要均已通过宿主私有 AI 生成来源核验');
    const selectedId = workflow.steps.character.artifact?.selectedCharacterId ?? null;
    if (artifact.selectedCharacterId !== selectedId || artifact.ready !== (candidatesOnly ? false : Boolean(selectedId))) {
      throw new CreationError('INVALID_OUTPUT', '人物选择或动作状态不符合当前用户决定。');
    }
    if (selectedId && !artifact.candidates.some((item) => item.id === selectedId)) throw new CreationError('INVALID_OUTPUT', '选中的人物被替换了。');
    if (candidatesOnly) {
      if (artifact.media.length) throw new CreationError('OUT_OF_SCOPE', '当前只制作人物候选，不交付动作或场景。');
      artifact.characterPhase = 'candidates';
      artifact.ready = Boolean(selectedId);
      if (selectedId) {
        const prior = workflow.steps.character.artifact!;
        const other = prior.candidates.find((item) => item.id !== selectedId)!;
        const currentOther = artifact.candidates.find((item) => item.id === other.id);
        if (JSON.stringify(currentOther) !== JSON.stringify(other)
          || artifact.lockedAssets[other.image] !== prior.lockedAssets[other.image]) {
          throw new CreationError('UNRELATED_CANDIDATE_CHANGED', '修改影响了另一个候选，已保留原来两个人物。');
        }
        const before = prior.candidates.find((item) => item.id === selectedId)!;
        const after = artifact.candidates.find((item) => item.id === selectedId)!;
        if (artifact.lockedAssets[after.image] === prior.lockedAssets[before.image]) {
          throw new CreationError('UNCHANGED_IMAGE', '人物图片没有产生修改，不能把说明文字当成改图结果。');
        }
      }
    } else if (selectedId) {
      const prior = workflow.steps.character.artifact!;
      if (JSON.stringify(artifact.candidates) !== JSON.stringify(prior.candidates)) throw new CreationError('APPROVED_ASSET_CHANGED', '动作制作不能改动任何基础候选。');
      for (const item of prior.candidates) if (artifact.lockedAssets[item.image] !== prior.lockedAssets[item.image]) throw new CreationError('APPROVED_ASSET_CHANGED', '动作制作修改了基础人物图片。');
      const selected = prior.candidates.find((item) => item.id === selectedId)!;
      if (artifact.lockedAssets[selected.image] !== prior.lockedAssets[selected.image]) {
        throw new CreationError('APPROVED_ASSET_CHANGED', '制作动作时替换了选中的人物原图，请保留用户选择。');
      }
      const animations = artifact.media.filter((item) => item.kind === 'animation');
      if (!animations.length) throw new CreationError('MISSING_ANIMATION', '需要当前人物的实际动作资源，不能用静态图替代。');
      for (const animation of animations) {
        if (!/\.(tres|tscn)$/iu.test(animation.path)) throw new CreationError('MISSING_ANIMATION', '动作必须引用实际 Godot 动画资源。');
        const data = await readFile(await safeCreationFile(root, animation.path), 'utf8');
        if (!/SpriteFrames|AnimationPlayer|AnimationLibrary/u.test(data)) throw new CreationError('MISSING_ANIMATION', '未找到可播放的动作资源。');
      }
    }
  } else if (!artifact.ready) throw new CreationError('INVALID_OUTPUT', '本阶段成果尚未完成。');

  // Verify all approved predecessors, regardless of what the model listed as locked.
  for (const [id, step] of Object.entries(workflow.steps)) {
    if (id === stage || !step.confirmedVersionId || !step.artifact) continue;
    for (const [file, hash] of Object.entries(step.artifact.lockedAssets)) {
      if (await creationHash(root, file) !== hash) throw new CreationError('APPROVED_ASSET_CHANGED', '制作改动了已确认素材，请恢复素材或返回对应阶段修改。');
      artifact.lockedAssets[file] = hash;
    }
  }
  if (stage === 'scene') {
    const newImages = artifact.media.filter((item) => item.kind === 'image');
    if (!newImages.length) throw new CreationError('INVALID_OUTPUT', '场景缺少可查看的画面素材。');
    for (const media of newImages) {
      const hash = await creationHash(root, media.path);
      if (!await hasProof(media.path, hash)) throw new CreationError('UNPROVEN_IMAGE', '场景图片缺少真实生成记录。');
      artifact.lockedAssets[media.path] = hash;
    }
  }
  if (stage !== 'character' || (!candidatesOnly && artifact.ready)) {
    await safeCreationFile(root, 'project.godot');
    await safeCreationFile(root, 'build/web/index.html');
    // Make sure selected character art is wired into a scene/resource, not merely copied.
    const character = stage === 'character' ? artifact : workflow.steps.character.artifact;
    const selected = character?.candidates.find((item) => item.id === character.selectedCharacterId);
    if (selected && !(['scene', 'playable'].includes(stage) && character?.actions) && !await hasGodotReference(root, selected.image)) throw new CreationError('MISSING_ASSET_REFERENCE', '已选人物尚未接入实际场景。');
  }
  artifact.checks.push('成果格式与文件已检查', '已确认素材保持一致');
  return artifact;
}
async function hasGodotReference(root: string, image: string): Promise<boolean> {
  let files = 0;
  const visit = async (dir: string): Promise<boolean> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (++files > 5000) throw new CreationError('PROJECT_TOO_LARGE', '场景文件过多。');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && await visit(join(dir, entry.name))) return true;
      if (entry.isFile() && /\.(gd|tscn|tres)$/u.test(entry.name)) {
        if ((await readFile(join(dir, entry.name), 'utf8')).includes(image)) return true;
      }
    }
    return false;
  };
  for (const dir of ['scenes', 'resources', 'scripts']) if (await visit(join(root, dir))) return true;
  return false;
}
