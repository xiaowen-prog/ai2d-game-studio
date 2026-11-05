import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { StagedCreationGenerator } from './creationGenerator.js';
import { newCreation } from './creationWorkflowStore.js';
import { directionArtifact } from './creationArtifact.js';

const brief = { title: '竹林剑客', genre: 'topdown' as const, theme: '武侠', controls: '自动攻击', goal: '三波敌人', style: '像素', scope: ['一张地图'] };
function fixture() {
  const runtime = Object.assign(new EventEmitter(), {
    startThread: vi.fn(async () => 'thread'),
    runTurn: vi.fn(async () => ({ status: 'completed', text: JSON.stringify(brief) })),
    unsubscribeThread: vi.fn(async () => {}), interruptTurn: vi.fn(async () => {}),
  });
  const unexpected = vi.fn(() => { throw new Error('Later-stage tool called'); });
  const options = { runtime, project: async () => ({ id: 'project', root: '/tmp/direction-contract', model: null }),
    settings: async () => ({ defaultModel: 'configured-model', defaultEffort: 'medium' }),
    preflight: async () => ({ tools: [], imageSkill: null }), harness: { run: unexpected },
    versions: { prepare: unexpected }, previews: {}, candidateRoute: unexpected, waitForMedia: unexpected,
    hasImageProof: unexpected, mediaRequirements: unexpected, validateDelivery: unexpected };
  const generator = new StagedCreationGenerator(options as unknown as ConstructorParameters<typeof StagedCreationGenerator>[0]);
  const state = newCreation('project', '做一个武侠游戏');
  state.task = { id: 'task', operationId: 'op', stage: 'direction', prompt: '改成手动攻击',
    startedAt: '', state: 'running', baseVersionId: null, error: null };
  return { runtime, generator, state, unexpected };
}
describe('real direction adapter contract with offline runtime', () => {
  it('uses the configured model and readonly thread, sends the previous card and edit, and never calls game tools', async () => {
    const f = fixture(); f.state.steps.direction.artifact = directionArtifact(brief);
    f.runtime.runTurn.mockResolvedValueOnce({ status: 'completed', text: JSON.stringify({ ...brief, controls: '手动攻击' }) });
    const result = await f.generator.generate(f.state, new AbortController().signal);
    expect(f.runtime.startThread).toHaveBeenCalledWith(expect.objectContaining({ sandbox: 'read-only', approvalPolicy: 'never', model: 'configured-model' }));
    expect(f.runtime.runTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('改成手动攻击') }));
    expect(result.direction?.controls).toBe('手动攻击');
    expect(result.changes).toEqual(['已调整操作方式']);
    expect(f.unexpected).not.toHaveBeenCalled();
    expect(f.runtime.unsubscribeThread).toHaveBeenCalledWith('thread');
  });
  it('rejects invalid output without automatic retries', async () => {
    const f = fixture(); f.runtime.runTurn.mockResolvedValueOnce({ status: 'completed', text: '游戏已经完成' });
    await expect(f.generator.generate(f.state, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    expect(f.runtime.runTurn).toHaveBeenCalledTimes(1);
    expect(f.runtime.unsubscribeThread).toHaveBeenCalledOnce();
  });
  it('does not call the model after cancellation', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.generator.generate(f.state, controller.signal)).rejects.toThrow();
    expect(f.runtime.startThread).not.toHaveBeenCalled();
  });
  it('unsubscribes on runtime failure without claiming successful generation', async () => {
    const f = fixture(); f.runtime.runTurn.mockRejectedValueOnce(new Error('offline timeout'));
    await expect(f.generator.generate(f.state, new AbortController().signal)).rejects.toThrow('offline timeout');
    expect(f.runtime.runTurn).toHaveBeenCalledOnce();
    expect(f.runtime.unsubscribeThread).toHaveBeenCalledOnce();
  });
});
