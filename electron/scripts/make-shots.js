// 演示截图：把正在跑的本地页面截成 PNG，供 README 使用
// 为什么用 Electron 而不是系统截屏工具：窗口尺寸、缩放比、等待时机都可控 ——
// 同一份脚本在任何机器上产出一致的图，不会带进桌面背景、鼠标指针或系统的 DPI 缩放。
// 每张图截之前都自检一次页面状态（弹窗/下拉是否真打开、星图 canvas 是否真的画了东西），
// 截图最怕「截到加载中或没打开」的帧 —— 让脚本把状态打出来，就不必靠肉眼逐张核对。
// 用法：先起服务（cd server && npm run dev），再在仓库根 npm run shots
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'docs/screenshots');
const BASE = process.env.ORBIT_SHOT_URL || 'http://127.0.0.1:5310';
const W = 1280, H = 800;

// 与 make-icon 同理：固定 1:1 像素比，否则系统 DPI 缩放会让输出尺寸随机器变化
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: W, height: H, show: false, frame: false,
    backgroundColor: '#030510',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  await win.loadURL(BASE);
  await wait(3800);   // 等星图入场动画跑完：动画期间截会拍到半透明的中间帧

  const click = (sel) => win.webContents.executeJavaScript(`document.querySelector('${sel}')?.click()`);
  const readProp = (sel, prop) =>
    win.webContents.executeJavaScript(`(() => { const el = document.querySelector('${sel}'); return el ? el.${prop} : null; })()`);

  /** 页面当前状态：用于证明每张截图确实对应预期的界面状态 */
  const state = async () => JSON.parse(await win.webContents.executeJavaScript(`(() => {
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
      total: (document.querySelector('#mtValue')?.textContent || '').trim(),
      canvasLit: lit,
    });
  })()`));

  const shot = async (name) => {
    const st = await state();
    const img = await win.webContents.capturePage();
    writeFileSync(join(outDir, name), img.toPNG());
    const { width, height } = img.getSize();
    console.log(`[shot] ${name} ${width}×${height} · 弹窗=${st.modal} 下拉=${st.menu} 下钻=${st.detail} · 总额=${st.total} · 星图着色像素采样=${st.canvasLit}`);
  };

  await shot('overview.png');

  // 记一笔浮层（DOM 上的按钮，点击稳定）
  await click('#btnAdd');
  await wait(900);
  await shot('entry.png');
  await click('#modalClose');
  await wait(600);

  // 账本下拉：顺带展示导出/导入备份、标签管理等入口
  await click('#ledgerBtn');
  await wait(900);
  await shot('ledger-menu.png');
  await click('#ledgerBtn');
  await wait(600);

  // L3 下钻：类目节点画在 canvas 上，没有 DOM 可点，只能按屏幕坐标扫。
  // 命中信号是「返回主视图按钮出现」—— 这是页面自己给出的确定反馈，
  // 比猜测坐标可靠；扫不到也只是少一张图，不影响其它截图。
  let entered = false;
  for (let y = 180; y <= 540 && !entered; y += 60) {
    for (let x = 280; x <= 1020 && !entered; x += 60) {
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await wait(260);
      if ((await readProp('#btnBack', 'hidden')) === false) entered = true;
    }
  }
  if (entered) {
    await wait(1500);
    await shot('detail.png');
  } else {
    console.log('[shot] 未点中类目节点，跳过 detail.png（可手动进入下钻后重跑）');
  }

  app.quit();
}

app.whenReady().then(main).catch((err) => { console.error('[shot] 失败', err); app.exit(1); });
