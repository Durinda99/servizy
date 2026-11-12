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

/** Переключатель «По частям / Целиком» (эскизы 7, 16) */
export const modeToggle = mode => `<div class="col" style="gap:6px"><span class="fl">Как ждёт</span>
  <div class="grid2" style="gap:6px;padding:4px;background:var(--line2);border-radius:14px">
    <button class="btn" data-mode="parts" style="height:auto;min-height:52px;flex-direction:column;gap:0;border-radius:11px;${mode === 'parts' ? 'border:1.5px solid var(--blue);background:var(--card);color:var(--ink)' : 'border:none;background:transparent;color:var(--muted)'}"><span>По частям</span><span class="xs" style="font-weight:500">предметы состава</span></button>
    <button class="btn" data-mode="whole" style="height:auto;min-height:52px;flex-direction:column;gap:0;border-radius:11px;${mode === 'whole' ? 'border:1.5px solid var(--blue);background:var(--card);color:var(--ink)' : 'border:none;background:transparent;color:var(--muted)'}"><span>Целиком</span><span class="xs" style="font-weight:500">одной позицией</span></button>
  </div></div>`;
export const compText = (m, pid) => m.bundleItems(pid).filter(b => !b.product.is_packaging).map(b => `${esc(m.short(b.product))} ${b.quantity}`).join(' · ');

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
  if (!c) return { html: `${top({ title: 'Клиент не найден' })}<div class="content"><div class="empty">Такого клиента нет.</div></div>`, backTo: '#/clients' };
  const reqs = m.clientRequests(c.id);
  const reqSummary = r => {
    const items = m.requestItems(r.id);
    const pc = db.all('purchase').filter(p => items.some(i => i.id === p.request_item_id)).length;
    return `${r.status === 'active' ? 'ждёт' : r.status === 'closed' ? 'всё куплено' : 'снят с ожидания'} · ${items.length} ${plural(items.length, 'позиция', 'позиции', 'позиций')} · ${pc} ${plural(pc, 'покупка', 'покупки', 'покупок')}`;
  };
  if (c.is_archived) {
    const html = `${top({ title: 'Клиент в архиве' })}
    <div class="content" style="gap:12px;padding:16px 20px">
      <div class="col" style="gap:4px"><h1 style="font-size:24px;font-weight:800">${esc(c.name)}</h1><span style="font-size:15px;font-weight:600" class="muted">${esc(c.phone || 'без телефона')}</span><span class="tag gray">В АРХИВЕ${c.archived_at ? ' С ' + fmtDate(c.archived_at) : ''}</span></div>
      ${c.note ? `<div class="card tight"><span class="xs b muted">ЗАМЕТКИ</span><span class="small" style="white-space:pre-wrap">${esc(c.note)}</span></div>` : ''}
      ${reqs.map(r => `<a class="card tight tap" href="#/request/${r.id}" style="gap:2px"><span style="font-size:14px;font-weight:700">${esc(m.requestTitle(r))}</span><span class="small muted">${reqSummary(r)}</span></a>`).join('') || '<span class="small muted">Запросов не было</span>'}
      <button class="btn soft" id="unarch">Вернуть из архива</button>
      <button class="btn" id="del" style="border:1.5px solid #B42318;color:#B42318;font-weight:800">Удалить навсегда</button>
    </div>`;
    return {
      html, backTo: '#/archive/clients',
      bind(root) {
        root.querySelector('#unarch').onclick = async () => { db.put('client', { ...c, is_archived: 0, archived_at: null }); await ctx.save('Клиент возвращён'); ctx.refresh(); };
        root.querySelector('#del').onclick = () => deleteClientDialog(ctx, c);
      },
    };
  }
  const active = reqs.filter(r => r.status === 'active');
  const closed = reqs.filter(r => r.status !== 'active');
  const rems = m.clientReminders(c.id);
  const remWait = rems.filter(r => r.status === 'waiting');
  const remDone = rems.filter(r => r.status === 'done').reverse();
  const reqCard = r => {
    const pr = m.requestProgress(r.id);
    return `<a class="card tight tap" href="#/request/${r.id}"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(m.requestTitle(r))}</span><span class="xs b muted">${esc(m.requestSub(r))} · запрос от ${fmtDate(r.created_at)}</span><span class="small b">${r.status === 'active' ? `Собрано ${pr.got} из ${pr.need} · ждёт ${pr.waiting}` : `${r.status === 'closed' ? 'всё куплено' : 'снят с ожидания'} ${fmtDate(r.closed_at)} · собрано ${pr.got}`}</span></a>`;
  };
  const html = `${top({ title: c.name, right: `<button class="btn sm" id="edit">Изменить</button>` })}
  <div class="content">
    <div class="col" style="gap:4px"><span style="font-size:15px;font-weight:600">${esc(c.phone || 'Телефон не указан')}</span></div>
    ${phoneRow(c)}
    <div class="card tight tap" id="note"><span class="xs b muted">ЗАМЕТКИ</span><span style="font-size:14px;white-space:pre-wrap;line-height:1.4">${c.note ? esc(c.note) : '<span class="muted">Нажмите, чтобы добавить заметку</span>'}</span></div>
    <div class="between" style="align-items:center"><span class="label">Напоминания</span><button class="linkbtn small" id="addrem">${icon.plus}Напоминание</button></div>
    ${remWait.length ? remWait.map(r => `<div class="card tight tap ${r.remind_at < nowISO() ? 'warn' : ''}" data-rem="${r.id}"><span class="xs b" style="color:${r.remind_at < nowISO() ? 'var(--warn)' : 'var(--blue)'}">${r.remind_at < nowISO() ? 'ПРОСРОЧЕНО · ' : ''}${esc(humanDT(r.remind_at))}</span>${r.note ? `<span class="small">${esc(r.note)}</span>` : ''}</div>`).join('') : '<span class="small muted">Нет запланированных звонков</span>'}
    <div class="between" style="align-items:center"><span class="label">Ждёт</span><a class="linkbtn small" href="#/client/${c.id}/new">${icon.plus}Новый запрос</a></div>
    ${active.length ? active.map(reqCard).join('') : '<span class="small muted">Активных запросов нет</span>'}
    <div class="row wrap" style="gap:4px 16px"><a class="linkbtn small" href="#/search">${icon.plus}Записать на товар (через поиск)</a><button class="linkbtn small" id="similar">${icon.plus}Что-то подобное</button></div>
    ${closed.length ? `<span class="label">Архив запросов</span>${closed.map(reqCard).join('')}` : ''}
    ${remDone.length ? `<span class="label">История звонков</span><div class="list">${remDone.slice(0, 20).map(r => `<div class="li"><span class="small">${esc(r.note || 'Звонок')}</span><span class="xs muted nowrap">${fmtDate(r.done_at || r.remind_at)}</span></div>`).join('')}</div>` : ''}
    <button class="btn" id="arch" style="margin-top:12px">Перенести клиента в архив</button>
  </div>`;
  return {
    html, backTo: '#/clients',
    bind(root) {
      root.querySelector('#edit').onclick = () => newClientSheet(ctx, () => ctx.refresh(), c);
      root.querySelector('#note').onclick = () => sheet(`<h1 class="h-screen">Заметки</h1><label class="field"><textarea id="t" rows="6">${esc(c.note ?? '')}</textarea></label><button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
        el.querySelector('#ok').onclick = async () => { db.put('client', { ...c, note: el.querySelector('#t').value.trim() || null }); await ctx.save(); close(); ctx.refresh(); };
      });
      root.querySelector('#addrem').onclick = () => newReminderSheet(ctx, c);
      root.querySelector('#similar').onclick = () => similarSheet(ctx, null, async s => {
        const r = m.createSimilarRequest(c.id, s);
        await ctx.save('Записано в лист ожидания');
        ctx.go('#/request/' + r.id);
      });
      root.querySelectorAll('[data-rem]').forEach(el => el.onclick = () => reminderSheet(ctx, Number(el.dataset.rem)));
      root.querySelector('#arch').onclick = async () => {
        if (!(await confirmSheet('Перенести клиента в архив? Он перестанет попадать в подбор. История сохранится, клиента можно будет вернуть.', 'В архив'))) return;
        db.put('client', { ...c, is_archived: 1, archived_at: todayISO() });
        await ctx.save('Клиент в архиве');
        ctx.refresh();
      };
    },
  };
}

/** Удаление клиента навсегда: показывает, что исчезнет, и спрашивает ещё раз (ТЗ 4.5) */
function deleteClientDialog(ctx, c) {
  const f = ctx.m.clientFootprint(c.id);
  const n = (x, a, b, d) => `${x} ${plural(x, a, b, d)}`;
  sheet(`<h2 style="font-size:19px;font-weight:800;line-height:1.3">Удалить клиента «${esc(c.name)}» навсегда?</h2>
    <div class="col" style="gap:6px;padding:12px 14px;background:#FDF1EF;border-radius:12px;font-size:14px;line-height:1.4"><span class="b">Исчезнут:</span>
      <span>карточка клиента · ${n(f.reqs.length, 'запрос', 'запроса', 'запросов')} · ${n(f.items.length, 'позиция', 'позиции', 'позиций')} · ${n(f.purchases.length, 'покупка', 'покупки', 'покупок')} · ${n(f.reminders.length, 'напоминание', 'напоминания', 'напоминаний')}</span>
      <span class="small muted">Товары, комплекты и цены не затрагиваются.</span></div>
    <span style="font-size:14px;line-height:1.4">Вернуть данные будет нельзя. Они останутся только в резервных копиях, сделанных раньше.</span>
    <div class="grid2"><button class="btn" id="no">Отмена</button><button class="btn" id="yes" style="background:#B42318;color:#fff;border:none;font-weight:800">Да, удалить</button></div>`, (el, close) => {
    el.querySelector('#no').onclick = close;
    el.querySelector('#yes').onclick = async () => {
      ctx.m.deleteClient(c.id);
      await ctx.save('Клиент удалён');
      close();
      location.replace('#/archive/clients');
    };
  });
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
    mode: query.mode === 'whole' ? 'whole' : 'parts',
    wholeQty: 1,
  });
  const canWhole = m.isBundle(bundle.id);
  if (!canWhole) st.mode = 'parts';
  const whole = st.mode === 'whole';
  const total = () => st.lines.reduce((s, l) => s + l.qty, 0) + st.similar.reduce((s, l) => s + l.qty, 0);
  const nItems = m.leaves(bundle.id).reduce((s, l) => s + l.qty, 0);
  const price = m.currentPrice(bundle.id);
  const html = `${top({ title: 'Новый запрос' })}
  <div class="content" style="gap:10px">
    <span class="fl">Клиент: ${esc(c.name)}</span>
    <div class="col" style="gap:6px"><span class="fl">${whole ? 'Какой комплект ждёт' : 'Какой комплект собирает'}</span>
      <div class="card tight sel" style="flex-direction:row;align-items:center;gap:10px"><div class="col grow" style="gap:2px"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(m.short(bundle))}</span><span class="xs b muted">${esc(m.shapePattern(bundle))}</span><span class="xs b muted">${bundle.article ? 'арт. ' + esc(bundle.article) + ' · ' : ''}${nItems} ${plural(nItems, 'предмет', 'предмета', 'предметов')}${price != null ? ' · ' + rub(price) : ''}</span></div><a class="btn sm soft" href="#/client/${c.id}/new">Сменить</a></div></div>
    ${canWhole ? modeToggle(st.mode) : ''}
    ${whole ? `<span class="fl" style="margin-top:4px">В листе ожидания будет одна позиция</span>
      <div class="card tight" style="flex-direction:row;align-items:center;gap:10px"><div class="col grow" style="gap:2px"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(m.short(bundle))} целиком</span><span class="xs b muted">${bundle.article ? 'арт. ' + esc(bundle.article) : ''}${price != null ? ' · ' + rub(price) : ''}</span><span class="tag violet">комплект целиком</span></div>${stepperHTML('w', st.wholeQty, 1, 99)}</div>
      <div class="card tight" style="border-style:dashed"><span class="small b">Что внутри</span><span class="small muted" style="line-height:1.4">${compText(m, bundle.id)}</span></div>
      <label class="field"><span class="fl">Заметка к запросу</span><textarea id="nt" rows="2" placeholder="необязательно">${esc(st.note ?? '')}</textarea></label>
      <div class="note blue"><span><span class="b">Клиент попадёт в подбор, когда придёт этот комплект.</span> Если придёт только предмет из него, клиент будет в конце списка с пометкой «ждёт комплект целиком».<br>Передумает ждать целиком — позицию можно разбить на состав в запросе.</span></div>
      <button class="btn primary big" id="okw">Записать в лист ожидания</button>
    </div>` : `<span class="fl" style="margin-top:4px">Состав из каталога — уберите то, что уже есть</span>
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
  </div>`}`;
  return {
    html,
    bind(root) {
      root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; ctx.refresh(); });
      if (whole) {
        bindSteppers(root, (_, n) => { st.wholeQty = n; });
        root.querySelector('#nt').oninput = e => { st.note = e.target.value; };
        root.querySelector('#okw').onclick = async () => {
          const r = m.createRequest(c.id, bundle.id, [], [], st.note?.trim() || null, { whole: st.wholeQty });
          ctx.state.newReq = null;
          await ctx.save('Записано в лист ожидания');
          location.replace('#/request/' + r.id);
        };
        return;
      }
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
const REASONS = ['Купил в другом месте', 'Передумал', 'Уже есть'];
const STATUS = { active: 'ждёт', closed: 'всё куплено', withdrawn: 'снят с ожидания' };

export function request(ctx, [id]) {
  const { db, m } = ctx;
  const r = db.get('request', Number(id));
  if (!r) return { html: `${top({ title: 'Запрос не найден' })}<div class="content"><div class="empty">Такого запроса нет.</div></div>` };
  const c = db.get('client', r.client_id);
  const b = m.requestProduct(r);
  const items = m.requestItems(r.id);
  const pr = m.requestProgress(r.id);
  const waiting = items.filter(i => i.status === 'waiting');
  const withdrawn = items.filter(i => i.status === 'withdrawn');
  const splitDone = items.filter(i => i.status === 'split');
  const bought = items.filter(i => i.status === 'bought');
  const purchases = db.all('purchase').filter(p => items.some(i => i.id === p.request_item_id));
  // «Уже собрано»: покупки, сгруппированные по дате
  const byDate = new Map();
  for (const p of purchases) {
    if (!byDate.has(p.purchased_at)) byDate.set(p.purchased_at, []);
    byDate.get(p.purchased_at).push(p);
  }
  const collected = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, list]) => {
    const parts = list.map(p => `${esc(m.itemLabel(items.find(i => i.id === p.request_item_id)))} ${p.qty}`).join(' · ');
    const notes = [...new Set(list.map(p => p.note).filter(Boolean))].join('; ');
    return `<div class="between small" style="align-items:flex-start;padding:10px 14px;background:var(--card);border:1px solid var(--line);border-radius:14px"><span>${parts}${notes ? `<br><span class="xs muted">${esc(notes)}</span>` : ''}</span><span class="muted nowrap">${fmtShort(d)}</span></div>`;
  }).join('');
  const meta = ri => {
    const p = ri.product_id ? m.product(ri.product_id) : null;
    const got = m.bought(ri.id);
    const now = p ? m.currentPrice(p.id) : null;
    const price = !p ? '' : ri.price_kop != null ? `при записи ${rub(ri.price_kop)}${now != null ? `, сейчас ${rub(now)}` : ''}` : now != null ? `сейчас ${rub(now)}` : '';
    return [p?.article, got ? `куплено ${got} из ${ri.qty_needed}` : null, p && !p.sold_separately ? 'только в составе' : null, price, ri.updated_at ? `изменено ${fmtShort(ri.updated_at)}` : null].filter(Boolean).join(' · ');
  };
  const title = ri => ri.product_id ? esc(m.itemLabel(ri)) : `<span class="tag violet" style="margin-bottom:2px">что-то подобное</span><br>${esc(m.kindName(ri.kind_id))}`;
  const wholeCard = ri => {
    const p = m.product(ri.product_id);
    const got = m.bought(ri.id);
    const now = m.currentPrice(p.id);
    const price = ri.price_kop != null ? `при записи ${rub(ri.price_kop)}${now != null ? `, сейчас ${rub(now)}` : ''}` : now != null ? `сейчас ${rub(now)}` : 'цены нет';
    return `<div class="card" style="padding:12px;gap:8px;border-radius:14px">
    <div class="between" style="align-items:flex-start"><div class="col" style="gap:3px"><span style="font-size:15px;font-weight:700">${esc(m.short(p))} целиком</span><span class="xs muted">${got ? `куплено ${got} из ${ri.qty_needed} · ` : ''}${esc(price)}</span><span class="tag violet">комплект целиком</span>${ri.note ? `<span class="xs muted">${esc(ri.note)}</span>` : ''}</div><span class="qty">ждёт ${m.remaining(ri)}</span></div>
    <div class="inset xs muted" style="line-height:1.4">${compText(m, p.id)}</div>
    <div class="grid2" style="gap:6px"><button class="btn primary" style="height:44px;border-radius:12px;font-size:13px" data-buy="${ri.id}">Купил</button><button class="btn soft" style="height:44px;border-radius:12px;font-size:13px" data-edit="${ri.id}">Изменить</button>
      <button class="btn" style="height:44px;border-radius:12px;font-size:13px;color:var(--violet);background:var(--violet-soft);border-color:#DCCFEA" data-split="${ri.id}">${icon.split.replace('width="20" height="20"', 'width="16" height="16"')} Разбить на состав</button><button class="btn" style="height:44px;border-radius:12px;font-size:13px" data-wd="${ri.id}">Снять с ожидания</button></div></div>`;
  };
  const waitCard = ri => m.isWhole(ri) ? wholeCard(ri) : `<div class="card" style="padding:12px;gap:8px;border-radius:14px">
    <div class="between" style="align-items:flex-start"><div class="col" style="gap:2px"><span style="font-size:15px;font-weight:700">${title(ri)}</span><span class="xs muted">${ri.product_id ? esc(meta(ri)) : esc(m.shapeName(ri.shape_id) + ' · ' + m.patternName(ri.pattern_id))}</span>${ri.note ? `<span class="xs muted">${esc(ri.note)}</span>` : ''}</div><span class="qty">ждёт ${m.remaining(ri)}</span></div>
    <div class="grid3" style="gap:6px"><button class="btn primary" style="height:44px;border-radius:12px;font-size:13px" data-buy="${ri.id}">Купил</button><button class="btn soft" style="height:44px;border-radius:12px;font-size:13px" data-edit="${ri.id}">Изменить</button><button class="btn" style="height:44px;border-radius:12px;font-size:13px;line-height:1.15" data-wd="${ri.id}">Снять с<br>ожидания</button></div></div>`;
  const wdCard = ri => `<div class="card" style="padding:10px 12px;gap:6px;border-radius:14px;background:#FBFAF7">
    <div class="between"><span style="font-size:14px;font-weight:700">${esc(m.itemLabel(ri))} · ${ri.qty_needed} шт</span><span class="xs muted">${fmtShort(ri.closed_at)}</span></div>
    <span class="xs muted">Причина: ${esc(ri.withdraw_reason || '—')}${m.bought(ri.id) ? ` · куплено ${m.bought(ri.id)} шт` : ''}</span>
    <div class="grid2" style="gap:6px"><button class="btn soft" style="height:40px;border-radius:12px;font-size:13px" data-back-item="${ri.id}">Вернуть в ожидание</button><button class="btn danger" style="height:40px;border-radius:12px;font-size:13px;border-color:#F0C7C2;color:#B42318" data-del="${ri.id}">Удалить навсегда</button></div></div>`;
  const status = r.status === 'active' ? '' : ` · <span class="b">${STATUS[r.status]}${r.withdraw_reason ? ': ' + esc(r.withdraw_reason) : ''}</span>`;
  const html = `${top({ title: c?.name ?? '', right: `<button class="linkbtn small" id="sim" style="padding:0 6px">${icon.plus}Подобное</button>` })}
  <div class="content" style="gap:8px">
    <div class="col" style="gap:2px"><h1 style="font-size:18px;font-weight:800;line-height:1.25">${b ? `<a href="#/product/${b.id}" style="color:var(--ink)">${esc(m.requestTitle(r))}</a>` : esc(m.requestTitle(r))}</h1>
      <span class="xs muted">${b?.article ? 'арт. ' + esc(b.article) + ' · ' : ''}${esc(m.requestSub(r))} · с ${fmtDate(r.created_at)} · собрано ${pr.got} из ${pr.need} · ждёт ${pr.waiting}${status}</span></div>
    ${r.note ? `<div class="card tight"><span class="xs b muted">ЗАМЕТКИ</span><span class="small" style="white-space:pre-wrap">${esc(r.note)}</span></div>` : ''}
    <span class="label">Ждёт</span>
    ${waiting.length ? waiting.map(waitCard).join('') : '<span class="small muted">Ничего не ждёт</span>'}
    ${waiting.some(ri => m.isWhole(ri)) ? `<div class="note violet">${icon.split.replace('width="20" height="20"', 'width="16" height="16"')}<span><span class="b">Не дождался целиком?</span> «Разбить на состав» превратит позицию в предметы комплекта. Дата записи ${fmtDate(waiting.find(ri => m.isWhole(ri)).created_at)} и место в очереди сохранятся.</span></div>` : ''}
    ${bought.length ? `<span class="label">Куплено полностью</span><div class="list">${bought.map(ri => `<div class="li"><span class="small">${esc(m.itemLabel(ri))} · ${ri.qty_needed} шт</span><button class="linkbtn xs" data-edit="${ri.id}">Изменить</button></div>`).join('')}</div>` : ''}
    <span class="label">Уже собрано</span>${collected || '<div class="card tight small muted">Пока ничего</div>'}
    ${withdrawn.length ? `<span class="label">Снято с ожидания</span>${withdrawn.map(wdCard).join('')}` : ''}
    ${splitDone.length ? `<span class="label">Разбито на состав</span>${splitDone.map(ri => `<div class="card" style="padding:10px 12px;gap:6px;border-radius:14px;background:#FBFAF7"><div class="between"><span style="font-size:14px;font-weight:700">${esc(m.itemLabel(ri))} · ${ri.qty_needed} шт</span><span class="xs muted">${fmtShort(ri.closed_at)}</span></div><span class="xs muted">Предметы комплекта уже в ожидании${m.bought(ri.id) ? ` · куплено целиком ${m.bought(ri.id)} шт` : ''}. Вернуть нельзя, можно только удалить.</span><button class="btn danger" style="height:40px;border-radius:12px;font-size:13px;border-color:#F0C7C2;color:#B42318" data-del="${ri.id}">Удалить навсегда</button></div>`).join('')}` : ''}
    <div class="grid2" style="margin-top:8px"><button class="btn" id="rem">Напоминание</button><button class="btn" id="note">Заметка</button></div>
    ${r.status === 'active' ? '<button class="btn" id="wdall">Снять весь запрос с ожидания</button>'
      : `<button class="btn soft" id="reopen">Вернуть запрос в ожидание</button><button class="btn danger" id="delreq" style="border-color:#F0C7C2;color:#B42318">Удалить запрос навсегда</button>`}
  </div>`;
  return {
    html, backTo: '#/client/' + r.client_id,
    bind(root) {
      const on = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener('click', () => fn(el)));
      on('[data-buy]', el => buySheet(ctx, Number(el.dataset.buy)));
      on('[data-edit]', el => editItemSheet(ctx, Number(el.dataset.edit)));
      on('[data-wd]', el => withdrawSheet(ctx, { riId: Number(el.dataset.wd) }));
      on('[data-split]', el => splitSheet(ctx, Number(el.dataset.split)));
      on('[data-back-item]', async el => { m.reopenItem(Number(el.dataset.backItem)); await ctx.save('Позиция снова ждёт'); ctx.refresh(); });
      on('[data-del]', async el => {
        const ri = db.get('request_item', Number(el.dataset.del));
        const got = m.bought(ri.id);
        if (!(await confirmSheet(`Удалить позицию «${esc(m.itemLabel(ri))}» навсегда?${got ? `<br><span class="small" style="font-weight:500">Покупки по ней (${got} шт) тоже исчезнут из «Уже собрано».</span>` : ''}`, 'Удалить', { danger: true }))) return;
        m.deleteItem(ri.id); await ctx.save('Удалено'); ctx.refresh();
      });
      root.querySelector('#sim').onclick = () => similarSheet(ctx, b, async s => { m.addSimilar(r.id, s); await ctx.save('Добавлено'); ctx.refresh(); });
      root.querySelector('#rem').onclick = () => newReminderSheet(ctx, c, { request_id: r.id });
      root.querySelector('#note').onclick = () => sheet(`<h1 class="h-screen">Заметка к запросу</h1><label class="field"><textarea id="t" rows="5">${esc(r.note ?? '')}</textarea></label><button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
        el.querySelector('#ok').onclick = async () => { db.put('request', { ...r, note: el.querySelector('#t').value.trim() || null }); await ctx.save(); close(); ctx.refresh(); };
      });
      root.querySelector('#wdall')?.addEventListener('click', () => withdrawSheet(ctx, { requestId: r.id }));
      root.querySelector('#reopen')?.addEventListener('click', async () => { m.reopenRequest(r.id); await ctx.save('Запрос снова ждёт'); ctx.refresh(); });
      root.querySelector('#delreq')?.addEventListener('click', async () => {
        const n = items.length, p = purchases.length;
        if (!(await confirmSheet(`Удалить запрос «${esc(m.requestTitle(r))}» навсегда?<br><span class="small" style="font-weight:500">Исчезнут ${n} ${plural(n, 'позиция', 'позиции', 'позиций')}${p ? ` и ${p} ${plural(p, 'покупка', 'покупки', 'покупок')}` : ''}. Вернуть будет нельзя.</span>`, 'Удалить', { danger: true }))) return;
        m.deleteRequest(r.id); await ctx.save('Запрос удалён'); location.replace('#/client/' + r.client_id);
      });
    },
  };
}

