import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.noobi-private/direction-review`;
await mkdir(out, { recursive: true });
await build({ entryPoints: [`${root}scripts/direction-review/page.tsx`], bundle: true, jsx: 'automatic',
  outfile: `${out}/app.js`, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
await writeFile(`${out}/index.html`, `<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>方向卡 · 离线交互验收</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>`);
console.log('离线验收页面已构建，未调用模型。');
