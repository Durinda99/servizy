// «Ещё»: загрузка каталога, резервная копия, выгрузка в Excel, справочники, архив, первый запуск.
import { esc, rub, fmtDate, plural, todayISO, nowISO, daysAgo, normKey } from './util.js';
import { icon, top, nav, sheet, toast, confirmSheet, download, pickFile } from './ui.js';
import { readXlsx, writeXlsx } from './xlsx.js';
import { importCatalog } from './importer.js';

const DICTS = { section: 'Разделы', product_kind: 'Виды изделий', shape: 'Формы', pattern: 'Рисунки', collection: 'Коллекции' };

// ---------- резервная копия ----------
function backupFile(ctx) {
  ctx.db.setSetting('last_backup_at', nowISO());
  const d = ctx.db.dump();
  const name = `servizy-kopiya-${todayISO()}.json`;
  return new File([JSON.stringify(d)], name, { type: 'application/json' });
}
async function markBackup(ctx) { await ctx.save(); }
export async function backupDownload(ctx) {
  const f = backupFile(ctx);
  download(f, f.name);
  await markBackup(ctx);
  toast('Копия сохранена в «Загрузки»');
}
async function backupShare(ctx) {
  const f = backupFile(ctx);
  if (navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], title: 'Резервная копия «Сервизы»' }); await markBackup(ctx); return; }
    catch (e) { if (e.name === 'AbortError') { ctx.db.pending = []; return; } }
  }
  download(f, f.name);
  await markBackup(ctx);
  toast('Поделиться не получилось, копия сохранена в «Загрузки»');
}
export async function restoreBackup(ctx) {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  let d;
  try { d = JSON.parse(await f.text()); if (d.app !== 'servizy') throw new Error(); }
  catch { toast('Это не резервная копия приложения', 4000); return; }
  const s = d.stores;
  const ok = await confirmSheet(`Восстановить копию от ${fmtDate(d.exported_at?.slice(0, 10))}?<br><span class="small muted" style="font-weight:500">В ней ${s.client?.length ?? 0} клиентов, ${s.request?.length ?? 0} запросов, ${s.product?.length ?? 0} товаров. Текущие данные в телефоне будут заменены.</span>`, 'Восстановить', { danger: true });
  if (!ok) return;
  ctx.db.loadDump(d);
  await ctx.save('Данные восстановлены');
  ctx.go('#/');
}
async function exportExcel(ctx) {
  const { db, m } = ctx;
  const cName = id => db.get('client', id)?.name ?? '';
  const st = { active: 'активный', closed: 'закрыт', waiting: 'ждёт', bought: 'куплено', not_needed: 'не нужно', done: 'выполнено' };
  const kop = v => v == null ? null : v / 100;
  const reqs = db.all('request');
  const sheets = [
    { name: 'Клиенты', rows: [['Имя', 'Телефон', 'Заметки', 'В архиве', 'Создан'], ...db.all('client').map(c => [c.name, c.phone, c.note, c.is_archived ? 'да' : '', c.created_at])] },
    { name: 'Запросы', rows: [['Клиент', 'Комплект', 'Артикул', 'Статус', 'Создан', 'Закрыт', 'Нужно', 'Собрано', 'Ждёт', 'Заметка'], ...reqs.map(r => { const b = m.product(r.bundle_id); const p = m.requestProgress(r.id); return [cName(r.client_id), b?.name, b?.article, st[r.status], r.created_at, r.closed_at, p.need, p.got, p.waiting, r.note]; })] },
    { name: 'Позиции', rows: [['Клиент', 'Комплект', 'Позиция', 'Артикул', 'Нужно', 'Куплено', 'Остаток', 'Статус', 'Цена при записи, ₽', 'Цена сейчас, ₽', 'Дата записи', 'Заметка'], ...db.all('request_item').map(ri => { const r = db.get('request', ri.request_id); const p = ri.product_id ? m.product(ri.product_id) : null; const bought = m.bought(ri.id); return [cName(r?.client_id), m.product(r?.bundle_id)?.name, m.itemLabel(ri), p?.article, ri.qty_needed, bought, Math.max(0, ri.qty_needed - bought), st[ri.status], kop(ri.price_kop), p ? kop(m.currentPrice(p.id)) : null, ri.created_at, ri.note]; })] },
    { name: 'Покупки', rows: [['Дата', 'Клиент', 'Позиция', 'Кол-во', 'Заметка'], ...db.all('purchase').map(pu => { const ri = db.get('request_item', pu.request_item_id); const r = ri && db.get('request', ri.request_id); return [pu.purchased_at, cName(r?.client_id), ri ? m.itemLabel(ri) : '', pu.qty, pu.note]; })] },
    { name: 'Напоминания', rows: [['Когда', 'Клиент', 'Заметка', 'Статус', 'Выполнено'], ...db.all('reminder').map(r => [r.remind_at, cName(r.client_id), r.note, st[r.status], r.done_at])] },
    { name: 'Цены', rows: [['Артикул', 'Название', 'Цена, ₽', 'Действует с'], ...db.all('product_price').map(pr => { const p = m.product(pr.product_id); return [p?.article, p?.name, kop(pr.price_kop), pr.valid_from]; })] },
  ];
  download(writeXlsx(sheets), `servizy-${todayISO()}.xlsx`);
  toast('Таблица сохранена в «Загрузки»');
}

