// Клиенты, карточка клиента, запросы, напоминания.
import { esc, rub, fmtDate, fmtShort, humanDT, plural, telHref, smsHref, waHref, todayISO, nowISO, normKey } from './util.js';
import { icon, top, nav, sheet, toast, stepperHTML, bindSteppers, stepVal, optionsHTML, confirmSheet } from './ui.js';

// ---------- выбор времени напоминания ----------
const at = (days, hm = '12:00') => { const d = new Date(); d.setDate(d.getDate() + days); return `${todayISO(d)} ${hm}`; };
export function reminderPicker({ none = true } = {}) {
  const chips = [...(none ? [['none', 'Не надо']] : []), ['d1', 'Завтра, 12:00'], ['d3', 'Через 3 дня'], ['d7', 'Через неделю'], ['custom', 'Другое…']];
  const def = none ? 'none' : 'd1';
  return `<div class="col" style="gap:8px" data-rpick="${def}"><span class="fl">Напомнить перезвонить</span>
    <div class="row wrap" style="gap:8px">${chips.map(([k, l]) => `<button type="button" class="chip ${k === def ? 'on' : ''}" data-rchip="${k}">${l}</button>`).join('')}</div>
    <input type="datetime-local" class="input hide" data-rcustom value="${at(1).replace(' ', 'T')}"></div>`;
}
export function readReminderPicker(el) {
  const box = el.querySelector('[data-rpick]');
  if (!box) return null;
  const v = box.dataset.rpick;
  if (v === 'none') return null;
  if (v === 'custom') { const c = box.querySelector('[data-rcustom]').value; return c ? c.replace('T', ' ').slice(0, 16) : null; }
  return at(Number(v.slice(1)));
}
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-rchip]');
  if (!chip) return;
  const box = chip.closest('[data-rpick]');
  box.dataset.rpick = chip.dataset.rchip;
  box.querySelectorAll('[data-rchip]').forEach(c => c.classList.toggle('on', c === chip));
  box.querySelector('[data-rcustom]').classList.toggle('hide', chip.dataset.rchip !== 'custom');
});

const phoneRow = c => c.phone ? `<div class="grid3"><a class="btn primary" href="${telHref(c.phone)}">Позвонить</a><a class="btn soft" href="${smsHref(c.phone)}">СМС</a><a class="btn soft" href="${waHref(c.phone)}" target="_blank" rel="noopener">WhatsApp</a></div>` : '';

// ================= Список клиентов =================
export function clients(ctx) {
  const { db, m } = ctx;
  const st = ctx.state.clients ??= { q: '', tab: 'waiting' };
  const html = `<div class="content" style="gap:10px">
    <div class="between" style="align-items:center"><h1 class="h1">Клиенты</h1><button class="linkbtn" id="new">${icon.plus}Новый</button></div>
    <div class="search" style="height:50px;box-shadow:none">${icon.search}<input id="q" type="search" placeholder="Имя или телефон" value="${esc(st.q)}"></div>
    <div class="grid2"><button class="btn sm ${st.tab === 'waiting' ? 'on' : ''}" data-tab="waiting">Ждут товар</button><button class="btn sm ${st.tab === 'all' ? 'on' : ''}" data-tab="all">Все</button></div>
    <div id="res" class="col" style="gap:8px"></div></div>${nav('clients')}`;
  return {
    html, nav: true,
    bind(root) {
      const info = new Map();
      for (const r of db.all('request')) {
        if (r.status !== 'active') continue;
        const i = info.get(r.client_id) || { req: 0, items: 0 };
        i.req++; i.items += m.requestProgress(r.id).waiting;
        info.set(r.client_id, i);
      }
      const draw = () => {
        const q = normKey(st.q);
        let list = db.all('client').filter(c => !c.is_archived && (!q || normKey(c.name + ' ' + (c.phone || '')).includes(q)));
        if (st.tab === 'waiting' && !q) list = list.filter(c => info.get(c.id)?.items > 0);
        list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        root.querySelector('#res').innerHTML = list.map(c => {
          const i = info.get(c.id);
          return `<a class="card tight tap" href="#/client/${c.id}"><div class="between"><span style="font-size:16px;font-weight:700">${esc(c.name)}</span>${i?.items ? `<span class="tag blue">ждёт ${i.items}</span>` : ''}</div><span class="small muted">${esc(c.phone || 'без телефона')}${i?.req ? ` · ${i.req} ${plural(i.req, 'запрос', 'запроса', 'запросов')}` : ''}</span></a>`;
        }).join('') || `<div class="empty">${st.tab === 'waiting' && !q ? 'Никто не ждёт товар.<br>Добавьте клиента и запишите, что он собирает.' : 'Никого не нашлось.'}</div>`;
      };
      let t;
      root.querySelector('#q').oninput = e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; draw(); }, 120); };
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; ctx.refresh(); });
      root.querySelector('#new').onclick = () => newClientSheet(ctx, c => ctx.go('#/client/' + c.id));
      draw();
    },
  };
}