/** «Разбить на состав» (эскиз 18) */
export function splitSheet(ctx, riId) {
  const { m, db } = ctx;
  const ri = db.get('request_item', riId);
  const r = db.get('request', ri.request_id);
  const c = db.get('client', r.client_id);
  const rem = m.remaining(ri);
  const prev = m.splitPreview(ri.id);
  const keep = new Set(prev.map(x => x.product.id));
  const bp = m.product(ri.product_id);
  sheet(`<h1 class="h-screen">Разбить на состав</h1><span class="small muted" style="margin-top:-10px;line-height:1.4">${esc(m.short(bp))} · ждёт ${rem}<br>${esc(c.name)} · запись от ${fmtDate(ri.created_at)}</span>
    <span class="small b muted">Вместо комплекта клиент будет ждать — снимите галочку с того, что уже есть</span>
    <div class="col" style="gap:8px" id="list">${prev.map(x => `<button type="button" class="card tight" style="flex-direction:row;align-items:center;gap:12px;text-align:left" data-pid="${x.product.id}"><span class="check on">${icon.check}</span><span class="col grow" style="gap:1px"><span class="b" style="font-size:15px">${esc(m.short(x.product))}</span><span class="xs muted">${x.product.article ? esc(x.product.article) + ' · ' : ''}${x.product.sold_separately ? (x.price != null ? rub(x.price) + ' на ' + fmtShort(ri.created_at) : 'цены нет') : 'только в составе'}</span></span><span class="qty" data-q>${x.qty} шт</span></button>`).join('')}</div>
    <div class="inset small" style="line-height:1.4" id="sum"></div>
    <div class="grid2"><button class="btn" id="no">Отмена</button><button class="btn" id="ok" style="background:var(--violet);color:#fff;border:none;font-weight:800">Разбить</button></div>`, (el, close) => {
    const draw = () => {
      el.querySelectorAll('[data-pid]').forEach(b => {
        const on = keep.has(Number(b.dataset.pid));
        b.querySelector('.check').className = 'check' + (on ? ' on' : '');
        b.querySelector('.check').innerHTML = on ? icon.check : '';
        b.style.opacity = on ? '' : '.6';
        b.querySelector('.b').style.textDecoration = on ? '' : 'line-through';
        b.querySelector('[data-q]').textContent = on ? `${prev.find(x => x.product.id === Number(b.dataset.pid)).qty} шт` : 'уже есть';
      });
      const n = prev.filter(x => keep.has(x.product.id)).reduce((s, x) => s + x.qty, 0);
      const gone = prev.filter(x => !keep.has(x.product.id)).map(x => m.short(x.product));
      el.querySelector('#sum').innerHTML = `<span><span class="b">Будет ждать ${n} ${plural(n, 'предмет', 'предмета', 'предметов')}.</span> Количество = в составе × ${rem} ${plural(rem, 'комплект', 'комплекта', 'комплектов')}.</span><span>Дата записи ${fmtDate(ri.created_at)} и место в очереди — как у комплекта. Цены — на дату записи.</span>${gone.length ? `<span>${esc(gone.join(', '))} — ${gone.length > 1 ? 'снимутся' : 'снимется'} с причиной «уже есть».</span>` : ''}<span>Комплект уйдёт в архив запроса как «разбито на состав».</span>`;
      el.querySelector('#ok').disabled = n === 0;
    };
    el.querySelectorAll('[data-pid]').forEach(b => b.onclick = () => { const id = Number(b.dataset.pid); keep.has(id) ? keep.delete(id) : keep.add(id); draw(); });
    el.querySelector('#no').onclick = close;
    el.querySelector('#ok').onclick = async () => {
      try { m.split(ri.id, prev.filter(x => !keep.has(x.product.id)).map(x => x.product.id)); } catch (e) { toast(e.message); return; }
      await ctx.save('Разбито на состав'); close(); ctx.refresh();
    };
    draw();
  });
}

