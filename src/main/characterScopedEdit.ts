import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreationWorkflow } from '../shared/creation.js';
import { CreationError } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile } from './creationVersionStore.js';
import { parseCreationJson, readCreationArtifact } from './creationArtifact.js';
import { alphaInspectionPng, characterInspectionPreview } from './characterImageInspection.js';

interface Png { width: number; height: number; data: Buffer }
const { PNG } = createRequire(import.meta.url)('pngjs') as { PNG: { sync: { read(bytes: Buffer): Png; write(png: Png): Buffer } } };
type Point = [number, number];
type Polygon = Point[];
const invalid = () => new CreationError('INVALID_EDIT_REGION', '人物修改范围无效，已保留原图。请明确只修改哪个部分。');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function polygons(value: unknown, allowEmpty: boolean): Polygon[] {
  if (!Array.isArray(value) || value.length > 12 || (!allowEmpty && value.length === 0)) throw invalid();
  return value.map(polygon => {
    if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 96) throw invalid();
    return polygon.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000)) throw invalid();
      return point as Point;
    });
  });
}

function decode(bytes: Buffer): Png {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' || bytes.length > 32 * 1024 * 1024
    || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000) throw new CreationError('INVALID_IMAGE', '局部修改需要有效的 PNG 人物原图。');
  try { return PNG.sync.read(bytes); } catch { throw new CreationError('INVALID_IMAGE', '人物图片无法读取，已保留原图。'); }
}

/** Scanline rasterization avoids work proportional to every pixel times every polygon edge. */
function paint(mask: Uint8Array, width: number, height: number, areas: Polygon[], value: number) {
  for (const area of areas) {
    const points = area.map(([x, y]) => [x * width / 1000, y * height / 1000]);
    for (let y = 0; y < height; y++) {
      const scan = y + 0.5; const crossings: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan)) crossings.push(a[0] + (scan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const start = Math.max(0, Math.ceil(crossings[i] - 0.5));
        const end = Math.min(width, Math.ceil(crossings[i + 1] - 0.5));
        if (end > start) mask.fill(value, y * width + start, y * width + end);
      }
    }
  }
}

function hsv(data: Buffer, offset: number) {
  const r = data[offset] / 255, g = data[offset + 1] / 255, b = data[offset + 2] / 255;
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), delta = hi - lo;
  const hue = !delta ? 0 : hi === r ? ((g - b) / delta + 6) % 6 : hi === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: hue * 60, saturation: hi ? delta / hi : 0 };
}

/** For recolors, sample the original material's colors inside a generous spatial boundary.
 * This keeps dark outlines/belts while including thin colored fabric between accessories.
 * Samples select pixels only; every replacement pixel still comes from the genuine AI edit. */
function selectMaterialColors(source: Png, mask: Uint8Array, value: unknown) {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length || value.length > 12) throw invalid();
  const samples = value.map(point => {
    if (!Array.isArray(point) || point.length !== 2 || point.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 1000)) throw invalid();
    const pixel = Math.floor(point[1] * source.height / 1000) * source.width + Math.floor(point[0] * source.width / 1000);
    if (!mask[pixel] || source.data[pixel * 4 + 3] < 200) throw invalid();
    return { offset: pixel * 4, ...hsv(source.data, pixel * 4) };
  });
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue;
    const i = pixel * 4, color = hsv(source.data, i);
    const matches = source.data[i + 3] > 0 && samples.some(sample => {
      if (sample.saturation < 0.10) return Math.max(...[0, 1, 2].map(c => Math.abs(source.data[i + c] - source.data[sample.offset + c]))) <= 24;
      const difference = Math.abs(sample.hue - color.hue);
      return color.saturation >= 0.06 && Math.min(difference, 360 - difference) <= 24;
    });
    if (!matches) mask[pixel] = 0;
  }
}

