/**
 * 覆盖更新验收：同一台机器上**再装一次**，必须同时满足两件事 ——
 *   ① 被识别为本机已存在的同一个应用并**覆盖**（不并存两份、不装到别处）；
 *   ② **不碰旧数据** —— 数据目录配置不被重置，数据库文件不丢、不改。
 *
 * 为什么必须自动化：这两条都只在「装第二次」时才成立，手工点两遍很容易漏掉前提
 * （比如忘了先把数据目录指到自定义位置），而漏掉的代价是用户的账本。
 * 判据全部取自文件系统与注册表，不看界面：配置文本、数据库文件哈希与行数、
 * 注册表安装记录条数、卸载后的数据存留。
 *
 * 用法：node electron/scripts/verify-upgrade.js [安装包路径]
 *   默认用 release/Orbit-Setup-<package.json 里的 version>.exe。
 *   会真的安装 / 覆盖安装 / 卸载，但只碰它自己造的两个目录（默认 D:\OrbitUpgradeTest 与
 *   D:\OrbitUpgradeData），并把 %APPDATA%\Orbit 星账\data-path.txt 原样备份、结束时还原。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../../server/src/db/database.js';
import { migrate } from '../../core/schema.js';
import { seedIfEmpty } from '../../core/seed.js';
import { createExpenseService } from '../../core/services/expenseService.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CFG_DIR = join(process.env.APPDATA, 'Orbit 星账');
const CFG = join(CFG_DIR, 'data-path.txt');
const INSTALL_DIR = process.env.ORBIT_TEST_INSTALL || 'D:\\OrbitUpgradeTest';
const DATA_DIR = process.env.ORBIT_TEST_DATA || 'D:\\OrbitUpgradeData';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const setup = process.argv[2] || join(ROOT, 'release', `Orbit-Setup-${pkg.version}.exe`);

const log = (...a) => console.log('[升级验收]', ...a);
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16);
const run = (exe, args) => execFileSync(exe, args, { stdio: 'inherit' });

/** 与应用侧同样的编码嗅探：安装器写的是 UTF-16LE + BOM */
function readCfg(file) {
  if (!existsSync(file)) return '';
  const buf = readFileSync(file);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le').trim();
  return buf.toString('utf8').trim();
}

