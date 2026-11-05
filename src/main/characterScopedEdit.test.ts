import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { composeScopedCharacterEdit, finalizeScopedCharacterEdit, previewScopedCharacterEdit } from './characterScopedEdit.js';
import { encodePngRgba } from './projectIcon.js';
import { creationHash } from './creationVersionStore.js';
import { newCreation } from './creationWorkflowStore.js';
import { directionArtifact } from './creationArtifact.js';
const { PNG } = createRequire(import.meta.url)('pngjs');
const clothes = [[[100, 500], [900, 500], [900, 900], [100, 900]]];
const protectedHand = [[[100, 500], [300, 500], [300, 900], [100, 900]]];
function png(color: number[], width = 10, height = 10) {
  return encodePngRgba(width, height, new Uint8Array(Array.from({ length: width * height }, () => color).flat()));
}
describe('scoped character editing', () => {
  it('keeps every outside pixel including hair and protected overlapping hands even when the model changes the whole image', () => {
    const original = png([20, 70, 20, 255]), proposal = png([245, 245, 245, 255]);
    const result = composeScopedCharacterEdit(original, proposal, clothes, protectedHand);
    const decoded = PNG.sync.read(result.png);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const i = (y * 10 + x) * 4;
      expect([...decoded.data.subarray(i, i + 4)]).toEqual(x >= 3 && x < 9 && y >= 5 && y < 9 ? [245, 245, 245, 255] : [20, 70, 20, 255]);
    }
    expect(result.changedOutsideRegion).toBe(0); expect(result.changedPixels).toBe(24);
  });
  it('rejects changed framing instead of resizing or moving the original hair', () => {
    expect(() => composeScopedCharacterEdit(png([1, 2, 3, 255]), png([4, 5, 6, 255], 11), clothes, [])).toThrow('图片尺寸');
  });
  it.each([[], [[[0, 0], [1000, 0], [1000, 1000], [0, 1000]]], [[[0, 0], [NaN, 0], [300, 300]]]])('rejects empty, whole-image or invalid edit regions %j', regions => {
    expect(() => composeScopedCharacterEdit(png([1, 2, 3, 255]), png([4, 5, 6, 255]), regions, [])).toThrow('修改范围无效');
  });
  it('does not accept an unchanged local result', () => {
    expect(() => composeScopedCharacterEdit(png([1, 2, 3, 255]), png([1, 2, 3, 255]), clothes, [])).toThrow('没有实际变化');
  });
  it('selects thin fabric by its original color without changing a belt, skin or matching protected hair ribbon', () => {
    const source = PNG.sync.read(png([30, 30, 30, 255]));
    const set = (x: number, y: number, rgba: number[]) => source.data.set(rgba, (y * 10 + x) * 4);
    for (let y = 5; y < 9; y++) for (let x = 1; x < 9; x++) set(x, y, [50, 100, 70, 255]);
    set(5, 6, [28, 22, 20, 255]); // Belt inside the broad garment boundary.
    set(6, 6, [52, 96, 68, 255]); // A single fabric pixel between accessories.
    set(7, 6, [230, 160, 120, 255]); // Skin, also inside the envelope.
    set(4, 7, [120, 150, 132, 255]); // Highlight and shadow keep the material hue.
    set(5, 7, [10, 25, 16, 255]);
    const result = composeScopedCharacterEdit(PNG.sync.write(source), png([245, 245, 245, 255]), clothes, protectedHand, [[450, 650]]);
    const data = PNG.sync.read(result.png).data;
    for (const [x, y] of [[6, 6], [4, 7], [5, 7]]) expect([...data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)]).toEqual([245, 245, 245, 255]);
    for (const [x, y] of [[5, 6], [7, 6], [2, 6], [4, 2]]) expect(data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)).toEqual(source.data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4));
  });
  it('rejects color samples outside the editable material or in transparent pixels', () => {
    expect(() => composeScopedCharacterEdit(png([1, 100, 3, 255]), png([245, 245, 245, 255]), clothes, protectedHand, [[200, 600]])).toThrow('修改范围无效');
    expect(() => composeScopedCharacterEdit(png([1, 100, 3, 0]), png([245, 245, 245, 255]), clothes, [], [[400, 600]])).toThrow('修改范围无效');
  });
  it('supports neutral fabric colors without selecting differently colored skin', () => {
    const source = PNG.sync.read(png([125, 125, 125, 255]));
    source.data.set([180, 110, 80, 255], (6 * 10 + 5) * 4);
    const result = composeScopedCharacterEdit(PNG.sync.write(source), png([210, 20, 20, 255]), clothes, [], [[400, 600]]);
    const data = PNG.sync.read(result.png).data;
    expect([...data.subarray(260, 264)]).toEqual([180, 110, 80, 255]);
    expect([...data.subarray(256, 260)]).toEqual([210, 20, 20, 255]);
  });
  it('applies an exact pixel mask only within the allowed polygons and rejects ambiguous masks', () => {
    const original = png([20, 70, 20, 255]), proposal = png([245, 245, 245, 255]);
    const mask = PNG.sync.read(png([0, 0, 0, 255]));
    for (const pixel of [20, 61, 64]) mask.data.set([255, 255, 255, 255], pixel * 4);
    const result = composeScopedCharacterEdit(original, proposal, clothes, protectedHand, undefined, PNG.sync.write(mask));
    expect(result.changedPixels).toBe(1); // Outside polygon and protected pixel cannot be unmasked.
    const data = PNG.sync.read(result.png).data;
    expect([...data.subarray(256, 260)]).toEqual([245, 245, 245, 255]);
    expect(() => composeScopedCharacterEdit(original, proposal, clothes, [], undefined, png([128, 128, 128, 255]))).toThrow('修改范围无效');
    expect(() => composeScopedCharacterEdit(original, proposal, clothes, [], undefined, png([255, 255, 255, 255], 11))).toThrow('修改范围无效');
    expect(() => composeScopedCharacterEdit(original, proposal, clothes, [], [[400, 600]], PNG.sync.write(mask))).toThrow('修改范围无效');
  });
  it('validates generation provenance and source integrity, records a derived asset, and reviews the final asset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scoped-character-'));
    try {
      await mkdir(join(root, 'public/assets/images'), { recursive: true }); await mkdir(join(root, '.noobi'));
      const source = 'public/assets/images/source.png', raw = 'public/assets/images/proposal.png', other = 'public/assets/images/other.png';
      const original = png([20, 70, 20, 255]);
      await writeFile(join(root, source), original); await writeFile(join(root, raw), png([245, 245, 245, 255])); await writeFile(join(root, other), png([150, 20, 20, 255]));
      const workflow = newCreation('project', 'white clothes'); workflow.currentStage = 'character';
      workflow.task = { id: 'current-task', operationId: 'op', stage: 'character', prompt: 'white clothes', state: 'running', startedAt: '', baseVersionId: null, error: null };
      const base = directionArtifact({ title: 'Test', genre: 'topdown', theme: '武侠', controls: 'move', goal: 'test', style: 'pixel', scope: ['one'] });
      workflow.steps.character.artifact = { ...base, stage: 'character', direction: undefined, selectedCharacterId: 'a',
        candidates: [{ id: 'a', name: 'A', image: source }, { id: 'b', name: 'B', image: other }],
        lockedAssets: { [source]: await creationHash(root, source), [other]: await creationHash(root, other) } };
      await writeFile(join(root, '.noobi/stage-result.json'), JSON.stringify({ title: 'New', summary: 'white', changes: ['clothes'], ready: false, selectedCharacterId: 'a',
        candidates: [{ id: 'a', name: 'A', image: raw }, { id: 'b', name: 'B', image: other }], media: [], lockedAssets: [] }));
      await writeFile(join(root, '.noobi/character-edit-region.json'), JSON.stringify({ sourceImage: source, generatedImage: raw, editPolygons: clothes, preservePolygons: protectedHand }));
      const record = vi.fn(async () => {});
      await expect(finalizeScopedCharacterEdit(root, workflow, async () => false, record)).rejects.toMatchObject({ code: 'UNPROVEN_IMAGE' });
      expect(record).not.toHaveBeenCalled();
      await writeFile(join(root, source), png([7, 8, 9, 255]));
      await expect(finalizeScopedCharacterEdit(root, workflow, async () => true, record)).rejects.toMatchObject({ code: 'APPROVED_ASSET_CHANGED' });
      await writeFile(join(root, source), original);
      const beforePreview = await readFile(join(root, '.noobi/stage-result.json'));
      const preview = await previewScopedCharacterEdit(root, workflow, async () => true);
      expect(await readFile(join(root, '.noobi/stage-result.json'))).toEqual(beforePreview);
      await expect(readFile(join(root, '.noobi/character-edit-proof.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(root, preview.preview))).not.toHaveLength(0);
      expect(record).not.toHaveBeenCalled();
      await finalizeScopedCharacterEdit(root, workflow, async () => true, record);
      const manifest = JSON.parse(await readFile(join(root, '.noobi/stage-result.json'), 'utf8'));
      const proof = JSON.parse(await readFile(join(root, '.noobi/character-edit-proof.json'), 'utf8'));
      expect(proof.taskId).toBe('current-task'); expect(proof.changedOutsideRegion).toBe(0);
      expect(manifest.candidates[0].image).toBe(proof.outputImage); expect(record).toHaveBeenCalledWith(proof.outputImage, await creationHash(root, proof.outputImage));
      expect(manifest.candidates[1].image).toBe(other); expect(await readFile(join(root, source))).toEqual(original);
      expect(await creationHash(root, other)).toBe(workflow.steps.character.artifact.lockedAssets[other]);
      expect(await readFile(join(root, proof.inspectionPreview))).not.toHaveLength(0);
      expect(await readFile(join(root, proof.maskPreview))).not.toHaveLength(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
