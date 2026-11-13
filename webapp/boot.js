// 纯前端版入口：选数据目录 → 打开本地数据库 → 挂上 OrbitAPI → 再加载界面脚本。
//
// 为什么必须先初始化、后加载界面：web/data.js 在**顶层**就取走 window.OrbitAPI，
// 脚本一旦开始执行就定型了，所以本地 API 必须在它之前就位 —— 这也是这里用动态插 script
// 而不是直接在 HTML 里写 <script src> 的原因。
import { createLocalApi } from './api-local.js';
import { createStorage, isFileAccessSupported, pickDirectory, ensurePermission, rememberedDirectory, hasDirectoryPermission } from './storage.js';
import { showGate } from './gate.js';

const UI_SCRIPTS = ['data.js', 'timeline-nav.js', 'app.js'];   // 顺序不能反：app.js 依赖前两个
const WASM_DIR = new URL('./sqlite-wasm/', import.meta.url).href;
const WASM_URL = new URL('./sqlite-wasm/sql-wasm.wasm', import.meta.url).href;
const STORAGE_MODE_KEY = 'orbit.storage.mode';

function savedStorageMode() {
  try { return localStorage.getItem(STORAGE_MODE_KEY); } catch { return null; }
}
function rememberStorageMode(mode) {
  try { localStorage.setItem(STORAGE_MODE_KEY, mode); } catch {}
}

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
  const canUseFile = isFileAccessSupported();
  const remembered = await rememberedDirectory().catch(() => null);
  let gate = null;

  const openGate = (reason = '') => {
    if (gate) return gate;
    gate = showGate({
      canUseFile,
      remembered: Boolean(remembered),
      reason,
      onPick: chooseDirectory,
      onReauth: reauthorizeDirectory,
      onFallback: useBrowserStorage,
      onChooseOther: chooseDirectory,
    });
    return gate;
  };

  async function proceed(storage, currentGate) {
    currentGate?.setBusy(true);
    try {
      const bytes = await storage.read();
      await mount({ bytes, storage });
      currentGate?.close();
    } catch (err) {
      console.error('[webapp] 存储启动失败', err);
      if (currentGate) {
        currentGate.setError(`启动失败：${err.message}`);
        currentGate.setBusy(false);
      } else {
        openGate(`启动失败：${err.message}`);
      }
    }
  }

  async function chooseDirectory() {
    if (!canUseFile) return;
    gate?.setBusy(true);
    try {
      const handle = await pickDirectory();
      rememberStorageMode('file');
      await proceed(createStorage({ mode: 'file', dir: handle }), gate);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        gate?.setBusy(false);
        return;
      }
      gate?.setError(`选择目录失败：${err.message}`);
      gate?.setBusy(false);
    }
  }

  async function reauthorizeDirectory() {
    if (!remembered) return;
    gate?.setBusy(true);
    try {
      const granted = await ensurePermission(remembered);
      if (!granted) {
        gate?.setError('没有获得目录权限。可以重试，或改用浏览器存储。');
        gate?.setBusy(false);
        return;
      }
      rememberStorageMode('file');
      await proceed(createStorage({ mode: 'file', dir: remembered }), gate);
    } catch (err) {
      gate?.setError(`重新授权失败：${err.message}`);
      gate?.setBusy(false);
    }
  }

  async function useBrowserStorage() {
    gate?.setBusy(true);
    rememberStorageMode('idb');
    await proceed(createStorage({ mode: 'idb' }), gate);
  }

  // 浏览器存储一旦选定，下次必须直接进入；否则 Android/网页每次启动都回到 gate，
  // 用户会以为数据丢了。文件模式仍以「目录句柄 + 权限」为准。
  if (savedStorageMode() === 'idb') {
    await proceed(createStorage({ mode: 'idb' }), null);
    return;
  }

  // 已记住且权限仍有效：不打扰用户，直接复用原目录。
  if (canUseFile && remembered && await hasDirectoryPermission(remembered)) {
    rememberStorageMode('file');
    await proceed(createStorage({ mode: 'file', dir: remembered }), null);
    return;
  }

  openGate(
    canUseFile && remembered ? '上次的数据目录需要重新授权。' : '',
  );
}

main().catch((err) => {
  console.error('[webapp] 启动失败', err);
  const reason = document.querySelector('#orbitGateReason');
  if (reason) {
    reason.textContent = `启动失败：${err.message}`;
    reason.hidden = false;
  } else {
    showGate({
      canUseFile: isFileAccessSupported(),
      remembered: false,
      reason: `启动失败：${err.message}`,
      onPick: () => location.reload(),
      onFallback: () => location.reload(),
    });
  }
});