export function newClientSheet(ctx, onDone, c = null) {
  sheet(`<h1 class="h-screen">${c ? 'Изменить клиента' : 'Новый клиент'}</h1>
    <label class="field"><span class="fl">Имя</span><input id="nm" value="${esc(c?.name ?? '')}" autocomplete="off"></label>
    <label class="field"><span class="fl">Телефон</span><input id="ph" type="tel" value="${esc(c?.phone ?? '')}" placeholder="+7 …"></label>
    ${c ? '' : `<label class="field"><span class="fl">Заметки</span><textarea id="nt" rows="2"></textarea></label>`}
    <button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
    setTimeout(() => el.querySelector('#nm').focus(), 50);
    el.querySelector('#ok').onclick = async () => {
      const name = el.querySelector('#nm').value.trim();
      if (!name) { toast('Укажите имя'); return; }
      const phone = el.querySelector('#ph').value.trim() || null;
      let rec;
      if (c) rec = ctx.db.put('client', { ...c, name, phone });
      else rec = ctx.m.createClient({ name, phone, note: el.querySelector('#nt').value });
      await ctx.save('Сохранено');
      close();
      onDone?.(rec);
    };
  });
}

// ================= Карточка клиента =================
export function client(ctx, [id]) {
  const { db, m } = ctx;
  const c = db.get('client', Number(id));
  if (!c) return { html: `${top({ title: 'Клиент не найден' })}<div class="content"><div class="empty">Такого клиента нет.</div></div>` };
  const reqs = m.clientRequests(c.id);
  const active = reqs.filter(r => r.status === 'active');
  const closed = reqs.filter(r => r.status !== 'active');
  const rems = m.clientReminders(c.id);
  const remWait = rems.filter(r => r.status === 'waiting');
  const remDone = rems.filter(r => r.status === 'done').reverse();
  const reqCard = r => {
    const b = m.product(r.bundle_id);
    const pr = m.requestProgress(r.id);
    return `<a class="card tight tap" href="#/request/${r.id}"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(b ? m.short(b) : '—')}</span><span class="xs b muted">${b ? esc(m.shapePattern(b)) + ' · ' : ''}запрос от ${fmtDate(r.created_at)}</span><span class="small b">${r.status === 'active' ? `Собрано ${pr.got} из ${pr.need} · ждёт ${pr.waiting}` : `закрыт ${fmtDate(r.closed_at)} · собрано ${pr.got} из ${pr.need}`}</span></a>`;
  };
  const html = `${top({ title: c.name, right: `<button class="btn sm" id="edit">Изменить</button>` })}
  <div class="content">
    <div class="col" style="gap:4px"><span style="font-size:15px;font-weight:600">${esc(c.phone || 'Телефон не указан')}</span>${c.is_archived ? '<span class="tag gray">клиент в архиве</span>' : ''}</div>
    ${phoneRow(c)}
    <div class="card tight tap" id="note"><span class="xs b muted">ЗАМЕТКИ</span><span style="font-size:14px;white-space:pre-wrap;line-height:1.4">${c.note ? esc(c.note) : '<span class="muted">Нажмите, чтобы добавить заметку</span>'}</span></div>
    <div class="between" style="align-items:center"><span class="label">Напоминания</span><button class="linkbtn small" id="addrem">${icon.plus}Напоминание</button></div>
    ${remWait.length ? remWait.map(r => `<div class="card tight tap ${r.remind_at < nowISO() ? 'warn' : ''}" data-rem="${r.id}"><span class="xs b" style="color:${r.remind_at < nowISO() ? 'var(--warn)' : 'var(--blue)'}">${r.remind_at < nowISO() ? 'ПРОСРОЧЕНО · ' : ''}${esc(humanDT(r.remind_at))}</span>${r.note ? `<span class="small">${esc(r.note)}</span>` : ''}</div>`).join('') : '<span class="small muted">Нет запланированных звонков</span>'}
    <div class="between" style="align-items:center"><span class="label">Собирает</span><a class="linkbtn small" href="#/client/${c.id}/new">${icon.plus}Новый запрос</a></div>
    ${active.length ? active.map(reqCard).join('') : '<span class="small muted">Активных запросов нет</span>'}
    ${closed.length ? `<span class="label">Закрытые запросы</span>${closed.map(reqCard).join('')}` : ''}
    ${remDone.length ? `<span class="label">История звонков</span><div class="list">${remDone.slice(0, 20).map(r => `<div class="li"><span class="small">${esc(r.note || 'Звонок')}</span><span class="xs muted nowrap">${fmtDate(r.done_at || r.remind_at)}</span></div>`).join('')}</div>` : ''}
    <button class="btn" id="arch" style="margin-top:12px">${c.is_archived ? 'Вернуть из архива' : 'Перенести клиента в архив'}</button>
  </div>`;
  return {
    html, backTo: '#/clients',
    bind(root) {
      root.querySelector('#edit').onclick = () => newClientSheet(ctx, () => ctx.refresh(), c);
      root.querySelector('#note').onclick = () => sheet(`<h1 class="h-screen">Заметки</h1><label class="field"><textarea id="t" rows="6">${esc(c.note ?? '')}</textarea></label><button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
        el.querySelector('#ok').onclick = async () => { db.put('client', { ...c, note: el.querySelector('#t').value.trim() || null }); await ctx.save(); close(); ctx.refresh(); };
      });
      root.querySelector('#addrem').onclick = () => newReminderSheet(ctx, c);
      root.querySelectorAll('[data-rem]').forEach(el => el.onclick = () => reminderSheet(ctx, Number(el.dataset.rem)));
      root.querySelector('#arch').onclick = async () => {
        if (!c.is_archived && !(await confirmSheet('Перенести клиента в архив? Он перестанет попадать в подбор. История сохранится.', 'В архив'))) return;
        db.put('client', { ...c, is_archived: c.is_archived ? 0 : 1 });
        await ctx.save(c.is_archived ? 'Клиент возвращён' : 'Клиент в архиве');
        ctx.refresh();
      };
    },
  };
}

