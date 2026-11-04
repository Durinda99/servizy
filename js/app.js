// Запуск приложения и маршрутизация по #/адресам.
import { IdbDB } from './db.js';
import { Model } from './model.js';
import { toast } from './ui.js';
import * as P from './screens-products.js';
import * as C from './screens-clients.js';
import * as M from './screens-more.js';

export const APP_VERSION = '1.0.0';

const routes = [
  [/^\/$/, P.home],
  [/^\/search$/, P.search],
  [/^\/queue\/([\d,]+)$/, P.queue],
  [/^\/product\/(\d+)$/, P.product],
  [/^\/sets$/, P.sets],
  [/^\/clients$/, C.clients],
  [/^\/client\/(\d+)$/, C.client],
  [/^\/client\/(\d+)\/new(?:\/(\d+))?$/, C.newRequest],
  [/^\/request\/(\d+)$/, C.request],
  [/^\/more$/, M.more],
  [/^\/import$/, M.importScreen],
  [/^\/dict\/(\w+)$/, M.dict],
  [/^\/archive\/(requests|clients)$/, M.archive],
  [/^\/welcome$/, M.welcome],
];

const root = document.getElementById('app');
const ctx = {
  db: null, m: null, version: APP_VERSION,
  go(hash) { if (location.hash === hash) render(); else location.hash = hash; },
  back(fallback = '#/') { if (ctx.depth > 0) { ctx.depth -= 2; history.back(); } else location.replace(fallback); },
  refresh() { render(true); },
  async save(msg) {
    try { await ctx.db.commit(); if (msg) toast(msg); }
    catch (e) { console.error(e); toast('Не удалось сохранить: ' + (e.message || e), 5000); }
  },
  depth: 0,
  state: {},
};

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

let lastPath = null;
async function render(keepScroll = false) {
  const { path, query } = parseHash();
  if (!ctx.db.count('product') && !['/welcome', '/import'].includes(path) && !ctx.db.setting('welcome_skipped')) { location.replace('#/welcome'); return; }
  let handler = null, params = [];
  for (const [re, fn] of routes) { const m = re.exec(path); if (m) { handler = fn; params = m.slice(1); break; } }
  if (!handler) { location.replace('#/'); return; }
  const y = window.scrollY;
  try {
    const out = await handler(ctx, params, query);
    root.innerHTML = `<div class="screen ${out.nav ? 'has-nav' : ''}">${out.html}</div>`;
    root.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => ctx.back(out.backTo)));
    out.bind?.(root);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="screen"><div class="content"><div class="h-screen">Что-то пошло не так</div><div class="muted small">${String(e.message || e)}</div><a class="btn primary" href="#/">На главную</a></div></div>`;
  }
  if (keepScroll || path === lastPath) window.scrollTo(0, y); else window.scrollTo(0, 0);
  lastPath = path;
}

window.addEventListener('hashchange', () => { ctx.depth++; render(); });

async function boot() {
  try {
    ctx.db = await new IdbDB().open();
  } catch (e) {
    root.innerHTML = `<div class="content"><div class="h-screen">Хранилище недоступно</div><p class="muted">Браузер не дал приложению сохранить данные. Откройте приложение в Chrome (не в режиме инкогнито).</p><p class="muted small">${e.message || e}</p></div>`;
    return;
  }
  ctx.m = new Model(ctx.db);
  window.__ctx = ctx;
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
boot();
