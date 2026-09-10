// 应用图标生成：assets/icon.svg → assets/icon.png（512×512，圆角外保持透明）
// 为什么用 Electron 自己渲染：本项目零图形依赖（不引 sharp / node-canvas 这类需要原生编译的库，
// 沙箱装不了），而 Electron 本来就在手边 —— 它的 Chromium 就是最准的 SVG 光栅化器。
// 用法：npm run make:icon（仓库根）
import { app, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SIZE = 512;

// 固定 1:1 像素比：否则系统 DPI 缩放（本机实测 150%）会把 512 截成 770×770，
// 同一份 SVG 在不同机器上产出不同尺寸的图标，既没法比对也污染 diff。
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const svg = await readFile(join(root, 'assets/icon.svg'), 'utf8');
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`;

  const win = new BrowserWindow({
    width: SIZE, height: SIZE,
    show: false, frame: false,
    transparent: true,                 // 圆角外的透明必须保留，否则桌面图标是黑方块
    backgroundColor: '#00000000',
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));   // 等渐变与描边画完再截

  const img = await win.webContents.capturePage();
  const out = join(root, 'assets/icon.png');
  await writeFile(out, img.toPNG());
  const { width, height } = img.getSize();
  console.log(`[icon] 已生成 assets/icon.png（${width}×${height}）`);
  app.quit();
}).catch((err) => {
  console.error('[icon] 生成失败：', err);
  app.exit(1);
});
