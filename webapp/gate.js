// 首次使用的「账本存放位置」页。
//
// 这里只负责 UI 和可访问性；真正的目录授权、数据库挂载仍由 boot.js 驱动。
// 关键约束：File System Access 的授权必须由用户手势触发，所以 gate 不能自动
// 调 ensurePermission，也不能在权限失效时丢掉上次的目录句柄。
const FILE_CARD = `
  <button class="gate-card gate-card-file" id="orbitPickDir" type="button" data-primary>
    <span class="gate-card-kicker">真实文件 <em>推荐</em></span>
    <strong>存成真实文件</strong>
    <span class="gate-desc">在选定的文件夹里生成 <code>orbit.db</code>，可备份、可拷到别的设备。</span>
    <span class="gate-action">选择文件夹 <i>→</i></span>
  </button>`;

const IDB_CARD = `
  <button class="gate-card gate-card-idb" id="orbitUseIdb" type="button">
    <span class="gate-card-kicker">浏览器存储</span>
    <strong>存在浏览器里</strong>
    <span class="gate-desc">数据在浏览器内部；清理站点数据会丢失，建议定期导出备份。</span>
    <span class="gate-action">开始使用 <i>→</i></span>
  </button>`;

const REAUTH_CARD = `
  <button class="gate-card gate-card-file" id="orbitReauth" type="button" data-primary>
    <span class="gate-card-kicker">上次目录 · 需要重新授权</span>
    <strong>继续使用上次目录</strong>
    <span class="gate-desc">数据还在原文件里。浏览器需要你再次确认这个目录的读写权限。</span>
    <span class="gate-action">重新授权 <i>→</i></span>
  </button>`;

/**
 * @param {{canUseFile:boolean, remembered:boolean, reason?:string,
 *   onPick:Function, onReauth:Function, onFallback:Function, onChooseOther?:Function}} opts
 * @returns {{close:Function, setError:Function, setBusy:Function}}
 */
export function showGate(opts) {
  const { canUseFile, remembered, reason = '', onPick, onReauth, onFallback, onChooseOther } = opts;
  const root = document.createElement('div');
  root.id = 'orbitGate';
  root.className = 'orbit-gate';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'orbitGateTitle');
  root.setAttribute('aria-describedby', 'orbitGateDesc');

  const foot = canUseFile
    ? '两种存放方式的数据互不相通；切换不会自动迁移。之后可在账本菜单导出 JSON 备份。'
    : '数据只保存在当前浏览器；清理站点数据会丢失。之后可在账本菜单导出 JSON 备份。';

  const options = remembered && canUseFile
    ? `${REAUTH_CARD}${IDB_CARD}<button class="gate-link" id="orbitChooseOther" type="button">选择其他文件夹</button>`
    : canUseFile
      ? `${FILE_CARD}${IDB_CARD}`
      : `${IDB_CARD}<p class="gate-note">当前浏览器不支持直接写文件，只能使用浏览器存储。</p>`;

  root.innerHTML = `
    <div class="gate-plate">
      <header class="gate-head">
        <span class="gate-seal" aria-hidden="true">星</span>
        <div>
          <p class="gate-kicker">Orbit 星账 · 本地优先</p>
          <h1 id="orbitGateTitle">账本存放位置</h1>
        </div>
      </header>
      <p class="gate-desc" id="orbitGateDesc">数据只保存在这台设备上，不上传、不联网。选择一种存放方式。</p>
      <div class="gate-options${canUseFile ? '' : ' single'}">${options}</div>
      <p class="gate-reason" id="orbitGateReason" role="alert" tabindex="-1" hidden></p>
      <p class="gate-foot">${foot}</p>
    </div>`;

  document.body.appendChild(root);

  const reasonEl = root.querySelector('#orbitGateReason');
  if (reason) {
    reasonEl.textContent = reason;
    reasonEl.hidden = false;
  }

  const bind = (sel, fn) => {
    const el = root.querySelector(sel);
    if (el && typeof fn === 'function') el.addEventListener('click', fn);
    return el;
  };
  bind('#orbitPickDir', onPick);
  bind('#orbitReauth', onReauth);
  bind('#orbitUseIdb', onFallback);
  bind('#orbitChooseOther', onChooseOther || onPick);

  // 焦点落在第一个可用选项；不要自动触发任何权限请求
  requestAnimationFrame(() => {
    const primary = root.querySelector('[data-primary]') || root.querySelector('.gate-card');
    primary?.focus();
  });

  // 只有两个选项的 gate 不需要复杂焦点陷阱，但 Tab 不应跑到页面背后
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const buttons = [...root.querySelectorAll('button:not([disabled])')];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
    else if (!e.shiftKey && (i < 0 || i === buttons.length - 1)) { e.preventDefault(); buttons[0].focus(); }
  });

  return {
    close() { root.remove(); },
    setError(message) {
      reasonEl.textContent = message || '';
      reasonEl.hidden = !message;
      if (message) reasonEl.focus?.();
    },
    setBusy(busy) {
      root.classList.toggle('is-busy', Boolean(busy));
      root.setAttribute('aria-busy', String(Boolean(busy)));
      for (const b of root.querySelectorAll('button')) b.disabled = Boolean(busy);
    },
  };
}
