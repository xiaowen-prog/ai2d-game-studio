import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { assertWindowsX64 } from './windows-utils.mjs';
import { verifyZipFiles } from '../../dist/main/zipArchive.js';

const require = createRequire(import.meta.url), asar = require('@electron/asar');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const directory = resolve('release/windows'), unpacked = join(directory, 'win-unpacked');
const resources = join(unpacked, 'resources'), archive = join(resources, 'app.asar');
const entries = asar.listPackage(archive).map(path => path.replaceAll('\\', '/').replace(/^\//u, ''));
const native = 'node_modules/@openai/codex-win32-x64';
for (const path of ['dist/main/main.js', 'dist/main/preload.cjs', 'dist/main/creationDelivery.js',
  'dist/main/zipArchive.js', 'dist/renderer/index.html', `${native}/package.json`, 'node_modules/fflate/package.json']) {
  if (!entries.includes(path)) throw Error(`Windows 包缺少 ${path}`);
}
const privateEntry = entries.find(path => /(?:^|\/)(?:\.noobi-private|\.git|codex-home|auth\.json|projects\.json|media-providers\.json|\.env(?:\.[^/]*)?)(?:\/|$)/iu.test(path));
if (privateEntry) throw Error(`包内含私有文件：${privateEntry}`);
if (entries.some(path => /node_modules\/@openai\/codex-(?:darwin|linux|win32-arm64)/u.test(path))) throw Error('Windows 包混入了其他平台的 Codex');
await assertWindowsX64(join(unpacked, `${pkg.build.productName}.exe`));
await assertWindowsX64(join(resources, 'app.asar.unpacked', native, 'vendor/x86_64-pc-windows-msvc/bin/codex.exe'));
await access(join(unpacked, 'icudtl.dat'));
const bundled = JSON.parse(asar.extractFile(archive, `${native}/package.json`).toString());
if (bundled.version !== `${pkg.dependencies['@openai/codex']}-win32-x64`) throw Error('包内 Codex 版本不一致');
async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
const files = {};
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/');
    else if (entry.isFile()) files[path] = await hash(join(directory, entry.name));
    else throw Error(`Windows 包不允许文件链接：${path}`);
  }
}
await walk(unpacked);
const name = `Zaojing-${pkg.version}-win-x64.zip`, zip = join(directory, name);
await verifyZipFiles(zip, files, new AbortController().signal);
const result = { version: pkg.version, platform: 'win32', architecture: 'x64', format: 'portable-zip',
  bundledCodex: bundled.version, privatePathsFound: false, archiveContentsVerified: true,
  applicationLaunched: false, modelCalls: 0, windowsAcceptance: 'pending-user', codeSigned: false,
  artifacts: [{ name, bytes: (await stat(zip)).size, sha256: await hash(zip) }] };
await writeFile(join(directory, 'package-check.json'), JSON.stringify(result, null, 2) + '\n');
await writeFile(join(directory, 'SHA256SUMS.txt'), `${result.artifacts[0].sha256}  ${name}\n`);
console.log(JSON.stringify(result, null, 2));
