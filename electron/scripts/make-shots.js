// 演示截图：把正在跑的本地服务页面截成 PNG，供 README 使用
// 为什么用 Electron 而不是系统截屏工具：窗口尺寸、缩放比、等待时机都可控 ——
// 同一份脚本在任何机器上产出一致的图，不会带进桌面背景、鼠标指针或系统的 DPI 缩放。
//
// 两个必须记住的坑：
//  1) 窗口要**真的显示**：隐藏窗口时 Chromium 不合成新帧，capturePage() 会反复返回最后那一帧，
//     表现为「切了视图但截出来没变」（canvas 内部其实已经重绘，getImageData 读得到新画面）。
//  2) 每张图截之前自检界面状态并清掉 toast，避免拍到没打开、或带欢迎提示的帧。
//
// 用法：先起服务（cd server && npm run dev），再在仓库根 `npm run shots`
//      可用 ORBIT_SHOT_TAG=交通 指定下钻目标（默认挑素材最丰富的那个主 tag）
import { app, BrowserWindow, screen } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'docs/screenshots');
const BASE = process.env.ORBIT_SHOT_URL || 'http://127.0.0.1:5310';
const TARGET_TAG = process.env.ORBIT_SHOT_TAG || '餐饮';   // 当月 24 笔、8 种副 tag，下钻图素材最丰富

// 与 make-icon 同理：固定 1:1 像素比，否则系统 DPI 缩放会让输出尺寸随机器变化
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 当月区间（YYYY-MM-01 ~ 月末） */
function monthRange() {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth();
  const p = (n) => String(n).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${p(m + 1)}-01`, to: `${y}-${p(m + 1)}-${p(last)}` };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { width: SW, height: SH } = screen.getPrimaryDisplay().workAreaSize;   // 全屏（不含任务栏）

  const win = new BrowserWindow({
    width: SW, height: SH,
    show: true, frame: false,          // 必须真显示，理由见文件头
    backgroundColor: '#030510',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      backgroundThrottling: false,     // 顺带关掉后台节流，让动画在截图期间继续推进
    },
  });

  await win.loadURL(BASE);
  await wait(4000);   // 等星图入场动画跑完：动画期间截会拍到半透明的中间帧

  const js = (code) => win.webContents.executeJavaScript(code);
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`);
  const isHidden = (sel) => js(`document.querySelector('${sel}')?.hidden !== false`);
  const textOf = (sel) => js(`(document.querySelector('${sel}')?.textContent || '').trim()`);

  /** 页面当前状态：证明每张截图确实对应预期的界面状态 */
  const state = async () => JSON.parse(await js(`(() => {
    const c = document.querySelector('#graph');
    let lit = -1;
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      lit = 0;
      for (let i = 3; i < d.length; i += 4 * 211) if (d[i] > 16) lit++;
    } catch (e) { /* 读不到像素就记 -1 */ }
    return JSON.stringify({
      modal: !document.querySelector('#modalMask').hidden,
      menu: !document.querySelector('#ledgerMenu').hidden,
      detail: !document.querySelector('#btnBack').hidden,
      backLabel: (document.querySelector('#btnBack')?.textContent || '').trim(),
      total: (document.querySelector('#mtValue')?.textContent || '').trim(),
      canvasLit: lit,
    });
  })()`));

  /** 截图：先清掉 toast（页面的欢迎提示会挂在画面上好几秒），再报一次状态 */
  const shot = async (name) => {
    await js(`document.querySelectorAll('.toast').forEach((el) => el.remove())`);
    await wait(200);
    const st = await state();
    const img = await win.webContents.capturePage();
    writeFileSync(join(outDir, name), img.toPNG());
    const { width, height } = img.getSize();
    console.log(`[shot] ${name} ${width}×${height} · 弹窗=${st.modal} 下拉=${st.menu} 下钻=${st.detail}${st.backLabel ? ' (' + st.backLabel + ')' : ''} · 总额=${st.total} · 星图着色采样=${st.canvasLit}`);
    return st;
  };

  const first = await shot('overview.png');

  // 记一笔浮层
  await click('#btnAdd');
  await wait(1000);
  await shot('entry.png');
  await click('#modalClose');
  await wait(700);

  // 账本下拉：顺带展示导出/导入备份、标签管理等入口
  await click('#ledgerBtn');
  await wait(1000);
  await shot('ledger-menu.png');
  await click('#ledgerBtn');
  await wait(700);

  // ---- L3 下钻 ----
  // canvas 上的节点没有 DOM 可点，但 L1 布局是确定性的（金额降序沿弧线排布，见 web/app.js 的 buildGraph），
  // 所以：按同一套公式算出目标节点位置 → 邻域兜底 → 用「返回按钮上的名字」验证命中，
  // 点错了就退回主视图换下一个点。判据来自页面本身，不靠猜。
  const ledgers = await (await fetch(`${BASE}/api/ledgers`)).json();
  const { from, to } = monthRange();
  const stats = await (await fetch(`${BASE}/api/ledgers/${ledgers[0].id}/stats?from=${from}&to=${to}`)).json();
  // 前端 CATS 只含支出品类（收入类目走单独的底部一行）
  const cats = (stats.byDimension.category || [])
    .filter((c) => !String(c.name).startsWith('收入'))
    .sort((a, b) => b.amount_cents - a.amount_cents);
  const idx = cats.findIndex((c) => c.name === TARGET_TAG);

  const geo = JSON.parse(await js(`(() => {
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    const tl = document.querySelector('.timeline').getBoundingClientRect();
    return JSON.stringify({ w: innerWidth, h: innerHeight, top: tb.bottom, orbitTop: tl.top });
  })()`));
  const X0 = 300, X1 = geo.w - 60, Y0 = geo.top + 26, Y1 = geo.orbitTop - 44;

  const spots = [];
  if (idx >= 0 && cats.length > 1) {
    const nx = 0.14 + 0.72 * (idx / (cats.length - 1));
    const ny = 0.44 + 0.27 * Math.sin(idx * 1.2 + 0.6);
    const cx = Math.round(X0 + nx * (X1 - X0)), cy = Math.round(Y0 + ny * (Y1 - Y0));
    console.log(`[shot] 目标「${TARGET_TAG}」为金额第 ${idx + 1} 位 → 估算坐标 (${cx}, ${cy})`);
    for (let dy = -40; dy <= 40; dy += 40) for (let dx = -40; dx <= 40; dx += 40) spots.push([cx + dx, cy + dy]);
  } else {
    console.log(`[shot] 未在当月数据里找到「${TARGET_TAG}」，退回网格扫描`);
    for (let y = 160; y <= 560; y += 80) for (let x = 340; x <= 1200; x += 80) spots.push([x, y]);
  }

  let hit = null;
  for (const [x, y] of spots) {
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await wait(600);
    if ((await isHidden('#btnBack')) === false) {
      const label = await textOf('#btnBack');
      if (label.includes(TARGET_TAG)) { hit = label; break; }
      await click('#btnBack');    // 点进了别的主 tag：退回主视图换下一个点
      await wait(500);
    }
  }

  if (hit) {
    await wait(2600);   // 等下钻图的节点入场动画跑完
    const d = await shot('detail.png');
    if (d.canvasLit === first.canvasLit) console.log('[shot] ⚠ detail.png 与主视图的着色采样相同，可能是没重绘');
  } else {
    console.log(`[shot] 没点中「${TARGET_TAG}」，跳过 detail.png`);
  }

  app.quit();
}

app.whenReady().then(main).catch((err) => { console.error('[shot] 失败', err); app.exit(1); });