const itemCtx = (ctx, ri) => {
  const { m, db } = ctx;
  const r = db.get('request', ri.request_id);
  const c = db.get('client', r.client_id);
  const p = ri.product_id ? m.product(ri.product_id) : null;
  return `${esc(m.itemLabel(ri))}${p?.article ? ' · ' + esc(p.article) : ''}<br>${esc(m.requestTitle(r))}, ${esc(c?.name ?? '')}`;
};

/** «Купил»: сколько штук и дата */
export function buySheet(ctx, riId) {
  const { m, db } = ctx;
  const ri = db.get('request_item', riId);
  const rem = m.remaining(ri);
  sheet(`<h1 class="h-screen">Купил</h1><span class="small muted" style="margin-top:-10px;line-height:1.4">${itemCtx(ctx, ri)}</span>
    <div class="between" style="align-items:center;padding:12px 14px;background:var(--bg);border-radius:14px"><span style="font-size:15px;font-weight:600;line-height:1.3">Сколько купил<br><span class="small muted" style="font-weight:500">ждёт ${rem} шт</span></span>${stepperHTML('n', rem, 1, rem)}</div>
    <span class="small b" id="after"></span>
    <label class="field"><span class="fl">Дата покупки</span><input id="dt" type="date" value="${todayISO()}"></label>
    <div class="grid2"><button class="btn" id="no">Отмена</button><button class="btn primary" id="ok">Записать покупку</button></div>`, (el, close) => {
    const upd = () => { const n = stepVal(el, 'n'); el.querySelector('#after').textContent = rem - n > 0 ? `Будет ждать: ${rem - n} шт` : 'Куплено всё — позиция закроется'; };
    bindSteppers(el, upd); upd();
    el.querySelector('#no').onclick = close;
    el.querySelector('#ok').onclick = async () => { m.buy(ri.id, stepVal(el, 'n'), null, el.querySelector('#dt').value || todayISO()); await ctx.save('Покупка записана'); close(); ctx.refresh(); };
  });
}