// ================= Напоминания =================
export function newReminderSheet(ctx, c, { request_id = null } = {}) {
  sheet(`<h1 class="h-screen">Напоминание</h1><span class="small muted">Позвонить: ${esc(c.name)}</span>
    ${reminderPicker({ none: false })}
    <label class="field"><span class="fl">Заметка</span><textarea id="nt" rows="2" placeholder="Что сказать или уточнить"></textarea></label>
    <button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
    el.querySelector('#ok').onclick = async () => {
      const when = readReminderPicker(el);
      if (!when) { toast('Выберите дату и время'); return; }
      ctx.m.addReminder({ client_id: c.id, request_id, remind_at: when, note: el.querySelector('#nt').value });
      await ctx.save('Напоминание сохранено');
      close(); ctx.refresh();
    };
  });
}

export function reminderSheet(ctx, rid) {
  const { db } = ctx;
  const r = db.get('reminder', rid);
  if (!r) return;
  const c = db.get('client', r.client_id);
  sheet(`<div class="col"><span class="xs b" style="color:var(--blue)">${esc(humanDT(r.remind_at))}</span><h1 class="h-screen">${esc(c?.name ?? '—')}</h1>${r.note ? `<span class="small" style="line-height:1.4">${esc(r.note)}</span>` : ''}</div>
    ${c?.phone ? phoneRow(c) : ''}
    <button class="btn primary" id="done">${icon.ok} Выполнено</button>
    ${reminderPicker({ none: false }).replace('Напомнить перезвонить', 'Перенести на')}
    <button class="btn soft" id="move">Перенести</button>
    <a class="btn" href="#/client/${r.client_id}">Карточка клиента</a>`, (el, close) => {
    el.querySelector('#done').onclick = async () => { db.put('reminder', { ...r, status: 'done', done_at: nowISO() }); await ctx.save('Отмечено'); close(); ctx.refresh(); };
    el.querySelector('#move').onclick = async () => {
      const when = readReminderPicker(el);
      if (!when) return;
      db.put('reminder', { ...r, remind_at: when });
      await ctx.save('Перенесено'); close(); ctx.refresh();
    };
    el.querySelector('a.btn[href^="#/client"]').addEventListener('click', () => close());
  });
}

// ================= Новый запрос =================
export function newRequest(ctx, [cid, pid], query) {
  const { db, m } = ctx;
  const c = db.get('client', Number(cid));
  if (!c) return { html: `${top({ title: 'Клиент не найден' })}` };
  if (!pid) return pickBundle(ctx, c);
  const bundle = m.product(pid);
  const key = `${cid}|${pid}`;
  const st = ctx.state.newReq?.key === key ? ctx.state.newReq : (ctx.state.newReq = {
    key,
    lines: m.leaves(bundle.id).map(l => ({ product_id: l.product.id, qty: l.qty, full: l.qty })),
    similar: [],
  });
  const total = () => st.lines.reduce((s, l) => s + l.qty, 0) + st.similar.reduce((s, l) => s + l.qty, 0);
  const nItems = m.leaves(bundle.id).reduce((s, l) => s + l.qty, 0);
  const price = m.currentPrice(bundle.id);
  const html = `${top({ title: 'Новый запрос' })}
  <div class="content" style="gap:10px">
    <span class="fl">Клиент: ${esc(c.name)}</span>
    <div class="col" style="gap:6px"><span class="fl">Какой комплект собирает</span>
      <div class="card tight sel" style="flex-direction:row;align-items:center;gap:10px"><div class="col grow" style="gap:2px"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(m.short(bundle))}</span><span class="xs b muted">${esc(m.shapePattern(bundle))}</span><span class="xs b muted">${bundle.article ? 'арт. ' + esc(bundle.article) + ' · ' : ''}${nItems} ${plural(nItems, 'предмет', 'предмета', 'предметов')}${price != null ? ' · ' + rub(price) : ''}</span></div><a class="btn sm soft" href="#/client/${c.id}/new">Сменить</a></div></div>
    <span class="fl" style="margin-top:4px">Состав из каталога — уберите то, что уже есть</span>
    ${st.lines.map((l, i) => {
      const p = m.product(l.product_id);
      const pr = m.currentPrice(p.id);
      return `<div class="card tight" style="flex-direction:row;align-items:center;gap:10px;${l.qty === 0 ? 'opacity:.55' : ''}"><div class="col grow" style="gap:2px"><span style="font-size:15px;font-weight:700">${esc(m.short(p))}</span><span class="xs b muted">${p.article ? 'арт. ' + esc(p.article) : 'без артикула'}</span>${!p.sold_separately ? '<span class="tag violet">только в составе</span>' : ''}<span class="xs muted">в комплекте ${l.full} · ${pr != null ? rub(pr) : 'цены нет'}${l.qty === 0 ? ' · есть у клиента' : ''}</span></div>${stepperHTML('l' + i, l.qty, 0, 99)}</div>`;
    }).join('')}
    ${st.similar.map((s, i) => `<div class="card tight" style="flex-direction:row;align-items:center;gap:10px"><div class="col grow"><span class="tag violet">что-то подобное</span><span style="font-size:14px;font-weight:700">${esc(m.kindName(s.kind_id))}</span><span class="xs muted">${esc(m.shapeName(s.shape_id))} · ${esc(m.patternName(s.pattern_id))}</span></div>${stepperHTML('s' + i, s.qty, 0, 99)}</div>`).join('')}
    <button class="linkbtn" id="sim">${icon.plus}Добавить «что-то подобное»</button>
    <label class="field"><span class="fl">Заметка к запросу</span><textarea id="nt" rows="2" placeholder="необязательно">${esc(st.note ?? '')}</textarea></label>
    <div class="note blue" id="sum"></div>
    <button class="btn primary big" id="ok">Записать в лист ожидания</button>
  </div>`;
  return {
    html,
    bind(root) {
      const sum = root.querySelector('#sum');
      const drawSum = () => {
        const withPrice = st.lines.filter(l => l.qty > 0 && m.currentPrice(l.product_id) != null).length;
        const noPrice = st.lines.filter(l => l.qty > 0 && m.currentPrice(l.product_id) == null).length;
        const n = total();
        sum.innerHTML = `<span><span class="b">Будет ждать ${n} ${plural(n, 'предмет', 'предмета', 'предметов')}.</span> ${withPrice ? `Цена на сегодня запомнится у ${withPrice} ${plural(withPrice, 'позиции', 'позиций', 'позиций')}.` : ''} ${noPrice ? `У ${noPrice} ${plural(noPrice, 'позиции', 'позиций', 'позиций')} своей цены нет: они продаются только в составе.` : ''}</span>`;
        root.querySelector('#ok').disabled = n === 0;
      };
      bindSteppers(root, (name, n, stepper) => {
        if (name[0] === 'l') st.lines[Number(name.slice(1))].qty = n;
        else st.similar[Number(name.slice(1))].qty = n;
        stepper.closest('.card').style.opacity = n === 0 ? '.55' : '';
        drawSum();
      });
      root.querySelector('#nt').oninput = e => { st.note = e.target.value; };
      root.querySelector('#sim').onclick = () => similarSheet(ctx, bundle, s => { st.similar.push(s); ctx.refresh(); });
      root.querySelector('#ok').onclick = async () => {
        const r = m.createRequest(c.id, bundle.id, st.lines, st.similar.filter(s => s.qty > 0), st.note?.trim() || null);
        ctx.state.newReq = null;
        await ctx.save('Записано в лист ожидания');
        location.replace('#/request/' + r.id);
      };
      drawSum();
    },
  };
}

function pickBundle(ctx, c) {
  const { m } = ctx;
  const st = ctx.state.pickBundle ??= { q: '', all: false };
  const html = `${top({ title: 'Что собирает?' })}
  <div class="content" style="gap:10px">
    <span class="fl">Клиент: ${esc(c.name)}</span>
    <div class="search" style="height:50px;box-shadow:none">${icon.search}<input id="q" type="search" placeholder="Сервиз: рисунок, форма или артикул" value="${esc(st.q)}"></div>
    <label class="row small b"><input type="checkbox" id="all" ${st.all ? 'checked' : ''} style="width:22px;height:22px"> Искать среди всех товаров, не только комплектов</label>
    <div id="res" class="col" style="gap:8px"></div>
  </div>`;
  return {
    html,
    bind(root) {
      const draw = () => {
        const { items } = m.searchProducts(st.q, { limit: 40, bundlesOnly: !st.all });
        root.querySelector('#res').innerHTML = st.q.trim() ? items.map(p => `<a class="card tight tap" href="#/client/${c.id}/new/${p.id}"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(m.short(p))}</span><span class="xs b muted">${p.article ? 'арт. ' + esc(p.article) : ''}${m.shapePattern(p) ? ' · ' + esc(m.shapePattern(p)) : ''}</span></a>`).join('') || '<div class="empty">Ничего не нашлось</div>' : '<div class="empty">Начните вводить рисунок или название сервиза, например «саламандра чайный».</div>';
      };
      let t;
      const q = root.querySelector('#q');
      q.oninput = e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; draw(); }, 150); };
      root.querySelector('#all').onchange = e => { st.all = e.target.checked; draw(); };
      draw();
      setTimeout(() => q.focus(), 50);
    },
  };
}

function similarSheet(ctx, bundle, onAdd) {
  const { m } = ctx;
  sheet(`<h1 class="h-screen">Что-то подобное</h1><span class="small muted">Например: любая обеденная тарелка этой формы и рисунка. Подойдёт любой товар с таким видом, формой и рисунком.</span>
    <label class="field"><span class="fl">Вид изделия</span><select id="kd">${optionsHTML(m.sorted('product_kind').filter(k => k.name !== 'Упаковка'), null, '— выберите —')}</select></label>
    <label class="field"><span class="fl">Форма</span><select id="sh">${optionsHTML(m.sorted('shape'), bundle?.shape_id, '— выберите —')}</select></label>
    <label class="field"><span class="fl">Рисунок</span><select id="pt">${optionsHTML(m.sorted('pattern'), bundle?.pattern_id, '— выберите —')}</select></label>
    <div class="between" style="align-items:center"><span class="fl">Сколько нужно</span>${stepperHTML('q', 1, 1, 99)}</div>
    <button class="btn primary big" id="ok">Добавить</button>`, (el, close) => {
    bindSteppers(el);
    el.querySelector('#ok').onclick = () => {
      const v = s => Number(el.querySelector(s).value) || null;
      const s = { kind_id: v('#kd'), shape_id: v('#sh'), pattern_id: v('#pt'), qty: stepVal(el, 'q') };
      if (!s.kind_id || !s.shape_id || !s.pattern_id) { toast('Выберите вид, форму и рисунок'); return; }
      close();
      onAdd(s);
    };
  });
}

// ================= Запрос =================
export function request(ctx, [id]) {
  const { db, m } = ctx;
  const r = db.get('request', Number(id));
  if (!r) return { html: `${top({ title: 'Запрос не найден' })}` };
  const c = db.get('client', r.client_id);
  const b = m.product(r.bundle_id);
  const items = m.requestItems(r.id);
  const pr = m.requestProgress(r.id);
  const waiting = items.filter(i => i.status === 'waiting');
  const purchases = db.all('purchase').filter(p => items.some(i => i.id === p.request_item_id)).sort((a, b) => b.purchased_at.localeCompare(a.purchased_at) || b.id - a.id);
  const notNeeded = items.filter(i => i.status === 'not_needed');
  const itemCard = ri => {
    const p = ri.product_id ? m.product(ri.product_id) : null;
    const bought = m.bought(ri.id);
    const now = p ? m.currentPrice(p.id) : null;
    const priceTxt = !p ? 'цена не указана' : ri.price_kop != null ? `при записи ${rub(ri.price_kop)}${now != null ? ` · сейчас ${rub(now)}` : ''}` : now != null ? `сейчас ${rub(now)}` : 'цены нет';
    return `<div class="card tight tap" data-ri="${ri.id}"><div class="between" style="align-items:flex-start"><div class="col" style="gap:3px">
      ${p ? `<span style="font-size:15px;font-weight:700">${esc(m.short(p))}</span><span class="xs b muted">${p.article ? 'арт. ' + esc(p.article) : 'без артикула'}</span>${!p.sold_separately ? '<span class="tag violet">только в составе</span>' : ''}`
        : `<span class="tag violet">что-то подобное</span><span style="font-size:15px;font-weight:700">${esc(m.kindName(ri.kind_id))}</span><span class="xs b muted">${esc(m.shapeName(ri.shape_id))} · ${esc(m.patternName(ri.pattern_id))}</span>`}
      <span class="small muted">${bought ? `${bought} из ${ri.qty_needed} уже куплены · ` : ''}${priceTxt}</span>${ri.note ? `<span class="xs muted">${esc(ri.note)}</span>` : ''}
    </div><span class="qty">${Math.max(0, ri.qty_needed - bought)} шт</span></div></div>`;
  };
  const html = `${top({ title: c?.name ?? '' })}
  <div class="content" style="gap:10px">
    <div class="col" style="gap:3px"><h1 style="font-size:19px;font-weight:800;line-height:1.25">${b ? `<a href="#/product/${b.id}" style="color:var(--ink)">${esc(m.short(b))}</a>` : '—'}</h1>
      <span class="xs b muted">${b?.article ? 'арт. ' + esc(b.article) + ' · ' : ''}${b ? esc(m.shapePattern(b)) + ' · ' : ''}запрос от ${fmtDate(r.created_at)}</span>
      <span class="small b">${r.status === 'active' ? `Собрано ${pr.got} из ${pr.need} · ждёт ${pr.waiting}` : `Запрос закрыт ${fmtDate(r.closed_at)} · собрано ${pr.got} из ${pr.need}`}</span></div>
    ${r.note ? `<div class="card tight"><span class="xs b muted">ЗАМЕТКИ</span><span class="small" style="white-space:pre-wrap">${esc(r.note)}</span></div>` : ''}
    <span class="label">Ждёт</span>
    ${waiting.length ? waiting.map(itemCard).join('') : '<span class="small muted">Ничего не ждёт</span>'}
    <button class="linkbtn" id="sim">${icon.plus}Добавить «что-то подобное»</button>
    ${purchases.length ? `<span class="label">Уже собрано</span><div class="card tight" style="gap:6px;font-size:14px">${purchases.map(p => { const ri = items.find(i => i.id === p.request_item_id); return `<div class="between"><span>${esc(m.itemLabel(ri))}${p.note ? `<br><span class="xs muted">${esc(p.note)}</span>` : ''}</span><span class="muted nowrap">${p.qty} шт · ${fmtShort(p.purchased_at)}</span></div>`; }).join('')}</div>` : ''}
    ${notNeeded.length ? `<span class="label">Не нужно</span><div class="list">${notNeeded.map(ri => `<div class="li tap" data-ri="${ri.id}"><span class="small">${esc(m.itemLabel(ri))}${ri.product_id && m.product(ri.product_id)?.article ? `<br><span class="xs muted">${esc(m.product(ri.product_id).article)}</span>` : ''}</span><span class="xs muted">${esc(ri.note || 'не нужно')}</span></div>`).join('')}</div>` : ''}
    <div class="grid2" style="margin-top:8px"><button class="btn" id="rem">Напоминание</button><button class="btn" id="note">Заметка</button></div>
    <button class="btn" id="close">${r.status === 'active' ? 'Закрыть запрос (в архив)' : 'Вернуть запрос в работу'}</button>
  </div>`;
  return {
    html, backTo: '#/client/' + r.client_id,
    bind(root) {
      root.querySelectorAll('[data-ri]').forEach(el => el.onclick = () => itemSheet(ctx, Number(el.dataset.ri)));
      root.querySelector('#sim').onclick = () => similarSheet(ctx, b, async s => { m.addSimilar(r.id, s); await ctx.save('Добавлено'); ctx.refresh(); });
      root.querySelector('#rem').onclick = () => newReminderSheet(ctx, c, { request_id: r.id });
      root.querySelector('#note').onclick = () => sheet(`<h1 class="h-screen">Заметка к запросу</h1><label class="field"><textarea id="t" rows="5">${esc(r.note ?? '')}</textarea></label><button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
        el.querySelector('#ok').onclick = async () => { db.put('request', { ...r, note: el.querySelector('#t').value.trim() || null }); await ctx.save(); close(); ctx.refresh(); };
      });
      root.querySelector('#close').onclick = async () => {
        if (r.status === 'active') {
          if (!(await confirmSheet('Закрыть запрос? Несобранные позиции будут отмечены «не нужно». Запрос останется в архиве.', 'Закрыть'))) return;
          m.closeRequest(r.id);
        } else db.put('request', { ...r, status: 'active', closed_at: null });
        await ctx.save(); ctx.refresh();
      };
    },
  };
}

