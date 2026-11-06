import { cp, mkdir, readFile, rename, rm, symlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

// Native macOS packaging avoids an additional GitHub-hosted archiver download.
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const appName = `${pkg.build.productName}.app`;
const app = resolve('release/mac-arm64', appName);
const staging = resolve('.noobi-private/package-cache/dmg-staging');
const baseName = `AI2D-Game-Studio-${pkg.version}-arm64`;
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(app, join(staging, appName), { recursive: true, mode: constants.COPYFILE_FICLONE });
await symlink('/Applications', join(staging, 'Applications'));
const dmg = resolve('release', `${baseName}.dmg`);
const zip = resolve('release', `${baseName}.zip`);
const pendingDmg = resolve('.noobi-private/package-cache', `${baseName}.dmg`);
const pendingZip = resolve('.noobi-private/package-cache', `${baseName}.zip`);
await rm(pendingDmg, { force: true });
await rm(pendingZip, { force: true });
console.log('正在生成 DMG（仅本机文件操作）…');
execFileSync('/usr/bin/hdiutil', ['create', '-volname', pkg.build.productName,
  '-srcfolder', staging, '-format', 'UDZO', '-fs', 'HFS+', pendingDmg], { stdio: 'inherit' });
execFileSync('/usr/bin/hdiutil', ['verify', pendingDmg], { stdio: 'inherit' });
await rename(pendingDmg, dmg);
console.log('正在生成 ZIP…');
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, pendingZip], { stdio: 'inherit' });
await rename(pendingZip, zip);
await rm(staging, { recursive: true, force: true });
console.log(`已生成 ${baseName}.dmg 与 .zip`);
