// Linux 运行冒烟：在 Electron 主进程里启动内嵌服务，走真实 HTTP + SQLite，不打开窗口。
// 安装包能构建 ≠ 运行时能起来；这里验证 Electron 的 Node、node:sqlite、迁移/种子和
// Express 路由在 Linux 上确实可用。CI 的 Linux 构建任务会执行它（无窗口，不需要显示器）。
import assert from 'node:assert/strict';
import { app } from 'electron';
import { startServer } from '../../server/src/bootstrap.js';

async function main() {
  const srv = await startServer({ dbPath: ':memory:', port: 0 });
  try {
    let res = await fetch(`${srv.url}/api/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);

    res = await fetch(`${srv.url}/api/ledgers`);
    assert.equal(res.status, 200);
    const before = await res.json();
    assert.ok(Array.isArray(before) && before.length >= 1, '首次启动应已有默认账本');

    res = await fetch(`${srv.url}/api/ledgers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Linux smoke' }),
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.ok(created.id, '新建账本应返回 id');

    res = await fetch(`${srv.url}/api/ledgers/${created.id}/dimensions`);
    assert.equal(res.status, 200);
    const view = await res.json();
    assert.deepEqual(view.dimensions.map((d) => d.key), ['category', 'context']);

    console.log(`[verify-linux] OK: ${srv.url}`);
  } finally {
    await srv.close();
  }
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((err) => {
    console.error('[verify-linux] 失败：', err);
    app.exit(1);
  });