function itemSheet(ctx, riId) {
  const { m } = ctx;
  const ri = ctx.db.get('request_item', riId);
  const rem = m.remaining(ri);
  const label = m.itemLabel(ri);
  if (ri.status !== 'waiting') {
    sheet(`<h1 class="h-screen">${esc(label)}</h1><span class="small muted">${ri.status === 'bought' ? 'Куплено' : 'Не нужно'}${ri.closed_at ? ' · ' + fmtDate(ri.closed_at) : ''}</span>
      ${ri.status === 'not_needed' ? '<button class="btn primary big" id="re">Вернуть в ожидание</button>' : ''}`, (el, close) => {
      el.querySelector('#re')?.addEventListener('click', async () => {
        m.reopenItem(ri.id);
        await ctx.save('Позиция снова ждёт'); close(); ctx.refresh();
      });
    });
    return;
  }
  sheet(`<h1 class="h-screen">${esc(label)}</h1><span class="small muted">Ждёт ${rem} шт${ri.product_id ? '' : ' · подойдёт любой товар с таким видом, формой и рисунком'}</span>
    <div class="between" style="align-items:center;padding:12px 14px;background:var(--bg);border-radius:14px"><span style="font-size:15px;font-weight:600">Купил(а)</span>${stepperHTML('n', rem, 1, rem)}</div>
    <label class="field"><span class="fl">Дата покупки</span><input id="dt" type="date" value="${todayISO()}"></label>
    <button class="btn primary big" id="buy">Записать покупку</button>
    <label class="field"><span class="fl">Если не нужно — почему</span><input id="why" placeholder="например, купила в другом месте"></label>
    <button class="btn" id="no">Не нужно</button>`, (el, close) => {
    bindSteppers(el);
    el.querySelector('#buy').onclick = async () => { m.buy(ri.id, stepVal(el, 'n'), null, el.querySelector('#dt').value || todayISO()); await ctx.save('Покупка записана'); close(); ctx.refresh(); };
    el.querySelector('#no').onclick = async () => { m.notNeeded(ri.id, el.querySelector('#why').value.trim() || 'не нужно'); await ctx.save('Отмечено «не нужно»'); close(); ctx.refresh(); };
  });
}
