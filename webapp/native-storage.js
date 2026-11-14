// Android SAF 目录存储：由 MainActivity 的 OrbitAndroidStorage 注入提供。
// 与浏览器 FileSystemDirectoryHandle 不同，手机侧拿到的是可持久化的 tree URI；
// 这里把它包装成和 storage.js 相同的 read/write/flush/describe 接口。
function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function createNativeStorage() {
  const bridge = globalThis.OrbitAndroidStorage;
  if (!bridge || typeof bridge.readDatabase !== 'function') return null;

  let pending = null;
  let writing = null;
  let writeSeq = 0;
  const writeWaiters = new Map();

  // 原生写盘放到后台线程；这里只等回调，不阻塞 WebView 主线程。
  globalThis.__orbitNativeWriteDone = (token, ok) => {
    const waiter = writeWaiters.get(String(token));
    if (!waiter) return;
    writeWaiters.delete(String(token));
    clearTimeout(waiter.timer);
    if (ok) waiter.resolve(true);
    else waiter.reject(new Error('无法写入所选目录里的 orbit.db'));
  };

  function writeNative(base64) {
    if (typeof bridge.writeDatabaseAsync !== 'function') {
      // 旧 APK 没有异步桥时退回同步写；新包不会走到这里。
      if (!bridge.writeDatabase(base64)) return Promise.reject(new Error('无法写入所选目录里的 orbit.db'));
      return Promise.resolve(true);
    }
    return new Promise((resolve, reject) => {
      const token = String(++writeSeq);
      const timer = setTimeout(() => {
        writeWaiters.delete(token);
        reject(new Error('写入 orbit.db 超时'));
      }, 30000);
      writeWaiters.set(token, { resolve, reject, timer });
      try { bridge.writeDatabaseAsync(base64, token); }
      catch (err) {
        clearTimeout(timer);
        writeWaiters.delete(token);
        reject(err);
      }
    });
  }

  async function pump() {
    if (writing) return writing;
    writing = (async () => {
      try {
        while (pending) {
          const bytes = pending;
          pending = null;
          await writeNative(bytesToBase64(bytes));
        }
      } finally {
        writing = null;
      }
    })();
    return writing;
  }

  return {
    native: true,
    hasDirectory() {
      try { return Boolean(bridge.hasDirectory()); } catch { return false; }
    },
    pickDirectory() {
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { delete globalThis.__orbitNativeDirPicked; } catch {}
          resolve(Boolean(ok));
        };
        const timer = setTimeout(() => finish(false), 5 * 60 * 1000);
        globalThis.__orbitNativeDirPicked = finish;
        try { bridge.pickDirectory(); } catch { finish(false); }
      });
    },
    async read() {
      try {
        if (!bridge.hasDirectory()) return null;
        const b64 = bridge.readDatabase();
        return b64 ? base64ToBytes(b64) : null;
      } catch (err) {
        console.error('[native-storage] 读取失败', err);
        return null;
      }
    },
    write(bytes) {
      pending = bytes;
      return pump();
    },
    async flush() {
      while (pending || writing) await pump();
    },
    describe() {
      try { return bridge.describe() || '真实文件：所选目录里的 orbit.db'; }
      catch { return '真实文件：所选目录里的 orbit.db'; }
    },
  };
}
