import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetPlanStore } from './assetPlanStore.js';
import { AssetRetryQueue } from './assetRetryQueue.js';
import { boundReference, budgetHostEvidence } from './contextBudget.js';
import { stageHarnessPrompt } from './creationPrompts.js';
import { newCreation, CreationWorkflowStore } from './creationWorkflowStore.js';
import { creationMediaToolNames } from './creationToolPolicy.js';
import { checkToolPolicy, observeTool, ToolPolicyError } from './toolHooks.js';

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'zaojing-backend-'));
  roots.push(value);
  return value;
}

describe('bounded host context', () => {
  it('bounds only reference output and keeps the task and role contract intact', () => {
    const task = 'CURRENT TASK ID: approved-123\n' + '当前用户约束'.repeat(4_000);
    const reference = 'BEGIN_PLAN\n' + 'a'.repeat(100_000) + '\nEND_FINDING';
    const prompt = stageHarnessPrompt('repair', task, reference);
    expect(prompt).toContain(task);
    expect(prompt).toContain('BEGIN_PLAN');
    expect(prompt).toContain('END_FINDING');
    expect(prompt).toContain('YOUR CURRENT ROLE: repair');
    expect(prompt).toContain('Never write approval records');
    expect(prompt.length - task.length).toBeLessThan(15_000);
    expect(boundReference('small')).toBe('small');
  });
  it('preserves a failing verdict, all represented findings, and explicit omitted counts', () => {
    const findings = Array.from({ length: 60 }, (_, index) => `${index}:` + 'x'.repeat(10_000));
    const result = budgetHostEvidence({ ok: false, findings, evidence: ['source/report.json\n' + 'z'.repeat(400_000)] });
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(50);
    expect(result.findingCount).toBe(60);
    expect(result.evidence?.[0]).toContain('source/report.json');
    expect(JSON.stringify(result).length).toBeLessThan(33_000);
    expect(budgetHostEvidence({ ok: true, findings: ['unresolved'] }).ok).toBe(false);
  });
});

describe('host tool hooks', () => {
  const context = { projectId: 'p', threadId: 't', turnId: 'r', callId: 'c', tool: 'noobi_image_generate' };
  it('fails closed and redacts unexpected policy failures', async () => {
    await expect(checkToolPolicy({ before: () => { throw new Error('private-api-key'); } }, context))
      .rejects.toThrow('工具权限检查未通过');
    await expect(checkToolPolicy({ before: () => { throw new ToolPolicyError('当前步骤禁止'); } }, context))
      .rejects.toThrow('当前步骤禁止');
  });
  it('bounds a stuck pre-tool check', async () => {
    vi.useFakeTimers();
    const result = expect(checkToolPolicy({ before: () => new Promise(() => {}), timeoutMs: 20 }, context))
      .rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(20);
    await result;
  });
  it('isolates a rejected post-tool observer and sends metadata only', async () => {
    const after = vi.fn(async () => { throw new Error('observer disconnected'); });
    observeTool({ after }, context, true, Date.now());
    await vi.waitFor(() => expect(after).toHaveBeenCalledOnce());
    expect(after.mock.calls[0]).toEqual([{ ...context, success: true, durationMs: expect.any(Number) }]);
  });
  it('enforces stage permissions including resumed character-edit threads', () => {
    const workflow = newCreation('project', '测试');
    expect(creationMediaToolNames(workflow).size).toBe(0);
    workflow.currentStage = 'scene';
    expect(creationMediaToolNames(workflow).has('noobi_image_generate')).toBe(true);
    expect(creationMediaToolNames(workflow).has('noobi_audio_generate')).toBe(false);
    workflow.currentStage = 'game';
    expect(creationMediaToolNames(workflow).has('noobi_audio_synthesize')).toBe(true);
    expect(creationMediaToolNames(workflow).has('noobi_image_generate')).toBe(false);
    workflow.currentStage = 'playable';
    expect(creationMediaToolNames(workflow).size).toBe(0);
  });
});

