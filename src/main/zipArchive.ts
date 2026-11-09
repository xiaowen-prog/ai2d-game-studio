import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Unzip, UnzipInflate, Zip, ZipDeflate } from 'fflate';
import { safeCreationFile } from './creationVersionStore.js';

/** Stream bounded chunks; filenames are data, never shell commands. */
export async function createVerifiedZip(root: string, archive: string, files: Record<string, string>, signal: AbortSignal): Promise<void> {
  if (!/^[a-zA-Z0-9._-]+\.zip$/u.test(archive) || archive in files) throw new Error('Invalid archive name');
  signal.throwIfAborted();
  const destination = join(root, archive);
  const output = await open(destination, 'wx');
  let chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  async function flush() {
    for (const chunk of chunks) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        signal.throwIfAborted();
        const { bytesWritten } = await output.write(chunk, offset, chunk.byteLength - offset);
        if (!bytesWritten) throw new Error('Unable to write ZIP');
        offset += bytesWritten;
      }
    }
    chunks = [];
  }
  try {
    for (const path of Object.keys(files)) {
      signal.throwIfAborted();
      const source = await safeCreationFile(root, path);
      const entry = new ZipDeflate(path, { level: 6 });
      entry.os = 3;
      entry.attrs = (path.endsWith('.command') ? 0o100755 : 0o100644) << 16;
      zip.add(entry);
      for await (const chunk of createReadStream(source, { highWaterMark: 64 * 1024, signal })) {
        entry.push(chunk as Buffer);
        await flush();
      }
      entry.push(new Uint8Array(), true);
      await flush();
    }
    zip.end();
    await flush();
    await output.close();
    await verifyZipFiles(destination, files, signal);
  } catch (error) {
    zip.terminate();
    await output.close().catch(() => undefined);
    await rm(destination, { force: true });
    throw error;
  }
}

/** Read back decompressed content and compare every SHA-256 without extracting. */
export async function verifyZipFiles(archive: string, files: Record<string, string>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  // A stream decoder alone may accept a truncated central directory.
  const input = await open(archive, 'r');
  try {
    const { size } = await input.stat();
    const tail = Buffer.alloc(Math.min(size, 65557));
    await input.read(tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    }
    if (end < 0) throw new Error('Incomplete ZIP directory');
    const centralEnd = tail.readUInt32LE(end + 16) + tail.readUInt32LE(end + 12);
    if (centralEnd !== size - tail.length + end) throw new Error('Invalid ZIP directory');
  } finally { await input.close(); }
  const seen = new Set<string>(), complete = new Set<string>();
  const unzip = new Unzip(entry => {
    const directory = entry.name.endsWith('/') && Object.keys(files).some(path => path.startsWith(entry.name));
    if ((!directory && !Object.hasOwn(files, entry.name)) || seen.has(entry.name)) throw new Error(`Unexpected ZIP entry: ${entry.name}`);
    seen.add(entry.name);
    const hash = createHash('sha256');
    entry.ondata = (error, chunk, final) => {
      if (error) throw error;
      signal.throwIfAborted();
      if (directory) {
        if (chunk.length) throw new Error('Invalid ZIP directory content');
        return;
      }
      hash.update(chunk);
      if (final) {
        if (hash.digest('hex') !== files[entry.name]) throw new Error(`ZIP content mismatch: ${entry.name}`);
        complete.add(entry.name);
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of createReadStream(archive, { highWaterMark: 64 * 1024, signal })) unzip.push(chunk as Buffer);
  unzip.push(new Uint8Array(), true);
  signal.throwIfAborted();
  if (complete.size !== Object.keys(files).length) throw new Error('Incomplete ZIP');
}
