// 数据落盘：把整库字节保存到「这台设备」上。两条路径，能力不同但接口一致：
//
//  1) File System Access API（Chrome/Edge）：用户选一个目录，数据写成该目录里的真实 orbit.db 文件。
//     优点：看得见、能备份、能拷到别的设备、能换工具打开；句柄存进 IndexedDB，下次不用重选。
//     缺点：仅 Chromium 系支持，且首次授权必须由用户手势触发。
//  2) IndexedDB（降级）：数据存浏览器内部，用户看不到文件，清站点数据即丢失 —— 所以会主动提示导出备份。
//
// 两者对外只暴露同一组方法：read() / write(bytes) / describe()，上层不关心用的是哪条路。
const DB_FILE = 'orbit.db';
const IDB_NAME = 'orbit-ledger';
const IDB_STORE = 'handles';
const IDB_KEY_BYTES = 'db-bytes';
const IDB_KEY_DIR = 'dir-handle';

/** 是否支持直接读写真实文件 */
export function isFileAccessSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// ---- 极简 IndexedDB 封装（只为存一段字节和一个句柄，不值得引库） ----
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    tx.onsuccess = () => resolve(tx.result);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbSet(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const store = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** 让用户挑一个目录（必须在用户手势里调用）；选完把句柄记住，下次自动复用 */
export async function pickDirectory() {
  const dir = await window.showDirectoryPicker({ id: 'orbit-data', mode: 'readwrite', startIn: 'documents' });
  await idbSet(IDB_KEY_DIR, dir);
  return dir;
}

/** 取回上次选的目录；权限若已失效返回 null（调用方再决定要不要引导用户重选） */
export async function restoreDirectory() {
  const dir = await idbGet(IDB_KEY_DIR).catch(() => null);
  if (!dir) return null;
  const perm = await dir.queryPermission({ mode: 'readwrite' });
  return perm === 'granted' ? dir : null;
}

/** 申请目录权限（必须由用户手势触发） */
export async function ensurePermission(dir) {
  if (!dir) return false;
  if (await dir.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  return await dir.requestPermission({ mode: 'readwrite' }) === 'granted';
}

/**
 * 建一个存储通道。
 * @param {{ mode: 'file'|'idb', dir?: FileSystemDirectoryHandle }} opts
 * @returns {{ read: () => Promise<Uint8Array|null>, write: (b: Uint8Array) => Promise<void>,
 *   flush: () => Promise<void>, describe: () => string }}
 */
export function createStorage(opts) {
  const { mode, dir = null } = opts;
  let pending = null;      // 待写入的字节（合并连续写入）
  let writing = null;      // 正在进行的写入
  let lastError = null;

  async function writeFileNow(bytes) {
    const fh = await dir.getFileHandle(DB_FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
  }
  async function writeIdbNow(bytes) {
    await idbSet(IDB_KEY_BYTES, bytes);
  }

  /** 串行化写入：同一时刻只写一次，期间来的新数据合并成最后一次写 */
  async function pump() {
    if (writing) return writing;
    writing = (async () => {
      while (pending) {
        const bytes = pending;
        pending = null;
        try {
          if (mode === 'file') await writeFileNow(bytes);
          else await writeIdbNow(bytes);
          lastError = null;
        } catch (err) {
          lastError = err;
          console.error('[storage] 写入失败', err);
        }
      }
      writing = null;
    })();
    return writing;
  }

  return {
    /** 读取已有的数据库字节；没有则 null（首次使用） */
    async read() {
      try {
        if (mode === 'file') {
          const fh = await dir.getFileHandle(DB_FILE).catch(() => null);
          if (!fh) return null;
          const file = await fh.getFile();
          const buf = await file.arrayBuffer();
          return buf.byteLength ? new Uint8Array(buf) : null;
        }
        const bytes = await idbGet(IDB_KEY_BYTES).catch(() => null);
        return bytes && bytes.length ? bytes : null;
      } catch (err) {
        console.error('[storage] 读取失败', err);
        return null;
      }
    },
    /** 落盘（合并连续写入，避免每笔操作都立刻写一次文件） */
    write(bytes) {
      pending = bytes;
      return pump();
    },
    /** 等待当前写入完成（页面关闭前调用） */
    async flush() {
      while (pending || writing) await pump();
      if (lastError) throw lastError;
    },
    /** 给人看的一句话描述（用于界面上提示数据存哪了） */
    describe() {
      return mode === 'file' ? `真实文件：${DB_FILE}（你选择的目录里）` : '浏览器本地存储（IndexedDB）';
    },
  };
}
