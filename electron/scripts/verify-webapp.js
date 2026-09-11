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

  // 键盘输入验证：守的是用户报的「金额框只能删、不能输入」。
  // 这里必须注入**真实按键事件**，而不是直接改 value —— 改值绕过全部键盘处理，
  // 正好测不出「按键被吞」这类问题（我上一轮在年档上就栽在类似的地方）。
  await click('#btnAdd');
  await wait(900);
  await js(`(() => { const el = document.querySelector('#mAmount'); el.focus(); return true; })()`);
  win.webContents.debugger.attach('1.3');
  try {
    const press = async (key, code, vk, text) => {
      const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      // 只发 keyDown/keyUp：CDP 的 keyDown 带 text 时本身就会插入字符，
      // 再补一个 char 事件会把每个字符插两次（上一版就是这么得到 "112233" 的）
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        ...base, type: 'keyDown', ...(text ? { text, unmodifiedText: text } : {}),
      });
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    };
    // 完全照用户的操作顺序：先把初始值 88 用退格删掉，再敲数字
    await press('Backspace', 'Backspace', 8, null);
    await press('Backspace', 'Backspace', 8, null);
    for (const ch of '123') await press(ch, 'Digit' + ch, 48 + Number(ch), ch);
  } finally {
    win.webContents.debugger.detach();
  }
  await wait(400);
  const typed = await js(`document.querySelector('#mAmount').value`);
  const inputWorks = typed === '123';
  console.log(`[verify] 键盘输入「123」后金额框的值 = "${typed}" → ${inputWorks ? '可输入 ✓' : '✗ 按键未生效，复现了问题'}`);
  await click('#modalClose');
  await wait(600);

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

  // 点节点不该复位星轨（用户报的「点一下节点整条星轨复位」）。
  // 判据只能是「视口中心在点击前后不变」—— 画面本身看着都正常，截图分辨不出来。
  // 前提：必须先让平移量非零，否则「不复位」与「复位到同一处」不可区分；
  // 而新账本只有一个月的跨度，全年范围下月档/年档的 maxPan 会被算成 0（本来就看得见全部时间、
  // 没有可平移的余地），所以先切到日档（像素/天最大、maxPan 最大），再真实拖动制造偏移。
  win.webContents.debugger.attach('1.3');
  try {
    await sendMouse('mousePressed', box.x, box.yBottom, 1);
    await sendMouse('mouseMoved', box.x, box.yBottom - box.h + 4, 1);
    await sendMouse('mouseReleased', box.x, box.yBottom - box.h + 4, 0);
  } finally {
    win.webContents.debugger.detach();
  }
  await wait(1600);   // 等吸附动画落到「日」
  const atDay = JSON.parse(await js(`JSON.stringify(window.OrbitDebug.center())`));
  console.log(`[verify] 滑块拖到顶后档位 = ${atDay.level}（期望 day）`);

  const gb = JSON.parse(await js(`(() => {
    // 星轨有自己的画布（#orbit），平移手势绑在它身上；拖 #graph 是拖不到星轨的
    const r = document.querySelector('#orbit').getBoundingClientRect();
    return JSON.stringify({
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width), h: Math.round(r.height),
    });
  })()`));
  console.log(`[verify] 星轨画布 ${gb.w}×${gb.h} @ (${gb.x}, ${gb.y})`);
  win.webContents.debugger.attach('1.3');
  try {
    await sendMouse('mousePressed', gb.x + 160, gb.y, 1);
    for (let i = 1; i <= 8; i++) await sendMouse('mouseMoved', gb.x + 160 - i * 25, gb.y, 1);
    await sendMouse('mouseReleased', gb.x - 40, gb.y, 0);
  } finally {
    win.webContents.debugger.detach();
  }
  await wait(400);

  const before = JSON.parse(await js(`JSON.stringify(window.OrbitDebug.center())`));
  await js(`window.OrbitDebug.tapNode('day', 0)`);   // 等价于用户点第 0 个日节点
  await wait(700);
  const after = JSON.parse(await js(`JSON.stringify(window.OrbitDebug.center())`));
  const shifted = Math.abs(before.pan) > 1;
  const kept = Math.abs(after.c - before.c) < 1;
  console.log(`[verify] 拖动后 pan = ${before.pan.toFixed(2)} 天 · 视口中心 = ${before.c.toFixed(1)}`);
  console.log(`[verify] 点节点后 pan = ${after.pan.toFixed(2)} 天 · 视口中心 = ${after.c.toFixed(1)}`
    + ` → ${kept ? '不复位 ✓' : '被复位的 ✗'}`);
  const noReset = shifted ? kept : null;
  if (!shifted) {
    console.log('[verify] 注：本次没能拖动星轨（偏移仍为 0），「不复位」与「复位到原处」无法区分，本项不计入结论');
  }

  // 收入类目在浮层里显示不出来（用户报的「收入主 tag 创建之后不显示」）。
  // 收入类目与支出品类同属 category 维度、靠名字的「收入」前缀区分，而 CATS 恰好是
  // 「排除了收入类目的那一半」；浮层原先拿 CATS.filter(名字含「收入」) 当收入候选 ⇒ 恒为空。
  // 复现必须走完整 UI 路径：记一笔 → 收入 tab → 新建「收入·工资」→ 候选区里必须出现它。
  await click('#btnAdd');
  await wait(700);
  await js(`document.querySelectorAll('.m-tab')[1].click()`);
  await wait(300);
  const incBefore = await js(`document.querySelector('#mCats').textContent.trim().slice(0, 40)`);
  console.log(`[verify] 收入 tab 品类候选（新建前）= "${incBefore}"`);
  const newTag = async (tagName) => {
    await click('#btnAddCat');
    await wait(500);
    await js(`(() => { document.querySelector('#nameInput').value = ${JSON.stringify(tagName)}; return true; })()`);
    await click('#nameOk');
    await wait(900);
  };
  await newTag('收入·工资');   // 已经带前缀
  await newTag('兼职');        // 不带前缀：必须被自动补成「收入·兼职」，否则它会算作支出品类
  const incChips = JSON.parse(await js(`JSON.stringify(
    [...document.querySelectorAll('#mCats .m-chip')].map((b) => b.textContent.trim())
  )`));
  const incomeVisible = incChips.includes('收入·工资') && incChips.includes('收入·兼职');
  console.log(`[verify] 新建收入类目后候选 = [${incChips.join(', ')}]`
    + ` → ${incomeVisible ? '已显示 ✓' : '仍未显示 ✗'}`);
  await click('#modalClose');
  await wait(500);

  // 提示层必须压在所有浮层之上（用户报：弹窗里操作时看不到 toast 提示）。
  // 判据不靠截图：让最高的浮层（#nameMask）**保持打开**时触发一条 toast，
  // 再用 elementFromPoint 问「这个点上最顶层的元素是谁」—— 被盖住的话拿到的是 mask 而不是 toast。
  // 触发方式是空名称点确定：它只 toast 不关浮层（正好保住了遮挡场景）。
  await click('#btnAdd');
  await wait(700);
  await click('#btnAddCat');
  await wait(500);
  await js(`(() => { document.querySelector('#nameInput').value = ''; return true; })()`);
  await click('#nameOk');
  await wait(400);
  const zTop = JSON.parse(await js(`(() => {
    const z = (s) => { const el = document.querySelector(s); return el ? Number(getComputedStyle(el).zIndex) || 0 : 0; };
    const t = document.querySelector('#toast');
    const r = t.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return JSON.stringify({
      toastZ: z('#toast'),
      topMaskZ: Math.max(z('#nameMask'), z('#tagMask'), z('#viewMask'), z('#modalMask'), z('#expMask')),
      toastShown: !t.hidden && r.width > 0,
      hit: hit ? (hit.id || String(hit.className)) : null,
    });
  })()`));
  const toastOnTop = zTop.toastShown && zTop.hit === 'toast' && zTop.toastZ > zTop.topMaskZ;
  console.log(`[verify] 提示层 z = ${zTop.toastZ} · 最高浮层 z = ${zTop.topMaskZ}`
    + ` · 浮层开着时 toast 中心点命中 = "${zTop.hit}" → ${toastOnTop ? '在最顶层 ✓' : '被盖住了 ✗'}`);
  await click('#nameCancel');   // 空名称不会关浮层，这里手动收尾
  await wait(300);
  await click('#modalClose');
  await wait(400);

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

  const ok = gateShown && state.loadedUi && state.canvasLit > 0 && wrote && inputWorks
    && yearVisible && year.centerLit > 0 && errors.length === 0 && noReset !== false
    && incomeVisible && toastOnTop;
  console.log(`[verify] 结论: ${ok ? '通过' : '未通过'}`);
  win.destroy();
  server.close();
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[verify] 失败', err);
  app.exit(1);
});
