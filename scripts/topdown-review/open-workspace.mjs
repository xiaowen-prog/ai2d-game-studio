// Opens the actual staged AI workspace for the user; no generation is triggered here.
import { app } from 'electron';
import { readFileSync, existsSync, mkdirSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
const latest = JSON.parse(readFileSync('.noobi-private/topdown-review/latest-topdown.json', 'utf8'));
if (!latest.baseArtifact?.snapshotId) throw Error('No saved draft is available');
if (process.env.OPENAI_API_KEY) throw Error('This workspace uses the existing subscription only');
const source = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
const destination = join(latest.stateDirectory, 'codex-home', 'auth.json');
let temporaryAuth = false;
if (!existsSync(destination) && existsSync(source)) {
  const auth = JSON.parse(readFileSync(source, 'utf8'));
  if (auth.auth_mode === 'chatgpt' && !auth.OPENAI_API_KEY && auth.tokens) {
    mkdirSync(join(latest.stateDirectory, 'codex-home'), { recursive: true, mode: 0o700 });
    copyFileSync(source, destination); chmodSync(destination, 0o600); temporaryAuth = true;
  }
}
app.on('will-quit', () => { if (temporaryAuth) rmSync(destination, { force: true }); });
app.setAppPath(resolve('.')); process.env.NOOBI_USER_DATA_DIR = latest.stateDirectory;
const localGodot = resolve('.noobi-private/godot-4.5.1/Godot.app/Contents/MacOS/Godot');
if (!process.env.NOOBI_GODOT_BIN && existsSync(localGodot)) process.env.NOOBI_GODOT_BIN = localGodot;
delete process.env.NOOBI_DISABLE_GENERATION; delete process.env.NOOBI_RENDERER_URL;
await import('../../dist/main/main.js');
