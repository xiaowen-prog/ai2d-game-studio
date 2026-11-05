import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveCurrentReviewEvidence, captureGodotChecks, currentEngineEvidence } from './hostReviewEvidence.js';
import { synchronizeCreationContext } from './creationContext.js';
import { newCreation } from './creationWorkflowStore.js';
import type { GodotEnvironmentService } from './godotEnvironmentService.js';
const roots: string[] = [];
async function setup() { const root = await mkdtemp(join(tmpdir(), 'host-review-')); roots.push(root); await writeFile(join(root, 'main.gd'), 'const SPEED = 240'); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const execute: GodotEnvironmentService['execute'] = async request => ({ task: request.kind, ok: true, stdout: 'native checked', stderr: '', exitCode: 0, timedOut: false, artifacts: [] } as never);

describe('current host evidence', () => {
  it('captures native results and rejects them after a source change', async () => {
    const root = await setup();
    await captureGodotChecks(root, execute, run => run({ kind: 'validate', projectPath: root }));
    expect(JSON.parse(await currentEngineEvidence(root))).toMatchObject({ ok: true, tasks: [{ task: 'validate', ok: true }] });
    await writeFile(join(root, 'main.gd'), 'const SPEED = 300');
    await expect(currentEngineEvidence(root)).rejects.toThrow('stale');
  });
  it('keeps real failures and raw diagnostics instead of promoting a failed command', async () => {
    const root = await setup();
    await expect(captureGodotChecks(root, async request => ({ ...await execute(request), ok: false, stderr: 'ERROR: Parse Error', exitCode: 1 }), async run => {
      const result = await run({ kind: 'validate', projectPath: root }); if (!result.ok) throw new Error('Native failed');
    })).rejects.toThrow('Native failed');
    const report = JSON.parse(await readFile(join(root, 'artifacts/engine/latest.json'), 'utf8'));
    expect(report).toMatchObject({ ok: false, error: 'Native failed', results: [{ ok: false, stderr: 'ERROR: Parse Error' }] });
  });
  it('archives old engine and playtest evidence without losing it', async () => {
    const root = await setup(); await captureGodotChecks(root, execute, run => run({ kind: 'validate', projectPath: root }));
    await mkdir(join(root, 'artifacts/playtest/latest'), { recursive: true });
    await writeFile(join(root, 'artifacts/playtest/latest/report.json'), '{"verdict":"repair"}');
    await archiveCurrentReviewEvidence(root);
    await expect(readFile(join(root, 'artifacts/engine/latest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'artifacts/playtest/latest/report.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(join(root, 'artifacts/engine'))).filter(name => name.startsWith('history-'))).toHaveLength(1);
    expect(await readdir(join(root, 'artifacts/playtest/history'))).toHaveLength(1);
  });
  it('fails closed when game inputs change during a native check', async () => {
    const root = await setup();
    await expect(captureGodotChecks(root, execute, async run => { await run({ kind: 'import', projectPath: root }); await writeFile(join(root, 'main.gd'), 'changed'); })).rejects.toThrow('inputs changed');
    expect(JSON.parse(await readFile(join(root, 'artifacts/engine/latest.json'), 'utf8')).ok).toBe(false);
  });
});

describe('snapshot project decisions', () => {
  it('keeps previous design/custom instructions while replacing only the active task', async () => {
    const root = await setup();
    await writeFile(join(root, 'AGENTS.md'), '# User rule\nPreserve palette.');
    await writeFile(join(root, 'GAME_DESIGN.md'), '# Implementation\nReuse two blink frames; speed 240.');
    const workflow = newCreation('project', 'test'); workflow.currentStage = 'character';
    workflow.task = { id: 'task-old', prompt: 'old edit' } as never;
    await synchronizeCreationContext(root, workflow);
    workflow.task = { id: 'task-new', prompt: 'new edit' } as never;
    await synchronizeCreationContext(root, workflow);
    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8'); const design = await readFile(join(root, 'GAME_DESIGN.md'), 'utf8');
    expect(agents).toContain('Preserve palette.'); expect(design).toContain('Reuse two blink frames; speed 240.');
    expect(agents).toContain('task-new'); expect(agents).not.toContain('task-old'); expect(design).not.toContain('task-old');
    expect(agents.match(/NOOBI_CREATION_CONTEXT_START/g)).toHaveLength(1);
  });
});
