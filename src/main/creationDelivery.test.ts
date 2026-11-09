import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import type { CreationArtifact } from '../shared/creation.js';
import { creationId, newCreation } from './creationWorkflowStore.js';
import { CreationVersionStore } from './creationVersionStore.js';
import { exportCreationDelivery, verifyCreationDelivery } from './creationDelivery.js';

it('exports only synthetic confirmed files with both platform launchers and verifies the saved package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zaojing-delivery-fixture-'));
  try {
    const source = join(root, 'synthetic-game');
    await mkdir(join(source, 'build/web'), { recursive: true });
    const fakeFiles = { 'project.godot': '[application]\nconfig/name="fixture"\n',
      'build/web/index.html': '<html>fixture, not a playable game</html>', 'build/web/index.js': '// synthetic fixture',
      'build/web/index.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), 'build/web/index.pck': 'GDPCfixture' };
    for (const [path, contents] of Object.entries(fakeFiles)) await writeFile(join(source, path), contents);
    const versions = new CreationVersionStore(join(root, 'versions'));
    const snapshotId = await versions.save('fixture', source);
    const workflow = newCreation('fixture', 'synthetic fixture');
    for (const stage of ['direction', 'character', 'scene', 'playable', 'game'] as const) {
      const artifact: CreationArtifact = { id: creationId(), stage, title: '测试夹具', summary: '合成文件，不是实际游戏',
        changes: [], createdAt: new Date().toISOString(), candidates: [], selectedCharacterId: null,
        media: [], ready: true, snapshotId, checks: [], lockedAssets: {},
        ...(stage === 'game' ? { round: { manifest: '.noobi/platformer-round.json' as const, genre: 'platformer' as const, timeLimitSeconds: 90, maxJumps: 1 as const } } : {}) };
      workflow.steps[stage] = { ...workflow.steps[stage], artifact, status: 'confirmed', confirmedVersionId: artifact.id };
    }
    workflow.currentStage = 'delivery'; workflow.workingSnapshotId = snapshotId;
    workflow.task = { id: creationId(), operationId: creationId(), stage: 'delivery', prompt: '',
      startedAt: new Date().toISOString(), state: 'running', baseVersionId: null, error: null };
    const result = await exportCreationDelivery(workflow, source, versions, new AbortController().signal);
    const directory = await verifyCreationDelivery('fixture', source, result);
    const zip = unzipSync(await readFile(join(directory, 'game-package.zip')));
    const cmd = Buffer.from(zip['打开网页游戏.cmd']).toString();
    expect(cmd).toContain('pushd "%~dp0"');
    expect(cmd).toContain('py -3 serve-game.py\r\n');
    expect(cmd).toContain('python serve-game.py\r\n');
    expect(zip['打开网页游戏.command']).toBeDefined();
    expect(Buffer.from(zip['打开说明.md']).toString()).toContain('Windows');
    expect(await readFile(join(source, 'project.godot'), 'utf8')).toBe(fakeFiles['project.godot']);
    await writeFile(join(directory, 'web-game/index.html'), 'tampered');
    await expect(verifyCreationDelivery('fixture', source, result)).rejects.toThrow('已修改');
  } finally { await rm(root, { recursive: true, force: true }); }
});
