import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { safeCreationFile } from './creationVersionStore.js';
import { CreationError } from './creationWorkflowStore.js';

interface Png { width: number; height: number; data: Buffer }
const { PNG } = createRequire(import.meta.url)('pngjs') as {
  PNG: { sync: { read(bytes: Buffer): Png; write(png: Png): Buffer } };
};

/** Inspection rendering only. The original asset and its generation proof are untouched. */
export function alphaInspectionPng(bytes: Buffer): Buffer {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000) {
    throw new CreationError('INVALID_IMAGE', '人物图片格式或尺寸无法检查。');
  }
  const png = PNG.sync.read(bytes);
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    const a = png.data[i + 3] / 255;
    const background = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 ? 210 : 245;
    for (let c = 0; c < 3; c++) png.data[i + c] = Math.round(png.data[i + c] * a + background * (1 - a));
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

export async function characterInspectionPreview(root: string, image: string): Promise<{ inspectionPreview: string } | null> {
  if (!/^public\/assets\/images\/[^/]+\.png$/iu.test(image)) return null;
  const source = await safeCreationFile(root, image);
  for (const relative of ['.noobi', '.noobi/inspection']) {
    const directory = join(root, relative);
    await mkdir(directory, { recursive: false }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new CreationError('INVALID_PATH', '图片检查目录无效。');
  }
  const inspectionPreview = `.noobi/inspection/${basename(image)}.inspection.png`;
  const preview = alphaInspectionPng(await readFile(source));
  const file = await open(join(root, inspectionPreview), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(preview); } finally { await file.close(); }
  return { inspectionPreview };
}