/** 本机注册的卸载项（只看 Orbit 相关的），用来判断"装了几份" */
function uninstallEntries() {
  const ps = "$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';"
    + "if(!(Test-Path $k)){ '[]'; exit };"
    + "$r=@(Get-ChildItem $k | ForEach-Object { $p=Get-ItemProperty $_.PSPath;"
    + " if($p.DisplayName -like '*Orbit*'){[pscustomobject]@{name=$p.DisplayName;ver=$p.DisplayVersion;loc=$p.InstallLocation;us=$p.UninstallString}} });"
    + 'ConvertTo-Json -InputObject $r -Compress';
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  const parsed = out ? JSON.parse(out) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** 结束可能被"装完自动启动"拉起来的应用，否则安装目录被占用、覆盖会失败 */
function killApp() {
  try { execFileSync('taskkill', ['/IM', 'Orbit 星账.exe', '/F'], { stdio: 'ignore' }); } catch { /* 没在跑 */ }
}

const UNINSTALL_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\';

/** 本机已有的 Orbit 卸载记录（注册表子键名） */
function orbitKeys() {
  const ps = "$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';"
    + "if(!(Test-Path $k)){ '[]'; exit };"
    + "$r=@(Get-ChildItem $k | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like '*Orbit*' } | ForEach-Object { $_.PSChildName });"
    + 'ConvertTo-Json -InputObject $r -Compress';
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  const parsed = out ? JSON.parse(out) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * 把本机**已有的** Orbit 安装记录整体挪开（导出后删除），返回恢复函数。
 * 为什么必须这么做：安装器现在会优先「更新已存在的那一份」（这正是要验的行为），
 * 所以只要本机装着用户的 Orbit，测试就会跑到他真实的安装目录上去 —— 卸载收尾时
 * 还会把他卸掉。实测就发生过一次：/D= 指定的测试目录被忽略，装到了用户的目录。
 */
function stashExistingInstall() {
  const keys = orbitKeys();
  if (!keys.length) return () => {};
  const files = keys.map((k, i) => {
    const f = join(tmpdir(), `orbit-uninstall-${i}.reg`);
    execFileSync('reg', ['export', UNINSTALL_ROOT + k, f, '/y'], { stdio: 'ignore' });
    return f;
  });
  for (const k of keys) execFileSync('reg', ['delete', UNINSTALL_ROOT + k, '/f'], { stdio: 'ignore' });
  log(`本机已有 ${keys.length} 份 Orbit 安装记录，测试期间先挪开，跑完原样放回`);
  return () => {
    for (const f of files) { try { execFileSync('reg', ['import', f], { stdio: 'ignore' }); } catch { /* 尽力恢复 */ } }
  };
}

function findUninstaller() {
  if (!existsSync(INSTALL_DIR)) return null;
  const f = readdirSync(INSTALL_DIR).find((n) => /^Uninstall.*\.exe$/i.test(n));
  return f ? join(INSTALL_DIR, f) : null;
}

const problems = [];

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** 删目录容错：卸载后进程未必立刻退出，会短时间占着安装目录 */
function rmDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (e) {
    log(`清理 ${dir} 未完成（${e.code}）—— 多半是应用进程还没退出，手工删掉即可`);
  }
}

/**
 * 等目录真正消失。NSIS 卸载器会把自己复制到临时目录后**立刻返回**（常规做法），
 * 真正的删除还在后台跑 —— 卸载刚返回就去删/去断言，看到的必然是"还剩一堆文件"。
 */
function waitGone(dir, timeoutMs = 30000) {
  const t0 = Date.now();
  while (existsSync(dir) && Date.now() - t0 < timeoutMs) sleep(400);
  return !existsSync(dir);
}

/**
 * 场景 2：把账本放在**程序安装目录里面**（真有人这么用，本机历史配置就是 D:\orbit\store）。
 * 1.0.4 及更早的安装器在升级时会调用旧卸载器（`RMDir /r $INSTDIR`），账本会被一起删掉；
 * 1.0.5 起改为抑制那个调用、让新载荷就地覆盖，所以这里的断言是：**原文件原地不动**。
 */
function checkInnerDataDir() {
  log('\n--- 场景 2：账本放在程序安装目录内 ---');
  const inner = join(INSTALL_DIR, 'store');
  try {
    rmDir(INSTALL_DIR);
    run(setup, ['/S', `/D=${INSTALL_DIR}`]);
    killApp();

    mkdirSync(inner, { recursive: true });
    const src = join(inner, 'orbit.db');
    const db = openDatabase(src);
    migrate(db);
    seedIfEmpty(db);
    const led = db.prepare('SELECT id FROM ledgers ORDER BY id LIMIT 1').get();
    createExpenseService(db).add({ ledgerId: led.id, amountCents: 520, date: '2026-09-11', note: '放在安装目录里' });
    db.close();
    writeFileSync(CFG, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(inner, 'utf16le')]));
    const hash0 = sha(src);
    log(`账本故意放在安装目录内：${src}（sha ${hash0}）`);

    run(setup, ['/S', `/D=${INSTALL_DIR}`]);
    killApp();

    const cfgAfter = readCfg(CFG);
    if (cfgAfter !== inner) problems.push(`数据目录配置被改了：期望仍是「${inner}」，实际「${cfgAfter}」`);
    else log('数据目录配置没被动过 ✓（还是用户原来选的位置）');
    if (!existsSync(src)) problems.push('安装目录里的账本被覆盖更新清掉了');
    else if (sha(src) !== hash0) problems.push('安装目录里的账本被改写了');
    else {
      const db2 = openDatabase(src);
      const n = db2.prepare('SELECT COUNT(*) AS c FROM expenses').get().c;
      db2.close();
      if (n !== 1) problems.push(`账本笔数不对：${n}，期望 1`);
      else log('账本原地不动、笔数完好 ✓（旧卸载器已被抑制）');
    }
  } finally {
    killApp();
    const un = findUninstaller();
    if (un) { try { run(un, ['/S']); } catch { /* 尽力而为 */ } waitGone(INSTALL_DIR, 15000); }
    killApp();
    rmDir(INSTALL_DIR);
  }
}

