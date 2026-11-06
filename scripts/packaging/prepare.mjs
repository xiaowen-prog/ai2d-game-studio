import { access, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// Local test distribution only. No credentials, signing account or model calls.
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('本节点只制作 Apple 芯片 Mac 测试包，请在 arm64 macOS 上构建。');
}
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
let nativePackage;
try { nativePackage = require.resolve('@openai/codex-darwin-arm64/package.json'); }
catch { throw new Error('缺少随包 AI 运行程序。请运行 npm ci --include=optional 后重新打包。'); }
const native = JSON.parse(await readFile(nativePackage, 'utf8'));
if (native.version !== `${pkg.dependencies['@openai/codex']}-darwin-arm64`) {
  throw new Error('Codex 运行程序版本与项目锁定版本不一致，停止打包。');
}
await access(join(dirname(nativePackage), 'vendor/aarch64-apple-darwin/bin/codex'), constants.X_OK);
await access(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), constants.X_OK);
if (pkg.build.mac.identity !== '-' || pkg.build.mac.notarize !== false) {
  throw new Error('本节点只允许本地临时签名，不连接付费签名或公证服务。');
}
// Convert the existing icon with macOS tools, without downloading a conversion toolset.
const iconset = resolve('.noobi-private/package-cache/studio.iconset');
await mkdir(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale),
      resolve('build/zaojing-icon.png'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'pipe' });
  }
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', resolve(pkg.build.mac.icon)], { stdio: 'pipe' });
console.log('打包准备完成：内置 Codex 已就位；不附带账户或项目，不上传、不调用模型。');