// ================= Ещё =================
export function more(ctx) {
  const { db, m } = ctx;
  const imp = JSON.parse(db.setting('last_import') || 'null');
  const last = db.setting('last_backup_at');
  const ago = last ? daysAgo(last) : null;
  const closedReq = db.all('request').filter(r => r.status !== 'active').length;
  const archClients = db.all('client').filter(c => c.is_archived).length;
  const li = (href, label, n) => `<a class="li" href="${href}"><span style="font-size:15px;font-weight:600">${label}</span><span class="row muted" style="gap:6px;font-size:14px">${n ?? ''}${icon.chev}</span></a>`;
  const html = `<div class="content" style="gap:14px">
    <h1 class="h1">Ещё</h1>
    <div class="col" style="gap:6px"><span class="label">Каталог с сайта</span>
      <div class="card tight" style="gap:10px"><span style="font-size:14px;line-height:1.4">${imp ? `Последняя загрузка: <span class="b">${fmtDate(imp.at)}</span><br><span class="muted">${imp.products} товаров · ${imp.bundles} комплектов</span>` : 'Каталог ещё не загружался'}</span>
      <a class="btn primary" href="#/import">${icon.upload} Загрузить файл с сайта (Excel)</a></div></div>
    <div class="col" style="gap:6px"><span class="label">Резервная копия</span>
      <div class="card tight" style="gap:10px"><span style="font-size:14px">${last ? `Последняя: ${fmtDate(last.slice(0, 10))} — ${ago === 0 ? 'сегодня' : `${ago} ${plural(ago, 'день', 'дня', 'дней')} назад`}` : 'Копий ещё не было'}</span>
        <div class="grid2"><button class="btn soft" id="bk">В «Загрузки»</button><button class="btn soft" id="sh">Поделиться</button></div>
        <span class="xs muted" style="line-height:1.4">Копия в этом же телефоне не спасёт при его потере. Время от времени отправляйте её себе в облако или мессенджер кнопкой «Поделиться».</span>
        <div class="row" style="gap:16px"><button class="linkbtn small" id="rs">Восстановить из копии</button><button class="linkbtn small" id="xl">Выгрузить в Excel</button></div></div></div>
    <div class="col" style="gap:6px"><span class="label">Справочники (оператор)</span>
      <div class="list">${li('#/search', 'Цены товаров', db.count('product_price'))}${Object.entries(DICTS).map(([s, l]) => li('#/dict/' + s, l, db.count(s))).join('')}</div></div>
    <div class="col" style="gap:6px"><span class="label">Архив</span>
      <div class="list">${li('#/archive/requests', 'Закрытые запросы', closedReq)}${li('#/archive/clients', 'Клиенты в архиве', archClients)}</div></div>
    <span class="xs muted" style="text-align:center">Сервизы ${ctx.version} · данные хранятся только в этом телефоне<span id="pers"></span></span>
  </div>${nav('more')}`;
  return {
    html, nav: true,
    bind(root) {
      root.querySelector('#bk').onclick = () => backupDownload(ctx).then(() => ctx.refresh());
      root.querySelector('#sh').onclick = () => backupShare(ctx).then(() => ctx.refresh());
      root.querySelector('#rs').onclick = () => restoreBackup(ctx);
      root.querySelector('#xl').onclick = () => exportExcel(ctx);
      navigator.storage?.persisted?.().then(p => { if (!p) root.querySelector('#pers').textContent = ' · установите приложение на главный экран, чтобы браузер не очистил данные'; });
    },
  };
}