/** The generated proposal supplies only the requested region. All other RGBA bytes come from the original. */
export function composeScopedCharacterEdit(original: Buffer, proposal: Buffer, regions: unknown, protectedRegions: unknown, colorSamples?: unknown, pixelMask?: Buffer) {
  const source = decode(original), generated = decode(proposal);
  if (source.width !== generated.width || source.height !== generated.height) throw new CreationError('EDIT_SIZE_CHANGED', '修改改变了图片尺寸，无法安全保留发型等细节，已保留原图。');
  const mask = new Uint8Array(source.width * source.height);
  paint(mask, source.width, source.height, polygons(regions, false), 1);
  paint(mask, source.width, source.height, polygons(protectedRegions, true), 0);
  if (pixelMask) {
    if (colorSamples !== undefined) throw invalid();
    const exact = decode(pixelMask);
    if (exact.width !== source.width || exact.height !== source.height) throw invalid();
    for (let pixel = 0; pixel < mask.length; pixel++) {
      const i = pixel * 4, value = exact.data[i];
      if ((value !== 0 && value !== 255) || exact.data[i + 1] !== value || exact.data[i + 2] !== value || exact.data[i + 3] !== 255) throw invalid();
      if (!value) mask[pixel] = 0;
    }
  }
  selectMaterialColors(source, mask, colorSamples);
  const editablePixels = mask.reduce((sum, v) => sum + v, 0);
  if (!editablePixels || editablePixels > mask.length * 0.8) throw invalid();
  const output = { ...source, data: Buffer.from(source.data) };
  const overlay = { ...source, data: Buffer.from(source.data) };
  let changedPixels = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue;
    const i = pixel * 4;
    if ((source.data[i + 3] || generated.data[i + 3]) && !source.data.subarray(i, i + 4).equals(generated.data.subarray(i, i + 4))) changedPixels++;
    generated.data.copy(output.data, i, i, i + 4);
    overlay.data[i] = Math.round(overlay.data[i] * 0.45 + 255 * 0.55);
    overlay.data[i + 1] = Math.round(overlay.data[i + 1] * 0.45);
    overlay.data[i + 2] = Math.round(overlay.data[i + 2] * 0.45 + 200 * 0.55);
    overlay.data[i + 3] = Math.max(overlay.data[i + 3], 140);
  }
  if (!changedPixels) throw new CreationError('UNCHANGED_IMAGE', '指定修改范围内没有实际变化，已保留原图。');
  return { png: PNG.sync.write(output), maskPreview: alphaInspectionPng(PNG.sync.write(overlay)),
    width: source.width, height: source.height, editablePixels, protectedPixels: mask.length - editablePixels,
    changedPixels, changedOutsideRegion: 0 };
}

async function prepareScopedEdit(root: string, workflow: CreationWorkflow, hasProof: (path: string, hash: string) => Promise<boolean>) {
  const prior = workflow.steps.character.artifact;
  const selected = prior?.candidates.find(c => c.id === prior.selectedCharacterId);
  if (!selected) return;
  // Validate genuine generated input and protection of the other candidate before compositing.
  const proposal = await readCreationArtifact(root, workflow, hasProof, true);
  const generated = proposal.candidates.find(c => c.id === selected.id)!;
  if (generated.image === selected.image || prior!.lockedAssets[generated.image]) throw new CreationError('INVALID_EDIT_SOURCE', '局部修改必须使用新生成的图片，不能覆盖原图。');
  if (await creationHash(root, selected.image) !== prior!.lockedAssets[selected.image]) throw new CreationError('APPROVED_ASSET_CHANGED', '人物原图被改动，不能继续局部修改，已保留历史版本。');
  let region: Record<string, unknown>;
  try { region = parseCreationJson(await readFile(await safeCreationFile(root, '.noobi/character-edit-region.json'), 'utf8')); }
  catch { throw invalid(); }
  if (region.sourceImage !== selected.image || region.generatedImage !== generated.image) throw invalid();
  const original = await readFile(await safeCreationFile(root, selected.image));
  const raw = await readFile(await safeCreationFile(root, generated.image));
  if (region.maskImage !== undefined && (typeof region.maskImage !== 'string' || !/^\.noobi\/[a-zA-Z0-9_-]+\.png$/u.test(region.maskImage))) throw invalid();
  const exactMask = typeof region.maskImage === 'string' ? await readFile(await safeCreationFile(root, region.maskImage)) : undefined;
  const composed = composeScopedCharacterEdit(original, raw, region.editPolygons, region.preservePolygons, region.colorSamples, exactMask);
  return { selected, generated, original, raw, region, composed };
}

