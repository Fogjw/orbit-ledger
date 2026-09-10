// 纯前端版端到端验证：起一个本地静态服务托管 webapp/dist，用 Electron 当浏览器加载它，
// 自动走完「引导层 → 用浏览器存储 → 界面加载 → 星图渲染出来」并截图存证。
//
// 为什么需要它：纯前端版没有服务端可测 —— 业务层已经被「双驱动一致性」和
// 「本地 API 与 REST 一致性」两组测试覆盖，剩下必须真跑一遍的就是这条浏览器链路
// （ESM 加载、wasm 定位、IndexedDB 落盘、UI 在本地 API 上能否正常渲染）。
//
// 用法：npm run build:web && npm run verify:web
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '../../webapp/dist');
const SHOT = join(here, '../../webapp/verify-shot.png');
const SHOT_YEAR = join(here, '../../webapp/verify-year.png');

// wasm 的 MIME 必须正确，否则 WebAssembly 的流式实例化会被浏览器拒绝
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

app.commandLine.appendSwitch('force-device-scale-factor', '1');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const file = join(distDir, rel);
      if (!file.startsWith(distDir)) { res.writeHead(403).end('forbidden'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const { server, port } = await serve();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`[verify] 静态服务 ${url}`);

  const errors = [];
  const warnings = [];
  const win = new BrowserWindow({
    width: 1280, height: 800,
    show: true, frame: false,                 // 真显示：隐藏窗口不合成新帧（见 make-shots.js 的说明）
    backgroundColor: '#030510',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
      sandbox: true,   // 与真实浏览器一致：不暴露 process，避免 emscripten 误判宿主环境
    },
  });
  // Electron 44 起 console-message 的事件对象自带 level / message
  win.webContents.on('console-message', (event) => {
    const level = event?.level;                  // 'info' | 'warning' | 'error'
    const message = event?.message ?? String(event);
    if (level === 'error') errors.push(message);
    else if (level === 'warning') warnings.push(message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`));

  await win.loadURL(url);
  await wait(1500);
  const js = (code) => win.webContents.executeJavaScript(code);
  const has = (sel) => js(`Boolean(document.querySelector('${sel}'))`);

  // 先探 wasm 能不能取到：wasm 加载失败会让整个业务层起不来，
  // 而它抛出的 "Failed to execute 'compile'" 本身看不出到底是 404 还是 MIME 不对
  const probe = await js(`fetch(new URL('./sqlite-wasm/sql-wasm.wasm', location.href))
    .then((r) => r.status + ' · ' + (r.headers.get('content-type') || 'no-ct'))
    .catch((e) => 'ERR ' + e.message)`);
  console.log(`[verify] wasm 探测: ${probe}`);

  // 1) 引导层应当先出现
  const gateShown = await has('#orbitGate');
  console.log(`[verify] 引导层出现: ${gateShown}`);

  // 2) 走浏览器存储分支（选目录需要用户手势，自动化里点不了系统弹窗）
  if (gateShown) {
    await js(`document.querySelector('#orbitUseIdb')?.click()`);
    await wait(2500);
  }

  // 3) 界面脚本应当被 boot 动态加载并完成初始化
  const state = JSON.parse(await js(`(() => {
    const c = document.querySelector('#graph');
    let lit = -1;
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      lit = 0;
      for (let i = 3; i < d.length; i += 4 * 211) if (d[i] > 16) lit++;
    } catch (e) { /* ignore */ }
    return JSON.stringify({
      loadedUi: Boolean(document.querySelector('#mtValue')),
      total: (document.querySelector('#mtValue')?.textContent || '').trim(),
      canvasLit: lit,
      ledgerBtn: (document.querySelector('#ledgerBtn')?.textContent || '').trim(),
      storage: window.OrbitStorage ? window.OrbitStorage.describe() : null,
      api: typeof window.OrbitAPI,
    });
  })()`));

  console.log(`[verify] 界面已加载: ${state.loadedUi}`);
  console.log(`[verify] OrbitAPI: ${state.api} · 存储: ${state.storage}`);
  console.log(`[verify] 顶部总额: ${state.total} · 账本按钮: ${state.ledgerBtn}`);
  console.log(`[verify] 星图着色采样: ${state.canvasLit}`);

  // 4) 记一笔，验证写路径（本地 API → sql.js → IndexedDB 落盘）
  let wrote = false;
  if (state.loadedUi) {
    wrote = await js(`(async () => {
      try {
        const l = await window.OrbitAPI.listLedgers();
        const r = await window.OrbitAPI.addExpense(l[0].id, {
          amountCents: 1234, date: '2026-09-10', note: '验证写入',
          primary: { category: '餐饮' }, tags: [],
        });
        const after = await window.OrbitAPI.listExpenses(l[0].id, { from: '2026-09-01', to: '2026-09-30' });
        return Boolean(r && r.amount_cents === 1234 && after.count > 0);
      } catch (e) { console.error('写入验证失败: ' + e.message); return false; }
    })()`);
  }
  console.log(`[verify] 记账写入链路: ${wrote}`);
  await wait(1200);

  const img = await win.webContents.capturePage();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(SHOT, img.toPNG());
  console.log(`[verify] 截图已存 ${SHOT}`);

  // 切到年档，确认年视图也有节点。
  // 这里守的是一个修过的 bug：时间轴原先只覆盖「有数据的月份」，而年档节点锚在该年年中（7/1），
  // 新账本只记了 9 月一笔时锚点落在轴之外 —— 日档月档都有节点，唯独年档空白。
  await js(`(() => {
    const c = document.querySelector('#graph');
    for (let i = 0; i < 4; i++) {
      c.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 300, bubbles: true, cancelable: true, clientX: 640, clientY: 400,
      }));
    }
    return true;
  })()`);
  await wait(1500);   // 等吸附动画把档位收进「年」
  const year = JSON.parse(await js(`(() => {
    const c = document.querySelector('#graph');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    // 只取画面中央那块：年档的年份节点锚在视口中心附近，节点若跑到画面外，这里就是空的
    const d = ctx.getImageData(Math.floor(w * 0.25), Math.floor(h * 0.2), Math.floor(w * 0.5), Math.floor(h * 0.6)).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 16) lit++;
    return JSON.stringify({ centerLit: lit });
  })()`));
  console.log(`[verify] 年档画面中央着色采样: ${year.centerLit}（>0 说明年节点画在了视口里）`);

  const imgYear = await win.webContents.capturePage();
  writeFileSync(SHOT_YEAR, imgYear.toPNG());
  console.log(`[verify] 年档截图已存 ${SHOT_YEAR}`);

  if (warnings.length) {
    console.log(`[verify] 页面告警 ${warnings.length} 条（不影响结论）：`);
    for (const w of warnings.slice(0, 5)) console.log('  ~ ' + String(w).split('\n')[0].slice(0, 120));
  }
  if (errors.length) {
    console.log('[verify] 页面报错：');
    for (const e of errors.slice(0, 10)) console.log('  - ' + String(e).split('\n')[0].slice(0, 160));
  } else {
    console.log('[verify] 页面无报错');
  }

  const ok = gateShown && state.loadedUi && state.canvasLit > 0 && wrote
    && year.centerLit > 0 && errors.length === 0;
  console.log(`[verify] 结论: ${ok ? '通过' : '未通过'}`);
  win.destroy();
  server.close();
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[verify] 失败', err);
  app.exit(1);
});
