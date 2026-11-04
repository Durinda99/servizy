// Загрузка каталога из Excel-файла с сайта (ТЗ 4.8, схема 7.1).
// Работает и в браузере, и в Node (для сборки стартовых данных).
import { normKey, clean, toInt } from './util.js';

const PACKAGING_RE = /упаковк|коробк|буклет|шубер|футляр|пакет подароч/i;

/** Правила на случай, когда вида нет в таблице соответствия (новые товары при повторной загрузке) */
export function guessKind(name, bundleKind = '') {
  const s = ' ' + String(name || '').toLowerCase().replace(/ё/g, 'е') + ' ';
  const b = String(bundleKind || '').toLowerCase();
  const tea = /чайн/.test(s) ? true : /коф/.test(s) ? false : /коф/.test(b) ? false : /чай/.test(b) ? true : null;
  if (/упаковк|коробк|буклет|шубер/.test(s)) return 'Упаковка';
  if (/^\s*крышк/.test(s)) return 'Крышка';
  if (/тар-ка|тарелк/.test(s)) {
    if (/глуб/.test(s)) return 'Тарелка глубокая';
    if (/десерт/.test(s)) return 'Тарелка десертная';
    if (/декор/.test(s)) return 'Декоративная тарелка';
    return 'Тарелка мелкая';
  }
  if (/чашк/.test(s) && /блюдц/.test(s)) return /бульон/.test(s) ? 'Чашка с блюдцем для бульона' : 'Чашка с блюдцем';
  if (/чашк/.test(s)) return /бульон/.test(s) ? 'Чашка для бульона' : tea === true ? 'Чашка чайная' : tea === false ? 'Чашка кофейная' : 'Чашка';
  if (/блюдц/.test(s)) return tea === true ? 'Блюдце чайное' : tea === false ? 'Блюдце кофейное' : 'Блюдце';
  if (/блюдо/.test(s)) return /\bкр|кругл/.test(s) ? 'Блюдо круглое' : /\bов|овал/.test(s) ? 'Блюдо овальное' : 'Блюдо';
  if (/чайник/.test(s)) return /долив/.test(s) ? 'Чайник доливной' : 'Чайник заварочный';
  const simple = ['Кофейник', 'Сахарница', 'Сливочник', 'Молочник', 'Салатник', 'Соусник', 'Масленка', 'Селедочница', 'Супница', 'Кружка', 'Ваза', 'Банка', 'Солонка', 'Перечница', 'Икорница', 'Розетка', 'Графин', 'Стакан', 'Бокал', 'Стопка', 'Поднос', 'Сухарница', 'Горчичница', 'Хренница', 'Чайница', 'Этажерка', 'Миска'];
  for (const k of simple) if (s.includes(' ' + k.toLowerCase())) return k === 'Банка' ? 'Банка с крышкой' : k;
  return null;
}

function headerIndex(row, names) {
  const idx = {};
  row.forEach((h, i) => { if (h) idx[String(h).trim().toLowerCase()] = i; });
  const out = {};
  for (const [key, variants] of Object.entries(names)) {
    for (const v of variants) if (idx[v.toLowerCase()] !== undefined) { out[key] = idx[v.toLowerCase()]; break; }
  }
  return out;
}

/**
 * db: MemDB/IdbDB; wb: { sheetNames, sheets }; opts: { fileDate: 'YYYY-MM-DD', kindmap }
 * Изменяет db (без commit) и возвращает отчёт.
 */
