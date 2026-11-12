// Загрузка каталога из Excel-файла с сайта (ТЗ 4.8, схема 7.1).
// Работает и в браузере, и в Node (для сборки встроенного каталога).
import { normKey, clean, toInt } from './util.js';

const PACKAGING_RE = /упаковк|коробк|буклет|шубер|футляр|пакет подароч|каталог|флэш|флеш|аудиокниг|сертификат/i;

/**
 * Вид по названию (правила соответствия видов, схема 7.2).
 * Возвращает общий вид («Тарелка», «Чашка», «Блюдце», «Блюдо»), если тип не указан, — его уточняет refineKind.
 */
export function guessKind(name, bundleKind = '') {
  const s = ' ' + String(name || '').toLowerCase().replace(/ё/g, 'е') + ' ';
  const b = String(bundleKind || '').toLowerCase();
  const tea = /чайн/.test(s) ? true : /коф/.test(s) ? false : /коф/.test(b) ? false : /чай/.test(b) ? true : null;
  if (PACKAGING_RE.test(s)) return 'Упаковка';
  if (/^\s*крышк/.test(s)) return 'Крышка';
  if (/тар-ка|тарелк/.test(s)) {
    if (/глуб/.test(s)) return 'Тарелка глубокая';
    if (/десерт|пирожк/.test(s)) return 'Тарелка десертная';
    if (/декор/.test(s)) return 'Декоративная тарелка';
    if (/мелк|мел\.|плоск|обеден/.test(s)) return 'Тарелка мелкая';
    return 'Тарелка';
  }
  if (/чашк/.test(s) && /блюдц/.test(s)) return /бульон/.test(s) ? 'Чашка с блюдцем для бульона' : 'Чашка с блюдцем';
  if (/чашк/.test(s)) return /бульон/.test(s) ? 'Чашка для бульона' : tea === true ? 'Чашка чайная' : tea === false ? 'Чашка кофейная' : 'Чашка';
  if (/блюдц/.test(s)) return tea === true ? 'Блюдце чайное' : tea === false ? 'Блюдце кофейное' : 'Блюдце';
  if (/блюдо/.test(s)) return /\sкр|кругл/.test(s) ? 'Блюдо круглое' : /\sов|овал/.test(s) ? 'Блюдо овальное' : 'Блюдо';
  if (/чайник/.test(s)) return /долив/.test(s) ? 'Чайник доливной' : 'Чайник заварочный';
  const simple = ['Кофейник', 'Сахарница', 'Сливочник', 'Молочник', 'Салатник', 'Соусник', 'Масленка', 'Селедочница', 'Супница', 'Кружка', 'Ваза', 'Банка', 'Солонка', 'Перечница', 'Икорница', 'Розетка', 'Графин', 'Стакан', 'Бокал', 'Стопка', 'Поднос', 'Сухарница', 'Горчичница', 'Хренница', 'Чайница', 'Этажерка', 'Миска'];
  for (const k of simple) if (s.includes(' ' + k.toLowerCase())) return k === 'Банка' ? 'Банка с крышкой' : k;
  return null;
}

/** Уточнение общего вида по габаритам и соседям по комплекту */
export function refineKind(kind, p, siblingKinds = []) {
  if (kind === 'Чашка' && p.volume_ml) return p.volume_ml <= 180 ? 'Чашка кофейная' : p.volume_ml >= 200 ? 'Чашка чайная' : kind;
  if (kind === 'Блюдце') {
    if (siblingKinds.includes('Чашка чайная') && !siblingKinds.includes('Чашка кофейная')) return 'Блюдце чайное';
    if (siblingKinds.includes('Чашка кофейная') && !siblingKinds.includes('Чашка чайная')) return 'Блюдце кофейное';
    return kind;
  }
  if (kind === 'Тарелка') {
    if (p.height_mm >= 30) return 'Тарелка глубокая';
    const d = p.length_mm || p.width_mm || toInt(/(\d{3})\s*мм/.exec(p.name || '')?.[1]);
    if (d >= 220 && d <= 229) return 'Тарелка глубокая';
    return 'Тарелка мелкая';
  }
  if (kind === 'Блюдо' && p.length_mm && p.width_mm) return p.length_mm === p.width_mm ? 'Блюдо круглое' : 'Блюдо овальное';
  return kind;
}

