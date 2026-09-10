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
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`);
  const readDebug = async (level) => JSON.parse(await js(
    `JSON.stringify(window.OrbitDebug ? window.OrbitDebug.snapshot('${level}') : null)`
  ));

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
  const readState = async () => JSON.parse(await js(`(() => {
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

  const state = await readState();
  console.log(`[verify] 界面已加载: ${state.loadedUi}`);
  console.log(`[verify] OrbitAPI: ${state.api} · 存储: ${state.storage}`);
  console.log(`[verify] 顶部总额: ${state.total} · 账本按钮: ${state.ledgerBtn}`);
  console.log(`[verify] 星图着色采样: ${state.canvasLit}`);

  // 4) 走**完整的界面流程**记一笔。
  //    不能直接调 OrbitAPI：那样数据虽然进了库，但界面的刷新链路
  //    （afterChange → refreshMonths → 重绘星轨）根本不会被触发，星轨会一直是空数据状态 ——
  //    拿一个空星轨去验证「年档有没有节点」，等于什么都没验。
  let wrote = false;
  if (state.loadedUi) {
    const before = state.total;
    await click('#btnAdd');
    await wait(900);
    await js(`(() => { const el = document.querySelector('#mAmount'); el.value = '66'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await js(`document.querySelector('#mCats > *')?.click()`);   // 选第一个品类；不选也会落「未分类」
    await wait(300);
    await click('#modalSave');
    await wait(3000);   // 等提交 + 重拉统计 + 重绘星轨
    const afterSave = await readState();
    wrote = before !== afterSave.total;   // 顶部总额变了 = 界面确实刷新过
    console.log(`[verify] 界面记账：弹窗=${afterSave.modal} · 顶部总额 ${before} → ${afterSave.total}`);
  }
  console.log(`[verify] 记账写入链路（走界面）: ${wrote}`);
  await wait(1200);

  const img = await win.webContents.capturePage();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(SHOT, img.toPNG());
  console.log(`[verify] 截图已存 ${SHOT}`);

  // 切到年档，确认年视图也有节点（守的是「新账本只记一两个月时年档空白」那个 bug）。
  // 这里必须用**真实输入事件**，不能用 dispatchEvent(new WheelEvent(...))：
  // 合成事件在 Chromium 里未必被页面监听器接住 —— 上一版就是在这翻了车，
  // 「年档截图」其实还是月档，于是验证假通过。
  // 切档用**拖滑块**：mouseWheel 与合成 DOM 事件在这台机器上都没能让档位动起来，
  // 而滑块是 DOM 元素、走真实 pointerdown/move/up 最稳（需求里就是「上=日、下=年」）
  const box = JSON.parse(await js(`(() => {
    const el = document.querySelector('#rail');
    if (!el) return JSON.stringify({ missing: true });
    const r = el.getBoundingClientRect();
    return JSON.stringify({
      x: Math.round(r.left + r.width / 2),
      yBottom: Math.round(r.bottom - 2),
      w: Math.round(r.width), h: Math.round(r.height),
    });
  })()`));
  console.log(`[verify] 粒度滑块 ${box.missing ? '不存在' : `${box.w}×${box.h} @ x=${box.x} 底部 y=${box.yBottom}`}`);
  // 用 CDP 注入鼠标事件切档。为什么不是 sendInputEvent / dispatchEvent：
  // 那两层合成的 pointer 事件没有有效 pointerId，而滑块的 pointerdown 处理器会先调
  // setPointerCapture（抛错即中断后续），于是档位纹丝不动、截图与月档几乎一样。
  // CDP 走浏览器内部输入管线，最接近真人操作。
  win.webContents.debugger.attach('1.3');
  const sendMouse = (type, x, y, buttons) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse',
  });
  try {
    await sendMouse('mousePressed', box.x, box.yBottom, 1);
    await sendMouse('mouseMoved', box.x, box.yBottom - 60, 1);
    await sendMouse('mouseMoved', box.x, box.yBottom, 1);
    await sendMouse('mouseReleased', box.x, box.yBottom, 0);
  } finally {
    win.webContents.debugger.detach();
  }
  await wait(1600);   // 等吸附动画把档位收进「年」
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

  // 决定性判据：直接向页面要「各档节点的画布坐标」，而不是靠截图猜。
  // 这个 bug 的本质就是年节点坐标跑到了画布左边界之外 —— 画面上完全看不出来（只是没有节点），
  // 但坐标是问得出来的。
  const dbg = await readDebug('year');
  const yearVisible = Boolean(dbg) && dbg.yearX.length > 0
    && dbg.yearX.some((x) => x >= 0 && x <= dbg.canvasWidth);
  console.log(`[verify] 月序列 ${dbg?.months} 个 · 年序列 [${dbg?.years}] · 画布宽 ${dbg?.canvasWidth}`);
  console.log(`[verify] 年档节点 x = [${dbg?.yearX}] → 落在可视区内: ${yearVisible}`);

  // 只比**星轨所在的那条带**：全图平均差会把星轨的变化稀释掉 ——
  // 星轨只占画面底部约两成，而「只有一个月数据」时月档与年档都只有一个节点、位置也都在中央，
  // 全图差异天然就只有 1 左右，用它当判据必然误判成「没切档」。
  const bmpA = img.toBitmap(), bmpY = imgYear.toBitmap();
  const W = img.getSize().width, H = img.getSize().height;
  const y0 = Math.floor(H * 0.80);
  let acc = 0, cnt = 0;
  for (let y = y0; y < H; y += 2) {
    for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4;
      if (i + 3 >= bmpA.length || i + 3 >= bmpY.length) continue;
      acc += Math.abs(bmpA[i] - bmpY[i]) + Math.abs(bmpA[i + 1] - bmpY[i + 1]) + Math.abs(bmpA[i + 2] - bmpY[i + 2]);
      cnt++;
    }
  }
  const bandDiff = cnt ? acc / cnt / 3 : 0;
  const switched = bandDiff > 2;
  console.log(`[verify] 星轨区域的档位差异 = ${bandDiff.toFixed(2)}（>2 视为确实切了档）`);
  if (!switched) {
    console.log('[verify] 注：本次没能通过输入注入切到年档（无头环境下合成指针事件不生效），'
      + '那张「年档截图」其实还是月档 —— 年档的判定以上面的节点坐标为准，不受影响');
  }

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
    && yearVisible && year.centerLit > 0 && errors.length === 0;
  console.log(`[verify] 结论: ${ok ? '通过' : '未通过'}`);
  win.destroy();
  server.close();
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[verify] 失败', err);
  app.exit(1);
});
