// Opens the user's existing platformer in an isolated continuation workspace.
// It never starts generation, presses game keys, confirms a draft, or runs acceptance.
import { app } from 'electron';
import { constants, existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const location = resolve('.noobi-private/platformer-round');
const data = join(location, 'user-data');
const ready = join(location, 'workspace.json');
await mkdir(location, { recursive: true });
if (!existsSync(ready)) {
  const source = JSON.parse(await readFile(resolve('.noobi-private/platformer-review/latest-platformer.json'), 'utf8'));
  const workflow = JSON.parse(await readFile(join(source.stateDirectory, 'creation/records', `${source.projectId}.json`), 'utf8'));
  if (workflow.steps.playable.artifact?.playable?.genre !== 'platformer' || !workflow.steps.playable.artifact.snapshotId) throw Error('No saved platformer project is available');
  const originalProjects = JSON.parse(await readFile(join(source.stateDirectory, 'projects.json'), 'utf8'));
  const project = originalProjects.projects.find(item => item.id === source.projectId);
  if (!project) throw Error('Saved platformer project is missing');
  const pending = join(location, 'preparing-user-data');
  // Only incomplete preparation is replaceable; the saved source is never edited.
  await rm(pending, { recursive: true, force: true });
  await mkdir(pending, { recursive: true });
  const options = { recursive: true, mode: constants.COPYFILE_FICLONE, filter: path => !path.split('/').includes('runs') };
  for (const file of ['creation', 'image-generation-attestations.json', 'asset-plans.json']) {
    await cp(join(source.stateDirectory, file), join(pending, file), options);
  }
  await cp(project.root, join(pending, 'project'), options);
  project.root = join(data, 'project');
  originalProjects.projects = [project];
  originalProjects.settings.defaultWorkspace = join(data, 'projects');
  await writeFile(join(pending, 'projects.json'), JSON.stringify(originalProjects, null, 2));
  if (existsSync(data)) throw Error('An existing continuation workspace needs recovery; no saved data was overwritten');
  await rename(pending, data);
  await writeFile(ready, JSON.stringify({ projectId: project.id, sourceStateDirectory: source.stateDirectory, stateDirectory: data }, null, 2));
}

if (process.env.OPENAI_API_KEY) throw Error('This continuation workspace uses the existing subscription, not a paid API key');
const sourceAuth = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
const authDirectory = join(data, 'codex-home');
const destinationAuth = join(authDirectory, 'auth.json');
let temporaryAuth = false;
if (!existsSync(destinationAuth) && existsSync(sourceAuth)) {
  const auth = JSON.parse(readFileSync(sourceAuth, 'utf8'));
  if (auth.auth_mode === 'chatgpt' && !auth.OPENAI_API_KEY && auth.tokens) {
    mkdirSync(authDirectory, { recursive: true, mode: 0o700 });
    copyFileSync(sourceAuth, destinationAuth); chmodSync(destinationAuth, 0o600); temporaryAuth = true;
  }
}
process.on('exit', () => { if (temporaryAuth) rmSync(destinationAuth, { force: true }); });
app.setAppPath(resolve('.'));
process.env.NOOBI_USER_DATA_DIR = data;
const localGodot = resolve('.noobi-private/godot-4.5.1/Godot.app/Contents/MacOS/Godot');
if (!process.env.NOOBI_GODOT_BIN && existsSync(localGodot)) process.env.NOOBI_GODOT_BIN = localGodot;
delete process.env.NOOBI_DISABLE_GENERATION;
delete process.env.NOOBI_RENDERER_URL;
await import('../../dist/main/main.js');
