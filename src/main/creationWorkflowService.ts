import {
  CREATION_STAGES, CREATION_LAST_ENABLED_STAGE, creationStageLimit, isCreationStageEnabled, isCreationStage, isExplicitConfirmation,
  type CreationAction, type CreationArtifact, type CreationWorkflow, type CreationStage,
} from '../shared/creation.js';
import {
  CreationError, CreationWorkflowStore, checkpoint, claimAction, creationId,
  currentArtifact, invalidateFrom, requireIdle,
} from './creationWorkflowStore.js';

export interface CreationGenerator {
  generate(workflow: CreationWorkflow, signal: AbortSignal): Promise<CreationArtifact>;
}
export interface CreationServiceOptions {
  store: CreationWorkflowStore;
  generator: CreationGenerator;
  onChanged?(workflow: CreationWorkflow): void;
  validateSnapshot?(projectId: string, snapshotId: string): Promise<void>;
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
    if (input.action === 'restore') {
      const state = await this.get(input.projectId);
      const target = state?.history.find((item) => item.id === input.checkpointId);
      if (target) this.#requireEnabled(target.stage, target.steps.direction.artifact?.direction?.genre);
      if (target?.snapshotId) await this.options.validateSnapshot?.(input.projectId, target.snapshotId);
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
      if (action !== 'restore') this.#requireEnabled(action === 'revise' && input.stage ? input.stage : state.currentStage, state.steps.direction.artifact?.direction?.genre);
      state.error = null;
      let characterPhase = state.currentStage === 'character'
        ? (state.steps.character.artifact?.characterPhase === 'actions' || (['failed', 'stopped'].includes(state.task?.state ?? '') && state.task?.characterPhase === 'actions') ? 'actions' : 'candidates') as 'actions' | 'candidates' : undefined;
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
      if (action === 'continue') {
        const next = state.currentStage === 'character' ? 'scene' : state.currentStage === 'scene' ? 'playable' : null;
        if (!next || !step.artifact?.ready || step.status !== 'confirmed' || input.versionId !== step.artifact.id
          || step.confirmedVersionId !== step.artifact.id || (state.currentStage === 'character' && step.artifact.characterPhase !== 'actions')) throw new CreationError('NOT_CONFIRMABLE', '请先确认当前人物动作或场景。');
        this.#requireEnabled(next, state.steps.direction.artifact?.direction?.genre);
        checkpoint(state, next === 'scene' ? '开始场景前' : '开始核心试玩前'); state.currentStage = next; characterPhase = undefined;
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
        state.completed = state.currentStage === 'delivery';
        checkpoint(state, step.artifact.characterPhase === 'actions' ? '已确认人物动作' : `已确认${CREATION_STAGES.find((item) => item.id === state.currentStage)!.label}`);
        if (state.currentStage === creationStageLimit(state.steps.direction.artifact?.direction?.genre, this.#lastEnabledStage) || step.artifact.characterPhase === 'candidates') {
          state.task = null;
          return;
        }
        if (state.completed) return;
        const index = CREATION_STAGES.findIndex((item) => item.id === state.currentStage);
        state.currentStage = CREATION_STAGES[index + 1].id;
      } else if (action === 'run') {
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
        prompt: action === 'confirm' ? '' : input.prompt?.trim() ?? retryPrompt, startedAt: new Date().toISOString(),
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
      throw new CreationError('STAGE_UNAVAILABLE', '本节点只开放横版核心试玩；俯视试玩和完整游戏尚未开放。');
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
      const artifact = await this.options.generator.generate(workflow, signal);
      if (signal.aborted) return;
      const updated = await this.options.store.change(projectId, (state) => {
        if (state.task?.id !== taskId || state.task.state !== 'running') return false;
        if (artifact.stage !== state.task.stage) throw new CreationError('INVALID_OUTPUT', '生成结果不属于当前阶段。');
        state.task.state = 'succeeded';
        state.steps[artifact.stage] = { status: 'awaiting-confirmation', artifact, confirmedVersionId: null };
        if (artifact.snapshotId) state.workingSnapshotId = artifact.snapshotId;
        state.error = null;
        if (artifact.stage === 'direction') checkpoint(state, '方向草稿');
        if (artifact.stage === 'scene') checkpoint(state, '场景草稿');
        if (artifact.stage === 'playable') checkpoint(state, '核心试玩草稿');
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
  #emit(workflow: CreationWorkflow): void { this.options.onChanged?.(structuredClone(workflow)); }
}
export function publicCreationError(error: unknown): { code: string; message: string } {
  if (error instanceof CreationError) return { code: error.code, message: error.message };
  return { code: 'GENERATION_FAILED', message: '这次制作未完成，已有成果和历史版本仍保留。可以重试当前阶段；若再次失败，请保留当前项目以便排查。' };
}
function validateAction(input: CreationAction): void {
  if (!input || !['run', 'confirm', 'select', 'revise', 'restore', 'stop', 'animate', 'edit-character', 'continue'].includes(input.action)
    || (input.prompt !== undefined && (typeof input.prompt !== 'string' || input.prompt.length > 20_000))) {
    throw new CreationError('INVALID_INPUT', '操作或修改内容无效。');
  }
}
