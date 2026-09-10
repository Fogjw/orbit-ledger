// 纯前端版构建：把共享 core + 本地 API + 存储层 + sql.js 打成一个 bundle，
// 并复用 web/ 的界面（HTML / CSS / UI 脚本原样搬过去，**一行都不改**），
// 产出一份可直接托管的静态站点。
//
// 为什么 HTML 从 web/index.html 生成、而不是手写一份：界面骨架只能有一个来源。
// 以后 web/ 改了 DOM 结构，纯前端版不会悄悄落后 —— 它俩的差异只有「加载哪个数据源」。
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist');

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // 1) bundle：boot + 本地 API + 存储 + 共享 core + sql.js。
  //    产物是 ESM —— boot.js 靠 import.meta.url 定位同目录下的 wasm，所以必须走模块加载。
  await build({
    entryPoints: [join(here, 'boot.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome110'],
    outfile: join(out, 'bundle.js'),
    logLevel: 'info',
  });

  // 2) 界面脚本与静态资源：原样复制，保证与桌面端是同一份代码
  for (const f of ['app.js', 'data.js', 'styles.css', 'logo.svg']) {
    await cp(join(root, 'web', f), join(out, f));
  }

  // 3) sql.js 的 wasm 运行时：boot.js 会去 ./sqlite-wasm/ 找它
  const wasm = join(root, 'node_modules/sql.js/dist/sql-wasm.wasm');
  if (!existsSync(wasm)) throw new Error('找不到 sql.js 的 wasm，请先在仓库根 npm install');
  await mkdir(join(out, 'sqlite-wasm'), { recursive: true });
  await cp(wasm, join(out, 'sqlite-wasm/sql-wasm.wasm'));

  // 4) HTML：从 web/index.html 生成 —— 去掉 REST 客户端，改加载本地 bundle
  let html = await readFile(join(root, 'web/index.html'), 'utf8');
  html = html
    .replace(/<script src="api\.js"><\/script>\s*/g, '')
    .replace(/<script src="data\.js"><\/script>\s*/g, '')
    .replace(/<script src="app\.js"><\/script>\s*/g, '')
    .replace('</body>', '  <script type="module" src="./bundle.js"></script>\n</body>');
  await writeFile(join(out, 'index.html'), html, 'utf8');

  console.log('[webapp] 构建完成 → webapp/dist/（静态托管即可）');
}

main().catch((err) => { console.error('[webapp] 构建失败', err); process.exit(1); });