describe('persistent task state', () => {
  it('serializes two store instances without losing revisions or existing history', async () => {
    const directory = await root();
    const first = new CreationWorkflowStore(directory);
    const second = new CreationWorkflowStore(directory);
    await first.create('p', '旧项目');
    await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).change('p', state => {
      state.idea += `|${index}`;
    })));
    const reopened = await new CreationWorkflowStore(directory).get('p');
    expect(reopened?.revision).toBe(20);
    expect(reopened?.idea.split('|')).toHaveLength(21);
    expect(reopened?.history).toEqual([]);
  });
  it('recovers queued work without auto-calling any generator', async () => {
    const path = join(await root(), 'plans.json');
    const first = new AssetPlanStore(path);
    await first.init();
    await first.upsert({ id: 'hero', projectId: 'p', name: 'Hero', kind: 'image', prompt: 'Original prompt' });
    await first.queue('p', 'hero');
    const second = new AssetPlanStore(path);
    await second.init();
    expect(await second.get('p', 'hero')).toMatchObject({
      status: 'failed', attemptCount: 0, prompt: 'Original prompt', error: { code: 'generation-interrupted' },
    });
  });
});

describe('asset retry scheduler (offline worker)', () => {
  async function fixture() {
    const directory = await root();
    const store = new AssetPlanStore(join(directory, 'plans.json'));
    await store.init();
    for (const projectId of ['p1', 'p2']) {
      await store.upsert({ id: 'hero', projectId, kind: 'image', name: 'Hero', prompt: 'Original' });
    }
    return { store, project: (id: string) => ({ id, root: directory }) };
  }
  it('deduplicates clicks, serializes projects, and survives broken UI observers', async () => {
    const { store, project } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = vi.fn(async (p: { id: string }, planId: string) => {
      await store.begin(p.id, planId);
      if (p.id === 'p1') await gate;
      await store.waitForAgent(p.id, planId, 'codex-imagegen');
    });
    const queue = new AssetRetryQueue({ store, run, onChanged: () => { throw new Error('UI closed'); } });
    const first = queue.enqueue(project('p1'), 'hero');
    await expect(queue.enqueue(project('p1'), 'hero')).rejects.toThrow('已有');
    expect((await first).status).toBe('queued');
    await queue.enqueue(project('p2'), 'hero');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(queue.hasProject('p2')).toBe(true);
    release();
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(queue.hasProject('p1')).toBe(false);
    expect((await store.get('p1', 'hero')).attemptCount).toBe(1);
  });
  it('keeps the writer reservation after cancellation until it settles, with no automatic retry', async () => {
    const { store, project } = await fixture();
    let release!: () => void;
    let signal!: AbortSignal;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = vi.fn(async (_p, _id, input: AbortSignal) => { signal = input; await gate; input.throwIfAborted(); });
    const queue = new AssetRetryQueue({ store, run, timeoutMs: 20 });
    await queue.enqueue(project('p1'), 'hero');
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(queue.hasProject('p1')).toBe(true);
    release();
    await queue.idle();
    expect(queue.hasProject('p1')).toBe(false);
    expect(run).toHaveBeenCalledOnce();
    expect(await store.get('p1', 'hero')).toMatchObject({ status: 'failed', error: { code: 'generation-interrupted' } });
  });
  it('does not leave a queued job behind when the worker exits without generating', async () => {
    const { store, project } = await fixture();
    const run = vi.fn(async () => {});
    const queue = new AssetRetryQueue({ store, run });
    await queue.enqueue(project('p1'), 'hero');
    await queue.idle();
    expect((await store.get('p1', 'hero')).status).toBe('failed');
    expect(run).toHaveBeenCalledOnce();
    await queue.close();
    await expect(queue.enqueue(project('p2'), 'hero')).rejects.toThrow('退出');
  });
});
