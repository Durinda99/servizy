// Общие элементы интерфейса: иконки, шапка, навигация, нижний лист, уведомления.
import { esc } from './util.js';

const I = (d, extra = '') => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icon = {
  back: I('<path d="M15 18l-6-6 6-6"/>'),
  chev: I('<path d="M9 6l6 6-6 6"/>', 'width="20" height="20" stroke="#5B6474"'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 'width="20" height="20" stroke="#1F4FB4" stroke-width="2.2"'),
  phone: I('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 'width="20" height="20"'),
  home: I('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  people: I('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'),
  plate: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>'),
  layers: I('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  more: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  plus: I('<path d="M12 5v14M5 12h14"/>', 'width="18" height="18" stroke-width="2.2"'),
  download: I('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', 'width="20" height="20" stroke="#1F4FB4"'),
  upload: I('<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>', 'width="20" height="20"'),
  split: I('<path d="M12 3v7M12 10l-6 6M12 10l6 6M4 20h4M16 20h4"/>', 'width="20" height="20" stroke="#6B3FA0"'),
  ok: I('<path d="M5 12l5 5 9-10"/>', 'width="20" height="20" stroke-width="2.4"'),
  img: I('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>', 'width="28" height="28" stroke="#8A919D" stroke-width="1.8"'),
  edit: I('<path d="M4 20h4L20 8l-4-4L4 16z"/>', 'width="20" height="20"'),
  file: I('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13l2 2 4-4"/>', 'width="22" height="22" stroke="#1E7A4C"'),
  check: I('<path d="M5 12l5 5 9-10"/>', 'width="16" height="16" stroke-width="3"'),
  msg: I('<path d="M4 5h16v11H8l-4 4z"/>', 'width="20" height="20"'),
};

export function top({ title = '', back = true, right = '', sub = null }) {
  return `<header class="top">${back ? `<button class="icon-btn" data-back aria-label="Назад">${icon.back}</button>` : ''}${sub ?? `<span class="title">${esc(title)}</span>`}${right}</header>`;
}

export function nav(active) {
  const it = (href, key, ic, label) => `<a href="${href}" class="${active === key ? 'on' : ''}">${ic}${label}</a>`;
  return `<nav class="nav">${it('#/', 'home', icon.home, 'Главная')}${it('#/clients', 'clients', icon.people, 'Клиенты')}${it('#/search', 'search', icon.plate, 'Товары')}${it('#/more', 'more', icon.more, 'Ещё')}</nav>`;
}

export function toast(text, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** Нижний лист. bind(el, close) навешивает обработчики. Возвращает close. */
export function sheet(html, bind, onClose) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.remove(); window.removeEventListener('popstate', onPop); onClose?.(); };
  const onPop = () => close();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  window.addEventListener('popstate', onPop);
  bind?.(ov.querySelector('.sheet'), close);
  return close;
}

export function confirmSheet(text, okLabel = 'Да', { danger = false } = {}) {
  return new Promise(res => {
    let answer = false;
    sheet(`<div class="h2" style="line-height:1.35">${text}</div><div class="grid2"><button class="btn" data-no>Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`, (el, cl) => {
      el.querySelector('[data-no]').onclick = () => cl();
      el.querySelector('[data-yes]').onclick = () => { answer = true; cl(); };
    }, () => res(answer));
  });
}

export function stepperHTML(name, value, min = 0, max = 999) {
  return `<div class="stepper" data-stepper="${name}" data-min="${min}" data-max="${max}"><button type="button" data-dec aria-label="Меньше">−</button><span data-val>${value}</span><button type="button" data-inc aria-label="Больше">+</button></div>`;
}
export function bindSteppers(root, onChange) {
  root.querySelectorAll('[data-stepper]').forEach(s => {
    const min = Number(s.dataset.min), max = Number(s.dataset.max);
    const v = s.querySelector('[data-val]');
    const set = n => { n = Math.max(min, Math.min(max, n)); v.textContent = n; onChange?.(s.dataset.stepper, n, s); };
    s.querySelector('[data-dec]').onclick = () => set(Number(v.textContent) - 1);
    s.querySelector('[data-inc]').onclick = () => set(Number(v.textContent) + 1);
  });
}
export const stepVal = (root, name) => Number(root.querySelector(`[data-stepper="${name}"] [data-val]`)?.textContent ?? 0);

export function optionsHTML(list, selected, empty = '— не выбрано —') {
  return `<option value="">${esc(empty)}</option>` + list.map(o => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function pickFile(accept) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}
