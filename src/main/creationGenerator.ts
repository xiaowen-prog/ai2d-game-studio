import { readPlatformer, type PlatformerInputs } from './creationPlatformer.js';
import { readPlatformerRound } from './creationPlatformerRound.js';
import { readTopdownRound } from './creationTopdownRound.js';
import { AppearanceRevision } from './creationAppearance.js';
import { exportCreationDelivery, verifyCreationDelivery } from './creationDelivery.js';
import { readTopdown, type TopdownInputs } from './creationTopdown.js';
import { readScenePreview, type ScenePreviewManifest } from './creationScene.js';
import { isCharacterActionTask } from '../shared/creation.js';
import { readCharacterActions, characterActionControls, type CharacterActionManifest } from './characterActionInspection.js';
import { synchronizeCreationContext } from './creationContext.js';
import { archiveCurrentReviewEvidence, reviewWorkspaceHash } from './hostReviewEvidence.js';
import type { HostDeliveryValidation, HostImageGenerationRequirement, HostAudioGenerationRequirement } from './gameHarness.js';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreationArtifact, CreationGenerationResult, CreationPreview, CreationWorkflow } from '../shared/creation.js';
import type { ProjectRecord } from '../shared/contracts.js';
import type { CodexAppServer, DynamicToolSpec } from './codexAppServer.js';
import { GameHarnessReviewFailedError, GameHarnessTurnTimeoutError, type GameHarness } from './gameHarness.js';
import type { CreationGenerator } from './creationWorkflowService.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, CreationVersionStore, safeCreationFile } from './creationVersionStore.js';
import { finalizeScopedCharacterEdit } from './characterScopedEdit.js';
import { directionArtifact, parseCreationDirection, readCreationArtifact } from './creationArtifact.js';
import { DIRECTION_INSTRUCTIONS, creationStageTask } from './creationPrompts.js';
import type { PreviewServer } from './previewServer.js';

interface GeneratorOptions {
  runtime: CodexAppServer;
  harness: GameHarness;
  versions: CreationVersionStore;
  previews: PreviewServer;
  project(projectId: string): Promise<ProjectRecord>;
  settings(): Promise<{ defaultModel: string | null; defaultEffort: string }>;
  preflight(workflow: CreationWorkflow): Promise<{ tools: DynamicToolSpec[]; imageSkill: { name: string; path: string } | null; imageRoute?: 'configured-api' | 'codex-imagegen' }>;
  candidateRoute(projectId: string, root: string | null): void;
  waitForMedia(projectId: string): Promise<void>;
  hasImageProof(projectId: string, root: string, path: string, hash: string): Promise<boolean>;
  recordScopedImageProof(projectId: string, path: string, hash: string): Promise<void>;
  mediaRequirements(project: ProjectRecord, completeGame: boolean): Promise<{ image: HostImageGenerationRequirement; audio: HostAudioGenerationRequirement }>;
  validateDelivery(project: ProjectRecord, scope: 'preview' | 'game' | 'round', signal: AbortSignal, assetScope?: { paths: string[]; since: string }): Promise<HostDeliveryValidation>;
  validatePlatformer?(project: ProjectRecord, inputs: PlatformerInputs, signal: AbortSignal): Promise<string[]>;
  validateTopdown?(project: ProjectRecord, inputs: TopdownInputs, signal: AbortSignal): Promise<string[]>;
  validateActions?(project: ProjectRecord, manifest: CharacterActionManifest, signal: AbortSignal, scene?: ScenePreviewManifest): Promise<string[]>;
}

