// 纯前端版入口：选数据目录 → 打开本地数据库 → 挂上 OrbitAPI → 再加载界面脚本。
//
// 为什么必须先初始化、后加载界面：web/data.js 在**顶层**就取走 window.OrbitAPI，
// 脚本一旦开始执行就定型了，所以本地 API 必须在它之前就位 —— 这也是这里用动态插 script
// 而不是直接在 HTML 里写 <script src> 的原因。
import { createLocalApi } from './api-local.js';
import { createStorage, isFileAccessSupported, pickDirectory, restoreDirectory, ensurePermission } from './storage.js';

const UI_SCRIPTS = ['data.js', 'app.js'];   // 顺序不能反：app.js 依赖 data.js
const WASM_DIR = new URL('./sqlite-wasm/', import.meta.url).href;
const WASM_URL = new URL('./sqlite-wasm/sql-wasm.wasm', import.meta.url).href;

/** 自己把 wasm 取回来交给 sql.js，不让它猜路径（原因见 sqlite-browser.js 的注释） */
async function loadWasm() {
  const res = await fetch(WASM_URL);
  if (!res.ok) throw new Error(`SQLite wasm 加载失败：HTTP ${res.status}`);
  return res.arrayBuffer();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`脚本加载失败：${src}`));
    document.body.appendChild(s);
  });
}

/** 引导层：File System Access 的授权必须由用户手势触发，所以首次进入要先点一下 */
function showGate({ reason, onPick, onFallback }) {
  const mask = document.createElement('div');
  mask.id = 'orbitGate';
  mask.style.cssText = 'position:fixed;inset:0;z-index:999;display:grid;place-items:center;'
    + 'background:rgba(3,5,16,.92);backdrop-filter:blur(6px);font-family:system-ui,"Microsoft YaHei",sans-serif;color:#e8eefc';
  mask.innerHTML = `
    <div style="max-width:520px;padding:28px 30px;border-radius:20px;border:1px solid rgba(130,165,225,.22);
                background:rgba(12,17,32,.9);box-shadow:0 20px 60px rgba(0,0,0,.5);line-height:1.75">
      <h1 style="margin:0 0 6px;font-size:20px">Orbit 星账 <span style="color:#5ad7ff">· 纯前端版</span></h1>
      <p style="margin:0 0 16px;color:#8b96b5;font-size:13px">
        数据存在<strong style="color:#c4cde6">这台设备</strong>上，不上传、不联网同步。请选择账本数据的存放位置。
      </p>
      <p id="orbitGateReason" style="margin:0 0 18px;color:#ffd166;font-size:12.5px">${reason || ''}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button id="orbitPickDir" style="flex:1;min-width:200px;padding:12px 16px;border-radius:12px;border:0;cursor:pointer;
                font:600 13px system-ui;color:#fff;background:linear-gradient(135deg,#2f7df0,#7b5cf0)">选择数据目录（推荐）</button>
        <button id="orbitUseIdb" style="padding:12px 16px;border-radius:12px;cursor:pointer;font:600 13px system-ui;
                color:#c4cde6;background:rgba(255,255,255,.04);border:1px solid rgba(130,165,225,.28)">用浏览器存储</button>
      </div>
      <p style="margin:16px 0 0;color:#5d6784;font-size:11.5px;line-height:1.7">
        选择目录后，账本会写成该目录里的 <code style="color:#9be9ff">orbit.db</code> —— 真实文件，可备份、可拷到别的设备。<br>
        浏览器存储则藏在浏览器内部（清站点数据会丢），需要自己定期导出备份。
      </p>
    </div>`;
  document.body.appendChild(mask);
  mask.querySelector('#orbitPickDir').onclick = onPick;
  mask.querySelector('#orbitUseIdb').onclick = onFallback;
  return () => mask.remove();
}

/** 初始化完成：挂 API、加载界面脚本、兜住未落盘的写入 */
async function mount({ bytes, storage }) {
  const api = await createLocalApi({
    bytes,
    wasmBinary: await loadWasm(),
    locateFile: (file) => WASM_DIR + file,   // 仅作为回退
    persist: (b) => storage.write(b),
  });
  window.OrbitAPI = api;
  window.OrbitStorage = storage;       // 界面上可以显示「数据存哪了」
  for (const src of UI_SCRIPTS) await loadScript(src);
  // 关闭页面前把排队中的写入刷出去（写文件是异步的，不能靠它自己赶在卸载前完成）
  addEventListener('pagehide', () => { storage.flush().catch(() => {}); });
  addEventListener('beforeunload', () => { storage.flush().catch(() => {}); });
}

async function main() {
  // 情况一：已经选过目录且权限还在 —— 直接进入
  const dir = await restoreDirectory().catch(() => null);
  if (dir) {
    const storage = createStorage({ mode: 'file', dir });
    await mount({ bytes: await storage.read(), storage });
    return;
  }

  // 情况二：需要用户点一下（首次，或浏览器把持久权限收回了）
  const canUseFile = isFileAccessSupported();
  const close = showGate({
    reason: canUseFile
      ? (dir ? '浏览器需要你再次确认该目录的读写权限。' : '')
      : '当前浏览器不支持直接写本地文件（仅 Chrome / Edge 支持），将使用浏览器内部存储。',
    onPick: async () => {
      try {
        const handle = await pickDirectory();
        close();
        const storage = createStorage({ mode: 'file', dir: handle });
        await mount({ bytes: await storage.read(), storage });
      } catch (err) {
        if (err && err.name === 'AbortError') return;    // 用户取消了，留在引导页
        document.querySelector('#orbitGateReason').textContent = `选择目录失败：${err.message}`;
      }
    },
    onFallback: async () => {
      close();
      const storage = createStorage({ mode: 'idb' });
      await mount({ bytes: await storage.read(), storage });
    },
  });
}

main().catch((err) => {
  console.error('[webapp] 启动失败', err);
  const reason = document.querySelector('#orbitGateReason');
  if (reason) reason.textContent = `启动失败：${err.message}`;
  else showGate({ reason: `启动失败：${err.message}`, onPick: () => location.reload(), onFallback: () => location.reload() });
});
