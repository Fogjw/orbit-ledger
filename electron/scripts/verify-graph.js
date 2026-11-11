// 阶段 0：只验证「主 tag → 下钻二部图 → 返回」的拓扑与信息，不测视觉。
// 需要先起一个带 demo 数据的服务：
//   ORBIT_DB=/tmp/orbit-ui-review.db npm run dev（在 server/ 下）
//   cd server && npm run seed:demo
// 再在仓库根：
//   env -u ELECTRON_RUN_AS_NODE npm run verify:graph
//
// 选一个数据最丰富的品类（有副 tag、有共享线），用真实坐标点击进入下钻，
// 读 OrbitDebug.graph() 断言：没有主 tag 节点、副 tag/账单都存在、归属线与共享线语义未变；
// 最后点返回按钮，确认回到 L1。
import { app, BrowserWindow } from 'electron';

const base = process.env.ORBIT_GRAPH_URL || 'http://127.0.0.1:5310';
const preferred = process.env.ORBIT_GRAPH_TAG || '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.commandLine.appendSwitch('force-device-scale-factor', '1');

async function main() {
  const win = new BrowserWindow({
    width: 1440, height: 900,
    show: true, frame: false,
    backgroundColor: '#030510',
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  });
  await win.loadURL(base);
  await wait(1500);
  const js = (code) => win.webContents.executeJavaScript(code);
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`);
  const graph = async () => JSON.parse(await js(`JSON.stringify(
    window.OrbitDebug && window.OrbitDebug.graph ? window.OrbitDebug.graph() : null
  )`));
  const backVisible = async () => js(`Boolean(
    document.querySelector('#btnBack') && !document.querySelector('#btnBack').hidden
  )`);
  // 用 CDP 真实鼠标事件，而不是 sendInputEvent：后者在部分 Linux/Electron 组合下
  // 只到 mouseup、pointerup 不触发，画布看起来「点了没反应」。
  const clickAt = async (x, y) => {
    win.webContents.debugger.attach('1.3');
    try {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
      });
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
      });
    } finally {
      win.webContents.debugger.detach();
    }
  };

  // 演示库有 2700+ 笔，首次拉统计/建图可能超过 4s；等节点真的画出来再断言。
  let l1 = null;
  for (let i = 0; i < 60; i++) {
    l1 = await graph();
    if (l1 && l1.view === 'l1' && (l1.nodes || []).length > 0) break;
    await wait(500);
  }
  if (!l1 || l1.view !== 'l1') throw new Error('图谱未就绪：检查服务是否在 5310、页面是否加载完成');
  const kinds = [...new Set((l1.nodes || []).map((n) => n.kind))].join(',');
  console.log(`[verify-graph] L1：节点 ${l1.nodes.length} 个 · 种类 ${kinds} · 总额 ${l1.nodes.reduce((s, n) => s + (n.amount || 0), 0)}`);
  const cats = (l1.nodes || []).filter((n) => n.kind === 'cat' && n.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (!cats.length) throw new Error('L1 没有金额 > 0 的主 tag；先跑 npm run seed:demo');
  const ordered = preferred
    ? [...cats.filter((n) => n.name === preferred), ...cats.filter((n) => n.name !== preferred)]
    : cats;

  let best = null;
  for (const cat of ordered.slice(0, 12)) {
    console.log(`[verify-graph] 尝试主 tag「${cat.name}」@ (${cat.screenX}, ${cat.screenY}) R=${cat.R}`);
    await clickAt(cat.screenX, cat.screenY);
    await wait(1200);
    const afterClick = JSON.parse(await js(`(() => {
      const q = (s) => document.querySelector(s);
      return JSON.stringify({
        view: q('#btnBack') && !q('#btnBack').hidden ? 'detail' : 'l1',
        back: q('#btnBack')?.textContent.trim() || '',
        expList: q('#expMask') && !q('#expMask').hidden,
        modal: q('#modalMask') && !q('#modalMask').hidden,
      });
    })()`));
    console.log(`[verify-graph] 点击后：view=${afterClick.view} · 返回「${afterClick.back}」`
      + ` · 明细=${afterClick.expList} · 记一笔=${afterClick.modal}`);
    if (!(await backVisible())) continue;

    const detail = await graph();
    const subs = (detail.nodes || []).filter((n) => n.kind === 'sub');
    const exps = (detail.nodes || []).filter((n) => n.kind === 'exp');
    const catsInDetail = (detail.nodes || []).filter((n) => n.kind === 'cat');
    const links = detail.links || [];
    const expSub = links.filter((l) => String(l.s).startsWith('e') && String(l.t).startsWith('s'));
    const shared = links.filter((l) => l.shared);
    const subIds = new Set(subs.map((s) => s.id));
    const sharedOk = shared.every((l) => subIds.has(l.s) && subIds.has(l.t) && Array.isArray(l.exps) && l.exps.length > 0);
    const linkedSubs = new Set(expSub.map((l) => l.t));
    const candidate = {
      cat, detail, subs, exps, catsInDetail, links, expSub, shared, sharedOk, linkedSubs,
      ok: detail.view === 'detail'
        && detail.detailTag?.name === cat.name
        && catsInDetail.length === 0
        && subs.length > 0
        && exps.length > 0
        && expSub.length > 0
        && subs.every((s) => linkedSubs.has(s.id))
        && sharedOk,
    };
    if (candidate.ok && (!best || shared.length > best.shared.length)) best = candidate;
    await click('#btnBack');
    await wait(800);
    if (best && best.shared.length > 0) break;
  }

  if (!best) {
    console.log('[verify-graph] 失败：没有找到含副 tag 与账单的下钻视图');
    win.destroy();
    app.exit(1);
    return;
  }

  const back = await graph();
  const backOk = back.view === 'l1'
    && (back.nodes || []).some((n) => n.kind === 'cat' && n.name === best.cat.name);
  console.log(`[verify-graph] 主 tag「${best.cat.name}」→ 下钻：副tag=${best.subs.length}`
    + ` · 账单=${best.exps.length} · 主tag节点=${best.catsInDetail.length}`
    + ` · 归属线=${best.expSub.length} · 共享线=${best.shared.length}`);
  console.log(`[verify-graph] 返回：view=${back.view} · 主 tag 回到 L1=${backOk}`);
  if (best.shared.length === 0) console.log('[verify-graph] 注：该账本没有共享线，本次只验证了归属线');
  const ok = best.ok && backOk;
  console.log(`[verify-graph] 结论: ${ok ? '通过' : '未通过'}`);
  win.destroy();
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[verify-graph] 失败', err);
  app.exit(1);
});
