import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  CREATION_STAGES, affectedStages, isCreationStage,
  type CreationAction, type CreationArtifact, type CreationCheckpoint,
  type CreationStage, type CreationStep, type CreationWorkflow,
} from '../shared/creation.js';

export class CreationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export const creationId = () => randomUUID();
export function assertCreationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(value)) {
    throw new CreationError('INVALID_ID', '项目或操作标识无效，请重新打开项目。');
  }
}
function now() { return new Date().toISOString(); }
function blankSteps(): Record<CreationStage, CreationStep> {
  return Object.fromEntries(CREATION_STAGES.map(({ id }) => [id, {
    status: 'idle', artifact: null, confirmedVersionId: null,
  }])) as Record<CreationStage, CreationStep>;
}
export function newCreation(projectId: string, idea: string): CreationWorkflow {
  assertCreationId(projectId);
  if (typeof idea !== 'string' || !idea.trim() || idea.length > 50_000) throw new CreationError('INVALID_INPUT', '请用简短文字描述你的游戏。');
  return { schemaVersion: 1, projectId, revision: 0, idea: idea.trim(), currentStage: 'direction', workingSnapshotId: null,
    steps: blankSteps(), task: null, history: [], operations: [], error: null, completed: false, updatedAt: now() };
}

/** Private host store: never placed in the Agent's writable game workspace. */
const workflowWrites = new Map<string, Promise<unknown>>();
export class CreationWorkflowStore {
  constructor(readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('Creation storage must be absolute');
  }
  async get(projectId: string): Promise<CreationWorkflow | null> {
    assertCreationId(projectId);
    await workflowWrites.get(resolve(this.directory, `${projectId}.json`))?.catch(() => undefined);
    return this.#read(projectId);
  }
  async create(projectId: string, idea: string): Promise<CreationWorkflow> {
    return this.#exclusive(projectId, async () => {
      const existing = await this.#read(projectId);
      if (existing) return existing;
      const workflow = newCreation(projectId, idea);
      await this.#write(workflow);
      return structuredClone(workflow);
    });
  }
  async change(projectId: string, mutate: (workflow: CreationWorkflow) => void | boolean): Promise<CreationWorkflow> {
    return this.#exclusive(projectId, async () => {
      const workflow = await this.#read(projectId);
      if (!workflow) throw new CreationError('NOT_FOUND', '这个项目尚未使用分阶段创作。');
      if (mutate(workflow) !== false) {
        workflow.revision += 1;
        workflow.updatedAt = now();
        await this.#write(workflow);
      }
      return structuredClone(workflow);
    });
  }
  async recover(projectId: string): Promise<CreationWorkflow | null> {
    if (!await this.get(projectId)) return null;
    return this.change(projectId, (workflow) => {
      if (workflow.task?.state !== 'running') return false;
      workflow.task.state = 'stopped';
      workflow.task.error = '上次制作中断，已确认内容仍保留。请检查后重试。';
      workflow.steps[workflow.task.stage].status = 'stopped';
      workflow.error = { code: 'INTERRUPTED', message: workflow.task.error };
    });
  }
  async #read(projectId: string): Promise<CreationWorkflow | null> {
    try {
      const bytes = await readFile(join(this.directory, `${projectId}.json`));
      if (bytes.length > 32 * 1024 * 1024) throw new Error('Oversized workflow');
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      assertWorkflow(value, projectId);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CreationError('CORRUPT_STATE', '创作记录无法读取，原文件已保留。请先修复记录，不会覆盖或重新生成。');
    }
  }
  async #write(workflow: CreationWorkflow): Promise<void> {
    assertWorkflow(workflow, workflow.projectId);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const destination = join(this.directory, `${workflow.projectId}.json`);
    const temporary = `${destination}.${creationId()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(workflow, null, 2) + '\n');
        await file.sync();
      } finally { await file.close(); }
      await rename(temporary, destination);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  #exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    assertCreationId(id);
    const key = resolve(this.directory, `${id}.json`);
    const result = (workflowWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
    workflowWrites.set(key, result);
    void result.finally(() => { if (workflowWrites.get(key) === result) workflowWrites.delete(key); }).catch(() => undefined);
    return result;
  }
}

export function assertWorkflow(value: unknown, projectId: string): asserts value is CreationWorkflow {
  const workflow = value as CreationWorkflow;
  if (!workflow || workflow.schemaVersion !== 1 || workflow.projectId !== projectId
    || !Number.isSafeInteger(workflow.revision) || workflow.revision < 0 || !isCreationStage(workflow.currentStage)
    || typeof workflow.idea !== 'string' || typeof workflow.completed !== 'boolean'
    || !Array.isArray(workflow.history) || !Array.isArray(workflow.operations) || !workflow.steps) throw new Error('Invalid workflow');
  const validateSteps = (steps: CreationWorkflow['steps']) => {
    for (const { id } of CREATION_STAGES) {
      const step = steps[id];
      if (!step || !['idle', 'running', 'awaiting-confirmation', 'confirmed', 'needs-update', 'failed', 'stopped'].includes(step.status)) throw new Error('Invalid step');
      if (step.artifact && (step.artifact.stage !== id || typeof step.artifact.id !== 'string'
        || !Array.isArray(step.artifact.candidates) || !Array.isArray(step.artifact.media)
        || !Array.isArray(step.artifact.checks) || typeof step.artifact.ready !== 'boolean')) throw new Error('Invalid artifact');
      if (id === 'direction' && step.artifact) {
        const card = step.artifact.direction;
        if (!card || !['platformer', 'topdown'].includes(card.genre)
          || ![card.title, card.theme, card.controls, card.goal, card.style].every((item) => typeof item === 'string' && item.trim())
          || !Array.isArray(card.scope) || !card.scope.length
          || !card.scope.every((item) => typeof item === 'string' && item.trim())
          || !Array.isArray(step.artifact.changes) || !step.artifact.changes.every((item) => typeof item === 'string')) {
          throw new Error('Invalid saved direction');
        }
      }
      if (id === 'character' && step.artifact?.characterPhase === 'candidates') {
        const artifact = step.artifact;
        if (artifact.candidates.length !== 2 || new Set(artifact.candidates.map((item) => item.id)).size !== 2
          || artifact.media.length || !artifact.snapshotId || !artifact.lockedAssets
          || (artifact.selectedCharacterId !== null && !artifact.candidates.some((item) => item.id === artifact.selectedCharacterId))
          || artifact.ready !== Boolean(artifact.selectedCharacterId)) throw new Error('Invalid saved candidates');
        assertCreationId(artifact.snapshotId);
        for (const item of artifact.candidates) {
          if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(item.id)
            || typeof item.name !== 'string' || !item.name.trim()
            || typeof item.image !== 'string' || !/^public\/assets\/images\/[^/]+\.(png|jpe?g|webp)$/iu.test(item.image)
            || !/^[a-f0-9]{64}$/u.test(artifact.lockedAssets[item.image] ?? '')
            || (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 300))) {
            throw new Error('Invalid saved candidate image');
          }
        }
      }
      if (step.artifact?.playable) {
        const playable = step.artifact.playable;
        const valid = playable.genre === 'platformer'
          ? playable.manifest === '.noobi/platformer-preview.json' && [1, 2].includes(playable.maxJumps)
          : playable.genre === 'topdown' && playable.manifest === '.noobi/topdown-preview.json' && [0, 1].includes(playable.maxBounces);
        if (id !== 'playable' || !step.artifact.ready || !step.artifact.snapshotId || !valid) throw new Error('Invalid saved playable');
      }
      if (step.artifact?.scene) {
        const artifact = step.artifact;
        if (id !== 'scene' || !artifact.ready || !artifact.snapshotId || artifact.scene!.manifest !== '.noobi/scene-preview.json'
          || !['topdown', 'platformer'].includes(artifact.scene!.genre)
          || !/^public\/assets\/images\/[^/]+\.png$/u.test(artifact.scene!.background)
          || !/^[a-f0-9]{64}$/u.test(artifact.lockedAssets[artifact.scene!.background] ?? '')) throw new Error('Invalid saved scene');
      }
      if (step.artifact?.round) {
        const round = step.artifact.round;
        const valid = round.genre === 'platformer'
          ? round.manifest === '.noobi/platformer-round.json' && Number.isInteger(round.timeLimitSeconds)
            && round.timeLimitSeconds >= 30 && round.timeLimitSeconds <= 300 && [1, 2].includes(round.maxJumps)
          : round.genre === 'topdown' && round.manifest === '.noobi/topdown-round.json'
            && Array.isArray(round.waveCounts) && round.waveCounts.length === 3
            && round.waveCounts.every(count => Number.isInteger(count) && count >= 1 && count <= 12)
            && Number.isInteger(round.playerHealth) && round.playerHealth >= 1 && round.playerHealth <= 20 && [0, 1].includes(round.maxBounces);
        if (id !== 'game' || !step.artifact.ready || !step.artifact.snapshotId || !valid) {
          throw new Error('Invalid saved complete round');
        }
      }
      if (step.artifact?.appearanceChange) {
        const change = step.artifact.appearanceChange;
        const expected = change.target === 'character' ? ['character', 'scene', 'playable', 'game'] : ['scene', 'playable', 'game'];
        if (id !== 'game' || !step.artifact.round || !['character', 'scene'].includes(change.target)
          || JSON.stringify(change.stages) !== JSON.stringify(expected)) throw new Error('Invalid appearance revision');
        assertCreationId(change.checkpointId);
      }
      if (step.artifact?.delivery) {
        const delivery = step.artifact.delivery;
        if (id !== 'delivery' || !step.artifact.ready || step.artifact.snapshotId !== delivery.sourceSnapshotId
          || !Number.isInteger(delivery.fileCount) || delivery.fileCount < 1 || delivery.fileCount > 10_010
          || !/^[a-f0-9]{64}$/u.test(delivery.manifestSha256) || !/^[a-f0-9]{64}$/u.test(delivery.archiveSha256)) throw new Error('Invalid delivery record');
        for (const value of [delivery.bundleId, delivery.sourceVersionId, delivery.sourceSnapshotId]) assertCreationId(value);
      }
      if (step.artifact?.characterPhase === 'actions') {
        const artifact = step.artifact;
        if (!artifact.ready || !artifact.snapshotId || !artifact.selectedCharacterId || artifact.candidates.length !== 2
          || !artifact.actions || artifact.actions.manifest !== '.noobi/character-actions.json'
          || !Array.isArray(artifact.actions.states) || !artifact.actions.states.some(item => item.id === 'walk')
          || !artifact.media.some(item => item.kind === 'animation')) throw new Error('Invalid saved actions');
      }
      if (step.confirmedVersionId && (step.artifact?.id !== step.confirmedVersionId || !step.artifact.ready)) throw new Error('Invalid approval');
      if (step.status === 'confirmed' && !step.confirmedVersionId) throw new Error('Missing approval');
    }
  };
  validateSteps(workflow.steps);
  for (const checkpoint of workflow.history) {
    assertCreationId(checkpoint.id);
    if (!isCreationStage(checkpoint.stage) || typeof checkpoint.completed !== 'boolean') throw new Error('Invalid checkpoint');
    validateSteps(checkpoint.steps);
  }
  if (workflow.task?.characterPhase && !['candidates', 'actions'].includes(workflow.task.characterPhase)) throw new Error('Invalid character task');
  if (workflow.task?.appearanceTarget) {
    if (workflow.task.stage !== 'game' || !['character', 'scene'].includes(workflow.task.appearanceTarget)) throw new Error('Invalid appearance task');
    assertCreationId(workflow.task.sourceCheckpointId);
    if (!workflow.history.some(point => point.id === workflow.task!.sourceCheckpointId)) throw new Error('Missing appearance source');
  }
  if (workflow.task && (!isCreationStage(workflow.task.stage) || !['running', 'succeeded', 'failed', 'stopped'].includes(workflow.task.state))) throw new Error('Invalid task');
}

/** Returns false for a successful retry of the same action, before revision checking. */
export function claimAction(workflow: CreationWorkflow, action: CreationAction): boolean {
  assertCreationId(action.operationId);
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...action, expectedRevision: undefined })).digest('hex');
  const prior = workflow.operations.find((item) => item.id === action.operationId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new CreationError('OPERATION_CONFLICT', '这次操作标识已用于其他内容，请重新操作。');
    return false;
  }
  if (!Number.isSafeInteger(action.expectedRevision) || action.expectedRevision !== workflow.revision) {
    throw new CreationError('STALE_VERSION', '成果已有更新，请查看最新版本后再操作。');
  }
  workflow.operations.push({ id: action.operationId, fingerprint });
  return true;
}
export function requireIdle(workflow: CreationWorkflow): void {
  if (workflow.task?.state === 'running') throw new CreationError('BUSY', '当前正在制作，请等待完成或先停止。');
}
export function currentArtifact(workflow: CreationWorkflow): CreationArtifact | null {
  return workflow.steps[workflow.currentStage].artifact;
}
export function lastSnapshot(workflow: CreationWorkflow): string | null {
  return workflow.workingSnapshotId;
}
export function checkpoint(workflow: CreationWorkflow, label: string): CreationCheckpoint {
  const record: CreationCheckpoint = { id: creationId(), label, createdAt: now(), stage: workflow.currentStage,
    steps: structuredClone(workflow.steps), snapshotId: lastSnapshot(workflow), completed: workflow.completed };
  // Running task state never becomes resumable evidence in a version checkpoint.
  for (const step of Object.values(record.steps)) if (step.status === 'running') step.status = step.artifact ? 'awaiting-confirmation' : 'idle';
  workflow.history.push(record);
  return record;
}
export function invalidateFrom(workflow: CreationWorkflow, stage: CreationStage): void {
  for (const id of affectedStages(stage)) {
    const step = workflow.steps[id];
    step.status = step.artifact ? 'needs-update' : 'idle';
    step.confirmedVersionId = null;
  }
  workflow.currentStage = stage;
  workflow.completed = false;
}
