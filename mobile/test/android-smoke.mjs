// Android 真机/模拟器 smoke：通过 adb 启动 debug APK，再用 WebView DevTools 协议读 DOM。
// 这不是 Chromium 设备仿真；它跑在 Android System WebView 里，验证 gate、移动壳、持久化。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ADB = process.env.ADB || 'adb';
const PKG = 'com.fogjw.orbit.ledger';
const PORT = Number(process.env.CDP_PORT || 9222);
const OUT = join(process.cwd(), 'mobile/test/artifacts');
mkdirSync(OUT, { recursive: true });
// Node 在没有活动 handle 时会直接退出未决的 top-level await；给 E2E 一个心跳。
const keepAlive = setInterval(() => {}, 1000);

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function shell(cmd) { return adb('shell', cmd); }
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(300);
  }
  throw new Error(`等待超时：${label}${last ? ` (${last.message})` : ''}`);
}
function webviewSocket() {
  const out = shell('cat /proc/net/unix');
  // force-stop 后旧 WebView 的 socket 可能还留在 /proc/net/unix；
  // 必须按当前 app pid 找，且找不到时继续等，绝不能回退到旧 socket。
  const pids = shell(`pidof ${PKG}`).trim().split(/\s+/).filter(Boolean);
  if (!pids.length) throw new Error('app pid 尚未就绪');
  for (const pid of pids) {
    const exact = `webview_devtools_remote_${pid}`;
    if (out.includes(exact)) {
      console.log(`[android] socket ${exact}`);
      return exact;
    }
  }
  throw new Error(`app pid=${pids.join(',')} 还没有 WebView devtools socket`);
}
async function connectPage() {
  try { adb('forward', '--remove', `tcp:${PORT}`); } catch {}
  adb('forward', `tcp:${PORT}`, `localabstract:${webviewSocket()}`);
  const list = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/json`);
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) && data.find((t) => t.webSocketDebuggerUrl) ? data : null;
  }, 30000, 'WebView CDP 目标');
  console.log('[android] CDP targets:', list.map((t) => `${t.type}:${t.url}`).join(' | '));
  const page = list.find((t) => t.type === 'page' && /localhost|capacitor/.test(t.url)) || list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error('WebView CDP 已断开'));
    pending.clear();
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'JS 异常');
    return r.result?.value;
  };
  const capture = async () => {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    return Buffer.from(r.data, 'base64');
  };
  return { ws, evaluate, capture };
}
async function waitEval(page, expr, pred, label, ms = 30000) {
  return waitFor(async () => {
    const v = await page.evaluate(expr);
    return pred(v) ? v : null;
  }, ms, label);
}
function screenshot(name) {
  const buf = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
  writeFileSync(join(OUT, `${name}.png`), buf);
  console.log(`[android] screenshot ${name}.png`);
}
async function cdpScreenshot(page, name) {
  const buf = await page.capture();
  writeFileSync(join(OUT, `${name}.png`), buf);
  console.log(`[android] webview screenshot ${name}.png`);
}
function launch() {
  // 无 KVM 的 runner 仍可能让 Pixel Launcher 弹 ANR；它不是被测应用，先清掉。
  try { adb('shell', 'am', 'force-stop', 'com.google.android.apps.nexuslauncher'); } catch {}
  try { adb('shell', 'am', 'force-stop', 'com.android.launcher3'); } catch {}
  adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
}

try {
  shell('getprop sys.boot_completed').trim() === '1' || await waitFor(
    () => shell('getprop sys.boot_completed').trim() === '1', 120000, '模拟器启动');
  adb('install', '-r', process.env.APK || 'app-debug.apk');
  launch();

  let page = await waitFor(connectPage, 90000, 'WebView 连接');
  await waitEval(page, `Boolean(document.querySelector('#orbitGate'))`, Boolean, '首次 gate');
  const gate = await page.evaluate(`({
    title: document.querySelector('#orbitGateTitle')?.textContent?.trim() || '',
    file: Boolean(document.querySelector('#orbitPickDir')),
    idb: Boolean(document.querySelector('#orbitUseIdb')),
  })`);
  if (gate.title !== '账本存放位置' || !gate.idb || !gate.file) {
    throw new Error(`Android gate 状态异常：${JSON.stringify(gate)}`);
  }
  await page.evaluate(`document.querySelector('#orbitUseIdb').click()`);
  // #mtValue/#mobile-nav 在静态 HTML 里就存在，不能当作“UI 已启动”。
  // 必须等 boot 挂上 OrbitAPI 且 gate 真正移除；空账本余额 ¥0 是合法状态。
  await waitEval(page, `typeof window.OrbitAPI === 'object' && !document.querySelector('#orbitGate')`, Boolean, '本地 API/界面加载', 60000);
  await waitEval(page, `Boolean(document.querySelector('#mtValue'))`, Boolean, '顶部计数就绪', 10000);

  const mobile = await page.evaluate(`({
    nav: getComputedStyle(document.querySelector('.mobile-nav')).display,
    balance: document.querySelector('#mBalNum')?.textContent?.trim() || '',
    panel: getComputedStyle(document.querySelector('#insightPanel')).display,
    width: innerWidth,
  })`);
  if (mobile.nav !== 'flex' || mobile.panel !== 'none') {
    throw new Error(`Android 移动壳异常：${JSON.stringify(mobile)}`);
  }
  const bridge = await page.evaluate(`({
    share: typeof window.OrbitAndroid?.shareBackup,
    pick: typeof window.OrbitAndroid?.pickBackup,
    storagePick: typeof window.OrbitAndroidStorage?.pickDirectory,
    storageRead: typeof window.OrbitAndroidStorage?.readDatabase,
  })`);
  if (bridge.share !== 'function' || bridge.pick !== 'function' || bridge.storagePick !== 'function' || bridge.storageRead !== 'function') {
    throw new Error(`Android 备份桥未挂载：${JSON.stringify(bridge)}`);
  }
  console.log('[android] backup bridge ready');
  console.log('[android] page:', await page.evaluate(`JSON.stringify({href: location.href, visibility: document.visibilityState, gate: Boolean(document.querySelector('#orbitGate')), api: typeof window.OrbitAPI})`));
  await sleep(1200);
  screenshot('android-main');

  // 移动端星轨四档：日/月/年/全部必须可达（右轨在移动端隐藏）
  await page.evaluate(`document.querySelector('#tlLevels [data-z="0"]').click()`);
  await sleep(700);
  const levelDay = await page.evaluate(`window.OrbitDebug.snapshot().level`);
  await page.evaluate(`document.querySelector('#tlLevels [data-z="2"]').click()`);
  await sleep(700);
  const levelYear = await page.evaluate(`window.OrbitDebug.snapshot().level`);
  await page.evaluate(`document.querySelector('#tlLevels [data-z="1"]').click()`);
  await sleep(700);
  const levelMonth = await page.evaluate(`window.OrbitDebug.snapshot().level`);
  if (levelDay !== 'day' || levelYear !== 'year' || levelMonth !== 'month') {
    throw new Error(`Android 星轨粒度异常：day=${levelDay} year=${levelYear} month=${levelMonth}`);
  }
  console.log('[android] timeline levels:', levelDay, levelYear, levelMonth);

  // Android 硬件返回键：先关最上层账笺，不能直接退出 Activity
  await page.evaluate(`document.querySelector('#mobileReadout').click()`);
  await waitEval(page, `document.querySelector('#insightPanel').classList.contains('mobile-open')`, Boolean, '读数账笺打开');
  adb('shell', 'input', 'keyevent', '4');
  await waitEval(page, `!document.querySelector('#insightPanel').classList.contains('mobile-open')`, Boolean, '返回键关读数账笺');
  await waitEval(page, `typeof window.OrbitAPI === 'object'`, Boolean, '返回后 app 仍在');
  console.log('[android] back: readout closed, app alive');

  // 记一笔：默认金额 88 / 默认日期，保存后应关闭并刷新
  await page.evaluate(`document.querySelector('#mobileAdd').click()`);
  await waitEval(page, `!document.querySelector('#modalMask').hidden`, Boolean, '记一笔打开');
  const entryState = await page.evaluate(`({
    amount: document.querySelector('#mAmount')?.value,
    focused: document.activeElement?.id || '',
  })`);
  await page.evaluate(`document.querySelector('#mDateBtn').click()`);
  await sleep(250);
  const calendarOpen = await page.evaluate(`!document.querySelector('#mCalendar')?.hidden`);
  const firstDate = await page.evaluate(`document.querySelector('#mCalGrid button[data-date]')?.dataset.date || ''`);
  await page.evaluate(`document.querySelector('#mCalGrid button[data-date]')?.click()`);
  await sleep(250);
  const pickedDate = await page.evaluate(`document.querySelector('#mDate')?.value || ''`);
  if (entryState.amount !== '' || !calendarOpen || !/^\d{4}-\d{2}-\d{2}$/.test(firstDate) || pickedDate !== firstDate) {
    throw new Error(`Android 记一笔日期/金额异常：${JSON.stringify({ entryState, calendarOpen, firstDate, pickedDate })}`);
  }
  console.log('[android] calendar:', pickedDate, 'amount empty, focus=' + (entryState.focused || 'none'));
  // Android 返回键应关掉记账账笺，而不是退到桌面
  adb('shell', 'input', 'keyevent', '4');
  await waitEval(page, `document.querySelector('#modalMask').hidden`, Boolean, '返回键关记账账笺');
  await waitEval(page, `typeof window.OrbitAPI === 'object'`, Boolean, '返回后 app 仍在');
  console.log('[android] back: entry closed, app alive');

  await page.evaluate(`document.querySelector('#mobileAdd').click()`);
  await waitEval(page, `!document.querySelector('#modalMask').hidden`, Boolean, '记一笔重新打开');
  await page.evaluate(`(() => {
    const a=document.querySelector('#mAmount'); a.value='12.34'; a.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#modalSave').click();
  })()`);
  await waitEval(page, `document.querySelector('#modalMask').hidden`, Boolean, '记一笔保存关闭', 30000);
  await sleep(1200);
  screenshot('android-after-add');

  // 横屏：Android 系统旋转，不是 CSS 假横屏。settings 偶发不生效，用 window 命令兜底。
  shell('settings put system accelerometer_rotation 0');
  try { shell('cmd window user-rotation lock 1'); } catch { shell('settings put system user_rotation 1'); }
  await sleep(1500);
  let landscape = await page.evaluate(`({ w: innerWidth, h: innerHeight, panel: getComputedStyle(document.querySelector('#insightPanel')).display, nav: getComputedStyle(document.querySelector('.mobile-nav')).display })`);
  if (!(landscape.w > landscape.h)) {
    shell('cmd window user-rotation lock 1');
    await sleep(1500);
    landscape = await page.evaluate(`({ w: innerWidth, h: innerHeight, panel: getComputedStyle(document.querySelector('#insightPanel')).display, nav: getComputedStyle(document.querySelector('.mobile-nav')).display })`);
  }
  if (!(landscape.w > landscape.h) || landscape.panel !== 'flex' || landscape.nav !== 'none') {
    throw new Error(`Android 横屏异常：${JSON.stringify(landscape)}`);
  }
  screenshot('android-landscape');
  try { shell('cmd window user-rotation free'); } catch { shell('settings put system user_rotation 0'); }
  await sleep(1000);

  // 进程被杀后：账本仍在，且不该再次出现首次 gate
  adb('shell', 'am', 'force-stop', PKG);
  launch();
  page = await waitFor(connectPage, 60000, '重启 WebView');
  await waitEval(page, `typeof window.OrbitAPI === 'object' && !document.querySelector('#orbitGate')`, Boolean, '重启后界面', 60000);
  // 空账本也会显示 ¥0；必须等刚才那笔 12.34 真正从 IndexedDB 恢复出来。
  await waitEval(page, `(() => {
    const b=document.querySelector('#mBalNum')?.textContent || '';
    const t=document.querySelector('#mtValue')?.textContent || '';
    return b.includes('12.34') || t.includes('12.34');
  })()`, Boolean, '重启后账目恢复', 30000);
  const relaunch = await page.evaluate(`({
    gate: Boolean(document.querySelector('#orbitGate')),
    total: document.querySelector('#mtValue')?.textContent?.trim() || '',
    balance: document.querySelector('#mBalNum')?.textContent?.trim() || '',
  })`);
  if (relaunch.gate || !relaunch.total || !relaunch.balance.includes('12.34')) {
    throw new Error(`进程重启持久化异常：${JSON.stringify(relaunch)}`);
  }
  console.log('[android] relaunch:', JSON.stringify(relaunch));
  await sleep(1500);
  await cdpScreenshot(page, 'android-relaunch-webview');
  screenshot('android-relaunch');

  console.log(`[android] PASS gate=${gate.title} · mobile=${mobile.width}px · landscape=${landscape.w}x${landscape.h} · relaunch=${relaunch.total}`);
  clearInterval(keepAlive);
  page.ws.close();
} catch (e) {
  console.error('[android] FAIL', e.stack || e.message);
  clearInterval(keepAlive);
  try { screenshot('android-fail'); } catch {}
  process.exit(1);
}
