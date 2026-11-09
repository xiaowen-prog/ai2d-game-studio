import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { createVerifiedZip, verifyZipFiles } from './zipArchive.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zaojing zip 中文 ')); roots.push(root);
  await mkdir(join(root, 'web-game'));
  const contents = { 'web-game/场景 空格.txt': Buffer.from('真实的文件内容\n'.repeat(1000)), 'empty.txt': Buffer.alloc(0), '打开网页游戏.cmd': Buffer.from('@echo off\r\n') };
  const hashes: Record<string, string> = {};
  for (const [path, data] of Object.entries(contents)) {
    await writeFile(join(root, path), data);
    hashes[path] = createHash('sha256').update(data).digest('hex');
  }
  return { root, contents, hashes, signal: new AbortController().signal };
}
describe('cross-platform ZIP export (synthetic files only)', () => {
  it('round-trips Unicode paths, spaces, empty files and launchers without system tools', async () => {
    const { root, contents, hashes, signal } = await fixture();
    await createVerifiedZip(root, 'game.zip', hashes, signal);
    const decoded = unzipSync(await readFile(join(root, 'game.zip')));
    expect(Object.keys(decoded).sort()).toEqual(Object.keys(contents).sort());
    for (const [path, data] of Object.entries(contents)) expect(Buffer.from(decoded[path])).toEqual(data);
  });
  it('rejects missing or changed source content and removes its partial output', async () => {
    const { root, hashes, signal } = await fixture();
    await writeFile(join(root, 'empty.txt'), 'unexpected');
    await expect(createVerifiedZip(root, 'game.zip', hashes, signal)).rejects.toThrow('mismatch');
    await expect(readFile(join(root, 'game.zip'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(createVerifiedZip(root, 'game.zip', { 'absent.txt': '' }, signal)).rejects.toThrow();
    await expect(readFile(join(root, 'game.zip'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves an existing archive and rejects path traversal', async () => {
    const { root, hashes, signal } = await fixture();
    await writeFile(join(root, 'game.zip'), 'previous export');
    await expect(createVerifiedZip(root, 'game.zip', hashes, signal)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(root, 'game.zip'), 'utf8')).toBe('previous export');
    await expect(createVerifiedZip(root, '../game.zip', hashes, signal)).rejects.toThrow('Invalid archive');
    await expect(createVerifiedZip(root, 'new.zip', { '../outside.txt': '' }, signal)).rejects.toThrow();
  });
  it('rejects truncated archives and mismatched expected manifests', async () => {
    const { root, hashes, signal } = await fixture();
    await createVerifiedZip(root, 'game.zip', hashes, signal);
    await expect(verifyZipFiles(join(root, 'game.zip'), { ...hashes, 'missing.txt': '' }, signal)).rejects.toThrow('Incomplete');
    const zip = await readFile(join(root, 'game.zip'));
    await writeFile(join(root, 'game.zip'), zip.subarray(0, zip.length - 10));
    await expect(verifyZipFiles(join(root, 'game.zip'), hashes, signal)).rejects.toThrow('Incomplete');
  });
  it('stops before writing when canceled', async () => {
    const { root, hashes } = await fixture();
    await expect(createVerifiedZip(root, 'game.zip', hashes, AbortSignal.abort())).rejects.toThrow();
    await expect(readFile(join(root, 'game.zip'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