export class StagedCreationGenerator implements CreationGenerator {
  constructor(private readonly options: GeneratorOptions) {}
  async generate(workflow: CreationWorkflow, signal: AbortSignal): Promise<CreationGenerationResult> {
    signal.throwIfAborted();
    const project = await this.options.project(workflow.projectId);
    if (workflow.currentStage === 'delivery') return exportCreationDelivery(workflow, project.root, this.options.versions, signal);
    const settings = await this.options.settings();
    const capabilities = await this.options.preflight(workflow);
    signal.throwIfAborted();
    if (workflow.currentStage === 'direction') return this.#direction(workflow, project, settings, signal);
    const root = await this.options.versions.prepare(project.id, workflow.task!.id, project.root, workflow.workingSnapshotId);
    const candidate = { ...project, root };
    await mkdir(join(root, '.noobi'), { recursive: true });
    for (const path of ['stage-result.json', 'stage-check.json', 'character-edit-region.json', 'character-edit-proof.json', 'inspection/character-edit-mask.png']) {
      await rm(join(root, '.noobi', path), { force: true });
    }
    await synchronizeCreationContext(root, workflow);
    this.options.candidateRoute(project.id, root);
    const stop = () => { void this.options.harness.stop(project.id); };
    signal.addEventListener('abort', stop, { once: true });
    let appearance: AppearanceRevision | null = null;
    const actions = isCharacterActionTask(workflow);
    const candidatesOnly = workflow.currentStage === 'character' && !actions;
    const completeGame = ['game', 'delivery'].includes(workflow.currentStage);
    const platformerRound = workflow.currentStage === 'game' && workflow.steps.direction.artifact?.direction?.genre === 'platformer';
    const topdownRound = workflow.currentStage === 'game' && workflow.steps.direction.artifact?.direction?.genre === 'topdown';
    const boundedRound = platformerRound || topdownRound;
    const deliveryScope = boundedRound ? 'round' : completeGame ? 'game' : 'preview';
    const generatedMusic = completeGame && !boundedRound;
    let artifact: CreationArtifact | null = null;
    let deliveryError: CreationError | null = null;
    let deliveryEvidence: string[] = [];
    let roundInputHash: string | null = null;
    const validate = async () => {
      deliveryEvidence = [];
      await this.options.waitForMedia(project.id);
      signal.throwIfAborted();
      const requiresPreview = !candidatesOnly;
      const core = workflow.currentStage === 'playable', genre = workflow.steps.direction.artifact?.direction?.genre;
      const platformer = core && genre === 'platformer' ? await readPlatformer(root, workflow, this.options.versions) : null;
      const topdown = core && genre === 'topdown' ? await readTopdown(root, workflow, this.options.versions) : null;
      if (core && !platformer && !topdown) throw new CreationError('INVALID_PLAYABLE', '请先确认游戏方向。');
      const playable = platformer ?? topdown;
      const effective = appearance?.effective ?? workflow;
      const round = platformerRound ? await readPlatformerRound(root, effective, this.options.versions)
        : topdownRound ? await readTopdownRound(root, effective, this.options.versions) : null;
      const inherited = playable ?? round;
      const scenePreview = workflow.currentStage === 'scene' ? await readScenePreview(root, workflow, this.options.versions, (path, hash) => this.options.hasImageProof(project.id, root, path, hash)) : null;
      const actionManifest = actions ? await readCharacterActions(root, workflow, (path, hash) => this.options.hasImageProof(project.id, root, path, hash), project.targetFrameRate) : null;
      if (requiresPreview) {
        const delivery = await this.options.validateDelivery(candidate, deliveryScope, signal, actionManifest ? { paths: [actionManifest.spriteSheet, actionManifest.sourceCharacter.path], since: workflow.task!.startedAt } : scenePreview ? { paths: [scenePreview.scene.background.path, scenePreview.actions.spriteSheet, scenePreview.actions.sourceCharacter.path], since: workflow.task!.startedAt } : inherited ? { paths: [inherited.scene.background.path, inherited.actions.spriteSheet, inherited.actions.sourceCharacter.path], since: workflow.task!.startedAt } : undefined);
        deliveryEvidence = delivery.evidence ?? [];
        if (!delivery.ok) throw new CreationError('DELIVERY_FAILED', delivery.findings.join('；'));
      }
      const checked = await readCreationArtifact(root, effective, (path, hash) => this.options.hasImageProof(project.id, root, path, hash), candidatesOnly);
      if (actionManifest) {
        if (!checked.media.some(item => item.kind === 'animation' && item.path === actionManifest.spriteFrames)
          || !checked.media.some(item => item.kind === 'image' && item.path === actionManifest.spriteSheet)) throw new CreationError('INVALID_ACTIONS', '展示素材与实际动作资源不一致。');
        if (!this.options.validateActions) throw new CreationError('ACTION_CHECK_UNAVAILABLE', '人物动作实际检查尚未连接。');
        checked.checks.push(...await this.options.validateActions(candidate, actionManifest, signal));
        checked.actions = characterActionControls(actionManifest);
        checked.characterPhase = 'actions';
        checked.checks.push('动作图集当前摘要已通过宿主私有 AI 生成来源核验；图集尺寸与切片核对通过，仅允许透明度 0–1/255 的整数分格余边');
        checked.lockedAssets[actionManifest.spriteSheet] = await creationHash(root, actionManifest.spriteSheet);
        checked.lockedAssets[actionManifest.spriteFrames] = await creationHash(root, actionManifest.spriteFrames);
        deliveryEvidence.push(JSON.stringify({ path: 'artifacts/engine/actions-latest.json', taskId: workflow.task!.id, sha256: await creationHash(root, 'artifacts/engine/actions-latest.json') }));
      }
      if (scenePreview) {
        if (!checked.media.some(item => item.kind === 'image' && item.path === scenePreview.scene.background.path)) throw new CreationError('INVALID_SCENE', '场景展示素材与实际背景不一致。');
        if (!this.options.validateActions) throw new CreationError('ACTION_CHECK_UNAVAILABLE', '场景实际运行检查未连接。');
        checked.checks.push(...await this.options.validateActions(candidate, scenePreview.actions, signal, scenePreview.scene));
        checked.scene = { manifest: '.noobi/scene-preview.json', background: scenePreview.scene.background.path, genre: scenePreview.scene.genre };
        checked.actions = workflow.steps.character.artifact!.actions;
        checked.checks.push('场景图片当前摘要已通过宿主私有 AI 生成来源核验；已确认人物与动作保持原样');
        deliveryEvidence.push(JSON.stringify({ path: 'artifacts/engine/scene-latest.json', taskId: workflow.task!.id, sha256: await creationHash(root, 'artifacts/engine/scene-latest.json') }));
      }
      if (playable) {
        if (!this.options.validateActions) throw new CreationError('PLAYABLE_CHECK_UNAVAILABLE', '人物动作检查尚未连接。');
        checked.checks.push(...await this.options.validateActions(candidate, playable.actions, signal));
        if (platformer) {
          if (!this.options.validatePlatformer) throw new CreationError('PLAYABLE_CHECK_UNAVAILABLE', '横版试玩检查尚未连接。');
          checked.checks.push(...await this.options.validatePlatformer(candidate, platformer, signal));
          checked.playable = { manifest: '.noobi/platformer-preview.json', genre: 'platformer', maxJumps: platformer.manifest.rules.maxJumps };
        } else if (topdown) {
          if (!this.options.validateTopdown) throw new CreationError('PLAYABLE_CHECK_UNAVAILABLE', '俯视试玩检查尚未连接。');
          checked.checks.push(...await this.options.validateTopdown(candidate, topdown, signal));
          checked.playable = { manifest: '.noobi/topdown-preview.json', genre: 'topdown', maxBounces: topdown.manifest.rules.maxBounces };
        }
        checked.actions = workflow.steps.character.artifact!.actions;
        const report = `artifacts/engine/${platformer ? 'platformer' : 'topdown'}-latest.json`;
        deliveryEvidence.push(JSON.stringify({ path: report, taskId: workflow.task!.id, sha256: await creationHash(root, report) }));
      }
      if (['game', 'delivery'].includes(workflow.currentStage)) {
        if (round) {
          const config = round.round;
          checked.round = config.genre === 'platformer'
            ? { manifest: '.noobi/platformer-round.json', genre: 'platformer', timeLimitSeconds: config.rules.timeLimitSeconds, maxJumps: config.rules.maxJumps }
            : { manifest: '.noobi/topdown-round.json', genre: 'topdown', waveCounts: config.rules.waves.map(wave => wave.count), playerHealth: config.rules.playerHealth, maxBounces: config.rules.maxBounces };
          checked.actions = workflow.steps.character.artifact!.actions;
          checked.checks.push('完整小局沿用已确认试玩、人物与场景；本地音效文件已核对');
        }
        checked.checks.push('生成过程的完整交付检查通过；游戏效果仍待你验收');
      } else if (requiresPreview) checked.checks.push('Godot 导入、脚本检查与网页导出通过；请亲自查看动作或试玩');
      artifact = checked;
      await writeFile(join(root, '.noobi', 'stage-check.json'), JSON.stringify({ taskId: workflow.task!.id,
        resultSha256: await creationHash(root, '.noobi/stage-result.json'), stage: workflow.currentStage, ok: true, checks: checked.checks, imageProofs: (workflow.currentStage === 'character' || scenePreview) ? [...checked.candidates.map(c => c.image), ...(actionManifest ? [actionManifest.spriteSheet] : []), ...(scenePreview ? [scenePreview.scene.background.path] : [])].map(path => ({ path, sha256: checked.lockedAssets[path], verified: true, authority: 'host-private-generation-ledger' })) : [] }));
      if (boundedRound) roundInputHash = await reviewWorkspaceHash(root);
    };
    try {
      if (workflow.task?.appearanceTarget) appearance = await AppearanceRevision.create(root, workflow, {
        versions: this.options.versions,
        hasProof: (path, hash) => this.options.hasImageProof(project.id, root, path, hash),
        recordProof: (path, hash) => this.options.recordScopedImageProof(project.id, path, hash),
        exportPreview: async (previewRoot, paths, previewSignal) => {
          const result = await this.options.validateDelivery({ ...project, root: previewRoot }, 'preview', previewSignal, { paths, since: workflow.task!.startedAt });
          if (!result.ok) throw new CreationError('APPEARANCE_PREVIEW_FAILED', '关联阶段的预览更新失败，整套旧版仍保留。' + result.findings.join('；'));
        },
      });
      const requirements = candidatesOnly ? undefined : await this.options.mediaRequirements(candidate, generatedMusic);
      await this.options.harness.run({
        projectId: project.id, cwd: root, prompt: workflow.task?.prompt || workflow.idea,
        stageTask: creationStageTask(workflow) + '\nPrivate image provenance: stage-check.json imageProofs are host-issued only after the private ledger verifies the actual file SHA. The public asset-pack provider label is not the provenance authority. When current host proofs pass, do not request another generation due solely to a procedural/workspace-agent label.',
        stageScope: candidatesOnly ? 'candidates' : ['game', 'delivery'].includes(workflow.currentStage) ? 'game' : 'preview',
        manualGameplayAcceptance: workflow.currentStage === 'playable' && workflow.steps.direction.artifact?.direction?.genre === 'topdown',
        targetFrameRate: project.targetFrameRate,
        beforeWrite: () => archiveCurrentReviewEvidence(root),
        hostReviewFirst: true,
        model: project.model ?? settings.defaultModel,
        effort: settings.defaultEffort, threadId: null,
        imageGenerationRequirement: requirements?.image, audioGenerationRequirement: requirements?.audio,
        ...(requirements ? {
          refreshImageGenerationRequirement: async () => (await this.options.mediaRequirements(candidate, generatedMusic)).image,
          refreshAudioGenerationRequirement: async () => (await this.options.mediaRequirements(candidate, generatedMusic)).audio,
        } : {}),
        dynamicTools: capabilities.tools, imageGenerationSkill: capabilities.imageSkill,
        imageGenerationRoute: capabilities.imageRoute,
        reuseApprovedImages: workflow.currentStage === 'playable' || boundedRound,
        ...(['character', 'scene', 'playable'].includes(workflow.currentStage) || boundedRound ? { maxRepairAttempts: 0 } : {}),
        prepareHostReview: async () => {
          await this.options.waitForMedia(project.id);
          signal.throwIfAborted();
          // Model-written or copied reports are not host evidence for this run.
          for (const path of ['stage-check.json', 'character-edit-proof.json', 'inspection/character-edit-mask.png']) {
            await rm(join(root, '.noobi', path), { force: true });
          }
          if (candidatesOnly) await finalizeScopedCharacterEdit(root, workflow,
            (path, hash) => this.options.hasImageProof(project.id, root, path, hash),
            (path, hash) => this.options.recordScopedImageProof(project.id, path, hash));
          if (appearance) await appearance.finalize(signal);
          signal.throwIfAborted();
        },
        validateHostDelivery: async () => {
          try { await validate(); return { ok: true, findings: [], evidence: [JSON.stringify({ taskId: workflow.task!.id, path: '.noobi/stage-check.json', sha256: await creationHash(root, '.noobi/stage-check.json') }), ...deliveryEvidence] }; }
          catch (error) {
            signal.throwIfAborted();
            if (error instanceof CreationError) deliveryError = error;
            const message = error instanceof CreationError ? error.message : '实际成果检查失败：检查图片文件、Godot 导出和阶段结果结构。';
            await writeFile(join(root, '.noobi', 'stage-check.json'), JSON.stringify({ taskId: workflow.task!.id, stage: workflow.currentStage, ok: false, findings: [message] }));
            return { ok: false, findings: [message] };
          }
        },
      });
      signal.throwIfAborted();
      if (boundedRound) {
        // The read-only reviewer cannot change the approved input. Reuse this exact host
        // result instead of replaying the whole game a second time before saving it.
        if (!roundInputHash || roundInputHash !== await reviewWorkspaceHash(root)) {
          throw new CreationError('GAME_CHANGED_AFTER_CHECK', '完整小局在检查后发生变化，上一版仍保留，请重试。');
        }
      } else await validate();
      if (!artifact) throw new CreationError('INVALID_OUTPUT', '缺少通过检查的阶段成果。');
      const result: CreationGenerationResult = artifact as CreationArtifact;
      result.snapshotId = await this.options.versions.save(project.id, root);
      if (appearance) {
        result.linkedArtifacts = appearance.linkedArtifacts;
        result.appearanceChange = { target: workflow.task!.appearanceTarget!, checkpointId: workflow.task!.sourceCheckpointId!,
          stages: workflow.task!.appearanceTarget === 'character' ? ['character', 'scene', 'playable', 'game'] : ['scene', 'playable', 'game'] };
        result.checks.push('外观已同步至关联版本；玩法与动作配置文件保持原样，等待用户整套确认');
      }
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      if (deliveryError) throw deliveryError;
      if (error instanceof GameHarnessTurnTimeoutError) {
        throw new CreationError('GENERATION_TIMEOUT', '这次制作等待超时，已有成果仍保留。你可以稍后重试当前阶段。');
      }
      if (workflow.currentStage === 'playable' && error instanceof GameHarnessReviewFailedError) throw new CreationError('PLAYABLE_REVIEW_FAILED', '试玩操作或修改效果未通过审查，上一版仍保留。可以调整要求后重试。');
      if (boundedRound && error instanceof GameHarnessReviewFailedError) throw new CreationError('GAME_REVIEW_FAILED', '完整小局的规则、音效或流程未通过检查，已确认的试玩和上一版仍保留。请调整要求后重试。');
      if (workflow.currentStage === 'scene' && error instanceof GameHarnessReviewFailedError) throw new CreationError('SCENE_REVIEW_FAILED', '场景视角、人物组合或修改结果未通过检查，上一版仍保留。可以调整要求后重试。');
      if (actions && error instanceof GameHarnessReviewFailedError) throw new CreationError('ACTION_REVIEW_FAILED', '动作或人物一致性未通过检查，上一版仍保留。请查看修改要求后再重试。');
      if (workflow.currentStage === 'character' && error instanceof GameHarnessReviewFailedError) {
        await this.options.waitForMedia(project.id);
        const images = await readdir(join(root, 'public/assets/images')).catch(() => []);
        if (!images.some((file) => /\.(png|jpe?g|webp)$/iu.test(file))) {
          throw new CreationError('CHARACTER_NOT_GENERATED', 'AI 这次没有生成人物图片。已确认的方向和历史版本仍保留，可以重试人物制作。');
        }
        throw new CreationError('CHARACTER_REVIEW_FAILED', '人物图片或修改结果未通过检查，未替换已有成果。请调整要求后重试，或恢复历史版本。');
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', stop);
      await this.options.waitForMedia(project.id);
      this.options.candidateRoute(project.id, null);
    }
  }
  async #direction(workflow: CreationWorkflow, project: ProjectRecord, settings: { defaultModel: string | null; defaultEffort: string }, signal: AbortSignal): Promise<CreationArtifact> {
    const runtime = this.options.runtime;
    const threadId = await runtime.startThread({ cwd: project.root, model: project.model ?? settings.defaultModel,
      sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: DIRECTION_INSTRUCTIONS, ephemeral: true });
    let turnId: string | null = null;
    const stop = () => { if (turnId) void runtime.interruptTurn(threadId, turnId).catch(() => undefined); };
    const onNotification = (notification: { method: string; params?: unknown }) => {
      const value = notification.params as { threadId?: string; turn?: { id?: string } } | undefined;
      if (notification.method === 'turn/started' && value?.threadId === threadId && value.turn?.id) {
        turnId = value.turn.id;
        if (signal.aborted) stop();
      }
    };
    runtime.on('notification', onNotification);
    signal.addEventListener('abort', stop, { once: true });
    try {
      signal.throwIfAborted();
      const result = await runtime.runTurn({ threadId, cwd: project.root, model: project.model ?? settings.defaultModel,
        effort: settings.defaultEffort, approvalPolicy: 'never', timeoutMs: 5 * 60_000,
        prompt: JSON.stringify({ idea: workflow.idea, previous: workflow.steps.direction.artifact?.direction,
          modification: workflow.task?.prompt ?? '', note: '仅输出当前方向，不制作后续内容。参考图如有已保存在 public/assets，请只将其作为参考。' }) });
      signal.throwIfAborted();
      if (result.status !== 'completed') throw new CreationError('GENERATION_FAILED', 'AI 未完成方向整理，请重试。');
      const direction = parseCreationDirection(result.text);
      const artifact = directionArtifact(direction);
      const previous = workflow.steps.direction.artifact?.direction;
      if (previous) {
        const labels = { title: '名称', genre: '游戏类型', theme: '主题', controls: '操作方式', goal: '游戏目标', style: '画面风格', scope: '制作范围' };
        artifact.changes = (Object.keys(labels) as Array<keyof typeof labels>)
          .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(direction[key]))
          .map((key) => `已调整${labels[key]}`);
      }
      return artifact;
    } finally {
      signal.removeEventListener('abort', stop);
      runtime.off('notification', onNotification);
      await runtime.unsubscribeThread(threadId).catch(() => undefined);
    }
  }
  async preview(workflow: CreationWorkflow, versionId: string): Promise<CreationPreview> {
    const artifacts = [...Object.values(workflow.steps).map((step) => step.artifact),
      ...workflow.history.flatMap((checkpoint) => Object.values(checkpoint.steps).map((step) => step.artifact))];
    const artifact = artifacts.find((item) => item?.id === versionId);
    if (!artifact) throw new CreationError('NOT_FOUND', '找不到这个成果版本。');
    if (artifact.stage === 'delivery') {
      const directory = await this.deliveryDirectory(workflow, versionId);
      const playableUrl = await this.options.previews.start(`delivery-${workflow.projectId}`, directory,
        { directory: 'web-game', sourceFallback: false, sourceAssetOverlay: false, hideGodotSplash: false });
      return { images: [], playableUrl, exportDirectory: directory };
    }
    if (!artifact.snapshotId) return { images: [], playableUrl: null, exportDirectory: null };
    const root = await this.options.versions.root(workflow.projectId, artifact.snapshotId);
    const imageItems = [...artifact.candidates.map((item) => ({ path: item.image, label: item.name })), ...artifact.media.filter((item) => item.kind === 'image')];
    const images: CreationPreview['images'] = [];
    for (const item of imageItems) {
      if (!/\.(png|jpe?g|webp)$/iu.test(item.path)) throw new CreationError('INVALID_OUTPUT', '不支持的预览图片格式。');
      const bytes = await readFile(await safeCreationFile(root, item.path));
      if (bytes.length > 32 * 1024 * 1024) throw new CreationError('IMAGE_TOO_LARGE', '图片太大，无法预览。');
      const mime = /\.webp$/iu.test(item.path) ? 'image/webp' : /\.png$/iu.test(item.path) ? 'image/png' : 'image/jpeg';
      images.push({ ...item, url: `data:${mime};base64,${bytes.toString('base64')}` });
    }
    const playable = artifact.stage !== 'direction' && (artifact.stage !== 'character' || (artifact.ready && artifact.characterPhase !== 'candidates'));
    const playableUrl = playable ? await this.options.previews.start(`creation-${workflow.projectId}`, root, { directory: 'build/web', sourceFallback: false }) : null;
    return { images, playableUrl, exportDirectory: null };
  }
  async deliveryDirectory(workflow: CreationWorkflow, versionId: string): Promise<string> {
    const artifact = [workflow.steps.delivery.artifact, ...workflow.history.map(point => point.steps.delivery.artifact)].find(item => item?.id === versionId);
    if (!artifact) throw new CreationError('NOT_FOUND', '找不到这份交付记录。');
    const project = await this.options.project(workflow.projectId);
    return verifyCreationDelivery(workflow.projectId, project.root, artifact);
  }
}
