import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { CreationArtifact, CreationDelivery, CreationWorkflow } from '../shared/creation.js';
import { CreationError, assertCreationId, creationId } from './creationWorkflowStore.js';
import { creationHash, safeCreationFile, type CreationVersionStore } from './creationVersionStore.js';

const execute = promisify(execFile);
const MANIFEST = 'delivery-manifest.json';
const ARCHIVE = 'game-package.zip';
const SOURCE_EXTENSIONS = new Set(['.godot', '.gd', '.gdshader', '.tscn', '.tres', '.res', '.uid', '.import', '.cfg', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.wav', '.ogg', '.mp3', '.ttf', '.otf', '.woff', '.woff2', '.json', '.csv', '.txt']);
const WEB_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.wasm', '.pck', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.json', '.wav', '.ogg', '.mp3', '.woff', '.woff2']);
interface DeliveryManifest {
  schemaVersion: 1; projectId: string; sourceVersionId: string; sourceSnapshotId: string;
  createdAt: string; files: Record<string, string>; sourceFiles: Record<string, string>;
}
function failure(message: string): never { throw new CreationError('DELIVERY_PACKAGE_INVALID', message); }
function privateFile(path: string): boolean {
  return path.split('/').some(part => part.startsWith('.') || /^(?:auth|credentials?|secrets?|service[-_]account|export_credentials)(?:[._-]|$)/iu.test(part));
}
function sourceFile(path: string): boolean {
  if (privateFile(path) || path.split('/').some(part => ['build', 'artifacts', 'exports', 'node_modules', 'codex-home', 'logs'].includes(part))) return false;
  if (basename(path) === 'asset-pack.json' || basename(path).startsWith('appearance-before-')) return false;
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) || /^LICEN[CS]E(?:\.[^/]+)?$/iu.test(basename(path));
}
async function header(root: string, path: string): Promise<Buffer> {
  const file = await open(await safeCreationFile(root, path), 'r');
  try { const bytes = Buffer.alloc(4); await file.read(bytes, 0, 4, 0); return bytes; }
  finally { await file.close(); }
}
async function validateEntrypoints(root: string, sourcePaths: Set<string>, webPaths: Set<string>): Promise<void> {
  if (!sourcePaths.has('project.godot')) failure('确认版本缺少 Godot 工程入口。');
  for (const path of ['index.html', 'index.js', 'index.wasm', 'index.pck']) {
    if (!webPaths.has(path)) failure(`确认版本缺少网页文件 ${path}，请返回完整游戏重新制作并确认。`);
    if ((await lstat(await safeCreationFile(root, `build/web/${path}`))).size < 8) failure(`网页文件 ${path} 不完整。`);
  }
  const wasm = await header(root, 'build/web/index.wasm');
  const pack = await header(root, 'build/web/index.pck');
  if (wasm.toString('hex') !== '0061736d' || pack.toString('ascii') !== 'GDPC') failure('确认版本的网页引擎或游戏资源包无效。');
  for (const path of sourcePaths) {
    if (!/\.(gd|tscn|tres|godot|gdshader)$/iu.test(path)) continue;
    const contents = (await readFile(await safeCreationFile(root, path), 'utf8')).split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
    for (const match of contents.matchAll(/["']res:\/\/([^"'\r\n]+)["']/gu)) {
      const ref = match[1].split('::')[0];
      if (ref.includes('%') || ref.endsWith('/')) continue;
      if (!sourcePaths.has(ref) && ![...sourcePaths].some(file => file.startsWith(`${ref}/`))) failure(`工程引用的资源未包含在交付范围：${ref}。原版仍保留。`);
    }
  }
}

