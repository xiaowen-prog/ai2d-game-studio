import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATION_STAGES, isExplicitConfirmation, type CreationAction, type CreationArtifact, type CreationWorkflow } from '../shared/creation.js';
import { CreationWorkflowStore, creationId } from './creationWorkflowStore.js';
import { CreationWorkflowService } from './creationWorkflowService.js';
import { directionArtifact, parseCreationDirection } from './creationArtifact.js';

const brief = { title: '竹林剑客', genre: 'topdown' as const, theme: '武侠', controls: '方向键移动', goal: '击败三波敌人', style: '像素', scope: ['一张地图、三波敌人'] };
function output(workflow: CreationWorkflow): CreationArtifact {
  if (workflow.currentStage === 'direction') return directionArtifact(brief);
  const selected = workflow.steps.character.artifact?.selectedCharacterId ?? null;
  return { ...directionArtifact(brief), direction: undefined, stage: workflow.currentStage,
    candidates: workflow.currentStage === 'character' ? [{ id: 'a', name: '甲', image: 'a.png' }, { id: 'b', name: '乙', image: 'b.png' }] : [],
    selectedCharacterId: selected, ready: workflow.currentStage !== 'character' || !!selected,
    snapshotId: creationId() };
}
describe('creation workflow host approval and persistence', () => {
  let root: string; let store: CreationWorkflowStore; let service: CreationWorkflowService;
  let generate: ReturnType<typeof vi.fn<(workflow: CreationWorkflow, signal: AbortSignal) => Promise<CreationArtifact>>>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'creation-test-')); store = new CreationWorkflowStore(root);
    generate = vi.fn(async (workflow) => output(workflow));
    service = new CreationWorkflowService({ store, generator: { generate }, lastEnabledStage: 'delivery', characterCandidatesOnly: false });
    await service.create('project', '武侠小游戏');
  });
  afterEach(async () => { await service.stopAll(); await rm(root, { recursive: true, force: true }); });
  async function action(input: Partial<CreationAction> & Pick<CreationAction, 'action'>) {
    const current = (await service.get('project'))!;
    const value = await service.act({ projectId: 'project', operationId: creationId(), expectedRevision: current.revision,
      versionId: current.steps[current.currentStage].artifact?.id, ...input });
    await service.idle('project');
    return (await service.get('project'))!;
  }
  it('does not call any model on creation or while awaiting user confirmation', async () => {
    expect(generate).not.toHaveBeenCalled();
    const state = await action({ action: 'run' });
    expect(state.steps.direction.status).toBe('awaiting-confirmation');
    expect(state.steps.character.status).toBe('idle');
    expect(generate).toHaveBeenCalledTimes(1);
    const reopened = new CreationWorkflowStore(root);
    expect(await reopened.get('project')).toEqual(state);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('persists exact approval before starting the next task and pauses again', async () => {
    const first = await action({ action: 'run' });
    const state = await action({ action: 'confirm' });
    expect(state.steps.direction.confirmedVersionId).toBe(first.steps.direction.artifact!.id);
    expect(state.currentStage).toBe('character');
    expect(state.steps.character.status).toBe('awaiting-confirmation');
    expect(generate.mock.calls[1][0].steps.direction.status).toBe('confirmed');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('does not let character selection bypass action production approval', async () => {
    await action({ action: 'run' }); await action({ action: 'confirm' });
    await expect(action({ action: 'confirm' })).rejects.toMatchObject({ code: 'NOT_CONFIRMABLE' });
    const selected = await action({ action: 'select', candidateId: 'b' });
    expect(selected.currentStage).toBe('character');
    expect(selected.steps.character.artifact?.selectedCharacterId).toBe('b');
    expect(selected.steps.character.artifact?.ready).toBe(true);
    expect(selected.steps.scene.status).toBe('idle');
    expect(selected.steps.character.confirmedVersionId).toBeNull();
  });
  it('deduplicates concurrent retries of one request before checking the old revision', async () => {
    const input: CreationAction = { projectId: 'project', operationId: 'one-operation', expectedRevision: 0, action: 'run' };
    await Promise.all([service.act(input), service.act(input)]);
    await service.idle('project');
    expect(generate).toHaveBeenCalledTimes(1);
    await service.act(input);
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(service.act({ ...input, prompt: 'different' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
  });
  it('rejects stale revisions and old artifact confirmations', async () => {
    const first = await action({ action: 'run' });
    const oldId = first.steps.direction.artifact!.id;
    await action({ action: 'run', prompt: '改成手动攻击' });
    await expect(action({ action: 'confirm', versionId: oldId })).rejects.toMatchObject({ code: 'NOT_CONFIRMABLE' });
    await expect(action({ action: 'confirm', expectedRevision: first.revision })).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });
  it('recognizes explicit assent but never mixed assent and a modification', async () => {
    await action({ action: 'run' });
    const changed = await action({ action: 'run', prompt: '不错，但是衣服换蓝色' });
    expect(changed.currentStage).toBe('direction');
    expect(changed.steps.direction.confirmedVersionId).toBeNull();
    const confirmed = await action({ action: 'run', prompt: '这个版本可以，继续。' });
    expect(confirmed.currentStage).toBe('character');
  });
  it('keeps previous artifacts when a modification fails', async () => {
    const first = await action({ action: 'run' });
    generate.mockRejectedValueOnce(new Error('private stack /secret/path'));
    const failed = await action({ action: 'run', prompt: '换风格' });
    expect(failed.steps.direction.artifact).toEqual(first.steps.direction.artifact);
    expect(failed.error?.message).not.toContain('secret');
    expect(failed.currentStage).toBe('direction');
    expect(failed.steps.direction.status).toBe('failed');
  });
  it('ignores a late result after stop', async () => {
    let release!: (artifact: CreationArtifact) => void;
    generate.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const initial = (await service.get('project'))!;
    await service.act({ projectId: 'project', operationId: creationId(), expectedRevision: initial.revision, action: 'run' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const running = (await service.get('project'))!;
    await service.act({ projectId: 'project', operationId: creationId(), expectedRevision: running.revision, action: 'stop' });
    release(directionArtifact(brief)); await service.idle('project');
    const stopped = (await service.get('project'))!;
    expect(stopped.steps.direction.status).toBe('stopped');
    expect(stopped.steps.direction.artifact).toBeNull();
  });
  it('recovers a persisted in-flight task without automatically starting it', async () => {
    await store.change('project', (state) => {
      state.steps.direction.status = 'running';
      state.task = { id: creationId(), operationId: 'crash', stage: 'direction', state: 'running', prompt: '',
        startedAt: new Date().toISOString(), baseVersionId: null, error: null };
    });
    const recovered = await new CreationWorkflowStore(root).recover('project');
    expect(recovered?.task?.state).toBe('stopped'); expect(generate).not.toHaveBeenCalled();
  });
  it('invalidates downstream confirmations only after explicit impact acceptance', async () => {
    await action({ action: 'run' }); await action({ action: 'confirm' });
    await expect(action({ action: 'revise', stage: 'direction', prompt: '换主题' })).rejects.toMatchObject({ code: 'IMPACT_CONFIRMATION_REQUIRED' });
    const state = await action({ action: 'revise', stage: 'direction', prompt: '换主题', impactAccepted: true });
    expect(state.currentStage).toBe('direction');
    expect(state.steps.character.status).toBe('needs-update');
    expect(state.history.length).toBeGreaterThan(1);
  });
  it('restores a consistent checkpoint without generation or lost history', async () => {
    await action({ action: 'run' });
    const approved = await action({ action: 'confirm' });
    const saved = approved.history.find((item) => item.label === '已确认方向')!;
    await action({ action: 'revise', stage: 'direction', prompt: '换主题', impactAccepted: true });
    const calls = generate.mock.calls.length;
    const restored = await action({ action: 'restore', checkpointId: saved.id });
    expect(restored.steps.direction.confirmedVersionId).toBe(saved.steps.direction.confirmedVersionId);
    expect(restored.currentStage).toBe('character'); expect(restored.steps.character.artifact).toBeNull();
    expect(generate).toHaveBeenCalledTimes(calls); expect(restored.history.length).toBeGreaterThan(approved.history.length);
  });
  it('does not mark the whole project complete until the final human confirmation', async () => {
    await action({ action: 'run' }); await action({ action: 'confirm' });
    await action({ action: 'select', candidateId: 'a' });
    for (const stage of ['character', 'scene', 'playable', 'game']) {
      expect((await service.get('project'))!.currentStage).toBe(stage);
      await action({ action: 'confirm' });
    }
    expect((await service.get('project'))!.currentStage).toBe('delivery');
    expect((await service.get('project'))!.completed).toBe(false);
    expect((await action({ action: 'confirm' })).completed).toBe(true);
  });
  describe('current direction-only release', () => {
    beforeEach(() => { service = new CreationWorkflowService({ store, generator: { generate }, lastEnabledStage: 'direction' }); });
    it('saves approval and stops without starting characters or claiming a completed game', async () => {
      await action({ action: 'run' });
      const state = await action({ action: 'confirm' });
      expect(state.currentStage).toBe('direction');
      expect(state.steps.direction.status).toBe('confirmed');
      expect(state.task).toBeNull();
      expect(state.completed).toBe(false);
      expect(state.steps.character.status).toBe('idle');
      expect(generate).toHaveBeenCalledTimes(1);
      expect(await new CreationWorkflowStore(root).get('project')).toEqual(state);
    });
    it('also stops for natural-language approval and rejects another run of the approved version', async () => {
      await action({ action: 'run' }); await action({ action: 'run', prompt: '确认' });
      await expect(action({ action: 'run' })).rejects.toMatchObject({ code: 'IMPACT_CONFIRMATION_REQUIRED' });
      expect(generate).toHaveBeenCalledTimes(1);
    });
    it('saves drafts and restores an approved version without model calls or advancing', async () => {
      const first = await action({ action: 'run' });
      const approved = await action({ action: 'confirm' });
      const saved = approved.history.find((item) => item.label === '已确认方向')!;
      generate.mockResolvedValueOnce(directionArtifact({ ...brief, controls: '空格键手动攻击' }));
      const changed = await action({ action: 'revise', stage: 'direction', prompt: '手动攻击', impactAccepted: true });
      expect(changed.steps.direction.confirmedVersionId).toBeNull();
      expect(changed.steps.direction.artifact?.direction?.controls).toBe('空格键手动攻击');
      const restored = await action({ action: 'restore', checkpointId: saved.id });
      expect(restored.steps.direction.artifact?.id).toBe(first.steps.direction.artifact?.id);
      expect(restored.steps.direction.status).toBe('confirmed');
      expect(restored.currentStage).toBe('direction');
      expect(generate).toHaveBeenCalledTimes(2);
    });
    it('retries the failed modification, not the original empty request', async () => {
      await action({ action: 'run' });
      generate.mockRejectedValueOnce(new Error('offline failure'));
      await action({ action: 'run', prompt: '改成手动攻击，其他不变' });
      await action({ action: 'run' });
      expect(generate.mock.calls.at(-1)?.[0].task?.prompt).toBe('改成手动攻击，其他不变');
    });
    it('blocks an existing future-stage record and future-stage restoration', async () => {
      await store.change('project', (state) => { state.currentStage = 'character'; });
      await expect(action({ action: 'run' })).rejects.toMatchObject({ code: 'STAGE_UNAVAILABLE' });
      await expect(action({ action: 'revise', stage: 'scene', impactAccepted: true })).rejects.toMatchObject({ code: 'STAGE_UNAVAILABLE' });
      expect(generate).not.toHaveBeenCalled();
    });
  });
  it('does not overwrite corrupted or incompatible records', async () => {
    const path = join(root, 'project.json'); await writeFile(path, '{ broken');
    await expect(store.get('project')).rejects.toMatchObject({ code: 'CORRUPT_STATE' });
    await expect(store.create('project', 'new')).rejects.toMatchObject({ code: 'CORRUPT_STATE' });
    expect(await readFile(path, 'utf8')).toBe('{ broken');
  });
  it.each(['current card', 'history card', 'approval'])('rejects damaged %s without overwriting the saved file', async (target) => {
    const state = await action({ action: 'run' });
    if (target === 'approval') state.steps.direction.status = 'confirmed';
    else {
      const steps = target === 'history card' ? state.history[0].steps : state.steps;
      // Valid JSON with a damaged nested field must not reach the renderer or restore path.
      (steps.direction.artifact!.direction as unknown as Record<string, unknown>).scope = 'broken';
    }
    const path = join(root, 'project.json'); const saved = JSON.stringify(state);
    await writeFile(path, saved);
    await expect(store.get('project')).rejects.toMatchObject({ code: 'CORRUPT_STATE' });
    await expect(store.create('project', 'replacement')).rejects.toMatchObject({ code: 'CORRUPT_STATE' });
    expect(await readFile(path, 'utf8')).toBe(saved);
  });
});
describe('creation direction parsing', () => {
  it('accepts JSON fences and validates the actual enum and required fields', () => {
    expect(parseCreationDirection('```json\n' + JSON.stringify(brief) + '\n```')).toEqual(brief);
    expect(() => parseCreationDirection(JSON.stringify({ ...brief, genre: '3d' }))).toThrow();
    expect(() => parseCreationDirection('{"title":"完成"}')).toThrow();
    expect(() => parseCreationDirection('我已完成')).toThrow();
  });
  it.each(['可以但是换衣服', '不确认', '等等', '', '确认？'])('does not treat %s as assent', (value) => {
    expect(isExplicitConfirmation(value)).toBe(false);
  });
});
