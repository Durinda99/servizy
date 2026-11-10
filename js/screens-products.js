// Главная, поиск товара, «кто ждёт», товар и комплекты.
import { esc, rub, fmtDate, humanDT, longToday, plural, telHref, smsHref, todayISO, nowISO, daysAgo, normKey } from './util.js';
import { icon, top, nav, sheet, toast, stepperHTML, bindSteppers, stepVal, optionsHTML, confirmSheet } from './ui.js';
import { reminderSheet, reminderPicker, readReminderPicker } from './screens-clients.js';

const phoneBtns = c => c.phone
  ? `<a class="btn primary" style="height:44px;border-radius:12px;font-size:14px" href="${telHref(c.phone)}">Позвонить</a><a class="btn soft" style="height:44px;border-radius:12px;font-size:14px" href="${smsHref(c.phone)}">Написать</a>`
  : `<button class="btn" style="height:44px;border-radius:12px;font-size:14px" disabled>Нет телефона</button><span></span>`;

// ================= Главная =================
export function home(ctx) {
  const { m, db } = ctx;
  const due = m.dueReminders();
  const upcoming = m.upcomingReminders(3);
  const st = m.stats();
  const last = db.setting('last_backup_at');
  const ago = last ? daysAgo(last) : null;
  const remCard = r => {
    const c = db.get('client', r.client_id);
    const overdue = r.remind_at < nowISO();
    return `<div class="card ${overdue ? 'warn' : ''} tap" style="flex-direction:row;align-items:center;gap:12px" data-rem="${r.id}">
      <div class="col grow">
        ${overdue ? `<span class="tag warn">ПРОСРОЧЕНО · ${esc(humanDT(r.remind_at).toLowerCase())}</span>` : `<span class="xs b" style="color:var(--blue)">${esc(humanDT(r.remind_at))}</span>`}
        <span style="font-size:16px;font-weight:700">${esc(c?.name ?? '—')}</span>
        ${r.note ? `<span class="small muted" style="line-height:1.35">${esc(r.note)}</span>` : ''}
      </div>
      ${c?.phone ? `<a class="btn call" href="${telHref(c.phone)}" aria-label="Позвонить ${esc(c.name)}" data-stop>${icon.phone}</a>` : ''}
    </div>`;
  };
  const html = `<div class="content home">
    <div class="col" style="gap:2px"><span class="small b muted">${longToday()}</span><h1 class="h1">Сервизы</h1></div>
    <a class="search" href="#/search">${icon.search}<span>Артикул или название — кто ждёт?</span></a>
    <div class="col" style="gap:10px">
      <div class="between"><h2 class="h2">Позвонить</h2><span class="small b muted">${due.length ? `${due.length} ${plural(due.length, 'напоминание', 'напоминания', 'напоминаний')}` : ''}</span></div>
      ${due.length ? due.map(remCard).join('') : `<div class="card tight muted small">На сегодня звонков нет.${upcoming.length ? '' : ' Напоминание можно поставить в карточке клиента или после разговора.'}</div>`}
      ${upcoming.length ? `<span class="label">Ближайшие дни</span>${upcoming.map(remCard).join('')}` : ''}
    </div>
    <div class="grid2" style="gap:10px">
      <a class="stat" href="#/clients"><span class="n">${st.clients}</span><span class="small muted">${plural(st.clients, 'клиент ждёт', 'клиента ждут', 'клиентов ждут')}</span></a>
      <a class="stat" href="#/clients"><span class="n">${st.items}</span><span class="small muted">${plural(st.items, 'предмет', 'предмета', 'предметов')} в листе ожидания</span></a>
    </div>
    ${ago === null || ago >= 7 ? `<a class="banner" href="#/more">${icon.download}<span class="grow small" style="line-height:1.35">${ago === null ? 'Резервной копии ещё нет' : `Резервная копия была ${ago} ${plural(ago, 'день', 'дня', 'дней')} назад`}</span><span class="small b" style="color:var(--blue)">Сделать</span></a>` : ''}
  </div>${nav('home')}`;
  return {
    html, nav: true,
    bind(root) {
      root.querySelectorAll('[data-stop]').forEach(a => a.addEventListener('click', e => e.stopPropagation()));
      root.querySelectorAll('[data-rem]').forEach(el => el.addEventListener('click', () => reminderSheet(ctx, Number(el.dataset.rem))));
    },
  };
}

// ================= Поиск товара =================
const addIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg>';
const SEC_SHORT = { 'Столовые предметы': 'Столовые', 'Чайно-кофейные предметы': 'Чайно-кофейные', 'Сервизы': 'Сервизы' };

