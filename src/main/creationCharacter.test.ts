import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationAction, CreationArtifact, CreationWorkflow } from '../shared/creation.js';
import { CreationWorkflowStore, creationId, newCreation } from './creationWorkflowStore.js';
import { CreationWorkflowService } from './creationWorkflowService.js';
import { creationHash, CreationVersionStore } from './creationVersionStore.js';
import { directionArtifact, readCreationArtifact } from './creationArtifact.js';
import { creationStageTask } from './creationPrompts.js';
import { StagedCreationGenerator } from './creationGenerator.js';
import { GameHarnessReviewFailedError, GameHarnessTurnTimeoutError } from './gameHarness.js';
import { publicCreationError } from './creationWorkflowService.js';

const brief = { title: '剑客', genre: 'topdown' as const, theme: '武侠', controls: '移动攻击', goal: '三波敌人', style: '像素', scope: ['一张地图'] };
const imageA = 'public/assets/images/a.png';
const imageB = 'public/assets/images/b.png';
function candidates(selected: string | null = null): CreationArtifact {
  return { ...directionArtifact(brief), stage: 'character', direction: undefined, characterPhase: 'candidates',
    candidates: [{ id: 'a', name: '青衣', image: imageA }, { id: 'b', name: '红衣', image: imageB }],
    ready: Boolean(selected), selectedCharacterId: selected, snapshotId: 'snapshot', lockedAssets: { [imageA]: 'a'.repeat(64), [imageB]: 'b'.repeat(64) } };
}
describe('node 2-2 candidate choices and restoration', () => {
  let root: string; let store: CreationWorkflowStore; let service: CreationWorkflowService;
  let generate: ReturnType<typeof vi.fn<(state: CreationWorkflow, signal: AbortSignal) => Promise<CreationArtifact>>>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'character-workflow-'));
    store = new CreationWorkflowStore(root);
    generate = vi.fn(async state => state.currentStage === 'direction' ? directionArtifact(brief) : candidates(state.steps.character.artifact?.selectedCharacterId ?? null));
    service = new CreationWorkflowService({ store, generator: { generate }, lastEnabledStage: 'character' });
    await service.create('project', '武侠打怪');
  });
  afterEach(async () => { await service.stopAll(); await rm(root, { recursive: true, force: true }); });
  async function act(input: Partial<CreationAction> & Pick<CreationAction, 'action'>) {
    const s = (await service.get('project'))!;
    await service.act({ projectId: s.projectId, expectedRevision: s.revision, operationId: creationId(), versionId: s.steps[s.currentStage].artifact?.id, ...input });
    await service.idle('project'); return (await service.get('project'))!;
  }
  async function begin() { await act({ action: 'run' }); return act({ action: 'confirm' }); }
  it('produces candidates after direction confirmation but never images before approval', async () => {
    await act({ action: 'run' }); expect(generate).toHaveBeenCalledTimes(1);
    const s = await act({ action: 'confirm' });
    expect(s.currentStage).toBe('character'); expect(s.steps.character.artifact?.candidates).toHaveLength(2);
    expect(s.steps.scene.status).toBe('idle'); expect(generate).toHaveBeenCalledTimes(2);
  });
  it('selection and candidate approval persist without generation, actions or scene advancement', async () => {
    await begin(); await expect(act({ action: 'confirm' })).rejects.toMatchObject({ code: 'NOT_CONFIRMABLE' });
    const choice = await act({ action: 'select', candidateId: 'b' });
    const saved = await act({ action: 'confirm' });
    expect(saved.steps.character.confirmedVersionId).toBe(choice.steps.character.artifact?.id);
    expect(saved.steps.character.artifact?.characterPhase).toBe('candidates');
    expect(saved.currentStage).toBe('character'); expect(saved.completed).toBe(false); expect(saved.task).toBeNull();
    expect(generate).toHaveBeenCalledTimes(2); expect(await new CreationWorkflowStore(root).get('project')).toEqual(saved);
  });
  it('requires an explicit selection before editing and rejects old candidate versions', async () => {
    const s = await begin();
    await expect(act({ action: 'run', prompt: '改衣服' })).rejects.toMatchObject({ code: 'CANDIDATE_REQUIRED' });
    await act({ action: 'select', candidateId: 'a' });
    await expect(act({ action: 'select', candidateId: 'b', versionId: s.steps.character.artifact!.id })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('changing an approved selection requires impact acknowledgement and resets approval without a model call', async () => {
    await begin(); await act({ action: 'select', candidateId: 'a' }); await act({ action: 'confirm' });
    await expect(act({ action: 'select', candidateId: 'b' })).rejects.toMatchObject({ code: 'IMPACT_CONFIRMATION_REQUIRED' });
    const s = await act({ action: 'select', candidateId: 'b', impactAccepted: true });
    expect(s.steps.character.confirmedVersionId).toBeNull(); expect(s.steps.character.artifact?.selectedCharacterId).toBe('b');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('edits selected characters, requires reconfirmation and restores exact old selection without generation', async () => {
    await begin(); await act({ action: 'select', candidateId: 'b' });
    const approved = await act({ action: 'confirm' });
    const checkpoint = [...approved.history].reverse().find(h => h.label === '已确认人物')!;
    const edited = candidates('b'); edited.candidates[1].name = '白衣';
    generate.mockResolvedValueOnce(edited);
    const s = await act({ action: 'revise', stage: 'character', impactAccepted: true, prompt: '衣服改白，保留发型和武器' });
    expect(generate.mock.calls.at(-1)?.[0].steps.character.artifact?.selectedCharacterId).toBe('b');
    expect(s.steps.character.confirmedVersionId).toBeNull();
    const restored = await act({ action: 'restore', impactAccepted: true, checkpointId: checkpoint.id });
    expect(restored.steps.character).toEqual(approved.steps.character);
    expect(restored.currentStage).toBe('character'); expect(generate).toHaveBeenCalledTimes(3);
  });
  it('failed edits keep both previous images and can retry the same request', async () => {
    await begin(); const old = await act({ action: 'select', candidateId: 'a' });
    generate.mockRejectedValueOnce(new Error('private failure'));
    const failed = await act({ action: 'run', prompt: '衣服改白' });
    expect(failed.steps.character.artifact).toEqual(old.steps.character.artifact);
    await act({ action: 'run' }); expect(generate.mock.calls.at(-1)?.[0].task?.prompt).toBe('衣服改白');
  });
  it('upgrades an already approved 2-1 direction to an idle character step without generating', async () => {
    const legacy = new CreationWorkflowService({ store, generator: { generate }, lastEnabledStage: 'direction' });
    await act({ action: 'run' }); const s = (await service.get('project'))!;
    await legacy.act({ projectId: 'project', operationId: creationId(), expectedRevision: s.revision, action: 'confirm', versionId: s.steps.direction.artifact!.id });
    await service.recover('project'); const reopened = (await service.get('project'))!;
    expect(reopened.currentStage).toBe('character'); expect(reopened.steps.character.status).toBe('idle');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('a new direction invalidates and regenerates the candidate pair instead of editing an old selection', async () => {
    await begin(); await act({ action: 'select', candidateId: 'a' });
    await act({ action: 'revise', stage: 'direction', impactAccepted: true, prompt: '太空横版' });
    await act({ action: 'confirm' });
    expect(generate.mock.calls.at(-1)?.[0].steps.character.artifact).toBeNull();
  });
  it.each(['choice', 'image', 'hash'])('preserves corrupt saved %s records instead of loading them', async target => {
    const s = await begin(); const a = s.steps.character.artifact!;
    if (target === 'choice') a.selectedCharacterId = 'missing';
    if (target === 'image') a.candidates[0].image = '../outside.png';
    if (target === 'hash') a.lockedAssets[imageA] = 'invalid';
    const file = join(root, 'project.json'); const original = JSON.stringify(s); await writeFile(file, original);
    await expect(store.get('project')).rejects.toMatchObject({ code: 'CORRUPT_STATE' });
    expect(await readFile(file, 'utf8')).toBe(original);
  });
  it('rejects scene work even when the client tries to bypass the hidden stage', async () => {
    await begin(); await expect(act({ action: 'revise', stage: 'scene', impactAccepted: true })).rejects.toMatchObject({ code: 'STAGE_UNAVAILABLE' });
  });
});

describe('candidate artifacts and existing generation adapter', () => {
  let root: string; let state: CreationWorkflow; let result: Record<string, unknown>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'character-artifacts-')); await mkdir(join(root, '.noobi'));
    await mkdir(join(root, 'public/assets/images'), { recursive: true });
    // Offline provenance adapter fixtures, never used as real model evidence.
    await writeFile(join(root, imageA), 'fixture-a'); await writeFile(join(root, imageB), 'fixture-b');
    state = newCreation('project', '武侠'); state.currentStage = 'character';
    state.steps.direction = { status: 'confirmed', artifact: directionArtifact(brief), confirmedVersionId: null };
    state.steps.direction.confirmedVersionId = state.steps.direction.artifact!.id;
    state.task = { id: 'task', operationId: 'op', stage: 'character', prompt: '', state: 'running', startedAt: '', baseVersionId: null, error: null };
    result = { title: '人物候选', summary: '两个形象', changes: [], ready: false,
      candidates: candidates().candidates, selectedCharacterId: null, media: [], lockedAssets: [] };
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const proof = async () => true;
  async function check(hasProof = proof) { await writeFile(join(root, '.noobi/stage-result.json'), JSON.stringify(result)); return readCreationArtifact(root, state, hasProof, true); }
  async function select() { const initial = await check(); initial.selectedCharacterId = 'a'; initial.ready = true; initial.snapshotId = 'snapshot'; state.steps.character.artifact = initial; result.selectedCharacterId = 'a'; }
  it('validates two images as candidates without requiring Godot or animations', async () => {
    expect(await check()).toMatchObject({ characterPhase: 'candidates', ready: false, selectedCharacterId: null });
  });
  it('rejects missing generation proof, duplicate image contents and premature animation claims', async () => {
    await expect(check(async () => false)).rejects.toMatchObject({ code: 'UNPROVEN_IMAGE' });
    result.ready = true; await expect(check()).rejects.toMatchObject({ code: 'INVALID_OUTPUT' }); result.ready = false;
    await writeFile(join(root, imageB), 'fixture-a'); await expect(check()).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });
  it('allows only the selected image to change and requires visible file changes', async () => {
    await select(); await expect(check()).rejects.toMatchObject({ code: 'UNCHANGED_IMAGE' });
    await writeFile(join(root, imageA), 'white-clothes'); const edited = await check();
    expect(edited.ready).toBe(true); expect(edited.lockedAssets[imageB]).toBe(await creationHash(root, imageB));
    await writeFile(join(root, imageB), 'unrequested-edit');
    await expect(check()).rejects.toMatchObject({ code: 'UNRELATED_CANDIDATE_CHANGED' });
  });
  it('does not let the model replace the user choice', async () => {
    await select(); result.selectedCharacterId = 'b'; await expect(check()).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });
  it.each(['platformer', 'topdown'] as const)('inherits %s perspective and requires original-image editing', async genre => {
    await select(); state.steps.direction.artifact!.direction!.genre = genre;
    const prompt = creationStageTask(state);
    expect(prompt).toContain(genre === 'platformer' ? '侧向全身' : '俯视打怪角色');
    expect(prompt).toContain('referenced_image_paths'); expect(prompt).toContain(imageA); expect(prompt).toContain('至多生成 1 张');
  });
  it('runs the existing harness with repair disabled, saves images and previews without engine calls', async () => {
    const versions = new CreationVersionStore(join(root, 'version-data'));
    // Candidate source is separate from the snapshot storage to avoid recursive copying.
    const source = join(root, 'source'); await mkdir(source); await mkdir(join(source, '.noobi'));
    await writeFile(join(source, '.noobi/stage-check.json'), JSON.stringify({ taskId: 'old-task', ok: true }));
    const forbidden = vi.fn(() => { throw new Error('Engine or later stage called'); });
    const harness = { run: vi.fn(async (options: { cwd: string; prepareHostReview: () => Promise<void>; validateHostDelivery: () => Promise<{ ok: boolean }> }) => {
      await expect(readFile(join(options.cwd, '.noobi/stage-check.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      await mkdir(join(options.cwd, 'public/assets/images'), { recursive: true });
      await writeFile(join(options.cwd, imageA), 'fixture-a'); await writeFile(join(options.cwd, imageB), 'fixture-b');
      await writeFile(join(options.cwd, '.noobi/stage-result.json'), JSON.stringify(result));
      await writeFile(join(options.cwd, '.noobi/stage-check.json'), JSON.stringify({ taskId: 'forged-old-task', ok: true }));
      await options.prepareHostReview();
      await expect(readFile(join(options.cwd, '.noobi/stage-check.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await options.validateHostDelivery()).ok).toBe(true);
      const evidence = JSON.parse(await readFile(join(options.cwd, '.noobi/stage-check.json'), 'utf8'));
      expect(evidence.taskId).toBe(state.task!.id);
      expect(evidence.resultSha256).toBe(await creationHash(options.cwd, '.noobi/stage-result.json'));
    }), stop: vi.fn() };
    const generator = new StagedCreationGenerator({ runtime: {} as never, harness: harness as never, versions, previews: { start: forbidden } as never,
      project: async () => ({ id: 'project', root: source, model: null } as never), settings: async () => ({ defaultModel: 'configured', defaultEffort: 'medium' }),
      preflight: async () => ({ tools: [], imageSkill: null }), candidateRoute: vi.fn(), waitForMedia: async () => {}, hasImageProof: proof, recordScopedImageProof: vi.fn(),
      mediaRequirements: forbidden, validateDelivery: forbidden });
    const artifact = await generator.generate(state, new AbortController().signal);
    expect(harness.run).toHaveBeenCalledWith(expect.objectContaining({ maxRepairAttempts: 0, stageTask: expect.stringContaining('CHARACTER CANDIDATES ONLY') }));
    artifact.selectedCharacterId = 'a'; artifact.ready = true; state.steps.character.artifact = artifact;
    const preview = await generator.preview(state, artifact.id);
    expect(preview.images).toHaveLength(2); expect(preview.playableUrl).toBeNull(); expect(forbidden).not.toHaveBeenCalled();
  });
  it.each([
    ['missing', new GameHarnessReviewFailedError('private reviewer detail'), 'CHARACTER_NOT_GENERATED'],
    ['rejected', new GameHarnessReviewFailedError('private reviewer detail'), 'CHARACTER_REVIEW_FAILED'],
    ['timeout', new GameHarnessTurnTimeoutError('project', 'turn'), 'GENERATION_TIMEOUT'],
  ])('reports a safe, actionable %s failure instead of blaming the account', async (kind, failure, code) => {
    const source = join(root, 'source'); await mkdir(source);
    const harness = { run: vi.fn(async (options: { cwd: string }) => {
      if (kind === 'rejected') { await mkdir(join(options.cwd, 'public/assets/images'), { recursive: true }); await writeFile(join(options.cwd, imageA), 'rejected-fixture'); }
      throw failure;
    }), stop: vi.fn() };
    const generator = new StagedCreationGenerator({ runtime: {} as never, harness: harness as never,
      versions: new CreationVersionStore(join(root, 'versions')), previews: {} as never,
      project: async () => ({ id: 'project', root: source, model: null } as never), settings: async () => ({ defaultModel: null, defaultEffort: 'medium' }),
      preflight: async () => ({ tools: [], imageSkill: null }), candidateRoute: vi.fn(), waitForMedia: async () => {}, hasImageProof: proof, recordScopedImageProof: vi.fn(),
      mediaRequirements: vi.fn(), validateDelivery: vi.fn() });
    const error = await generator.generate(state, new AbortController().signal).catch(publicCreationError);
    expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toMatch(/private reviewer|检查账户|turn-/u);
    expect(harness.run).toHaveBeenCalledTimes(1);
  });
});