/** Packaging never invokes the AI, edits source snapshots, or rebuilds gameplay. */
export async function exportCreationDelivery(workflow: CreationWorkflow, projectRoot: string, versions: CreationVersionStore, signal: AbortSignal): Promise<CreationArtifact> {
  const game = workflow.steps.game;
  if (workflow.currentStage !== 'delivery' || !workflow.task || !game.artifact?.snapshotId || !game.artifact.round
    || game.status !== 'confirmed' || game.confirmedVersionId !== game.artifact.id || workflow.workingSnapshotId !== game.artifact.snapshotId) {
    throw new CreationError('PREDECESSOR_REQUIRED', '请先确认当前完整游戏，再导出这个版本。');
  }
  for (const stage of ['direction', 'character', 'scene', 'playable'] as const) {
    const step = workflow.steps[stage];
    if (step.status !== 'confirmed' || !step.artifact?.ready || step.confirmedVersionId !== step.artifact.id) throw new CreationError('PREDECESSOR_REQUIRED', '前置成果或整套修改尚未确认，不能导出。');
  }
  signal.throwIfAborted();
  const source = await versions.snapshot(workflow.projectId, game.artifact.snapshotId);
  const projectPaths = new Set(Object.keys(source.files).filter(sourceFile));
  const webPaths = new Set(Object.keys(source.files).filter(path => path.startsWith('build/web/') && !privateFile(path) && WEB_EXTENSIONS.has(extname(path).toLowerCase()))
    .map(path => path.slice('build/web/'.length)));
  await validateEntrypoints(source.root, projectPaths, webPaths);
  const exports = join(projectRoot, 'exports');
  await mkdir(exports, { recursive: true });
  if ((await lstat(exports)).isSymbolicLink()) failure('交付目录不能是外部文件链接。');
  const bundleId = creationId();
  const temporary = join(exports, `${bundleId}.pending`), destination = join(exports, bundleId);
  await mkdir(temporary, { mode: 0o700 });
  const files: Record<string, string> = {}, sourceFiles: Record<string, string> = {};
  let bytes = 0;
  try {
    for (const [folder, paths] of [['godot-project', projectPaths], ['web-game', webPaths]] as const) {
      for (const path of paths) {
        signal.throwIfAborted();
        const original = folder === 'web-game' ? `build/web/${path}` : path;
        const from = await safeCreationFile(source.root, original), targetPath = `${folder}/${path}`;
        bytes += (await lstat(from)).size;
        if (bytes > 512 * 1024 * 1024 || Object.keys(files).length >= 10_000) failure('交付包超过首版大小限制，原游戏仍保留。');
        await mkdir(dirname(join(temporary, targetPath)), { recursive: true });
        await copyFile(from, join(temporary, targetPath));
        const hash = await creationHash(temporary, targetPath);
        if (hash !== source.files[original]) failure('复制时发现文件与确认版本不一致，已停止导出。');
        files[targetPath] = hash; sourceFiles[targetPath] = original;
      }
    }
    const createdAt = new Date().toISOString();
    const helpers = {
      '打开网页游戏.command': WEB_LAUNCHER,
      'serve-game.py': WEB_SERVER,
      '打开说明.md': deliveryReadme(game.artifact, createdAt),
    };
    for (const [path, content] of Object.entries(helpers)) {
      await writeFile(join(temporary, path), content, { flag: 'wx', mode: path.endsWith('.command') ? 0o755 : 0o644 });
      files[path] = await creationHash(temporary, path);
    }
    const manifest: DeliveryManifest = { schemaVersion: 1, projectId: workflow.projectId, sourceVersionId: game.artifact.id,
      sourceSnapshotId: game.artifact.snapshotId, createdAt, files, sourceFiles };
    await writeFile(join(temporary, MANIFEST), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    // macOS system tools, argv only. User-generated names never become shell commands.
    await execute('/usr/bin/zip', ['-q', '-r', ARCHIVE, 'godot-project', 'web-game', ...Object.keys(helpers), MANIFEST], { cwd: temporary, signal, timeout: 120_000, maxBuffer: 1_000_000 });
    await execute('/usr/bin/unzip', ['-tqq', ARCHIVE], { cwd: temporary, signal, timeout: 120_000, maxBuffer: 1_000_000 });
    const delivery: CreationDelivery = { bundleId, sourceVersionId: game.artifact.id, sourceSnapshotId: game.artifact.snapshotId,
      manifestSha256: await creationHash(temporary, MANIFEST), archiveSha256: await creationHash(temporary, ARCHIVE), fileCount: Object.keys(files).length };
    signal.throwIfAborted();
    await rename(temporary, destination);
    return { id: creationId(), stage: 'delivery', title: `${game.artifact.title} · 交付包`,
      summary: '已按最后确认版本保存 Godot 工程、网页游戏和压缩包。下方预览直接读取导出包。请打开文件验证后，再确认交付。',
      changes: ['导出已确认版本，未调用 AI 或改写游戏', '附带中文打开说明与本机网页启动脚本', '另存独立交付目录，旧包保留'],
      createdAt, candidates: [], selectedCharacterId: null, media: [], ready: true, snapshotId: game.artifact.snapshotId, lockedAssets: { ...game.artifact.lockedAssets },
      checks: ['源快照与交付文件摘要逐项一致', '网页入口和工程资源引用已核对', 'ZIP 完整性检查通过；真实运行与效果等待用户验收'], delivery };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    signal.throwIfAborted();
    if (error instanceof CreationError) throw error;
    throw new CreationError('EXPORT_FAILED', '导出未完成，原游戏与旧导出包仍保留。请检查磁盘空间及本机 zip 工具后重试。');
  }
}

/** Resolve only a host-recorded bundle; never accept an arbitrary renderer filesystem path. */
export async function verifyCreationDelivery(projectId: string, projectRoot: string, artifact: CreationArtifact): Promise<string> {
  const delivery = artifact.delivery;
  if (artifact.stage !== 'delivery' || !delivery || artifact.snapshotId !== delivery.sourceSnapshotId) failure('这份交付记录不完整，请从已确认游戏重新导出。');
  assertCreationId(delivery.bundleId);
  const prefix = `exports/${delivery.bundleId}`;
  try {
    await safeCreationFile(projectRoot, `${prefix}/${MANIFEST}`);
    const directory = join(projectRoot, prefix);
    if (await creationHash(directory, MANIFEST) !== delivery.manifestSha256 || await creationHash(directory, ARCHIVE) !== delivery.archiveSha256) failure('交付清单或压缩包已变化，请重新导出；现有文件不会被覆盖。');
    const manifest = JSON.parse(await readFile(await safeCreationFile(directory, MANIFEST), 'utf8')) as DeliveryManifest;
    if (manifest.schemaVersion !== 1 || manifest.projectId !== projectId || manifest.sourceVersionId !== delivery.sourceVersionId
      || manifest.sourceSnapshotId !== delivery.sourceSnapshotId || !manifest.files || Object.keys(manifest.files).length !== delivery.fileCount) failure('交付包来源记录不一致。');
    for (const [path, hash] of Object.entries(manifest.files)) if (await creationHash(directory, path) !== hash) failure('交付包内有文件缺失或已修改，请重新导出；旧文件保留。');
    return directory;
  } catch (error) {
    if (error instanceof CreationError) throw error;
    throw new CreationError('DELIVERY_PACKAGE_MISSING', '交付包缺失或不能读取。可返回已确认游戏重新导出，原游戏仍保留。');
  }
}

function deliveryReadme(game: CreationArtifact, date: string): string {
  return `# ${game.title.replace(/[\r\n]/gu, ' ').slice(0, 120)}\n\n这是你在 AI 2D 游戏制作台最后确认的版本。导出时间：${date}。\n游戏版本：${game.id}；来源快照：${game.snapshotId}。\n\n## 玩网页游戏\n\n在 macOS 双击“打开网页游戏.command”。电脑需要 Python 3；窗口会显示本机网址并打开浏览器。不要直接双击 web-game/index.html。关闭终端窗口或按 Ctrl+C 可停止。\n\n其他电脑安装 Python 3 后，在本文件所在目录运行 python3 serve-game.py，再打开显示的网址。仅本机可访问，不是公网分享链接。\n\n游戏操作和目标：\n\n${game.summary}\n\n## 继续编辑\n\n使用 Godot 4 导入 godot-project/project.godot，等待资源导入后运行项目。工程与网页分别保存，修改工程不会自动改变网页包。导出文件不需要登录制作台或模型账户。\n\n## 保存与转交\n\ngame-package.zip 包含工程、网页、启动脚本和本说明，解压后使用。delivery-manifest.json 记录文件与确认版本的对应关系；它证明文件一致，不代替真实试玩。工作会话、内部检查记录和缓存没有作为交付内容。\n`;
}

const WEB_LAUNCHER = `#!/bin/zsh
set -e
cd "\${0:A:h}"
if ! command -v python3 >/dev/null 2>&1; then
  echo "需要先安装 Python 3；详见打开说明.md。"
  read -r "reply?按回车关闭："
  exit 1
fi
exec python3 serve-game.py
`;

const WEB_SERVER = `#!/usr/bin/env python3
"""Local-only static server for the exported game. No model calls or file writes."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent / "web-game"

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm", ".pck": "application/octet-stream", ".js": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        host = self.headers.get("Host", "")
        port = self.server.server_port
        if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            self.send_error(403)
            return None
        target = Path(self.translate_path(self.path))
        try:
            parts = target.relative_to(ROOT).parts
            cursor = ROOT
            for part in parts:
                cursor = cursor / part
                if cursor.is_symlink():
                    raise ValueError()
            target.resolve().relative_to(ROOT.resolve())
            if target.is_dir() and not (target / "index.html").is_file():
                raise ValueError()
        except (ValueError, OSError):
            self.send_error(403)
            return None
        return super().send_head()

if __name__ == "__main__":
    if not (ROOT / "index.html").is_file():
        raise SystemExit("找不到网页游戏。请先完整解压 game-package.zip。")
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print("游戏地址：" + url, flush=True)
        print("按 Ctrl+C 停止。关闭此窗口后游戏服务停止。", flush=True)
        timer = threading.Timer(0.2, lambda: webbrowser.open(url))
        timer.daemon = True
        timer.start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
`;
