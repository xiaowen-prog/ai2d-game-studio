import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { assertWindowsX64 } from './windows-utils.mjs';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
let nativePath;
try { nativePath = require.resolve('@openai/codex-win32-x64/package.json'); }
catch { throw Error('缺少 Windows x64 AI 运行程序。在 Windows x64 上运行 npm ci --include=optional；跨平台打包请按 docs/WINDOWS.md 准备锁定版本。'); }
const native = JSON.parse(await readFile(nativePath, 'utf8'));
if (native.version !== `${pkg.dependencies['@openai/codex']}-win32-x64`) throw Error('Windows Codex 版本与锁文件不一致，停止打包。');
await assertWindowsX64(join(dirname(nativePath), 'vendor/x86_64-pc-windows-msvc/bin/codex.exe'));
if (pkg.build.win.signExecutable !== false) throw Error('测试包不允许连接签名服务。');
// An ICO can contain a PNG image. Reuse the product's existing icon, no external tools.
const original = PNG.sync.read(await readFile('build/zaojing-icon.png'));
const icon = new PNG({ width: 256, height: 256 });
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
  const from = (Math.floor(y * original.height / 256) * original.width + Math.floor(x * original.width / 256)) * 4;
  original.data.copy(icon.data, (y * 256 + x) * 4, from, from + 4);
}
const png = PNG.sync.write(icon), header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await mkdir(dirname(resolve(pkg.build.win.icon)), { recursive: true });
await writeFile(pkg.build.win.icon, Buffer.concat([header, png]));
console.log('Windows x64 准备完成：运行程序版本和架构已核对；不附带账户或项目。');
