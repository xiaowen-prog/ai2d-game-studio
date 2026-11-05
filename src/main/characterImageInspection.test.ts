import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePngRgba } from './projectIcon.js';
import { alphaInspectionPng, characterInspectionPreview } from './characterImageInspection.js';
const { PNG } = createRequire(import.meta.url)('pngjs');

describe('alpha-correct character inspection', () => {
  it('does not mistake hidden colors in transparent pixels for a visible halo', () => {
    const input = encodePngRgba(3, 1, new Uint8Array([200, 150, 90, 0, 20, 40, 60, 255, 100, 120, 140, 128]));
    const decoded = PNG.sync.read(alphaInspectionPng(input));
    expect([...decoded.data.slice(0, 4)]).toEqual([245, 245, 245, 255]);
    expect([...decoded.data.slice(4, 8)]).toEqual([20, 40, 60, 255]);
    expect([...decoded.data.slice(8, 12)]).toEqual([172, 182, 192, 255]);
  });
  it('writes an inspection copy without changing the source image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'character-alpha-'));
    try {
      await mkdir(join(root, 'public/assets/images'), { recursive: true });
      const input = encodePngRgba(1, 1, new Uint8Array([190, 120, 100, 0]));
      const path = 'public/assets/images/hero.png'; await writeFile(join(root, path), input);
      const result = await characterInspectionPreview(root, path);
      expect(await readFile(join(root, path))).toEqual(input);
      expect(PNG.sync.read(await readFile(join(root, result!.inspectionPreview))).data[3]).toBe(255);
      await characterInspectionPreview(root, path);
      expect(await readFile(join(root, path))).toEqual(input);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('rejects a linked inspection directory instead of writing outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'character-alpha-'));
    try {
      await mkdir(join(root, 'public/assets/images'), { recursive: true });
      await writeFile(join(root, 'public/assets/images/hero.png'), encodePngRgba(1, 1, new Uint8Array([1, 2, 3, 255])));
      await symlink(tmpdir(), join(root, '.noobi'));
      await expect(characterInspectionPreview(root, 'public/assets/images/hero.png')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