export function importCatalog(db, wb, { fileDate, kindmap = {} }) {
  const rep = { added: 0, updated: 0, pricesChanged: 0, pricesAdded: 0, bundles: 0, compItems: 0, compOnlyAdded: 0, packaging: 0, selfSkipped: 0, trimmed: 0, skippedRows: 0, missingBundles: [], mismatches: [], fileDate };
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
    const n = clean(name);
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
  const kindName = new Map(db.all('product_kind').map(k => [k.id, k.name]));

  const byArticle = new Map();
  const noArtKey = new Map();
  for (const p of db.all('product')) {
    if (p.article) byArticle.set(p.article, p);
    else noArtKey.set(`${normKey(p.name)}|${p.shape_id ?? ''}|${p.pattern_id ?? ''}`, p);
  }
  const lastPrice = new Map();
  for (const pr of db.all('product_price')) {
    const cur = lastPrice.get(pr.product_id);
    if (!cur || pr.valid_from > cur.valid_from) lastPrice.set(pr.product_id, pr);
  }
  const setPrice = (p, kop) => {
    if (kop == null) return;
    const cur = lastPrice.get(p.id);
    if (cur && cur.price_kop === kop) return;
    const same = db.all('product_price').find(x => x.product_id === p.id && x.valid_from === fileDate);
    const rec = same ? { ...same, price_kop: kop } : { product_id: p.id, price_kop: kop, valid_from: fileDate };
    db.put('product_price', rec);
    lastPrice.set(p.id, rec);
    if (cur) rep.pricesChanged++; else rep.pricesAdded++;
  };
  const sectionsOf = new Map();
  for (const ps of db.all('product_section')) {
    if (!sectionsOf.has(ps.product_id)) sectionsOf.set(ps.product_id, []);
    sectionsOf.get(ps.product_id).push(ps);
  }
  const resolveKind = (existing, art, name, raw, bundleKind) => {
    if (existing?.kind_id) return existing.kind_id;
    const k = (art && kindmap.byArticle?.[art]) || kindmap.byName?.[normKey(name)] || guessKind(name, bundleKind) || clean(raw);
    const id = dictId('product_kind', k);
    if (id && k) kindName.set(id, clean(k));
    return id;
  };

  // ---- лист «Товары» ----
  const seenInFile = new Set();
  for (let i = hRow + 1; i < tov.length; i++) {
    const r = tov[i];
    const rawArt = r[H.article];
    const art = clean(rawArt);
    const name = clean(r[H.name]);
    if (!art || !name) { if (r.some(c => clean(c))) rep.skippedRows++; continue; }
    if (String(rawArt) !== String(rawArt).trim()) rep.trimmed++;
    const inName = /арт\.?\s*(\d{2}\.\d{5}\.\d{2}\.\d)/i.exec(name);
    if (inName && inName[1] !== art) rep.mismatches.push({ article: art, inName: inName[1], name });
    seenInFile.add(art);
    const existing = byArticle.get(art);
    const shape_id = dictId('shape', r[H.shape]);
    const pattern_id = dictId('pattern', r[H.pattern]);
    const p = {
      ...(existing || {}),
      article: art,
      name,
      kind_id: resolveKind(existing, art, name, r[H.kind]),
      shape_id,
      pattern_id,
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
    // разделы
    const secIds = String(r[H.section] ?? '').split(',').map(s => dictId('section', s)).filter(Boolean);
    const old = sectionsOf.get(p.id) || [];
    for (const o of old) if (!secIds.includes(o.section_id)) db.del('product_section', [p.id, o.section_id]);
    for (const sid of secIds) if (!old.some(o => o.section_id === sid)) db.put('product_section', { product_id: p.id, section_id: sid });
  }

  // ---- лист «Состав комплектов» ----
  const compH = comp.findIndex(r => /артикул комплекта/i.test(String(r[0] ?? '')));
  const newComp = new Map(); // bundle_id → Map(product_id → qty)
  for (let i = compH + 1; i < comp.length; i++) {
    const r = comp[i];
    const bArt = clean(r[0]);
    const iArtRaw = r[2];
    const iName = clean(r[3]);
    if (!bArt || !iName || /^артикул$/i.test(String(iArtRaw ?? '').trim())) continue;
    const iArt = clean(iArtRaw);
    if (iArt && iArtRaw !== iArt) rep.trimmed++;
    if (iArt && iArt === bArt) { rep.selfSkipped++; continue; }
    const bundle = byArticle.get(bArt);
    if (!bundle) { if (!rep.missingBundles.includes(bArt)) rep.missingBundles.push(bArt); continue; }
    const qty = Math.max(1, toInt(r[4]) ?? 1);
    let item = iArt ? byArticle.get(iArt) : null;
    const bundleKind = kindName.get(bundle.kind_id) || bundle.name;
    if (!item) {
      const key = `${normKey(iName)}|${bundle.shape_id ?? ''}|${bundle.pattern_id ?? ''}`;
      if (!iArt) item = noArtKey.get(key);
      if (!item) {
        const compKind = kindmap.byComp?.[`${bArt}|${iArt ?? ''}|${normKey(iName)}`];
        const kindStr = compKind || kindmap.byName?.[normKey(iName)] || guessKind(iName, bundleKind) || iName;
        const isPack = kindStr === 'Упаковка' || PACKAGING_RE.test(iName) ? 1 : 0;
        item = {
          article: iArt, name: iName, kind_id: dictId('product_kind', kindStr),
          shape_id: bundle.shape_id, pattern_id: bundle.pattern_id, collection_id: bundle.collection_id,
          material: bundle.material, sold_separately: 0, is_packaging: isPack,
          source: 'file', is_archived: 0, created_at: fileDate,
        };
        db.put('product', item);
        rep.compOnlyAdded++;
        if (iArt) byArticle.set(iArt, item); else noArtKey.set(key, item);
      }
    }
    // габариты и вес предмета, если ещё не заполнены
    const dims = { height_mm: toInt(r[5]), length_mm: toInt(r[6]), width_mm: toInt(r[7]), volume_ml: toInt(r[8]), weight_g: toInt(r[9]) };
    let changed = false;
    for (const [k, v] of Object.entries(dims)) if (v != null && item[k] == null) { item[k] = v; changed = true; }
    if (changed) db.put('product', item);
    if (!newComp.has(bundle.id)) newComp.set(bundle.id, new Map());
    const m = newComp.get(bundle.id);
    m.set(item.id, (m.get(item.id) || 0) + qty);
  }
  const oldComp = new Map();
  for (const bi of db.all('bundle_item')) {
    if (!oldComp.has(bi.bundle_id)) oldComp.set(bi.bundle_id, []);
    oldComp.get(bi.bundle_id).push(bi);
  }
  for (const [bid, items] of newComp) {
    for (const o of oldComp.get(bid) || []) if (!items.has(o.product_id)) db.del('bundle_item', [bid, o.product_id]);
    for (const [pid, qty] of items) db.put('bundle_item', { bundle_id: bid, product_id: pid, quantity: qty });
    rep.bundles++;
    rep.compItems += items.size;
  }
  rep.compOnlyTotal = db.all('product').filter(p => !p.sold_separately && !p.is_packaging).length;
  rep.packaging = db.all('product').filter(p => p.is_packaging).length;
  rep.dicts = { section: db.count('section'), product_kind: db.count('product_kind'), shape: db.count('shape'), pattern: db.count('pattern'), collection: db.count('collection') };
  rep.notInFile = db.all('product').filter(p => p.sold_separately && p.source === 'file' && !seenInFile.has(p.article)).length;
  db.setSetting('last_import', JSON.stringify({ at: fileDate, products: rep.added + rep.updated, bundles: rep.bundles }));
  return rep;
}