/** «Изменить»: количество (не меньше купленного) и заметка */
export function editItemSheet(ctx, riId) {
  const { m, db } = ctx;
  const ri = db.get('request_item', riId);
  const got = m.bought(ri.id);
  const min = Math.max(1, got);
  sheet(`<h1 class="h-screen">Изменить позицию</h1><span class="small muted" style="margin-top:-10px;line-height:1.4">${itemCtx(ctx, ri)}</span>
    <div class="between" style="align-items:center;padding:12px 14px;background:var(--bg);border-radius:14px"><span style="font-size:15px;font-weight:600;line-height:1.3">Нужно всего<br><span class="small muted" style="font-weight:500">было ${ri.qty_needed}</span></span>${stepperHTML('n', ri.qty_needed, min, 999)}</div>
    <div class="col small muted" style="margin-top:-6px">${got ? `<span>Уже куплено ${got} — меньше ${got} поставить нельзя.</span>` : ''}<span class="b" style="color:var(--ink)" id="will"></span></div>
    <label class="field"><span class="fl">Заметка</span><textarea id="nt" rows="2">${esc(ri.note ?? '')}</textarea></label>
    <span class="note blue">Это исправление заказа, а не покупка. Цена, дата записи ${fmtDate(ri.created_at)} и место в очереди сохранятся.</span>
    <div class="grid2"><button class="btn" id="no">Отмена</button><button class="btn primary" id="ok">Сохранить</button></div>`, (el, close) => {
    const upd = () => { el.querySelector('#will').textContent = `Будет ждать: ${stepVal(el, 'n') - got} шт`; };
    bindSteppers(el, upd); upd();
    el.querySelector('#no').onclick = close;
    el.querySelector('#ok').onclick = async () => {
      try { m.editItem(ri.id, stepVal(el, 'n'), el.querySelector('#nt').value); } catch (e) { toast(e.message); return; }
      await ctx.save('Позиция исправлена'); close(); ctx.refresh();
    };
  });
}