function main() {
  if (!existsSync(setup)) {
    console.error(`[升级验收] 找不到安装包：${setup}（先跑 npm run dist）`);
    process.exit(2);
  }
  log(`安装包 ${setup}`);
  log(`测试安装目录 ${INSTALL_DIR} · 测试数据目录 ${DATA_DIR}`);

  const hadCfg = existsSync(CFG);
  const hadCfgDir = existsSync(CFG_DIR);
  const cfgBackup = hadCfg ? readFileSync(CFG) : null;
  let installed = false;
  const restoreExisting = stashExistingInstall();

  try {
    rmDir(INSTALL_DIR);
    rmDir(DATA_DIR);

    // ---- 1) 首次安装 ----
    log('首次安装…');
    run(setup, ['/S', `/D=${INSTALL_DIR}`]);
    installed = true;
    killApp();
    const first = uninstallEntries();
    log(`安装记录 ${first.length} 份 · ${first.map((e) => `${e.name} ${e.ver} @ ${e.loc}`).join(' | ')}`);

    // ---- 2) 造出"旧版本的数据"，并把数据目录配置指过去（模拟用户上次的自选位置）----
    mkdirSync(DATA_DIR, { recursive: true });
    const dbFile = join(DATA_DIR, 'orbit.db');
    const db = openDatabase(dbFile);
    migrate(db);
    seedIfEmpty(db);
    const led = db.prepare('SELECT id FROM ledgers ORDER BY id LIMIT 1').get();
    createExpenseService(db).add({ ledgerId: led.id, amountCents: 12345, date: '2026-09-10', note: '升级验收' });
    const rows0 = db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c;
    db.close();
    mkdirSync(CFG_DIR, { recursive: true });
    writeFileSync(CFG, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(DATA_DIR, 'utf16le')]));
    const cfgBytesBefore = readFileSync(CFG);
    const hash0 = sha(dbFile);
    log(`旧数据就位：${rows0} 笔 · ${dbFile} · sha ${hash0}`);

    // ---- 3) 覆盖更新：同一个安装包、同一个安装目录，再装一次 ----
    log('覆盖更新（同包再装一次）…');
    run(setup, ['/S', `/D=${INSTALL_DIR}`]);
    killApp();

    // ---- 4) 断言 ----
    const cfgAfter = readCfg(CFG);
    if (cfgAfter !== DATA_DIR) problems.push(`数据目录配置被改写：期望「${DATA_DIR}」，实际「${cfgAfter}」`);
    else log(`数据目录配置未被重置 ✓（仍是 ${cfgAfter}）`);
    // 逐字节比对：字符相等还不够 —— 编码/BOM/行尾任何一处变了都算「安装器动了用户的配置」，
    // 而应用正是按字节嗅探编码来读它的（1.1.6 那次事故就是它被悄悄换成了默认路径）。
    const cfgBytesAfter = existsSync(CFG) ? readFileSync(CFG) : null;
    if (!cfgBytesAfter || !cfgBytesBefore.equals(cfgBytesAfter)) {
      problems.push('data-path.txt 的字节与安装前不一致（安装器不该碰它）');
    } else {
      log(`data-path.txt 逐字节未变 ✓（${cfgBytesBefore.length} 字节）`);
    }

    if (!existsSync(dbFile)) problems.push('数据库文件被删掉了');
    else if (sha(dbFile) !== hash0) problems.push('数据库文件被替换或改写');
    else {
      const db2 = openDatabase(dbFile);
      const rows1 = db2.prepare('SELECT COUNT(*) AS c FROM expenses').get().c;
      db2.close();
      if (rows1 !== rows0) problems.push(`账本笔数变了：${rows0} → ${rows1}`);
      else log(`账本仍在且可读：${rows1} 笔 ✓`);
    }

    const second = uninstallEntries();
    if (second.length !== 1) problems.push(`本机有 ${second.length} 份安装记录（应恰好 1 份）：${JSON.stringify(second)}`);
    else log(`安装记录仍只有 1 份 ✓（${second[0].name} ${second[0].ver}）`);
    if (second.length === 1 && second[0].ver && second[0].ver !== pkg.version) {
      problems.push(`注册表里的版本是 ${second[0].ver}，期望 ${pkg.version}`);
    }
    // 「覆盖到了同一处」的直接证据：注册表里的卸载命令指向同一个安装目录（loc 字段
    // 有些 electron-builder 版本不写，所以以 UninstallString 为准）
    if (second.length === 1 && second[0].us && !second[0].us.includes(INSTALL_DIR)) {
      problems.push(`卸载命令没指向 ${INSTALL_DIR}：${second[0].us} —— 说明装到了别的地方`);
    }
    if (second.length === 1 && second[0].loc && second[0].loc.replace(/\\$/, '') !== INSTALL_DIR) {
      problems.push(`覆盖到了别的目录：${second[0].loc} ≠ ${INSTALL_DIR}`);
    }

    // ---- 5) 卸载不该带走数据 ----
    const un = findUninstaller();
    if (!un) problems.push('安装目录里找不到卸载器');
    else {
      log('卸载（验证卸载不删账本）…');
      killApp();            // 装完会自动启动；不先关掉，卸载器删不动被占用的文件
      run(un, ['/S']);
      installed = false;
      killApp();
      // 卸载是异步的：等它删完再断言，否则看到的只是"删到一半"
      if (waitGone(INSTALL_DIR)) log('卸载后安装目录也清干净了 ✓');
      else log('注：安装目录仍有残留（进程占用时常见），不影响账本数据');
      if (!existsSync(dbFile) || sha(dbFile) !== hash0) problems.push('卸载把账本数据删了（deleteAppDataOnUninstall 应为 false）');
      else log('卸载后账本数据仍在 ✓');
      if (existsSync(INSTALL_DIR) && readdirSync(INSTALL_DIR).length) {
        log(`注：安装目录还剩 ${readdirSync(INSTALL_DIR).length} 项（NSIS 卸载常见残留，不影响数据）`);
      }
    }

    checkInnerDataDir();
  } finally {
    // 还原现场：配置文件恢复原样，测试目录删掉，别把机器留在装了/卸了的状态
    killApp();
    if (installed) {
      const un = findUninstaller();
      if (un) { try { run(un, ['/S']); } catch { /* 已装不回去也无妨，下面照常清理 */ } }
    }
    if (hadCfg) { mkdirSync(CFG_DIR, { recursive: true }); writeFileSync(CFG, cfgBackup); } else {
      rmSync(CFG, { force: true });
      // 只有「跑之前连目录都不存在」时才清理这个空目录；目录里但凡有别的东西一律不动
      // —— 默认数据目录就是它，多删一步就可能把别人的账本删了
      if (!hadCfgDir) { try { rmSync(CFG_DIR, { recursive: false, force: true }); } catch { /* 非空，留着 */ } }
    }
    restoreExisting();   // 本机原有的安装记录放回去
    killApp();
    waitGone(INSTALL_DIR, 15000);
    rmDir(DATA_DIR);
    rmDir(INSTALL_DIR);
  }

  if (problems.length) {
    console.log('\n[升级验收] 未通过：');
    for (const p of problems) console.log('  ✗ ' + p);
    process.exit(1);
  }
  console.log('\n[升级验收] 通过：覆盖更新只留一份安装，且旧账本数据完好。');
}

main();
