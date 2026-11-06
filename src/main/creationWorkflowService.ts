import {
  CREATION_STAGES, CREATION_LAST_ENABLED_STAGE, creationStageLimit, isCreationStageEnabled, isCreationStage, isExplicitConfirmation,
  type CreationAction, type CreationArtifact, type CreationGenerationResult, type CreationWorkflow, type CreationStage,
} from '../shared/creation.js';
import {
  CreationError, CreationWorkflowStore, checkpoint, claimAction, creationId,
  currentArtifact, invalidateFrom, requireIdle,
} from './creationWorkflowStore.js';

export interface CreationGenerator {
  generate(workflow: CreationWorkflow, signal: AbortSignal): Promise<CreationGenerationResult>;
}
export interface CreationServiceOptions {
  store: CreationWorkflowStore;
  generator: CreationGenerator;
  onChanged?(workflow: CreationWorkflow): void | Promise<void>;
  validateSnapshot?(projectId: string, snapshotId: string): Promise<void>;
  validateDeliveryArtifact?(projectId: string, artifact: CreationArtifact): Promise<void>;
  lastEnabledStage?: CreationStage;
  /** Legacy single-step selection path; production separates candidates and actions. */
  characterCandidatesOnly?: boolean;
  characterActionsEnabled?: boolean;
}

