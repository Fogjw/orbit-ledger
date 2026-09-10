// 浏览器侧 SQLite 驱动：把 sql.js（SQLite 编译成 WebAssembly）包成与 **node:sqlite 同形**的接口。
//
// 为什么要「同形」：core/ 里的 repos 与 services 是照着 node:sqlite 的
// prepare(sql) → { run, get, all } 写的。只要驱动的形状一致，同一套业务规则就能原样跑在
// 浏览器里 —— 一行都不用改。这是整个纯前端方案能成立的前提。
//
// 与 node:sqlite 的已知差异，都在这一层抹平：
//  - exec()：node:sqlite 不返回结果，sql.js 会返回 → 统一丢弃
//  - run() 的返回值：sql.js 不直接给 lastInsertRowid → 用 SELECT last_insert_rowid() 取
//  - get() 无结果：node:sqlite 给 undefined，sql.js 需要自己判 → 这里统一成 undefined
//  - WAL / busy_timeout：内存与 WASM 环境没有 WAL、也不存在多连接争用，索性不设
import initSqlJs from 'sql.js';

let sqlPromise = null;

/**
 * 初始化 sql.js 的 WASM 运行时（只做一次，后续复用同一实例）。
 * @param {{ locateFile?: (file: string) => string }} [opts] 浏览器里通常需要指定 wasm 地址
 */
export function initSqlite(opts = {}) {
  if (!sqlPromise) {
    const cfg = {};
    // 优先用调用方**自己取回来的** wasm 字节，不让 emscripten 去猜路径：
    // 它在 Electron 渲染进程里会因为存在 process 而误判成 Node 环境，转而用 fs 去读
    // http(s) 地址，最后报「both async and sync fetching of the wasm failed」。
    // 由我们自己 fetch 再喂进去，任何宿主环境下的行为都一致。
    if (opts.wasmBinary) cfg.wasmBinary = opts.wasmBinary;
    else if (opts.locateFile) cfg.locateFile = opts.locateFile;
    sqlPromise = initSqlJs(cfg);
  }
  return sqlPromise;
}

/** 把 sql.js 的语句包成 node:sqlite 的形状 */
function wrapStatement(sqlDb, sql) {
  const stmt = sqlDb.prepare(sql);
  // node:sqlite 两种调用方式都支持：run(a, b) 与 run([a, b])
  const argsOf = (args) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
  const selectAll = (args) => {
    const out = [];
    stmt.bind(argsOf(args));
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.reset();
    return out;
  };
  return {
    all(...args) { return selectAll(args); },
    get(...args) { return selectAll(args)[0]; },   // 无命中 → undefined，与 node:sqlite 一致
    run(...args) {
      stmt.bind(argsOf(args));
      stmt.step();
      stmt.reset();
      const changes = sqlDb.getRowsModified();
      const r = sqlDb.exec('SELECT last_insert_rowid() AS id');
      const lastInsertRowid = r.length ? r[0].values[0][0] : 0;
      return { changes, lastInsertRowid };
    },
  };
}

/**
 * 用一段既有的数据库字节（或空）打开浏览器侧数据库连接。
 * @param {Uint8Array | null} [bytes] 已有的 .db 文件内容；不传则新建空库
 * @param {{ locateFile?: (file: string) => string }} [opts]
 * @returns {Promise<{ exec: Function, prepare: Function, export: () => Uint8Array, close: Function }>}
 */
export async function openBrowserDatabase(bytes = null, opts = {}) {
  const SQL = await initSqlite(opts);
  const sqlDb = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
  return {
    /** 与 node:sqlite 一致：执行但不返回结果（PRAGMA / BEGIN / COMMIT / DDL 用） */
    exec(sql) { sqlDb.exec(sql); },
    /** 与 node:sqlite 一致：返回 { run, get, all } */
    prepare(sql) { return wrapStatement(sqlDb, sql); },
    /** 导出整库字节 —— 持久化（写文件 / 存 IndexedDB）就靠它 */
    export() { return sqlDb.export(); },
    close() { sqlDb.close(); },
  };
}