export function search(ctx, _p, query) {
  const { m, db } = ctx;
  const st = ctx.state.search ??= { q: '', multi: false, picked: [], sec: null };
  if (query.q !== undefined) st.q = query.q;
  const secs = db.all('section').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const html = `<header class="top" style="flex-direction:column;align-items:stretch;gap:10px;padding:10px 16px 12px">
      <div class="row" style="gap:8px"><button class="icon-btn" data-back aria-label="Назад">${icon.back}</button>
        <label class="search grow" style="height:52px;border-radius:14px;box-shadow:none;padding:0 14px">${icon.search}<input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Артикул или название" value="${esc(st.q)}" style="font-weight:600"></label></div>
      <div class="row" style="gap:8px;overflow-x:auto;scrollbar-width:none">${[{ id: null, name: 'Все' }, ...secs].map(s => `<button class="chip ${st.sec === s.id ? 'on' : ''}" style="height:36px;font-size:13px;white-space:nowrap;flex-shrink:0" data-sec="${s.id ?? ''}">${esc(SEC_SHORT[s.name] || s.name)}</button>`).join('')}</div>
    </header>
    <div class="content" style="gap:10px">
      <span class="small b muted" id="found"></span>
      <div id="res" class="col" style="gap:10px"></div>
      <button class="btn" id="multi" style="border:1.5px dashed var(--blue);background:transparent;color:var(--blue);margin-top:6px">${st.multi ? 'Готово: проверять по одному' : `${icon.plus} Проверить несколько товаров (партию)`}</button>
      <button class="linkbtn" id="newp" style="justify-content:center;font-weight:600">Нет в каталоге? Добавить товар вручную</button>
    </div>
    <div id="multibar" class="nav ${st.multi ? '' : 'hide'}" style="padding:10px 16px calc(12px + env(safe-area-inset-bottom))"><button class="btn primary big grow" id="showq"></button></div>`;
  return {
    html,
    bind(root) {
      const inp = root.querySelector('#q');
      const res = root.querySelector('#res');
      const showq = root.querySelector('#showq');
      const wi = m.waitingIndex();
      const bundles = m.bundleIds();
      const line3 = p => {
        const price = m.currentPrice(p.id);
        let what;
        if (bundles.has(p.id)) {
          const leaves = m.leaves(p.id);
          const n = leaves.reduce((s, l) => s + l.qty, 0);
          what = 'Комплект: ' + (leaves.length <= 3 ? leaves.map(l => `${l.qty > 1 ? l.qty + ' ' : ''}${(m.kindName(l.product.kind_id) || m.short(l.product)).toLowerCase().split(' ')[0]}`).join(' + ') : `${n} ${plural(n, 'предмет', 'предмета', 'предметов')}`);
        } else what = !p.sold_separately ? 'только в составе комплекта' : m.sectionNames(p.id).map(s => SEC_SHORT[s] || s).join(', ');
        return [what, price != null ? rub(price) : null].filter(Boolean).join(' · ');
      };
      const draw = () => {
        const { total, items } = m.searchProducts(st.q, { limit: 50, sectionId: st.sec });
        showq.textContent = `Показать, кто ждёт (${st.picked.length})`;
        showq.disabled = !st.picked.length;
        const fnd = root.querySelector('#found');
        if (!st.q.trim()) {
          fnd.textContent = '';
          res.innerHTML = `<div class="empty">Введите артикул (например, 81.31631) или часть названия: «чашка саламандра».<br>Нажмите на товар — покажу, кто его ждёт. Кнопка справа — записать клиента на товар.</div>`;
          return;
        }
        fnd.textContent = `Найдено ${total} ${plural(total, 'товар', 'товара', 'товаров')}${total > items.length ? `, показаны первые ${items.length}` : ''}`;
        if (!items.length) { res.innerHTML = `<div class="empty">Ничего не нашлось.</div>`; return; }
        res.innerHTML = items.map(p => {
          const n = wi.count(p.id);
          const picked = st.picked.includes(p.id);
          const sp = m.shapeName(p.shape_id);
          return `<div class="card" style="flex-direction:row;padding:0;gap:0;overflow:hidden;align-items:stretch">
            <a class="row grow tap" style="gap:12px;padding:12px 10px 12px 14px;color:var(--ink);min-width:0" href="#/queue/${p.id}" data-pid="${p.id}">
              ${st.multi ? `<span class="check ${picked ? 'on' : ''}">${picked ? icon.check : ''}</span>` : ''}
              <div class="col grow" style="gap:3px"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(m.short(p))}${sp ? ', ' + esc(sp) : ''}</span><span class="xs b muted">${p.article ? 'арт. ' + esc(p.article) : 'без артикула'}${m.patternName(p.pattern_id) ? ' · ' + esc(m.patternName(p.pattern_id)) : ''}</span><span class="small muted">${esc(line3(p))}</span></div>
              ${n ? `<span class="col" style="align-items:center;padding:6px 10px;border-radius:12px;flex-shrink:0;gap:0;${n > 1 ? 'background:var(--blue);color:#fff' : 'background:var(--blue-soft);color:var(--blue)'}"><span style="font-size:18px;font-weight:800;line-height:1.1">${n}</span><span style="font-size:11px;font-weight:600">${plural(n, 'ждёт', 'ждут', 'ждут')}</span></span>` : '<span class="xs b muted" style="flex-shrink:0;text-align:right">никто<br>не ждёт</span>'}
            </a>
            ${p.is_packaging ? '' : `<a href="#/add/${p.id}" aria-label="Записать клиента на этот товар" style="width:52px;display:flex;align-items:center;justify-content:center;border-left:1px solid var(--line);color:var(--blue);flex-shrink:0">${addIcon}</a>`}
          </div>`;
        }).join('');
      };
      let t;
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = inp.value; draw(); }, 150); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      root.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { st.sec = b.dataset.sec ? Number(b.dataset.sec) : null; root.querySelectorAll('[data-sec]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
      res.addEventListener('click', e => {
        const a = e.target.closest('[data-pid]');
        if (!a || !st.multi) return;
        e.preventDefault();
        const id = Number(a.dataset.pid);
        st.picked = st.picked.includes(id) ? st.picked.filter(x => x !== id) : [...st.picked, id];
        draw();
      });
      root.querySelector('#multi').onclick = () => { st.multi = !st.multi; if (!st.multi) st.picked = []; ctx.refresh(); };
      showq.onclick = () => ctx.go('#/queue/' + st.picked.join(','));
      root.querySelector('#newp').onclick = () => productEditSheet(ctx, null);
      draw();
      if (!st.q) setTimeout(() => inp.focus(), 50);
    },
  };
}