const GENERIC = new Set(['Тарелка', 'Чашка', 'Блюдце', 'Блюдо']);
const RAW_ALIAS = { 'Тарелка декоративная': 'Декоративная тарелка', 'Чашка с блюдцем чайная': 'Чашка с блюдцем', 'Чашка с блюдцем кофейная': 'Чашка с блюдцем', 'Бокал с крышкой и блюдцем': 'Бокал с блюдцем и крышкой', 'Бокал с блюдцем и с крышкой': 'Бокал с блюдцем и крышкой', 'Чашка с блюдцем и с крышкой': 'Чашка с блюдцем и крышкой' };
const rawKind = v => { const k = clean(v); return k && !GENERIC.has(k) ? (RAW_ALIAS[k] || k) : null; };

function headerIndex(row, names) {
  const idx = {};
  row.forEach((h, i) => { if (h) idx[String(h).trim().toLowerCase()] = i; });
  const out = {};
  for (const [key, variants] of Object.entries(names)) {
    for (const v of variants) if (idx[v.toLowerCase()] !== undefined) { out[key] = idx[v.toLowerCase()]; break; }
  }
  return out;
}

/** Встроенный каталог хранится как строки двух листов файла: превращаем обратно в «книгу» */
export function catalogToWorkbook(cat) {
  return { sheetNames: ['Товары', 'Состав комплектов'], sheets: { 'Товары': cat.tov, 'Состав комплектов': cat.comp } };
}

/**
 * db: MemDB/IdbDB; wb: { sheetNames, sheets }; opts: { fileDate: 'YYYY-MM-DD', kindmap }
 * Изменяет db (без commit) и возвращает отчёт.
 */