/** «Снять с ожидания» — позицию ({ riId }) или весь запрос ({ requestId }) */
export function withdrawSheet(ctx, { riId = null, requestId = null }) {
  const { m, db } = ctx;
  const ri = riId ? db.get('request_item', riId) : null;
  const r = requestId ? db.get('request', requestId) : null;
  const got = ri ? m.bought(ri.id) : 0;
  const head = ri ? `${itemCtx(ctx, ri).replace('<br>', ` · ждёт ${m.remaining(ri)} шт<br>`)}` : `${esc(m.requestTitle(r))} · ждёт ${m.requestProgress(r.id).waiting} шт`;
  sheet(`<h1 class="h-screen">${ri ? 'Снять с ожидания' : 'Снять весь запрос'}</h1><span class="small muted" style="margin-top:-10px;line-height:1.4">${head}</span>
    <div class="col" style="gap:8px"><span class="fl">Причина</span><div class="row wrap" style="gap:8px">${[...REASONS, 'Другое…'].map((x, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-reason="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
    <label class="field"><span class="fl" id="cl">Комментарий (необязательно)</span><textarea id="cm" rows="2"></textarea></label>
    <div class="inset small" style="line-height:1.4">${ri ? `<span>Позиция перестанет попадать в подбор и уйдёт в архив запроса.</span>${got ? `<span>Купленные ${got} шт останутся в «Уже собрано».</span>` : ''}<span>Из архива её можно вернуть или удалить навсегда.</span>`
      : '<span>Все ждущие позиции снимутся с этой причиной, запрос уйдёт в архив.</span><span>Купленное останется в «Уже собрано». Запрос можно вернуть или удалить навсегда.</span>'}</div>
    <div class="grid2"><button class="btn" id="no">Отмена</button><button class="btn primary" id="ok">Снять с ожидания</button></div>`, (el, close) => {
    let reason = REASONS[0];
    el.querySelectorAll('[data-reason]').forEach(b => b.onclick = () => {
      reason = b.dataset.reason;
      el.querySelectorAll('[data-reason]').forEach(x => x.classList.toggle('on', x === b));
      el.querySelector('#cl').textContent = reason === 'Другое…' ? 'Причина' : 'Комментарий (необязательно)';
    });
    el.querySelector('#no').onclick = close;
    el.querySelector('#ok').onclick = async () => {
      const cm = el.querySelector('#cm').value.trim();
      if (reason === 'Другое…' && !cm) { toast('Напишите причину'); return; }
      const text = reason === 'Другое…' ? cm : cm ? `${reason.toLowerCase()}: ${cm}` : reason.toLowerCase();
      if (ri) m.withdraw(ri.id, text); else m.withdrawRequest(r.id, text);
      await ctx.save('Снято с ожидания'); close(); ctx.refresh();
    };
  });
}