// ================= Кто ждёт товар =================
function priceLine(m, it) {
  if (it.similar) return 'цена не указана';
  const now = m.currentPrice(it.leaf.product.id);
  if (it.ri.price_kop == null && now == null) return 'цены нет';
  if (it.ri.price_kop == null) return `сейчас ${rub(now)}`;
  return `при записи ${rub(it.ri.price_kop)}${now != null ? ` · сейчас ${rub(now)}` : ''}`;
}
function hintCard(ctx, g) {
  const { m } = ctx;
  const it = g.items[0];
  return `<a class="card tap" href="#/request/${g.request.id}" style="flex-direction:row;align-items:center;gap:10px;border:1.5px dashed #C9B6E0;background:var(--violet-soft);padding:12px 14px">
    <span class="col grow" style="gap:2px"><span class="xs b" style="color:var(--violet)">ЖДЁТ КОМПЛЕКТ ЦЕЛИКОМ</span><span style="font-size:16px;font-weight:700;color:var(--ink)">${esc(g.client.name)}</span><span class="small muted">${esc(m.short(it.leaf.product))} × ${it.remaining} · с ${fmtDate(it.ri.created_at)} · предложить по частям?</span></span>${icon.chev}</a>`;
}
function groupCard(ctx, g, idx, shown = idx) {
  const { m } = ctx;
  if (g.hint) return hintCard(ctx, g);
  const sim = g.items.filter(i => i.similar);
  return `<div class="card" style="gap:10px">
    <a class="row" style="gap:8px;color:var(--ink)" href="#/client/${g.client.id}"><span class="num">${shown + 1}</span><span style="font-size:16px;font-weight:700">${esc(g.client.name)}</span></a>
    <div class="small muted" style="line-height:1.35">
      ${sim.length && sim.length === g.items.length ? `<span class="b" style="color:var(--violet)">Что-то подобное:</span> ${esc(m.itemLabel(sim[0].ri).toLowerCase())}<br>` : ''}
      <a href="#/request/${g.request.id}" style="color:var(--muted)">${esc(g.bundle ? m.short(g.bundle) + (g.bundle.pattern_id ? ' «' + m.patternName(g.bundle.pattern_id) + '»' : '') : m.requestTitle(g.request))}</a> · запись от ${fmtDate(g.since)}
    </div>
    <div class="inset">${g.items.map(it => `<div class="between" style="font-size:14px;align-items:flex-start"><span class="col" style="gap:1px"><span class="b">${esc(it.similar ? m.kindName(it.ri.kind_id) : m.short(it.leaf.product) + (it.whole ? ' целиком' : ''))}${it.bought ? ` <span class="muted" style="font-weight:500">${it.bought} из ${it.ri.qty_needed} куплены</span>` : ''}</span><span class="xs muted">${esc(priceLine(m, it))}</span></span><span class="qty">${it.remaining} шт</span></div>`).join('')}</div>
    <div class="grid3">${phoneBtns(g.client)}<button class="btn" style="height:44px;border-radius:12px;font-size:14px" data-mark="${idx}">Отметить</button></div>
  </div>`;
}