/** Non-committing preview: no manifest mutation, version save, or generation attestation. */
export async function previewScopedCharacterEdit(root: string, workflow: CreationWorkflow, hasProof: (path: string, hash: string) => Promise<boolean>) {
  const input = await prepareScopedEdit(root, workflow, hasProof);
  if (!input) throw invalid();
  const { composed } = input;
  // readCreationArtifact above creates the inspection directory and validates its paths.
  const id = randomUUID();
  const preview = `.noobi/inspection/edit-preview-${id}.png`, maskPreview = `.noobi/inspection/edit-area-${id}.png`;
  await characterInspectionPreview(root, input.generated.image);
  await writeFile(join(root, preview), alphaInspectionPng(composed.png), { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, maskPreview), composed.maskPreview, { flag: 'wx', mode: 0o600 });
  return { preview, maskPreview, changedPixels: composed.changedPixels, changedOutsideRegion: 0,
    note: 'Only a preview. Inspect both files and refine the region/mask if necessary; do not regenerate or modify the source/generated image.' };
}

export async function finalizeScopedCharacterEdit(root: string, workflow: CreationWorkflow,
  hasProof: (path: string, hash: string) => Promise<boolean>, recordProof: (path: string, hash: string) => Promise<void>) {
  const input = await prepareScopedEdit(root, workflow, hasProof);
  if (!input) return;
  const { selected, generated, original, raw, region, composed } = input;
  const outputImage = `public/assets/images/scoped-${randomUUID()}.png`;
  await writeFile(join(root, outputImage), composed.png, { flag: 'wx', mode: 0o600 });
  const sha256 = hash(composed.png);
  await recordProof(outputImage, sha256);
  const manifest = parseCreationJson(await readFile(await safeCreationFile(root, '.noobi/stage-result.json'), 'utf8'));
  const candidates = manifest.candidates as Array<Record<string, unknown>>;
  candidates.find(c => c.id === selected.id)!.image = outputImage;
  manifest.lockedAssets = (manifest.lockedAssets as string[]).map(path => path === generated.image ? outputImage : path);
  await writeFile(join(root, '.noobi/stage-result.json'), JSON.stringify(manifest, null, 2));
  const preview = await characterInspectionPreview(root, outputImage);
  await writeFile(join(root, '.noobi/inspection/character-edit-mask.png'), composed.maskPreview, { flag: 'wx', mode: 0o600 });
  const proof = { taskId: workflow.task!.id, sourceImage: selected.image, sourceSha256: hash(original),
    generatedImage: generated.image, generatedSha256: hash(raw), outputImage, outputSha256: sha256,
    inspectionPreview: preview!.inspectionPreview, maskPreview: '.noobi/inspection/character-edit-mask.png',
    selectionMode: region.maskImage ? 'pixel-mask' : region.colorSamples === undefined ? 'polygon' : 'material-color',
    width: composed.width, height: composed.height, editablePixels: composed.editablePixels,
    protectedPixels: composed.protectedPixels, changedPixels: composed.changedPixels, changedOutsideRegion: composed.changedOutsideRegion };
  await writeFile(join(root, '.noobi/character-edit-proof.json'), JSON.stringify(proof, null, 2), { flag: 'wx', mode: 0o600 });
}
