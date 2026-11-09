import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const app = resolve('release/mac-arm64', `${pkg.build.productName}.app`);
const resources = join(app, 'Contents/Resources');
const archive = join(resources, 'app.asar');
const entries = asar.listPackage(archive).map(path => path.replace(/^\//u, ''));
const required = ['dist/main/main.js', 'dist/main/preload.cjs', 'dist/renderer/index.html',
  'dist/main/creationWorkflowService.js', 'dist/main/creationDelivery.js', 'dist/main/zipArchive.js', 'node_modules/fflate/package.json',
  'node_modules/@openai/codex-darwin-arm64/package.json', 'node_modules/pngjs/package.json', 'node_modules/parse5/package.json'];
for (const path of required) if (!entries.includes(path)) throw Error(`安装包缺少 ${path}`);
const privateEntry = entries.find(path => /(?:^|\/)(?:\.noobi-private|\.git|codex-home|auth\.json|projects\.json|media-providers\.json|\.env(?:\.[^/]*)?)(?:\/|$)/iu.test(path));
if (privateEntry) throw Error(`安装包包含本机私有数据路径：${privateEntry}`);
const unpacked = join(resources, 'app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
await access(unpacked, constants.X_OK);
const architectures = execFileSync('/usr/bin/lipo', ['-archs', unpacked], { encoding: 'utf8' }).trim();
if (!architectures.split(/\s/u).includes('arm64')) throw Error('随包 Codex 不是 arm64 程序');
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
const result = { version: pkg.version, architecture: 'arm64', bundleId: pkg.build.appId,
  localSignatureVerified: true, appleNotarized: false, bundledCodex: pkg.dependencies['@openai/codex'],
  privatePathsFound: false, applicationLaunched: false, modelCalls: 0, businessAcceptance: 'pending-user', artifacts: [] };
for (const extension of ['dmg', 'zip']) {
  const name = `AI2D-Game-Studio-${pkg.version}-arm64.${extension}`;
  const path = resolve('release', name);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  result.artifacts.push({ name, bytes: (await stat(path)).size, sha256: hash.digest('hex') });
}
await writeFile('release/package-check.json', JSON.stringify(result, null, 2) + '\n');
await writeFile('release/SHA256SUMS.txt', result.artifacts.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
console.log(JSON.stringify(result, null, 2));