// ================= Загрузка каталога =================
export function importScreen(ctx) {
  const html = `${top({ title: 'Загрузка каталога' })}<div class="content" id="box"></div>`;
  return {
    html, backTo: '#/more',
    bind(root) {
      const box = root.querySelector('#box');
      const start = () => {
        box.innerHTML = `<div class="note blue"><span>Выберите Excel-файл, выгруженный с сайта (листы «Товары» и «Состав комплектов»). Интернет не нужен: файл берётся из памяти телефона.</span></div>
          <button class="btn primary big" id="pick">${icon.upload} Выбрать файл</button>
          <span class="xs muted" style="line-height:1.4">Товары сопоставляются по артикулу: новые добавляются, у существующих обновляются поля, изменённые цены попадают в историю. Ничего не удаляется. Клиенты, запросы и напоминания не меняются.</span>`;
        box.querySelector('#pick').onclick = async () => {
          const f = await pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          if (f) confirmFile(f);
        };
      };
      const confirmFile = f => {
        const d = f.lastModified ? todayISO(new Date(f.lastModified)) : todayISO();
        box.innerHTML = `<div class="card tight" style="flex-direction:row;align-items:center;gap:12px">${icon.file}<div class="col grow"><span class="small b clip">${esc(f.name)}</span><span class="xs muted">${(f.size / 1048576).toFixed(1)} МБ</span></div></div>
          <label class="field"><span class="fl">Дата цен в файле</span><input type="date" id="dt" value="${d}"></label>
          <span class="xs muted">С этой даты цены из файла будут действовать в справочнике цен.</span>
          <button class="btn primary big" id="go">Загрузить</button><button class="btn" id="other">Другой файл</button>`;
        box.querySelector('#other').onclick = start;
        box.querySelector('#go').onclick = () => run(f, box.querySelector('#dt').value || todayISO());
      };
      const run = async (f, fileDate) => {
        box.innerHTML = `<div class="empty"><div class="spinner"></div><br>Читаю файл…</div>`;
        await new Promise(r => setTimeout(r, 30));
        const snapshot = ctx.db.dump();
        try {
          const wb = await readXlsx(await f.arrayBuffer());
          const kindmap = await fetch('data/kindmap.json').then(r => r.json()).catch(() => ({}));
          if (!ctx.db.count('section')) for (const [i, n] of ['Столовые предметы', 'Чайно-кофейные предметы', 'Сервизы'].entries()) ctx.db.put('section', { name: n, sort_order: i + 1 });
          const rep = importCatalog(ctx.db, wb, { fileDate, kindmap });
          await ctx.save();
          report(f, rep);
        } catch (e) {
          console.error(e);
          // откатываем незаписанные изменения в памяти
          ctx.db.loadDump(snapshot, { track: false });
          box.innerHTML = `<div class="note warn"><span><span class="b">Не получилось загрузить. Данные не изменились.</span><br>${esc(e.message || e)}</span></div><button class="btn primary" id="again">Выбрать другой файл</button>`;
          box.querySelector('#again').onclick = start;
        }
      };
      const report = (f, r) => {
        const d = r.dicts;
        const rows = [
          r.selfSkipped && [r.selfSkipped, `${plural(r.selfSkipped, 'комплект указан', 'комплекта указаны', 'комплектов указаны')} в своём составе — эти строки пропущены`],
          r.trimmed && [r.trimmed, 'артикулов с пробелом по краям — пробел убран'],
          r.packaging && [r.packaging, 'строк упаковки — отмечены, в подбор не попадут'],
          r.skippedRows && [r.skippedRows, 'служебных строк пропущено'],
          r.missingBundles.length && [r.missingBundles.length, `комплектов из состава нет в листе «Товары»: ${esc(r.missingBundles.slice(0, 5).join(', '))}`],
          ...r.mismatches.map(x => [1, `артикул ${esc(x.article)} не совпадает с названием (там ${esc(x.inName)}) — проверьте товар`, true]),
        ].filter(Boolean);
        box.innerHTML = `<div class="card tight" style="flex-direction:row;align-items:center;gap:12px">${icon.file}<div class="col grow"><span class="small b clip">${esc(f.name)}</span><span class="xs muted">цены с ${fmtDate(r.fileDate)}</span></div></div>
          <div class="note green">${icon.ok} Загружено. Клиенты и запросы не изменились.</div>
          <div class="grid2">
            <div class="stat soft"><span class="n">${r.added}</span><span class="xs muted">товаров добавлено</span></div>
            <div class="stat soft"><span class="n">${r.updated}</span><span class="xs muted">товаров обновлено</span></div>
            <div class="stat soft"><span class="n">${r.bundles}</span><span class="xs muted">комплектов с составом</span></div>
            <div class="stat soft"><span class="n">${r.compOnlyTotal}</span><span class="xs muted">предметов только в составе</span></div>
            <div class="stat soft"><span class="n">${r.pricesAdded}</span><span class="xs muted">новых цен</span></div>
            <div class="stat soft"><span class="n">${r.pricesChanged}</span><span class="xs muted">цен изменилось</span></div>
          </div>
          <span class="xs muted" style="line-height:1.4">Справочники: ${d.section} раздела, ${d.product_kind} видов, ${d.shape} форм, ${d.pattern} рисунков, ${d.collection} коллекций. Одинаковые названия, записанные по-разному, склеены.${r.notInFile ? ` ${r.notInFile} товаров из прежней загрузки в этом файле нет — они остались без изменений.` : ''}</span>
          ${rows.length ? `<div class="card tight" style="gap:0"><span class="xs b muted">ПРОПУЩЕНО И ИСПРАВЛЕНО</span>${rows.map(([n, t, w]) => `<div class="row" style="align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line2)"><span style="min-width:28px;font-size:14px;font-weight:800;color:${w ? 'var(--warn)' : 'var(--muted)'}">${n}</span><span class="small" style="line-height:1.4">${t}</span></div>`).join('')}</div>` : ''}
          <div class="grid2"><button class="btn" id="other">Другой файл</button><a class="btn primary" href="#/">Готово</a></div>`;
        box.querySelector('#other').onclick = start;
      };
      start();
    },
  };
}