export function importCatalog(db, wb, { fileDate, kindmap = {} }) {
  const rep = { added: 0, updated: 0, pricesChanged: 0, pricesAdded: 0, bundles: 0, compItems: 0, compOnlyAdded: 0, packaging: 0, selfSkipped: 0, nestedExpanded: 0, trimmed: 0, skippedRows: 0, kindsByRules: 0, missingBundles: [], mismatches: [], fileDate };
  const tovName = wb.sheetNames.find(n => /товар/i.test(n)) ?? wb.sheetNames[0];
  const compName = wb.sheetNames.find(n => /состав/i.test(n)) ?? wb.sheetNames[1];
  const tov = wb.sheets[tovName] || [];
  const comp = wb.sheets[compName] || [];
  const hRow = tov.findIndex(r => r.some(c => /^артикул$/i.test(String(c ?? '').trim())) && r.some(c => /^название$/i.test(String(c ?? '').trim())));
  if (hRow < 0) throw new Error('Не нашёл лист «Товары» с колонками «Артикул» и «Название». Это точно файл с сайта?');
  const H = headerIndex(tov[hRow], {
    name: ['Название'], section: ['Раздел'], subsection: ['Подраздел'], shape: ['Форма'], pattern: ['Рисунок'],
    persons: ['Персон'], items: ['Предметов'], material: ['Материал'], kind: ['Вид изделия'], collection: ['Коллекция'],
    weight: ['Вес, г', 'Вес'], year: ['Год начала выпуска'], article: ['Артикул'], price: ['Цена, руб.', 'Цена'],
    stock: ['Наличие'], url: ['Ссылка на товар'], photo: ['Ссылка на фото'],
  });

  // справочники: нормализованный ключ → id
  const dict = {};
  for (const s of ['section', 'product_kind', 'shape', 'pattern', 'collection']) {
    dict[s] = new Map();
    for (const o of db.all(s)) dict[s].set(normKey(o.name), o.id);
  }
  const dictId = (store, name) => {
    let n = clean(name);
    if (store === 'product_kind' && n) n = RAW_ALIAS[n] || n;
    if (!n) return null;
    const k = normKey(n);
    if (!k) return null;
    let id = dict[store].get(k);
    if (!id) {
      const o = { name: n };
      if (store === 'section') o.sort_order = db.count('section') + 1;
      id = db.put(store, o).id;
      dict[store].set(k, id);
    }
    return id;
  };
  const kindName = id => (id ? db.get('product_kind', id)?.name : null) || '';

  const byArticle = new Map();
  const noArtKey = new Map();
  for (const p of db.all('product')) {
    if (p.article) byArticle.set(p.article, p);
    else noArtKey.set(`${normKey(p.name)}|${p.shape_id ?? ''}|${p.pattern_id ?? ''}`, p);
  }
  const lastPrice = new Map();
  const priceByDate = new Map();
  for (const pr of db.all('product_price')) {
    const cur = lastPrice.get(pr.product_id);
    if (!cur || pr.valid_from > cur.valid_from) lastPrice.set(pr.product_id, pr);
    priceByDate.set(`${pr.product_id}|${pr.valid_from}`, pr);
  }
  const setPrice = (p, kop) => {
    if (kop == null) return;
    const cur = lastPrice.get(p.id);
    if (cur && cur.price_kop === kop) return;
    const same = priceByDate.get(`${p.id}|${fileDate}`);
    const rec = same ? { ...same, price_kop: kop } : { product_id: p.id, price_kop: kop, valid_from: fileDate };
    db.put('product_price', rec);
    lastPrice.set(p.id, rec);
    priceByDate.set(`${p.id}|${fileDate}`, rec);
    if (cur) rep.pricesChanged++; else rep.pricesAdded++;
  };
  const sectionsOf = new Map();
  for (const ps of db.all('product_section')) {
    if (!sectionsOf.has(ps.product_id)) sectionsOf.set(ps.product_id, []);
    sectionsOf.get(ps.product_id).push(ps);
  }

  // ---- лист «Товары» ----
  const seenInFile = new Set();
  for (let i = hRow + 1; i < tov.length; i++) {
    const r = tov[i] || [];
    const rawArt = r[H.article];
    const art = clean(rawArt);
    const name = clean(r[H.name]);
    if (!art || !name) { if (r.some(c => clean(c))) rep.skippedRows++; continue; }
    if (String(rawArt) !== String(rawArt).trim()) rep.trimmed++;
    const inName = /арт\.?\s*(\d{2}\.\d{5}\.\d{2}\.\d)/i.exec(name);
    if (inName && inName[1] !== art) rep.mismatches.push({ article: art, inName: inName[1], name });
    seenInFile.add(art);
    const existing = byArticle.get(art);
    let kind_id = existing?.kind_locked ? existing.kind_id : null;
    if (!kind_id) {
      let k = kindmap.byArticle?.[art] || kindmap.byName?.[normKey(name)];
      if (!k) {
        const g = guessKind(name);
        k = (g && !GENERIC.has(g) && /^(Тарелка|Чашка|Блюдце|Блюдо)/.test(g) ? g : null) || rawKind(r[H.kind]) || g || clean(r[H.kind]);
        if (k) rep.kindsByRules++;
      }
      if (k === 'Тарелка') k = refineKind(k, { name });
      kind_id = dictId('product_kind', k);
    }
    const p = {
      ...(existing || {}),
      article: art,
      name,
      kind_id,
      shape_id: dictId('shape', r[H.shape]),
      pattern_id: dictId('pattern', r[H.pattern]),
      collection_id: dictId('collection', r[H.collection]),
      subsection: clean(r[H.subsection]),
      material: clean(r[H.material]),
      persons: toInt(r[H.persons]),
      items_count: toInt(r[H.items]),
      weight_g: toInt(r[H.weight]) ?? existing?.weight_g ?? null,
      year_start: toInt(r[H.year]),
      sold_separately: 1,
      is_packaging: 0,
      site_status: clean(r[H.stock]),
      url: clean(r[H.url]),
      photo_url: clean(r[H.photo]),
      source: 'file',
      is_archived: existing?.is_archived ?? 0,
      created_at: existing?.created_at ?? fileDate,
    };
    db.put('product', p);
    byArticle.set(art, p);
    if (existing) rep.updated++; else rep.added++;
    const price = r[H.price];
    if (price !== null && price !== '' && Number.isFinite(Number(price))) setPrice(p, Math.round(Number(price) * 100));
    const secIds = String(r[H.section] ?? '').split(',').map(s => dictId('section', s)).filter(Boolean);
    const old = sectionsOf.get(p.id) || [];
    for (const o of old) if (!secIds.includes(o.section_id)) db.del('product_section', [p.id, o.section_id]);
    for (const sid of secIds) if (!old.some(o => o.section_id === sid)) db.put('product_section', { product_id: p.id, section_id: sid });
  }

  // ---- лист «Состав комплектов» ----
  const compH = comp.findIndex(r => /артикул комплекта/i.test(String(r?.[0] ?? '')));
  const newComp = new Map(); // bundle_id → Map(product_id → qty)
  const toKind = []; // предметы, которым нужно определить вид: { item, bundle, bArt, iArt, iName }
  for (let i = compH + 1; i < comp.length; i++) {
    const r = comp[i] || [];
    const bArt = clean(r[0]);
    const iArtRaw = r[2];
    const iName = clean(r[3]);
    if (!bArt || !iName || /^артикул$/i.test(String(iArtRaw ?? '').trim())) continue;
    const iArt = clean(iArtRaw);
    if (iArt && String(iArtRaw) !== iArt) rep.trimmed++;
    if (iArt && iArt === bArt) { rep.selfSkipped++; continue; }
    const bundle = byArticle.get(bArt);
    if (!bundle) { if (!rep.missingBundles.includes(bArt)) rep.missingBundles.push(bArt); continue; }
    const qty = Math.max(1, toInt(r[4]) ?? 1);
    let item = iArt ? byArticle.get(iArt) : null;
    let created = false;
    if (!item) {
      const key = `${normKey(iName)}|${bundle.shape_id ?? ''}|${bundle.pattern_id ?? ''}`;
      if (!iArt) item = noArtKey.get(key);
      if (!item) {
        item = {
          article: iArt, name: iName, kind_id: null,
          shape_id: bundle.shape_id, pattern_id: bundle.pattern_id, collection_id: bundle.collection_id,
          material: bundle.material, sold_separately: 0, is_packaging: PACKAGING_RE.test(iName) ? 1 : 0,
          source: 'file', is_archived: 0, created_at: fileDate,
        };
        db.put('product', item);
        rep.compOnlyAdded++;
        created = true;
        if (iArt) byArticle.set(iArt, item); else noArtKey.set(key, item);
      }
    }
    const dims = { height_mm: toInt(r[5]), length_mm: toInt(r[6]), width_mm: toInt(r[7]), volume_ml: toInt(r[8]), weight_g: toInt(r[9]) };
    let changed = false;
    for (const [k, v] of Object.entries(dims)) if (v != null && item[k] == null) { item[k] = v; changed = true; }
    if (changed && !created) db.put('product', item);
    if (!item.sold_separately && !item.kind_locked) toKind.push({ item, bundle, bArt, iArt, iName });
    if (!newComp.has(bundle.id)) newComp.set(bundle.id, new Map());
    const m = newComp.get(bundle.id);
    m.set(item.id, (m.get(item.id) || 0) + qty);
  }

  // виды предметов «только в составе»: таблица соответствия, затем правила
  const firstPass = new Map(); // item.id → вид
  const fromRules = new Set();
  for (const t of toKind) {
    if (firstPass.has(t.item.id)) continue;
    let k = kindmap.byComp?.[`${t.bArt}|${t.iArt ?? ''}|${normKey(t.iName)}`] || kindmap.byName?.[normKey(t.iName)];
    if (!k) { k = guessKind(t.iName, kindName(t.bundle.kind_id) || t.bundle.name) || t.iName; fromRules.add(t.item.id); }
    firstPass.set(t.item.id, k);
  }
  // сначала уточняем всё, кроме блюдец, затем блюдца — по уже уточнённым чашкам того же комплекта
  const refined = new Map();
  const order = [...toKind.filter(t => firstPass.get(t.item.id) !== 'Блюдце'), ...toKind.filter(t => firstPass.get(t.item.id) === 'Блюдце')];
  for (const t of order) {
    const siblings = [...(newComp.get(t.bundle.id)?.keys() || [])].map(id => refined.get(id) || firstPass.get(id) || kindName(db.get('product', id)?.kind_id));
    const k = refined.get(t.item.id) && firstPass.get(t.item.id) !== 'Блюдце' ? refined.get(t.item.id) : refineKind(firstPass.get(t.item.id), t.item, siblings);
    refined.set(t.item.id, k);
    const kid = dictId('product_kind', k);
    const isPack = k === 'Упаковка' || PACKAGING_RE.test(t.iName) ? 1 : 0;
    if (t.item.kind_id !== kid || t.item.is_packaging !== isPack) { t.item.kind_id = kid; t.item.is_packaging = isPack; db.put('product', t.item); }
  }
  rep.kindsByRules += fromRules.size;

  // в состав комплекта входят только товары без состава (ТЗ 1.13): вложенный набор раскладывается на свои предметы
  const compOf = id => {
    if (newComp.has(id)) return newComp.get(id);
    const own = db.all('bundle_item').filter(bi => bi.bundle_id === id);
    return own.length ? new Map(own.map(bi => [bi.product_id, bi.quantity])) : null;
  };
  for (const [bid, items] of newComp) {
    for (const [pid, qty] of [...items]) {
      const sub = pid === bid ? null : compOf(pid);
      if (!sub) continue;
      items.delete(pid);
      for (const [sp, sq] of sub) if (sp !== pid && sp !== bid) items.set(sp, (items.get(sp) || 0) + qty * sq);
      rep.nestedExpanded++;
    }
  }

  const oldComp = new Map();
  for (const bi of db.all('bundle_item')) {
    if (!oldComp.has(bi.bundle_id)) oldComp.set(bi.bundle_id, []);
    oldComp.get(bi.bundle_id).push(bi);
  }
  for (const [bid, items] of newComp) {
    for (const o of oldComp.get(bid) || []) if (!items.has(o.product_id)) db.del('bundle_item', [bid, o.product_id]);
    for (const [pid, qty] of items) {
      const o = oldComp.get(bid)?.find(x => x.product_id === pid);
      if (!o || o.quantity !== qty) db.put('bundle_item', { bundle_id: bid, product_id: pid, quantity: qty });
    }
    rep.bundles++;
    rep.compItems += items.size;
  }
  const all = db.all('product');
  rep.compOnlyTotal = all.filter(p => !p.sold_separately && !p.is_packaging).length;
  rep.packaging = all.filter(p => p.is_packaging).length;
  rep.dicts = { section: db.count('section'), product_kind: new Set(all.filter(p => !p.is_packaging).map(p => p.kind_id).filter(Boolean)).size, shape: db.count('shape'), pattern: db.count('pattern'), collection: db.count('collection') };
  rep.notInFile = all.filter(p => p.sold_separately && p.source === 'file' && !seenInFile.has(p.article)).length;
  const prev = JSON.parse(db.setting('last_import') || 'null');
  if (!prev || prev.at <= fileDate) db.setSetting('last_import', JSON.stringify({ at: fileDate, products: rep.added + rep.updated, bundles: rep.bundles }));
  return rep;
}
