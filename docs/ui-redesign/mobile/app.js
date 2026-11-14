const scrim = document.getElementById('scrim');
const sheets = { stats: document.getElementById('statsSheet'), entry: document.getElementById('entrySheet') };
let active = null;

function open(name) {
  active = name;
  scrim.hidden = false;
  for (const [key, el] of Object.entries(sheets)) {
    const on = key === name;
    el.classList.toggle('open', on);
    el.setAttribute('aria-hidden', String(!on));
  }
}

function close() {
  active = null;
  scrim.hidden = true;
  for (const el of Object.values(sheets)) {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }
}

document.getElementById('statsBtn').addEventListener('click', () => open('stats'));
document.getElementById('statsNav').addEventListener('click', () => open('stats'));
document.getElementById('summaryBtn').addEventListener('click', () => open('stats'));
document.getElementById('addNav').addEventListener('click', () => open('entry'));
scrim.addEventListener('click', close);
for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click', close);

// 原型用 ?state=stats / entry 直接打开 sheet，方便截图与评审
const state = location.hash.replace('#', '') || new URLSearchParams(location.search).get('state');
if (state === 'stats' || state === 'entry') open(state);