export function queue(ctx, [ids]) {
  const { m } = ctx;
  const pids = ids.split(',').map(Number).filter(id => m.product(id));
  if (!pids.length) return { html: `${top({ title: 'Товар не найден' })}<div class="content"><div class="empty">Такого товара нет.</div></div>` };
  const groups = m.queue(pids);
  const one = pids.length === 1 ? m.product(pids[0]) : null;
  let head;
  if (one) {
    const price = m.currentPrice(one.id);
    head = top({ sub: `<a class="top-sub" href="#/product/${one.id}"><b>${esc(m.short(one))}</b><span class="xs b muted">${one.article ? 'арт. ' + esc(one.article) : 'без артикула'}</span><span class="small muted">${esc(m.shapePattern(one))}${price != null ? ` · <span class="b" style="color:var(--ink)">сейчас ${rub(price)}</span>` : ''}</span></a>`, back: true });
  } else head = top({ title: `Проверка ${pids.length} ${plural(pids.length, 'товара', 'товаров', 'товаров')}` });
  const leavesNote = pid => {
    const items = m.bundleItems(pid).filter(b => !b.product.is_packaging);
    if (!items.length) return '';
    const txt = items.slice(0, 6).map(b => `${b.quantity} ${esc((m.kindName(b.product.kind_id) || m.short(b.product)).toLowerCase())}`).join(' + ') + (items.length > 6 ? ' и др.' : '');
    return `<div class="note violet">${icon.split}<span><span class="b">Это комплект:</span> ${txt}. Ищем ждущих его целиком и тех, кому не хватает этих предметов.</span></div>`;
  };
  let body = '';
  let idx = 0;
  const all = [];
  if (one) {
    body += leavesNote(one.id);
    const mainN = new Set(groups.filter(g => !g.hint).map(g => g.client.id)).size;
    body += `<div class="between"><h1 class="h-screen">${mainN ? `${plural(mainN, 'Ждёт', 'Ждут', 'Ждут')} ${mainN} ${plural(mainN, 'клиент', 'клиента', 'клиентов')}` : 'Никто не ждёт'}</h1>${mainN ? '<span class="xs b muted">по дате записи ↑</span>' : ''}</div>`;
    if (!mainN && groups.length) body += '<span class="small muted">Но есть клиенты, которые ждут комплект с этим предметом целиком:</span>';
    if (!groups.length) body += `<div class="empty">Этот товар сейчас никому не нужен.<br><a href="#/product/${one.id}">Открыть карточку товара</a></div>`;
    for (const g of groups) { body += groupCard(ctx, g, idx++); all.push(g); }
  } else {
    for (const pid of pids) {
      const p = m.product(pid);
      const gs = groups.filter(g => g.arrival === pid);
      body += `<a class="between" style="margin-top:6px;color:var(--ink)" href="#/product/${pid}"><span class="h2" style="font-size:16px;line-height:1.3">${esc(m.short(p))}</span><span class="tag ${gs.length ? 'blue' : 'gray'} nowrap">${gs.length ? 'ждут ' + gs.length : 'никто'}</span></a>`;
      gs.forEach((g, j) => { body += groupCard(ctx, g, idx++, j); all.push(g); });
    }
  }
  return {
    html: `${head}<div class="content" style="gap:10px">${body}</div>`,
    bind(root) {
      root.querySelectorAll('[data-mark]').forEach(b => b.addEventListener('click', () => afterCallSheet(ctx, all[Number(b.dataset.mark)])));
    },
  };
}

