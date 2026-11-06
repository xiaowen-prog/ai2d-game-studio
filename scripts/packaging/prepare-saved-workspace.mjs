// Only prepares the same continuation copy used by earlier nodes. No login or model calls.
import { constants, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const genre = process.argv[2];
if (!['platformer', 'topdown'].includes(genre)) throw Error('请选择横版或俯视项目。');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const browser = process.argv[3] === '--browser';
const privateRoot = join(repo, '.noobi-private');
const continuation = join(privateRoot, `${genre}-round`);
const folder = browser ? join(privateRoot, 'browser-studio', genre) : continuation;
const data = join(folder, 'user-data');
const ready = join(folder, 'workspace.json');
if (!existsSync(ready)) {
  if (existsSync(data)) throw Error('发现已有续做数据但缺少登记记录，已停止，未覆盖数据。');
  const continuationRecord = join(continuation, 'workspace.json');
  const sourceFile = browser && existsSync(continuationRecord)
    ? continuationRecord
    : join(privateRoot, `${genre}-review`, `latest-${genre}.json`);
  if (!existsSync(sourceFile)) throw Error('没有找到旧样例。请选“全新项目”从首页开始。');
  const source = JSON.parse(await readFile(sourceFile, 'utf8'));
  const workflow = JSON.parse(await readFile(join(source.stateDirectory, 'creation/records', `${source.projectId}.json`), 'utf8'));
  if (workflow.steps.playable.artifact?.playable?.genre !== genre || !workflow.steps.playable.artifact?.snapshotId) {
    throw Error('旧样例缺少可继续的试玩成果，未复制或修改原数据。');
  }
  const projects = JSON.parse(await readFile(join(source.stateDirectory, 'projects.json'), 'utf8'));
  const project = projects.projects.find(item => item.id === source.projectId);
  if (!project) throw Error('找不到原项目记录，未修改原数据。');
  await mkdir(folder, { recursive: true });
  const pending = await mkdtemp(join(folder, 'preparing-'));
  try {
    const options = { recursive: true, mode: constants.COPYFILE_FICLONE, filter: async path => {
      if (path.split('/').includes('runs')) return false;
      if (!browser) return true;
      if (/(?:^|\/)(?:codex-home|auth\.json|credentials?\.json|\.env(?:\.[^/]+)?)$/iu.test(path)) return false;
      if ((await lstat(path)).isSymbolicLink()) throw Error('项目包含外部链接，已停止复制。');
      return true;
    } };
    for (const name of ['creation', 'image-generation-attestations.json', 'asset-plans.json']) {
      await cp(join(source.stateDirectory, name), join(pending, name), options);
    }
    await cp(project.root, join(pending, 'project'), options);
    project.root = join(data, 'project');
    projects.projects = [project];
    projects.settings.defaultWorkspace = join(data, 'projects');
    await writeFile(join(pending, 'projects.json'), JSON.stringify(projects, null, 2));
    if (existsSync(data)) throw Error('续做区已在其他窗口创建，请重新打开；未覆盖。');
    await rename(pending, data);
    await writeFile(ready, JSON.stringify({ projectId: project.id, sourceStateDirectory: source.stateDirectory, stateDirectory: data }, null, 2));
  } finally {
    await rm(pending, { recursive: true, force: true });
  }
}
// Validate the expected saved copy, never accept an arbitrary directory from metadata.
const saved = JSON.parse(await readFile(ready, 'utf8'));
if (resolve(saved.stateDirectory) !== data || !existsSync(join(data, 'projects.json'))) {
  throw Error('续做区位置变化，请先恢复原目录；未自动创建空项目。');
}
process.stdout.write(data);
