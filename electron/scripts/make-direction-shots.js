// 阶段 1 方向截图：把三套 style tile（主视图 + 账笺）截成固定尺寸的 review 图。
// 用法：在仓库根 `env -u ELECTRON_RUN_AS_NODE npm run shots:direction`
// 输出到 docs/ui-redesign/review/direction/（不入库），只读，不改任何生产文件。
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const appHtml = join(root, 'docs/ui-redesign/direction/app.html');
const outDir = join(root, 'docs/ui-redesign/review/direction');
const W = Number(process.env.ORBIT_DIRECTION_WIDTH || 1229);
const H = Number(process.env.ORBIT_DIRECTION_HEIGHT || 684);

app.commandLine.appendSwitch('force-device-scale-factor', '1');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: W, height: H,
    show: true, frame: false,
    backgroundColor: '#080b0f',
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  });
  const themes = ['silk', 'brass', 'rubbing'];
  for (const theme of themes) {
    for (const entry of [0, 1]) {
      const url = `${pathToFileURL(appHtml).href}?theme=${theme}${entry ? '&entry=1' : ''}`;
      await win.loadURL(url);
      await wait(500);
      const img = await win.webContents.capturePage();
      const name = `${theme}${entry ? '-entry' : ''}.png`;
      writeFileSync(join(outDir, name), img.toPNG());
      const { width, height } = img.getSize();
      console.log(`[direction] ${name} ${width}×${height}`);
    }
  }
  win.destroy();
}

app.whenReady().then(main).then(() => app.quit()).catch((err) => {
  console.error('[direction] 失败', err);
  app.exit(1);
});