// ================= Записать клиента на товар =================
export function addToList(ctx, [pid], query) {
  const { db, m } = ctx;
  const p = m.product(pid);
  if (!p) return { html: `${top({ title: 'Товар не найден' })}` };
  const st = ctx.state.add?.pid === p.id ? ctx.state.add : (ctx.state.add = { pid: p.id, cid: query.c ? Number(query.c) : null, qty: 1, target: null, mode: 'parts' });
  if (query.c) st.cid = Number(query.c);
  const c = st.cid ? db.get('client', st.cid) : null;
  const price = m.currentPrice(p.id);
  const leaves = m.leaves(p.id).filter(l => !l.product.is_packaging);
  const isB = leaves.length > 1 || (leaves[0] && leaves[0].product.id !== p.id);
  let targets = [];
  if (c) {
    // ТЗ 4.2: по умолчанию — новый запрос на этот товар; затем запрос на этот же товар или комплект, если уже есть,
    // и запросы на комплекты, к которым товар подходит по форме и рисунку
    targets.push({ id: 'new', title: `Новый запрос: ${m.short(p)}`, sub: `В карточке клиента появится запрос «${m.short(p)}»` });
    const same = m.productRequest(c.id, p.id);
    if (same) targets.push({ id: same.id, title: m.requestTitle(same), sub: isB ? 'Клиент уже собирает этот комплект — добавить в этот запрос' : 'Клиент уже ждёт этот товар — добавить в этот запрос' });
    targets.push(...m.matchingRequests(c.id, p.id).map(r => ({ id: r.id, title: m.requestTitle(r), sub: `Клиент его собирает, товар подходит: форма ${m.shapeName(p.shape_id)}, рисунок ${m.patternName(p.pattern_id)}` })));
    if (!targets.some(t => t.id === st.target)) st.target = 'new';
  }
  const html = `${top({ title: 'Записать клиента' })}
  <div class="content" style="gap:14px">
    <a class="card tight" href="#/product/${p.id}" style="gap:2px"><span style="font-size:16px;font-weight:800;line-height:1.3">${esc(m.short(p))}${m.shapePattern(p) ? ', ' + esc(m.shapePattern(p).replace(' · ', ', ')) : ''}</span><span class="xs b muted">${p.article ? 'арт. ' + esc(p.article) : 'без артикула'}${price != null ? ' · сейчас ' + rub(price) : ''}</span>
      ${isB && st.mode === 'parts' ? `<span class="xs muted">По частям: в лист ожидания попадут ${leaves.map(l => `${esc((m.kindName(l.product.kind_id) || m.short(l.product)).toLowerCase())} × ${l.qty}`).join(', ')}</span>` : ''}${isB && st.mode === 'whole' ? '<span class="xs muted">Целиком: одна позиция — сам комплект</span>' : ''}</a>
    ${isB ? modeToggle(st.mode) : ''}
    <div class="col" style="gap:6px"><span class="fl">Клиент</span>
      ${c ? `<div class="card tight sel" style="flex-direction:row;align-items:center;gap:10px"><span class="col grow" style="gap:1px"><span style="font-size:15px;font-weight:700">${esc(c.name)}</span><span class="xs muted">${esc(c.phone || 'без телефона')}</span></span><button class="btn sm soft" id="pick">Сменить</button></div>`
        : `<button class="btn primary" id="pick">Выбрать клиента</button>`}
      <button class="linkbtn" id="newc">${icon.plus}Новый клиент</button></div>
    <div class="between" style="align-items:center;padding:10px 14px;background:var(--card);border:1px solid var(--line);border-radius:14px"><span style="font-size:15px;font-weight:700">Сколько нужно${isB ? '<br><span class="xs muted" style="font-weight:500">комплектов</span>' : ''}</span>${stepperHTML('q', st.qty, 1, 99)}</div>
    ${c ? `<div class="col" style="gap:8px"><span class="fl">Куда добавить</span>${targets.map(t => `<button class="card tight" style="flex-direction:row;align-items:flex-start;gap:12px;text-align:left;${st.target === t.id ? 'border:2px solid var(--blue);background:var(--blue-soft)' : ''}" data-t="${t.id}"><span style="width:22px;height:22px;border-radius:11px;border:2px solid ${st.target === t.id ? 'var(--blue)' : '#B8B2A7'};display:flex;align-items:center;justify-content:center;flex-shrink:0">${st.target === t.id ? '<span style="width:10px;height:10px;border-radius:5px;background:var(--blue)"></span>' : ''}</span><span class="col" style="gap:2px"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(t.title)}</span><span class="xs muted" style="line-height:1.35">${esc(t.sub)}</span></span></button>`).join('')}</div>` : ''}
    <span class="note blue">${price != null && (!isB || st.mode === 'whole') ? `Запомнятся цена ${rub(price)} и дата ${fmtDate(todayISO())}.` : `Запомнится дата ${fmtDate(todayISO())}${isB ? ' и цены предметов, если они есть' : ''}.`} Место в очереди — по этой дате.</span>
    <button class="btn primary big" id="ok" ${c ? '' : 'disabled'}>Записать в лист ожидания</button>
  </div>`;
  return {
    html,
    bind(root) {
      bindSteppers(root, (_, n) => { st.qty = n; });
      root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; ctx.refresh(); });
      root.querySelector('#pick').onclick = async () => { const { pickClientSheet } = await import('./screens-products.js'); pickClientSheet(ctx, cid => { st.cid = cid; st.target = null; ctx.refresh(); }); };
      root.querySelector('#newc').onclick = () => newClientSheet(ctx, cl => { st.cid = cl.id; st.target = null; ctx.refresh(); });
      root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { st.target = b.dataset.t === 'new' ? 'new' : Number(b.dataset.t); ctx.refresh(); });
      root.querySelector('#ok').onclick = async () => {
        const res = m.addToList(c.id, p.id, st.qty, st.target === 'new' ? null : st.target, { whole: isB && st.mode === 'whole' });
        ctx.state.add = null;
        await ctx.save('Записано в лист ожидания');
        location.replace('#/request/' + res.request.id);
      };
    },
  };
}