// ================= Справочники =================
export function dict(ctx, [store]) {
  const { db, m } = ctx;
  if (!DICTS[store]) return { html: top({ title: 'Нет такого справочника' }) };
  const st = ctx.state['dict_' + store] ??= { q: '' };
  const html = `${top({ title: DICTS[store], right: `<button class="btn sm soft" id="add">+ Добавить</button>` })}
    <div class="content" style="gap:10px"><div class="search" style="height:48px;box-shadow:none">${icon.search}<input id="q" type="search" placeholder="Поиск" value="${esc(st.q)}"></div><div id="res" class="list"></div></div>`;
  const edit = o => sheet(`<h1 class="h-screen">${o ? 'Переименовать' : 'Добавить'}</h1><label class="field"><span class="fl">Название</span><input id="nm" value="${esc(o?.name ?? '')}"></label>${o ? `<span class="xs muted">Используется в ${m.dictUsage(store, o.id)} товарах. Новое название появится у всех.</span>` : ''}<button class="btn primary big" id="ok">Сохранить</button>`, (el, close) => {
    setTimeout(() => el.querySelector('#nm').focus(), 50);
    el.querySelector('#ok').onclick = async () => {
      const name = el.querySelector('#nm').value.trim();
      if (!name) return;
      const dup = db.all(store).find(x => normKey(x.name) === normKey(name) && x.id !== o?.id);
      if (dup) { toast('Такое значение уже есть'); return; }
      if (o) db.put(store, { ...o, name }); else m.dictAdd(store, name);
      await ctx.save('Сохранено'); close(); ctx.refresh();
    };
  });
  return {
    html, backTo: '#/more',
    bind(root) {
      const draw = () => {
        const q = normKey(st.q);
        const list = m.sorted(store).filter(o => !q || normKey(o.name).includes(q));
        root.querySelector('#res').innerHTML = list.map(o => `<button class="li" style="border:none;border-bottom:1px solid var(--line2);background:none;text-align:left;width:100%" data-id="${o.id}"><span style="font-size:15px">${esc(o.name)}</span><span class="small muted">${m.dictUsage(store, o.id)}</span></button>`).join('') || '<div class="empty">Пусто</div>';
      };
      root.querySelector('#q').oninput = e => { st.q = e.target.value; draw(); };
      root.querySelector('#res').onclick = e => { const b = e.target.closest('[data-id]'); if (b) edit(db.get(store, Number(b.dataset.id))); };
      root.querySelector('#add').onclick = () => edit(null);
      draw();
    },
  };
}

