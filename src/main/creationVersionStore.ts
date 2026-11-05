import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, copyFile, writeFile, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { CreationError, assertCreationId, creationId } from './creationWorkflowStore.js';

const SKIP = new Set(['node_modules', '.git', '.godot', '.cache', '.creation', 'exports', '.DS_Store']);
const MAX_FILES = 10_000;
const MAX_BYTES = 512 * 1024 * 1024;
interface VersionManifest { schemaVersion: 1; projectId: string; id: string; files: Record<string, string> }

export async function safeCreationFile(root: string, file: string): Promise<string> {
  if (typeof file !== 'string' || !file || file.length > 512 || isAbsolute(file)
    || file.includes('\\') || file.split('/').some((part) => !part || part === '..' || part === '.')) {
    throw new CreationError('INVALID_PATH', '成果文件位置无效。');
  }
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const part of file.split('/')) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new CreationError('INVALID_PATH', '成果不能引用工程外的文件。');
  }
  const resolved = await realpath(current);
  const rel = relative(canonicalRoot, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !(await lstat(resolved)).isFile()) {
    throw new CreationError('INVALID_PATH', '成果文件不存在或超出工程范围。');
  }
  return resolved;
}
export async function creationHash(root: string, file: string): Promise<string> {
  return createHash('sha256').update(await readFile(await safeCreationFile(root, file))).digest('hex');
}

export class CreationVersionStore {
  constructor(readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('Version directory must be absolute');
  }
  async prepare(projectId: string, taskId: string, sourceRoot: string, snapshotId: string | null): Promise<string> {
    assertCreationId(projectId); assertCreationId(taskId);
    const source = snapshotId ? await this.root(projectId, snapshotId) : sourceRoot;
    const target = join(this.directory, projectId, 'runs', taskId);
    // Each task has one exclusive fresh candidate. Never adopt an abandoned partial run.
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await mkdir(target, { mode: 0o700 });
    await copyCreationTree(source, target);
    return target;
  }
  async save(projectId: string, candidate: string): Promise<string> {
    assertCreationId(projectId);
    const id = creationId();
    const base = join(this.directory, projectId, 'versions');
    const temporary = join(base, `${id}.pending`);
    await mkdir(join(temporary, 'game'), { recursive: true, mode: 0o700 });
    const files = await copyCreationTree(candidate, join(temporary, 'game'));
    await writeFile(join(temporary, 'manifest.json'), JSON.stringify({ schemaVersion: 1, projectId, id, files } satisfies VersionManifest), { mode: 0o600 });
    await rename(temporary, join(base, id));
    return id;
  }
  async root(projectId: string, snapshotId: string): Promise<string> {
    assertCreationId(projectId); assertCreationId(snapshotId);
    const directory = join(this.directory, projectId, 'versions', snapshotId);
    let manifest: VersionManifest;
    try { manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as VersionManifest; }
    catch { throw new CreationError('MISSING_VERSION', '该版本文件无法读取，已保留当前成果。'); }
    if (manifest.schemaVersion !== 1 || manifest.projectId !== projectId || manifest.id !== snapshotId
      || !manifest.files || Object.keys(manifest.files).length > MAX_FILES) throw new CreationError('CORRUPT_VERSION', '版本记录损坏，不能恢复。');
    const root = join(directory, 'game');
    for (const [file, hash] of Object.entries(manifest.files)) {
      if (await creationHash(root, file) !== hash) throw new CreationError('CORRUPT_VERSION', '版本文件已变化，不能将其作为原来的确认成果。');
    }
    return root;
  }
  async export(projectId: string, snapshotId: string, projectRoot: string): Promise<string> {
    const source = await this.root(projectId, snapshotId);
    const destination = join(projectRoot, 'exports', snapshotId);
    await mkdir(join(projectRoot, 'exports'), { recursive: true });
    const parent = await lstat(join(projectRoot, 'exports'));
    if (parent.isSymbolicLink()) throw new CreationError('INVALID_PATH', '导出目录不能是符号链接。');
    const temp = join(projectRoot, 'exports', `${snapshotId}.${creationId()}.pending`);
    await mkdir(temp);
    await copyCreationTree(source, temp);
    await rename(temp, destination);
    return destination;
  }
}

export async function copyCreationTree(source: string, destination: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  let count = 0; let bytes = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.env') || /\.(pem|p12|pfx|key)$/iu.test(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new CreationError('INVALID_PATH', '工程中包含符号链接，无法安全保存版本。');
      const file = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = join(destination, file);
      if (entry.isDirectory()) {
        await mkdir(target, { recursive: true });
        await walk(join(dir, entry.name), file);
      } else if (entry.isFile()) {
        const sourceFile = await safeCreationFile(source, file);
        bytes += (await lstat(sourceFile)).size;
        if (++count > MAX_FILES || bytes > MAX_BYTES) throw new CreationError('PROJECT_TOO_LARGE', '当前工程超过首版版本保存大小限制，请缩小素材后重试。');
        await copyFile(sourceFile, target);
        hashes[file] = await creationHash(destination, file);
      } else throw new CreationError('INVALID_PATH', '工程包含不支持的特殊文件。');
    }
  };
  await walk(source, '');
  return hashes;
}