/** All approval and revision decisions are host-owned, never inferred from model output. */
export class CreationWorkflowService {
  #active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  constructor(private readonly options: CreationServiceOptions) {}
  get(projectId: string) { return this.options.store.get(projectId); }
  async create(projectId: string, idea: string): Promise<CreationWorkflow> {
    const workflow = await this.options.store.create(projectId, idea);
    this.#emit(workflow);
    return workflow;
  }
  async recover(projectId: string): Promise<void> {
    let workflow = await this.options.store.recover(projectId);
    if (workflow?.currentStage === 'direction' && workflow.steps.direction.status === 'confirmed'
      && isCreationStageEnabled('character', this.#lastEnabledStage) && !workflow.steps.character.artifact) {
      workflow = await this.options.store.change(projectId, (state) => {
        state.currentStage = 'character'; state.task = null;
      });
    }
    if (workflow) this.#emit(workflow);
  }
  async act(input: CreationAction): Promise<CreationWorkflow> {
    validateAction(input);
    if (input.action === 'confirm' || (input.action === 'run' && isExplicitConfirmation(input.prompt ?? ''))) {
      const state = await this.get(input.projectId);
      if (state?.currentStage === 'delivery' && state.steps.delivery.artifact) await this.options.validateDeliveryArtifact?.(input.projectId, state.steps.delivery.artifact);
    }
    if (input.action === 'restore') {
      if (!input.impactAccepted) throw new CreationError('IMPACT_CONFIRMATION_REQUIRED', '恢复会同时切换各阶段成果和确认状态，请先确认影响。');
      const state = await this.get(input.projectId);
      const target = state?.history.find((item) => item.id === input.checkpointId);
      if (target) this.#requireEnabled(target.stage, target.steps.direction.artifact?.direction?.genre);
      if (target) {
        const snapshots = new Set([target.snapshotId, ...Object.values(target.steps).map(step => step.artifact?.snapshotId)].filter((id): id is string => Boolean(id)));
        for (const snapshot of snapshots) await this.options.validateSnapshot?.(input.projectId, snapshot);
      }
    }
    let startTask: string | null = null;
    let stop = false;
    const workflow = await this.options.store.change(input.projectId, (state) => {
      if (!claimAction(state, input)) return false;
      const step = state.steps[state.currentStage];
      const action = input.action === 'run' && step.status === 'awaiting-confirmation'
        && isExplicitConfirmation(input.prompt ?? '') ? 'confirm' : input.action;
      if (action === 'stop') {
        if (state.task?.state === 'running') {
          state.task.state = 'stopped';
          state.steps[state.task.stage].status = 'stopped';
          state.task.error = '已停止制作，已有成果仍保留。';
        }
        stop = true;
        return;
      }
      requireIdle(state);
      if (state.currentStage === 'game' && step.status === 'awaiting-confirmation' && step.artifact?.appearanceChange
        && !['confirm', 'restore'].includes(action)) throw new CreationError('LINKED_CONFIRMATION_REQUIRED', '请先确认整套外观修改，或恢复修改前版本，再继续修改。');
      if (action !== 'restore') this.#requireEnabled(action === 'revise' && input.stage ? input.stage : state.currentStage, state.steps.direction.artifact?.direction?.genre);
      state.error = null;
      let characterPhase = state.currentStage === 'character'
        ? (state.steps.character.artifact?.characterPhase === 'actions' || (['failed', 'stopped'].includes(state.task?.state ?? '') && state.task?.characterPhase === 'actions') ? 'actions' : 'candidates') as 'actions' | 'candidates' : undefined;
      const retryAppearance = action === 'run' && state.task?.stage === 'game' && ['failed', 'stopped'].includes(state.task.state) ? state.task : null;
      let appearanceTarget = retryAppearance?.appearanceTarget;
      let sourceCheckpointId = retryAppearance?.sourceCheckpointId;
      if (action === 'restore') {
        const target = state.history.find((item) => item.id === input.checkpointId);
        if (!target) throw new CreationError('NOT_FOUND', '找不到这个历史版本。');
        const copy = structuredClone(target);
        checkpoint(state, '恢复前保留');
        state.currentStage = copy.stage;
        state.steps = copy.steps;
        state.workingSnapshotId = copy.snapshotId;
        state.completed = copy.completed;
        state.task = null;
        // A confirmed checkpoint resumes at the next step, never replays its generation.
        if (!state.completed && state.steps[state.currentStage].status === 'confirmed'
          && state.currentStage !== 'playable' && state.currentStage !== 'game'
          && state.currentStage !== creationStageLimit(state.steps.direction.artifact?.direction?.genre, this.#lastEnabledStage) && state.steps[state.currentStage].artifact?.characterPhase !== 'candidates') {
          const index = CREATION_STAGES.findIndex((item) => item.id === state.currentStage);
          state.currentStage = CREATION_STAGES[index + 1]?.id ?? state.currentStage;
        }
        return;
      }
      if (action === 'edit-character') {
        if (state.currentStage !== 'character' || !step.artifact || input.versionId !== step.artifact.id) throw new CreationError('STALE_VERSION', '请重新打开当前人物。');
        if (!input.impactAccepted) throw new CreationError('IMPACT_CONFIRMATION_REQUIRED', '修改基础人物会使现有动作需要重新制作。');
        checkpoint(state, '返回人物形象前');
        const base = step.artifact;
        step.artifact = { ...base, id: creationId(), characterPhase: 'candidates', actions: undefined, media: [],
          ready: Boolean(base.selectedCharacterId), checks: ['已返回人物形象，原动作版本仍可恢复'],
          lockedAssets: Object.fromEntries(base.candidates.map(item => [item.image, base.lockedAssets[item.image]])) };
        step.status = 'awaiting-confirmation'; step.confirmedVersionId = null; state.task = null;
        invalidateFrom(state, 'character'); step.status = 'awaiting-confirmation';
        return;
      }
      if (action === 'return-game') {
        const game = state.steps.game;
        if (state.currentStage !== 'delivery' || !game.artifact?.snapshotId || game.status !== 'confirmed'
          || input.versionId !== game.artifact.id) throw new CreationError('STALE_VERSION', '请重新打开当前完整游戏。');
        checkpoint(state, '返回完整游戏前');
        state.currentStage = 'game'; state.workingSnapshotId = game.artifact.snapshotId; state.completed = false; state.task = null;
        return;
      }
      if (action === 'export') {
        this.#requireEnabled('delivery', state.steps.direction.artifact?.direction?.genre);
        const game = state.steps.game;
        if (!['game', 'delivery'].includes(state.currentStage) || !game.artifact?.round || !game.artifact.snapshotId || !game.artifact.ready
          || game.status !== 'confirmed' || game.confirmedVersionId !== game.artifact.id || input.versionId !== game.artifact.id) {
          throw new CreationError('NOT_CONFIRMABLE', '请先确认最新完整游戏，再导出。');
        }
        for (const id of ['direction', 'character', 'scene', 'playable'] as const) {
          if (state.steps[id].status !== 'confirmed') throw new CreationError('PREDECESSOR_REQUIRED', '还有前置成果或整套修改未确认，不能导出。');
        }
        checkpoint(state, '导出前整套版本');
        state.currentStage = 'delivery'; state.workingSnapshotId = game.artifact.snapshotId;
      } else if (action === 'revise-appearance') {
        if (state.currentStage !== 'game' || !step.artifact?.round || !step.artifact.snapshotId
          || step.status !== 'confirmed' || step.confirmedVersionId !== step.artifact.id || input.versionId !== step.artifact.id) {
          throw new CreationError('NOT_CONFIRMABLE', '请先查看并确认当前完整游戏，再只修改外观。');
        }
        if (!input.impactAccepted) throw new CreationError('IMPACT_CONFIRMATION_REQUIRED', '外观修改会同步前面的素材与当前游戏，请先确认影响。');
        for (const id of ['direction', 'character', 'scene', 'playable'] as const) {
          if (state.steps[id].status !== 'confirmed') throw new CreationError('PREDECESSOR_REQUIRED', '前面的成果尚未确认，不能直接同步外观。');
        }
        appearanceTarget = input.appearanceTarget!;
        sourceCheckpointId = checkpoint(state, '外观修改前整套版本').id;
        if (state.steps.delivery.artifact) { state.steps.delivery.status = 'needs-update'; state.steps.delivery.confirmedVersionId = null; }
      } else if (action === 'continue') {
        const next = state.currentStage === 'character' ? 'scene' : state.currentStage === 'scene' ? 'playable' : state.currentStage === 'playable' ? 'game' : null;
        if (!next || !step.artifact?.ready || step.status !== 'confirmed' || input.versionId !== step.artifact.id
          || step.confirmedVersionId !== step.artifact.id || (state.currentStage === 'character' && step.artifact.characterPhase !== 'actions')) throw new CreationError('NOT_CONFIRMABLE', '请先确认当前阶段的最新成果。');
        this.#requireEnabled(next, state.steps.direction.artifact?.direction?.genre);
        checkpoint(state, next === 'scene' ? '开始场景前' : next === 'game' ? '制作完整小局前' : '开始核心试玩前'); state.currentStage = next; characterPhase = undefined;
      } else if (action === 'animate') {
        if (!this.options.characterActionsEnabled) throw new CreationError('STAGE_UNAVAILABLE', '当前尚未开放人物动作。');
        if (state.currentStage !== 'character' || !step.artifact || input.versionId !== step.artifact.id
          || step.artifact.characterPhase !== 'candidates' || !step.artifact.ready || !step.artifact.selectedCharacterId
          || !['awaiting-confirmation', 'confirmed'].includes(step.status)) throw new CreationError('NOT_CONFIRMABLE', '请先选好并查看当前人物。');
        step.status = 'confirmed'; step.confirmedVersionId = step.artifact.id;
        checkpoint(state, '已确认基础人物');
        characterPhase = 'actions';
      } else if (action === 'revise') {
        if (!input.stage || !isCreationStage(input.stage)) throw new CreationError('INVALID_INPUT', '请选择要修改的阶段。');
        if (input.stage === 'delivery') throw new CreationError('DELIVERY_READ_ONLY', '交付只导出确认版本；请返回完整游戏修改。');
        if (!input.impactAccepted) throw new CreationError('IMPACT_CONFIRMATION_REQUIRED', '请先查看并确认对后续成果的影响。');
        if (!state.steps[input.stage].artifact) throw new CreationError('NOT_FOUND', '这个阶段还没有可修改的成果。');
        checkpoint(state, '返回修改前');
        invalidateFrom(state, input.stage);
      } else if (action === 'select') {
        if (state.currentStage !== 'character' || !step.artifact
          || input.versionId !== step.artifact.id || ['failed', 'stopped', 'needs-update'].includes(step.status)) {
          throw new CreationError('STALE_VERSION', '请重新打开当前候选人物。');
        }
        if ((step.confirmedVersionId || step.artifact.characterPhase === 'actions') && !input.impactAccepted) {
          throw new CreationError('IMPACT_CONFIRMATION_REQUIRED', '更换已确认人物后需要重新确认，请先查看影响。');
        }
        const candidate = step.artifact.candidates.find((item) => item.id === input.candidateId);
        if (!candidate) throw new CreationError('INVALID_INPUT', '请选择当前显示的候选人物。');
        if (step.artifact.characterPhase === 'actions') throw new CreationError('ACTIONS_REQUIRE_RESET', '请先返回修改人物形象，再更换人物；原动作可以恢复。');
        checkpoint(state, '人物选择前');
        step.artifact = { ...step.artifact, id: creationId(), selectedCharacterId: candidate.id, ready: false };
        if (this.options.characterCandidatesOnly !== false) {
          step.artifact.characterPhase = 'candidates';
          step.artifact.ready = true;
          step.confirmedVersionId = null;
          step.status = 'awaiting-confirmation';
          state.task = null;
          checkpoint(state, `已选择${candidate.name}`);
          return;
        }
      } else if (action === 'confirm') {
        if (step.status !== 'awaiting-confirmation' || !step.artifact?.ready
          || input.versionId !== step.artifact.id) {
          throw new CreationError('NOT_CONFIRMABLE', '当前成果尚未就绪或版本已变化，请先查看最新成果。');
        }
        step.confirmedVersionId = step.artifact.id;
        step.status = 'confirmed';
        if (state.currentStage === 'game' && step.artifact.appearanceChange) {
          for (const id of step.artifact.appearanceChange.stages) {
            const linked = state.steps[id];
            if (!linked.artifact?.ready || !linked.artifact.snapshotId || !['awaiting-confirmation', 'confirmed'].includes(linked.status)) {
              throw new CreationError('INVALID_LINKED_VERSION', '关联成果不完整，不能确认，请恢复修改前版本。');
            }
            linked.confirmedVersionId = linked.artifact.id; linked.status = 'confirmed';
          }
        }
        state.completed = state.currentStage === 'delivery';
        checkpoint(state, step.artifact.appearanceChange ? '已确认整套外观修改' : step.artifact.characterPhase === 'actions' ? '已确认人物动作' : `已确认${CREATION_STAGES.find((item) => item.id === state.currentStage)!.label}`);
        if (state.currentStage === 'playable' || state.currentStage === 'game' || state.currentStage === creationStageLimit(state.steps.direction.artifact?.direction?.genre, this.#lastEnabledStage) || step.artifact.characterPhase === 'candidates') {
          state.task = null;
          return;
        }
        if (state.completed) return;
        const index = CREATION_STAGES.findIndex((item) => item.id === state.currentStage);
        state.currentStage = CREATION_STAGES[index + 1].id;
      } else if (action === 'run') {
        if (state.currentStage === 'delivery' && input.prompt?.trim()) throw new CreationError('DELIVERY_READ_ONLY', '导出不会修改游戏，请返回完整游戏输入修改要求。');
        if (state.completed || step.confirmedVersionId) {
          throw new CreationError('IMPACT_CONFIRMATION_REQUIRED', '请先选择返回修改并确认影响范围。');
        }
        if (step.artifact) checkpoint(state, '修改前成果');
      }
      if (state.currentStage === 'character' && ['run', 'revise'].includes(action) && this.options.characterCandidatesOnly !== false
        && state.steps.character.artifact && !state.steps.character.artifact.selectedCharacterId) {
        throw new CreationError('CANDIDATE_REQUIRED', '请先选择要修改的人物，再输入修改要求。');
      }
      // Every stage must consume the currently confirmed predecessor.
      const index = CREATION_STAGES.findIndex((item) => item.id === state.currentStage);
      if (index > 0) {
        const previous = state.steps[CREATION_STAGES[index - 1].id];
        if (!previous.confirmedVersionId || previous.status !== 'confirmed') {
          throw new CreationError('PREDECESSOR_REQUIRED', '请先确认前一步成果。');
        }
        if (previous.artifact?.characterPhase === 'candidates') {
          throw new CreationError('ACTIONS_REQUIRED', '当前只确认了基础人物，动作尚未制作，不能开始场景。');
        }
      }
      const target = state.steps[state.currentStage];
      if (state.currentStage === 'character' && action === 'revise') characterPhase = target.artifact?.characterPhase === 'actions' ? 'actions' : 'candidates';
      if (state.currentStage !== 'character') characterPhase = undefined;
      if (action === 'confirm' && state.currentStage === 'character' && target.status === 'needs-update') {
        target.artifact = null;
      }
      const taskId = creationId();
      const retryPrompt = state.task?.stage === state.currentStage && ['failed', 'stopped'].includes(state.task.state)
        ? state.task.prompt : '';
      if (characterPhase === 'actions' && !this.options.characterActionsEnabled) throw new CreationError('STAGE_UNAVAILABLE', '当前尚未开放人物动作。');
      state.task = { id: taskId, operationId: input.operationId, stage: state.currentStage,
        ...(characterPhase ? { characterPhase } : {}),
        ...(appearanceTarget ? { appearanceTarget, sourceCheckpointId } : {}),
        prompt: action === 'confirm' || state.currentStage === 'delivery' ? '' : input.prompt?.trim() ?? retryPrompt, startedAt: new Date().toISOString(),
        state: 'running', baseVersionId: target.artifact?.id ?? null, error: null };
      target.status = 'running';
      target.confirmedVersionId = null;
      state.completed = false;
      startTask = taskId;
    });
    this.#emit(workflow);
    if (stop) this.#active.get(input.projectId)?.controller.abort();
    if (startTask) {
      const controller = new AbortController();
      // The previous writer must finish cancelling before a replacement can touch media routes.
      const previous = this.#active.get(input.projectId)?.done;
      const done = Promise.resolve(previous).catch(() => undefined)
        .then(() => this.#execute(input.projectId, startTask!, controller.signal));
      this.#active.set(input.projectId, { controller, done });
      void done.finally(() => {
        if (this.#active.get(input.projectId)?.done === done) this.#active.delete(input.projectId);
      }).catch(() => undefined);
    }
    return workflow;
  }
  async idle(projectId: string): Promise<void> { await this.#active.get(projectId)?.done; }
  get #lastEnabledStage(): CreationStage { return this.options.lastEnabledStage ?? CREATION_LAST_ENABLED_STAGE; }
  #requireEnabled(stage: CreationStage, genre?: 'platformer' | 'topdown'): void {
    if (!isCreationStage(stage) || !isCreationStageEnabled(stage, creationStageLimit(genre, this.#lastEnabledStage))) {
      throw new CreationError('STAGE_UNAVAILABLE', '当前阶段尚未开放，请先完成前面的确认步骤。');
    }
  }
  async stopAll(): Promise<void> {
    for (const task of this.#active.values()) task.controller.abort();
    await Promise.allSettled([...this.#active.values()].map((task) => task.done));
  }
  async #execute(projectId: string, taskId: string, signal: AbortSignal): Promise<void> {
    try {
      const workflow = await this.get(projectId);
      if (signal.aborted || !workflow || workflow.task?.id !== taskId || workflow.task.state !== 'running') return;
      this.#requireEnabled(workflow.currentStage, workflow.steps.direction.artifact?.direction?.genre);
      const { linkedArtifacts, ...artifact } = await this.options.generator.generate(workflow, signal);
      if (signal.aborted) return;
      const updated = await this.options.store.change(projectId, (state) => {
        if (state.task?.id !== taskId || state.task.state !== 'running') return false;
        if (artifact.stage !== state.task.stage) throw new CreationError('INVALID_OUTPUT', '生成结果不属于当前阶段。');
        if (artifact.stage === 'delivery' && (!artifact.delivery || artifact.delivery.sourceVersionId !== state.steps.game.confirmedVersionId
          || artifact.delivery.sourceSnapshotId !== state.steps.game.artifact?.snapshotId || artifact.snapshotId !== artifact.delivery.sourceSnapshotId)) {
          throw new CreationError('INVALID_DELIVERY', '导出包与最后确认的完整游戏不一致。');
        }
        if (state.task.appearanceTarget) {
          const expected = state.task.appearanceTarget === 'character' ? ['character', 'scene', 'playable'] as const : ['scene', 'playable'] as const;
          if (!artifact.appearanceChange || artifact.appearanceChange.checkpointId !== state.task.sourceCheckpointId
            || artifact.appearanceChange.target !== state.task.appearanceTarget
            || JSON.stringify(artifact.appearanceChange.stages) !== JSON.stringify([...expected, 'game'])
            || Object.keys(linkedArtifacts ?? {}).length !== expected.length) throw new CreationError('INVALID_LINKED_VERSION', '外观修改没有完整连接前后版本。');
          for (const id of expected) {
            const linked = linkedArtifacts?.[id];
            if (!linked?.ready || !linked.snapshotId || linked.stage !== id) throw new CreationError('INVALID_LINKED_VERSION', '外观修改缺少可恢复的关联成果。');
            state.steps[id] = { status: 'awaiting-confirmation', artifact: linked, confirmedVersionId: null };
          }
        } else if (linkedArtifacts || artifact.appearanceChange) throw new CreationError('INVALID_LINKED_VERSION', '当前任务不能改动其他阶段。');
        state.task.state = 'succeeded';
        state.steps[artifact.stage] = { status: 'awaiting-confirmation', artifact, confirmedVersionId: null };
        if (artifact.snapshotId) state.workingSnapshotId = artifact.snapshotId;
        state.error = null;
        if (artifact.stage === 'direction') checkpoint(state, '方向草稿');
        if (artifact.stage === 'scene') checkpoint(state, '场景草稿');
        if (artifact.stage === 'playable') checkpoint(state, '核心试玩草稿');
        if (artifact.stage === 'game') checkpoint(state, artifact.appearanceChange ? '整套外观修改草稿' : '完整游戏草稿');
        if (artifact.stage === 'delivery') checkpoint(state, '游戏导出包待验收');
        if (artifact.stage === 'character') checkpoint(state, artifact.characterPhase === 'actions' ? '人物动作草稿' : '人物候选草稿');
      });
      this.#emit(updated);
    } catch (error) {
      const failure = publicCreationError(error);
      const updated = await this.options.store.change(projectId, (state) => {
        if (state.task?.id !== taskId || state.task.state !== 'running') return false;
        state.task.state = signal.aborted ? 'stopped' : 'failed';
        state.task.error = failure.message;
        state.steps[state.task.stage].status = signal.aborted ? 'stopped' : 'failed';
        state.error = failure;
      });
      this.#emit(updated);
    }
  }
  #emit(workflow: CreationWorkflow): void {
    try {
      void Promise.resolve(this.options.onChanged?.(structuredClone(workflow))).catch(() => undefined);
    } catch {
      // State is already durable. A disconnected UI must not strand or fail a task.
    }
  }
}
export function publicCreationError(error: unknown): { code: string; message: string } {
  if (error instanceof CreationError) return { code: error.code, message: error.message };
  return { code: 'GENERATION_FAILED', message: '这次制作未完成，已有成果和历史版本仍保留。可以重试当前阶段；若再次失败，请保留当前项目以便排查。' };
}
function validateAction(input: CreationAction): void {
  if (!input || !['run', 'confirm', 'select', 'revise', 'restore', 'stop', 'animate', 'edit-character', 'continue', 'revise-appearance', 'export', 'return-game'].includes(input.action)
    || (input.prompt !== undefined && (typeof input.prompt !== 'string' || input.prompt.length > 20_000))
    || (input.action === 'revise-appearance' && (!['character', 'scene'].includes(input.appearanceTarget ?? '') || !input.prompt?.trim()))) {
    throw new CreationError('INVALID_INPUT', '操作或修改内容无效。');
  }
}