/** «После разговора»: купил / пусть ждёт / снять с ожидания + заметка + напоминание */
const REASONS = ['Купил в другом месте', 'Передумал', 'Уже есть'];
function afterCallSheet(ctx, g) {
  const { m } = ctx;
  const arrival = m.product(g.arrival);
  const multi = g.items.length > 1;
  const unitMax = Math.max(...g.items.map(it => Math.ceil(it.remaining / it.leaf.qty)));
  const nm = it => (it.similar ? m.kindName(it.ri.kind_id) : m.short(it.leaf.product) + (it.whole ? ' целиком' : ''));
  const waits = g.items.map(it => `${esc(nm(it).toLowerCase())} — ${it.remaining} шт`).join(', ');
  const html = `<div class="col"><h1 class="h-screen">${esc(g.client.name)}</h1><span class="small muted" style="line-height:1.4">Пришёл товар «${esc(m.short(arrival))}»${arrival.article ? ' · ' + esc(arrival.article) : ''}<br>Ждёт: ${waits}<br>для «${esc(g.bundle ? m.short(g.bundle) : m.requestTitle(g.request))}»</span></div>
    <div class="col" style="gap:8px"><span class="fl">Чем закончился разговор</span>
      <div class="grid3"><button class="btn on" data-out="buy">Купил</button><button class="btn" data-out="wait">Пусть ждёт</button><button class="btn" data-out="no" style="font-size:13px;line-height:1.15">Снять с<br>ожидания</button></div></div>
    <div id="buybox" class="col" style="gap:6px">
      <div class="between" style="align-items:center;padding:12px 14px;background:var(--bg);border-radius:14px"><span style="font-size:15px;font-weight:600;line-height:1.3">Сколько купил<br><span class="small muted" style="font-weight:500">${multi ? 'комплектов «' + esc(m.short(arrival)) + '»' : 'штук'}</span></span>${stepperHTML('n', Math.min(1, unitMax), 1, unitMax)}</div>
      <span class="small muted" id="buyinfo"></span>
    </div>
    <div id="nobox" class="col hide" style="gap:8px"><span class="fl">Причина</span><div class="row wrap" style="gap:8px">${[...REASONS, 'Другое…'].map((x, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-reason="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
    <div class="col" style="gap:4px">${g.items.map(it => `<button class="linkbtn small" style="min-height:32px" data-edit="${it.ri.id}">Неверное количество в заказе${multi ? ` (${esc(nm(it).toLowerCase())})` : ''}? Изменить</button>`).join('')}</div>
    <label class="field"><span class="fl">Заметка</span><textarea id="note" rows="2" placeholder="Например: остальное возьмёт после зарплаты"></textarea></label>
    ${reminderPicker()}
    <button class="btn primary big" id="save">Сохранить</button>`;
  sheet(html, (el, close) => {
    let out = 'buy', reason = REASONS[0];
    const info = el.querySelector('#buyinfo');
    const upd = () => {
      const n = stepVal(el, 'n');
      info.innerHTML = (multi ? 'Покупка запишется во все позиции запроса:<br>' : '') + `<span class="b" style="color:var(--ink)">${g.items.map(it => `${esc(nm(it))} — останется ${Math.max(0, it.remaining - n * it.leaf.qty)}`).join(' · ')}</span>`;
    };
    bindSteppers(el, upd); upd();
    el.querySelectorAll('[data-out]').forEach(b => b.onclick = () => {
      out = b.dataset.out;
      el.querySelectorAll('[data-out]').forEach(x => x.classList.toggle('on', x === b));
      el.querySelector('#buybox').classList.toggle('hide', out !== 'buy');
      el.querySelector('#nobox').classList.toggle('hide', out !== 'no');
    });
    el.querySelectorAll('[data-reason]').forEach(b => b.onclick = () => { reason = b.dataset.reason; el.querySelectorAll('[data-reason]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => { close(); const { editItemSheet } = await import('./screens-clients.js'); editItemSheet(ctx, Number(b.dataset.edit)); });
    el.querySelector('#save').onclick = async () => {
      const note = el.querySelector('#note').value.trim();
      const n = stepVal(el, 'n');
      if (out === 'buy') for (const it of g.items) m.buy(it.ri.id, Math.min(it.remaining, n * it.leaf.qty), multi || arrival.id !== it.leaf.product.id ? `как «${m.short(arrival)}» ${arrival.article ?? ''}`.trim() : null);
      if (out === 'no') {
        if (reason === 'Другое…' && !note) { toast('Напишите причину в заметке'); return; }
        const text = reason === 'Другое…' ? note : note ? `${reason.toLowerCase()}: ${note}` : reason.toLowerCase();
        for (const it of g.items) m.withdraw(it.ri.id, text);
      }
      if (note && out !== 'no') m.appendNote('request', g.request.id, note);
      const when = readReminderPicker(el);
      if (when) m.addReminder({ client_id: g.client.id, request_id: g.request.id, remind_at: when, note: note || `Перезвонить: ${m.short(arrival)}` });
      await ctx.save(out === 'buy' ? 'Покупка записана' : out === 'no' ? 'Снято с ожидания' : 'Сохранено');
      close();
      ctx.refresh();
    };
  });
}

// ================= Карточка товара =================
export function product(ctx, [id]) {
  const { m, db } = ctx;
  const p = m.product(id);
  if (!p) return { html: `${top({ title: 'Товар не найден' })}<div class="content"><div class="empty">Такого товара нет.</div></div>` };
  const items = m.bundleItems(p.id);
  const isB = items.length > 0;
  const prices = m.prices(p.id);
  const cur = m.currentPrice(p.id);
  const curRec = prices.find(x => x.price_kop === cur && x.valid_from <= todayISO());
  const sections = db.all('product_section').filter(s => s.product_id === p.id).map(s => m.dictName('section', s.section_id)).join(', ');
  const inB = m.bundlesContaining(p.id);
  const waiting = new Set(m.queue([p.id]).map(g => g.client.id)).size;
  const kv = [['Раздел', sections], ['Вид', m.kindName(p.kind_id)], ['Форма', m.shapeName(p.shape_id)], ['Рисунок', m.patternName(p.pattern_id)], ['Коллекция', m.dictName('collection', p.collection_id)], ['Материал', p.material],
    ['Персон', isB ? p.persons : null], ['Предметов', isB ? p.items_count : null], ['Высота', p.height_mm ? p.height_mm + ' мм' : null], ['Диаметр / длина', p.length_mm ? p.length_mm + ' мм' : null], ['Ширина', p.width_mm ? p.width_mm + ' мм' : null], ['Объём', p.volume_ml ? p.volume_ml + ' мл' : null], ['Вес', p.weight_g ? p.weight_g + ' г' : null], ['Год выпуска', p.year_start]]
    .filter(([, v]) => v);
  const nItems = items.filter(i => !i.product.is_packaging).reduce((s, i) => s + i.quantity, 0);
  const site = p.site_status ? `<span class="tag ${/нет/i.test(p.site_status) ? 'gray' : 'green'}">На сайте: ${esc(p.site_status.toLowerCase())}</span>` : '';
  const html = `${top({ right: `<span class="grow"></span><button class="btn sm" id="edit">Изменить</button>` })}
  <div class="content">
    <div class="row" style="align-items:flex-start;gap:12px">
      <div class="photo">${p.photo_url && navigator.onLine ? `<img src="${esc(p.photo_url)}" alt="" loading="lazy" onerror="this.remove()">` : icon.img}</div>
      <div class="col" style="gap:3px"><h1 style="font-size:18px;font-weight:800;line-height:1.25">${esc(p.name)}</h1>
        <span class="xs b muted">${p.article ? 'арт. ' + esc(p.article) : 'без артикула'}</span>
        <div class="row wrap" style="gap:6px">${isB ? `<span class="tag violet">Комплект · ${nItems} ${plural(nItems, 'предмет', 'предмета', 'предметов')}</span>` : ''}${!p.sold_separately ? '<span class="tag violet">только в составе</span>' : ''}${p.is_packaging ? '<span class="tag gray">упаковка</span>' : ''}${p.is_archived ? '<span class="tag gray">в архиве</span>' : ''}${site}</div>
      </div>
    </div>
    ${kv.length || p.url ? `<div class="card" style="gap:10px"><div class="kv">${kv.map(([k, v]) => `<div class="col" style="gap:2px"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="small b">Открыть на сайте ↗</a>` : ''}</div>` : ''}
    ${p.is_packaging ? '' : `<a class="btn primary big" href="#/queue/${p.id}" style="justify-content:space-between">Кто ждёт этот товар<span class="count">${waiting}</span></a>
      <a class="btn soft" href="#/add/${p.id}">${addIcon} Записать клиента на этот товар</a>`}
    <div class="card" style="gap:10px">
      <div class="between" style="align-items:flex-end"><div class="col" style="gap:2px"><span class="xs b muted">ЦЕНА СЕЙЧАС · справочно</span><span style="font-size:24px;font-weight:800">${cur != null ? rub(cur) : 'нет'}</span>${curRec ? `<span class="xs muted">с ${fmtDate(curRec.valid_from)}</span>` : `<span class="xs muted">${p.sold_separately ? 'цена не внесена' : 'продаётся только в составе комплекта'}</span>`}</div><button class="btn sm soft" id="price">+ Новая цена</button></div>
      ${prices.length > 1 ? `<div class="col" style="gap:4px">${prices.map(x => `<div class="between small"><span class="muted">с ${fmtDate(x.valid_from)}${x.valid_from > todayISO() ? ' (будущая)' : ''}</span><span class="b">${rub(x.price_kop)}</span></div>`).join('')}</div>` : prices.length ? '<span class="xs muted">История: пока одна цена.</span>' : ''}
    </div>
    ${isB ? `<div class="between"><span class="label">Состоит из</span><button class="linkbtn small" id="comp">Изменить состав</button></div>
      <div class="list">${items.map(i => `<a class="li" href="#/product/${i.product.id}"><span class="col" style="gap:1px"><span style="font-size:14px;${i.product.is_packaging ? 'color:var(--muted)' : ''}">${esc(m.short(i.product))}</span><span class="xs muted">${i.product.article ? esc(i.product.article) : 'без артикула'}${i.product.is_packaging ? ' · упаковка' : ''}</span></span><span class="b nowrap">× ${i.quantity}</span></a>`).join('')}</div>
      <button class="btn soft" id="enroll">Записать клиента на весь комплект (целиком или по частям)</button>` : ''}
    ${inB.length ? `<span class="label">Входит в комплекты</span><div class="list">${inB.map(b => `<a class="li" href="#/product/${b.bundle.id}"><span style="font-size:14px">${esc(b.bundle.name)}</span><span class="b nowrap">× ${b.quantity}</span></a>`).join('')}</div>` : ''}
    ${!isB && !p.is_packaging ? `<button class="btn soft" id="addcomp">Сделать комплектом (задать состав)</button>` : ''}
  </div>`;
  return {
    html,
    bind(root) {
      root.querySelector('#edit').onclick = () => productEditSheet(ctx, p);
      root.querySelector('#price').onclick = () => priceSheet(ctx, p);
      root.querySelector('#comp')?.addEventListener('click', () => compositionSheet(ctx, p));
      root.querySelector('#addcomp')?.addEventListener('click', () => compositionSheet(ctx, p));
      root.querySelector('#enroll')?.addEventListener('click', () => pickClientSheet(ctx, cid => ctx.go(`#/client/${cid}/new/${p.id}`)));
    },
  };
}

function priceSheet(ctx, p) {
  sheet(`<h1 class="h-screen">Новая цена</h1><span class="small muted">${esc(p.name)}</span>
    <label class="field"><span class="fl">Цена, ₽</span><input id="pr" inputmode="decimal" placeholder="например, 3020"></label>
    <label class="field"><span class="fl">Действует с</span><input id="dt" type="date" value="${todayISO()}"></label>
    <span class="xs muted">Старые цены не удаляются. Цены в уже созданных запросах не меняются.</span>
    <button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
    setTimeout(() => el.querySelector('#pr').focus(), 50);
    el.querySelector('#ok').onclick = async () => {
      const v = Number(el.querySelector('#pr').value.replace(/\s/g, '').replace(',', '.'));
      const d = el.querySelector('#dt').value;
      if (!Number.isFinite(v) || v < 0 || !d) { toast('Укажите цену и дату'); return; }
      ctx.m.addPrice(p.id, Math.round(v * 100), d);
      await ctx.save('Цена сохранена');
      close(); ctx.refresh();
    };
  });
}

export function productEditSheet(ctx, p, { asBundle = false } = {}) {
  const { m } = ctx;
  const isNew = !p;
  p = p || { name: '', article: '', kind_id: null, shape_id: null, pattern_id: null, sold_separately: 1, is_archived: 0 };
  sheet(`<h1 class="h-screen">${isNew ? (asBundle ? 'Новый комплект' : 'Новый товар') : 'Изменить товар'}</h1>
    <label class="field"><span class="fl">Название</span><input id="nm" value="${esc(p.name)}"></label>
    <label class="field"><span class="fl">Артикул</span><input id="ar" value="${esc(p.article ?? '')}" inputmode="decimal" placeholder="например, 80.44694.00.1"></label>
    <label class="field"><span class="fl">Вид изделия</span><select id="kd">${optionsHTML(m.sorted('product_kind'), p.kind_id)}</select></label>
    <label class="field"><span class="fl">Форма</span><select id="sh">${optionsHTML(m.sorted('shape'), p.shape_id)}</select></label>
    <label class="field"><span class="fl">Рисунок</span><select id="pt">${optionsHTML(m.sorted('pattern'), p.pattern_id)}</select></label>
    ${isNew ? `<label class="field"><span class="fl">Цена, ₽ (если есть)</span><input id="pr" inputmode="decimal"></label>` : ''}
    <label class="row small b"><input type="checkbox" id="ss" ${p.sold_separately ? 'checked' : ''} style="width:22px;height:22px"> Продаётся отдельно</label>
    ${isNew ? '' : `<label class="row small b"><input type="checkbox" id="arc" ${p.is_archived ? 'checked' : ''} style="width:22px;height:22px"> В архиве (не предлагать в новых запросах)</label>`}
    <span class="xs muted">Нет нужной формы или рисунка? Добавьте в «Ещё → Справочники».</span>
    <button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
    el.querySelector('#ok').onclick = async () => {
      const name = el.querySelector('#nm').value.trim();
      const article = el.querySelector('#ar').value.trim() || null;
      if (!name) { toast('Укажите название'); return; }
      if (article && ctx.db.all('product').some(x => x.article === article && x.id !== p.id)) { toast('Такой артикул уже есть'); return; }
      const num = sel => Number(el.querySelector(sel).value) || null;
      const rec = m.saveProduct({ ...p, name, article, kind_id: num('#kd'), shape_id: num('#sh'), pattern_id: num('#pt'), sold_separately: el.querySelector('#ss').checked ? 1 : 0, is_archived: el.querySelector('#arc')?.checked ? 1 : 0 });
      const pr = el.querySelector('#pr')?.value.replace(/\s/g, '').replace(',', '.');
      if (pr && Number.isFinite(Number(pr))) m.addPrice(rec.id, Math.round(Number(pr) * 100));
      await ctx.save('Сохранено');
      close();
      if (isNew) { ctx.go('#/product/' + rec.id); if (asBundle) setTimeout(() => compositionSheet(ctx, rec), 100); } else ctx.refresh();
    };
  });
}

/** Редактор состава комплекта: товар × количество */
function compositionSheet(ctx, bundle) {
  const { m, db } = ctx;
  let lines = m.bundleItems(bundle.id).map(i => ({ pid: i.product.id, qty: i.quantity }));
  const html = `<h1 class="h-screen">Состав комплекта</h1><span class="small muted">${esc(bundle.name)}</span>
    <div id="lines" class="col" style="gap:8px"></div>
    <div class="search" style="height:48px;box-shadow:none">${icon.search}<input id="q" placeholder="Добавить предмет: артикул или название"></div>
    <div id="found" class="col" style="gap:6px"></div>
    <span class="xs muted">Уже созданные запросы клиентов не изменятся.</span>
    <button class="btn primary big" id="ok">Сохранить состав</button>`;
  sheet(html, (el, close) => {
    const drawLines = () => {
      el.querySelector('#lines').innerHTML = lines.length ? lines.map((l, i) => {
        const p = m.product(l.pid);
        const bad = bundle.shape_id && p.shape_id && (p.shape_id !== bundle.shape_id || p.pattern_id !== bundle.pattern_id);
        return `<div class="card tight" style="flex-direction:row;align-items:center"><div class="col grow"><span class="small b">${esc(m.short(p))}</span><span class="xs muted">${esc(p.article ?? 'без артикула')} · ${esc(m.shapePattern(p))}</span>${bad ? '<span class="tag warn">другая форма или рисунок</span>' : ''}</div>${stepperHTML('l' + i, l.qty, 0, 99)}</div>`;
      }).join('') : '<div class="empty">Состав пуст. Найдите предметы ниже.</div>';
      bindSteppers(el.querySelector('#lines'), (name, n) => { lines[Number(name.slice(1))].qty = n; });
    };
    const q = el.querySelector('#q');
    q.oninput = () => {
      const { items } = m.searchProducts(q.value, { limit: 8 });
      el.querySelector('#found').innerHTML = q.value.trim() ? items.filter(p => p.id !== bundle.id).map(p => `<button class="btn" style="height:auto;min-height:48px;padding:8px 12px;justify-content:flex-start;text-align:left;font-size:14px" data-add="${p.id}">+ ${esc(p.name)}</button>`).join('') : '';
    };
    el.querySelector('#found').onclick = e => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      const pid = Number(b.dataset.add);
      const ex = lines.find(l => l.pid === pid);
      if (ex) ex.qty++; else lines.push({ pid, qty: 1 });
      q.value = ''; el.querySelector('#found').innerHTML = '';
      drawLines();
    };
    drawLines();
    el.querySelector('#ok').onclick = async () => {
      const keep = lines.filter(l => l.qty > 0);
      const total = keep.reduce((s, l) => s + l.qty, 0);
      if (keep.length && total < 2) { toast('В комплекте должно быть два предмета или больше'); return; }
      for (const bi of db.all('bundle_item').filter(b => b.bundle_id === bundle.id)) if (!keep.some(l => l.pid === bi.product_id)) db.del('bundle_item', [bundle.id, bi.product_id]);
      for (const l of keep) db.put('bundle_item', { bundle_id: bundle.id, product_id: l.pid, quantity: l.qty });
      await ctx.save('Состав сохранён');
      close(); ctx.refresh();
    };
  });
}

export function pickClientSheet(ctx, onPick) {
  const { db, m } = ctx;
  sheet(`<h1 class="h-screen">Какой клиент?</h1>
    <div class="search" style="height:48px;box-shadow:none">${icon.search}<input id="q" placeholder="Имя или телефон"></div>
    <div id="list" class="list"></div>
    <button class="btn soft" id="new">${icon.plus} Новый клиент</button>`, (el, close) => {
    const draw = () => {
      const q = normKey(el.querySelector('#q').value);
      const list = db.all('client').filter(c => !c.is_archived && (!q || normKey(c.name + c.phone).includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'ru')).slice(0, 40);
      el.querySelector('#list').innerHTML = list.map(c => `<button class="li" style="border:none;border-bottom:1px solid var(--line2);background:none;text-align:left;width:100%" data-c="${c.id}"><span class="b">${esc(c.name)}</span><span class="small muted">${esc(c.phone ?? '')}</span></button>`).join('') || '<div class="empty">Клиентов пока нет</div>';
    };
    el.querySelector('#q').oninput = draw;
    el.querySelector('#list').onclick = e => { const b = e.target.closest('[data-c]'); if (b) { close(); onPick(Number(b.dataset.c)); } };
    el.querySelector('#new').onclick = async () => {
      close();
      const { newClientSheet } = await import('./screens-clients.js');
      newClientSheet(ctx, c => onPick(c.id));
    };
    draw();
  });
}

// ================= Комплекты =================
export function sets(ctx) {
  const { m } = ctx;
  const st = ctx.state.sets ??= { q: '' };
  const html = `<div class="content" style="gap:10px">
    <div class="between" style="align-items:center"><h1 class="h1">Комплекты</h1><button class="linkbtn" id="new">${icon.plus}Новый</button></div>
    <div class="search" style="height:50px;box-shadow:none">${icon.search}<input id="q" type="search" placeholder="Название, рисунок или артикул" value="${esc(st.q)}"></div>
    <div id="res" class="col" style="gap:8px"></div></div>${nav('sets')}`;
  return {
    html, nav: true,
    bind(root) {
      const draw = () => {
        const { total, items } = m.searchProducts(st.q, { limit: 60, bundlesOnly: true });
        root.querySelector('#res').innerHTML = items.map(p => {
          const pr = m.currentPrice(p.id);
          return `<a class="card tight tap" href="#/product/${p.id}"><span style="font-size:15px;font-weight:700;line-height:1.3">${esc(m.short(p))}</span><span class="xs b muted">${esc(m.shapePattern(p))}</span><span class="xs b muted">${p.article ? 'арт. ' + esc(p.article) : ''}${p.persons ? ` · ${p.persons} перс.` : ''}${p.items_count ? ` · ${p.items_count} пр.` : ''}${pr != null ? ' · ' + rub(pr) : ''}</span></a>`;
        }).join('') + (total > items.length ? `<div class="empty">Показаны ${items.length} из ${total}. Уточните поиск.</div>` : '') || '<div class="empty">Ничего не нашлось</div>';
      };
      let t;
      root.querySelector('#q').oninput = e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; draw(); }, 150); };
      root.querySelector('#new').onclick = () => productEditSheet(ctx, null, { asBundle: true });
      draw();
    },
  };
}
