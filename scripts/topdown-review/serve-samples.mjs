// Read-only browser handoff. Does not call a model or operate the game.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { PreviewServer } from '../../dist/main/previewServer.js';
const latest = JSON.parse(readFileSync('.noobi-private/topdown-review/latest-topdown.json', 'utf8'));
if (!latest.baseArtifact?.snapshotId) throw Error('A saved draft is required');
const server = new PreviewServer(), urls = {};
for (const [name, artifact] of Object.entries({ original: latest.baseArtifact, bounce: latest.finalArtifact })) {
  if (!artifact?.snapshotId) continue;
  const root = join(latest.stateDirectory, 'creation/artifacts', latest.projectId, 'versions', artifact.snapshotId, 'game');
  urls[name] = await server.start(`topdown-${name}`, root, { directory: 'build/web', sourceFallback: false, sourceAssetOverlay: false });
}
const record = { startedAt: new Date().toISOString(), processId: process.pid, ...urls, manualAcceptance: 'pending' };
writeFileSync('.noobi-private/topdown-review/manual-urls.json', JSON.stringify(record, null, 2));
console.log(JSON.stringify(record));
if (process.argv.includes('--open')) {
  for (const url of Object.values(urls)) execFile('open', [url]);
}
process.on('SIGTERM', async () => { await server.stopAll(); process.exit(0); });
