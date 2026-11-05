import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveLatestGameplayExperienceReport } from './gameplayExperienceEvaluator.js';
import type { GodotEnvironmentService } from './godotEnvironmentService.js';

const SKIP = new Set(['.git', '.godot', '.cache', 'node_modules', 'artifacts', 'build', 'dist', 'exports', '.DS_Store']);
/** Fingerprint inputs, including media and control contracts; generated logs are not inputs. */
export async function reviewWorkspaceHash(root: string): Promise<string> {
  const digest = createHash('sha256');
  let files = 0;
  const walk = async (directory: string, prefix = ''): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP.has(entry.name) || ['.log', '.import', '.uid'].some(suffix => entry.name.endsWith(suffix))) continue;
      if (entry.isSymbolicLink()) throw new Error('Review inputs must not contain symbolic links');
      const name = `${prefix}${entry.name}`;
      if (name === '.noobi/stage-check.json') continue;
      if (entry.isDirectory()) await walk(join(directory, entry.name), `${name}/`);
      else if (entry.isFile()) {
        if (++files > 10000) throw new Error('Too many review input files');
        digest.update(name).update('\0').update(createHash('sha256').update(await readFile(join(directory, entry.name))).digest());
      }
    }
  };
  await walk(root);
  return digest.digest('hex');
}

export async function engineDirectory(root: string): Promise<string> {
  let path = root;
  for (const part of ['artifacts', 'engine']) {
    path = join(path, part);
    await mkdir(path, { recursive: true });
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('Unsafe engine evidence directory');
  }
  return path;
}

export async function archiveCurrentReviewEvidence(root: string): Promise<void> {
  await archiveLatestGameplayExperienceReport(root);
  const directory = await engineDirectory(root);
  for (const name of ['latest.json', 'actions-latest.json', 'scene-latest.json', 'platformer-latest.json']) {
  const latest = join(directory, name);
  try {
    const metadata = await lstat(latest);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('Unsafe engine evidence file');
    await rename(latest, join(directory, `history-${name}-${randomUUID()}.json`));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

/** Keeps the full native result, including failures; the model cannot issue the host verdict. */
export async function captureGodotChecks<T>(
  root: string,
  execute: GodotEnvironmentService['execute'],
  run: (execute: GodotEnvironmentService['execute']) => Promise<T>,
): Promise<T> {
  const results: Awaited<ReturnType<GodotEnvironmentService['execute']>>[] = [];
  const runId = randomUUID();
  const directory = await engineDirectory(root);
  const before = await reviewWorkspaceHash(root);
  let ok = false;
  let error: string | null = null;
  try {
    const value = await run(async (request) => {
      const result = await execute(request);
      results.push(result);
      return result;
    });
    ok = true;
    return value;
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
    throw failure;
  } finally {
    const after = await reviewWorkspaceHash(root);
    const report = { schemaVersion: 1, runId, checkedAt: new Date().toISOString(), workspaceSha256: after,
      inputsStable: before === after, ok: ok && before === after, error, results };
    // Replace atomically so a model-authored symlink at latest.json cannot redirect a host write.
    const temporary = join(directory, `${runId}.tmp`);
    await writeFile(temporary, JSON.stringify(report, null, 2), { flag: 'wx' });
    await rename(temporary, join(directory, 'latest.json'));
    if (ok && before !== after) throw new Error('Godot verification inputs changed during execution; a fresh check is required');
  }
}

export async function currentEngineEvidence(root: string): Promise<string> {
  const file = join(root, 'artifacts/engine/latest.json');
  const bytes = await readFile(file);
  const report = JSON.parse(bytes.toString());
  if (report.workspaceSha256 !== await reviewWorkspaceHash(root)) throw new Error('Engine evidence is stale');
  return JSON.stringify({ path: 'artifacts/engine/latest.json', runId: report.runId,
    sha256: createHash('sha256').update(bytes).digest('hex'), workspaceSha256: report.workspaceSha256,
    ok: report.ok, tasks: report.results.map((item: { task: string; ok: boolean }) => ({ task: item.task, ok: item.ok })) });
}
