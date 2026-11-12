// 阶段 0 视觉基线截图：固定 1440×900，输出到 docs/ui-redesign/review/。
//
// 用法：先起服务（cd server && npm run dev），再在仓库根：
//   env -u ELECTRON_RUN_AS_NODE npm run shots:ui
//
// 只打开/关闭界面，不写任何账目；用可丢弃的 demo 库，不碰真实账本。
// 为什么固定窗口：视觉对比必须同尺寸；make-shots.js 用的是主显示器工作区，不适合逐界面 review。
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.env.ORBIT_UI_SHOT_DIR || join(root, 'docs/ui-redesign/review');
const base = process.env.ORBIT_UI_SHOT_URL || 'http://127.0.0.1:5310';
const W = Number(process.env.ORBIT_UI_SHOT_WIDTH || 1440);
const H = Number(process.env.ORBIT_UI_SHOT_HEIGHT || 900);

app.commandLine.appendSwitch('force-device-scale-factor', '1');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: W, height: H,
    show: true, frame: false,
    backgroundColor: '#030510',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  await win.loadURL(base);
  await wait(4000);

  const js = (code) => win.webContents.executeJavaScript(code);
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`);
  const state = async () => JSON.parse(await js(`(() => {
    const q = (s) => document.querySelector(s);
    return JSON.stringify({
      ready: Boolean(q('#mtValue')),
      modal: Boolean(q('#modalMask')) && !q('#modalMask').hidden,
      menu: Boolean(q('#ledgerMenu')) && !q('#ledgerMenu').hidden,
      tagMgr: Boolean(q('#tagMask')) && !q('#tagMask').hidden,
      expList: Boolean(q('#expMask')) && !q('#expMask').hidden,
      view: Boolean(q('#viewMask')) && !q('#viewMask').hidden,
      name: Boolean(q('#nameMask')) && !q('#nameMask').hidden,
      detail: Boolean(q('#btnBack')) && !q('#btnBack').hidden,
      back: (q('#btnBack')?.textContent || '').trim(),
      total: (q('#mtValue')?.textContent || '').trim(),
    });
  })()`));

  const shots = [];
  const shot = async (name) => {
    await js(`document.querySelectorAll('.toast').forEach((el) => el.remove())`);
    await wait(250);
    const st = await state();
    const img = await win.webContents.capturePage();
    const file = join(outDir, `${name}.png`);
    writeFileSync(file, img.toPNG());
    const { width, height } = img.getSize();
    console.log(`[ui-shot] ${name}.png ${width}×${height}`, st);
    shots.push({ name, file, ...st });
    return st;
  };

  const initial = await shot('01-overview');
  if (!initial.ready) throw new Error(`界面未加载：${base}`);

  // 左栏收起：确认按钮可见、图谱让位；随后展开，避免影响后续截图
  await js(`document.querySelector('#panelCollapse')?.click()`);
  await wait(900);
  await shot('09-panel-collapsed');
  await js(`document.querySelector('#panelCollapse')?.click()`);
  await wait(900);

  // 记一笔：浮层有 350ms 入场动画；多等一帧，避免截到 opacity 还是 0 的中间帧
  await click('#btnAdd');
  await wait(1400);
  await shot('02-entry');
  // 命名 + 取色：从记一笔里的「新建品类」打开
  const openedName = await js(`Boolean(document.querySelector('#btnAddCat'))`);
  if (openedName) {
    await click('#btnAddCat');
    await wait(700);
    await shot('08-name');
    await click('#nameClose');
    await wait(400);
  }
  await click('#modalClose');
  await wait(500);

  // 账本下拉
  await click('#ledgerBtn');
  await wait(500);
  await shot('03-ledger-menu');

  // 标签管理
  if (await js(`Boolean(document.querySelector('#ddManageTags'))`)) {
    await click('#ddManageTags');
    await wait(700);
    await shot('04-tag-manager');
    await click('#tagClose');
    await wait(400);
  }
  await js(`(() => { const m = document.querySelector('#ledgerMenu'); if (m) m.hidden = true; return true; })()`);
  await wait(300);

  // 花销明细：从左侧 TOP 分类点进去
  const openedList = await js(`(() => {
    const row = [...document.querySelectorAll('#topList .top-row')][0];
    if (!row) return false;
    row.click();
    return true;
  })()`);
  if (openedList) {
    await wait(900);
    await shot('05-expense-list');
    // 从明细点一笔，截「账单详情」——只读视图，关闭后回到明细
    const openedView = await js(`(() => {
      const row = document.querySelector('#expList .e-row');
      if (!row) return false;
      row.click();
      return true;
    })()`);
    if (openedView) {
      await wait(800);
      await shot('07-view-detail');
      await click('#viewClose');
      await wait(500);
    }
    await click('#expDone');
    await wait(500);
  } else {
    console.log('[ui-shot] 没有 TOP 分类，跳过 05-expense-list');
  }

  // 下钻：优先选「副 tag 最多」的主 tag（演示库里通常是餐饮），再按真实坐标点击
  const richName = process.env.ORBIT_UI_SHOT_TAG || await js(`(() => {
    const roots = [];
    for (const tree of Object.values(window.OrbitData?.dims || {})) roots.push(...(tree.roots || []));
    const rich = roots
      .filter((r) => (r.children || []).length > 0)
      .sort((a, b) => (b.children || []).length - (a.children || []).length)[0];
    return rich ? rich.name : '';
  })()`);
  const graph = JSON.parse(await js(`JSON.stringify(
    window.OrbitDebug && window.OrbitDebug.graph ? window.OrbitDebug.graph() : null
  )`));
  const candidates = (graph?.nodes || []).filter((n) => n.kind === 'cat' && n.amount > 0
    && n.screenX > 300 && n.screenX < W - 120 && n.screenY > 120 && n.screenY < H - 220)
    .sort((a, b) => (b.name === richName) - (a.name === richName) || b.amount - a.amount);
  const clickAt = async (x, y) => {
    win.webContents.debugger.attach('1.3');
    try {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
      });
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
      });
    } finally {
      win.webContents.debugger.detach();
    }
  };
  let entered = false;
  for (const n of candidates.slice(0, 8)) {
    await clickAt(n.screenX, n.screenY);
    await wait(1200);
    if ((await state()).detail) {
      await wait(1800);
      await shot('06-detail');
      entered = true;
      break;
    }
  }
  if (!entered) console.log('[ui-shot] 没有点中主 tag，跳过 06-detail（检查数据或坐标）');
  await click('#btnBack');
  await wait(600);

  // 拖宽左栏：用 CDP 真实鼠标拖动右缘 handle，截图确认栏宽和星图重排
  const pr = JSON.parse(await js(`(() => {
    const el = document.querySelector('#panelResize');
    if (!el) return JSON.stringify(null);
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.right - 2), y: Math.round(r.top + 100) });
  })()`));
  if (pr) {
    win.webContents.debugger.attach('1.3');
    try {
      const send = (type, x, y, buttons) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse',
      });
      await send('mousePressed', pr.x, pr.y, 1);
      await send('mouseMoved', pr.x + 54, pr.y, 1);
      await send('mouseReleased', pr.x + 54, pr.y, 0);
    } finally {
      win.webContents.debugger.detach();
    }
    await wait(900);
    await shot('10-panel-wide');

    // 再向左收窄到接近下限，确认内容不被裁掉
    const pr2 = JSON.parse(await js(`(() => {
      const el = document.querySelector('#panelResize');
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.right - 2), y: Math.round(r.top + 100) });
    })()`));
    win.webContents.debugger.attach('1.3');
    try {
      const send = (type, x, y, buttons) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse',
      });
      await send('mousePressed', pr2.x, pr2.y, 1);
      await send('mouseMoved', pr2.x - 120, pr2.y, 1);
      await send('mouseReleased', pr2.x - 120, pr2.y, 0);
    } finally {
      win.webContents.debugger.detach();
    }
    await wait(900);
    await shot('11-panel-narrow');
  }

  // 拉高星轨：确认 Canvas 缓冲区跟着高度走，节点不会变椭圆
  const tr = JSON.parse(await js(`(() => {
    const el = document.querySelector('#timelineResize');
    if (!el) return JSON.stringify(null);
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 2) });
  })()`));
  if (tr) {
    win.webContents.debugger.attach('1.3');
    try {
      const send = (type, x, y, buttons) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse',
      });
      await send('mousePressed', tr.x, tr.y, 1);
      await send('mouseMoved', tr.x, tr.y - 200, 1);
      await wait(350);
      await shot('13-timeline-dragging');
      await send('mouseReleased', tr.x, tr.y - 200, 0);
    } finally {
      win.webContents.debugger.detach();
    }
    await wait(900);
    await shot('12-timeline-tall');
  }

  writeFileSync(join(outDir, '00-state.json'), JSON.stringify({
    base, size: [W, H], capturedAt: new Date().toISOString(), shots,
  }, null, 2));
  console.log(`[ui-shot] ${shots.length} 张 → ${outDir}`);
  win.destroy();
}

app.whenReady().then(main).then(() => app.quit()).catch((err) => {
  console.error('[ui-shot] 失败', err);
  app.exit(1);
});
