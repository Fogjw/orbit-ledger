// 移动端 M0 原型截图：390×844（主/洞察/记账）+ 412×915（主）。
// 只读原型文件，不写业务数据；输出到 docs/ui-redesign/review/mobile/。
import { app, BrowserWindow } from 'electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const file = join(root, 'docs/ui-redesign/mobile/index.html');
const outDir = join(root, 'docs/ui-redesign/review/mobile');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(outDir, { recursive: true });
mkdirSync(join(root, '.cache'), { recursive: true });
app.setPath('userData', mkdtempSync(join(root, '.cache/mobile-shots-')));
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  // offscreen：390×844 超过当前显示器工作区高度，show:true 会被系统裁成 684
  const win = new BrowserWindow({
    width: 390, height: 844, show: false, frame: false, backgroundColor: '#070a09',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true },
  });
  const capture = async (name) => {
    await wait(450);
    const img = await win.webContents.capturePage();
    writeFileSync(join(outDir, `${name}.png`), img.toPNG());
    console.log(`[mobile-shot] ${name}.png ${img.getSize().width}×${img.getSize().height}`);
  };
  const js = (code) => win.webContents.executeJavaScript(code);

  await win.loadURL(pathToFileURL(file).href);
  await wait(700);
  await capture('main-390');

  await js(`open('stats')`);
  await capture('stats-390');
  await js(`close(); open('entry')`);
  await capture('entry-390');

  await js(`close()`);
  win.setContentSize(412, 915);
  await wait(500);
  await capture('main-412');

  win.destroy();
  app.quit();
}).catch((err) => { console.error('[mobile-shot] 失败', err); app.exit(1); });