// ================= Архив =================
export function archive(ctx, [kind]) {
  const { db, m } = ctx;
  let body;
  if (kind === 'requests') {
    const list = db.all('request').filter(r => r.status !== 'active').sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''));
    body = list.map(r => { const p = m.requestProgress(r.id); return `<a class="card tight tap" href="#/request/${r.id}"><span class="b">${esc(db.get('client', r.client_id)?.name ?? '')}</span><span class="small">${esc(m.short(m.product(r.bundle_id)))} · ${esc(m.shapePattern(m.product(r.bundle_id) || {}))}</span><span class="xs muted">с ${fmtDate(r.created_at)} по ${fmtDate(r.closed_at)} · собрано ${p.got} из ${p.need}</span></a>`; }).join('') || '<div class="empty">Закрытых запросов нет</div>';
  } else {
    const list = db.all('client').filter(c => c.is_archived).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    body = list.map(c => `<a class="card tight tap" href="#/client/${c.id}"><span class="b">${esc(c.name)}</span><span class="small muted">${esc(c.phone ?? '')}</span></a>`).join('') || '<div class="empty">В архиве никого нет</div>';
  }
  return { html: `${top({ title: kind === 'requests' ? 'Закрытые запросы' : 'Клиенты в архиве' })}<div class="content" style="gap:8px">${body}</div>`, backTo: '#/more' };
}

// ================= Первый запуск =================
export function welcome(ctx) {
  const html = `<div class="content home" style="justify-content:center">
    <div class="col" style="gap:8px"><h1 class="h1">Сервизы</h1><span class="muted" style="line-height:1.45">Учёт клиентов, которые собирают сервиз по частям. Всё работает без интернета, данные хранятся только в этом телефоне.</span></div>
    <span class="label">С чего начать</span>
    <button class="btn primary big" id="seed">Загрузить каталог на 05.11.2026</button>
    <span class="xs muted" style="margin-top:-10px">1977 товаров и 860 комплектов уже встроены в приложение.</span>
    <a class="btn" href="#/import">Загрузить свежий файл с сайта</a>
    <button class="btn" id="restore">Восстановить из резервной копии</button>
    <div id="msg"></div>
  </div>`;
  return {
    html,
    bind(root) {
      root.querySelector('#seed').onclick = async e => {
        e.target.disabled = true;
        root.querySelector('#msg').innerHTML = '<div class="spinner"></div>';
        try {
          const d = await fetch('data/seed.json').then(r => { if (!r.ok) throw new Error('файл каталога не найден'); return r.json(); });
          d.stores.settings = (d.stores.settings || []).filter(s => s.key !== 'last_backup_at');
          ctx.db.loadDump(d);
          await ctx.save('Каталог загружен');
          ctx.go('#/');
        } catch (err) {
          e.target.disabled = false;
          root.querySelector('#msg').innerHTML = `<div class="note warn"><span>Не удалось загрузить: ${esc(err.message || err)}</span></div>`;
        }
      };
      root.querySelector('#restore').onclick = () => restoreBackup(ctx);
    },
  };
}
