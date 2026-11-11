// Предметная логика: цены, состав, подбор, запросы, покупки, напоминания.
import { nowISO, todayISO, normKey } from './util.js';

export class Model {
  constructor(db) { this.db = db; }

  // ---------- справочники ----------
  dictName(store, id) { return id ? this.db.get(store, id)?.name ?? '' : ''; }
  kindName(id) { return this.dictName('product_kind', id); }
  shapeName(id) { return this.dictName('shape', id); }
  patternName(id) { return this.dictName('pattern', id); }
  sorted(store) { return this.db.all(store).sort((a, b) => a.name.localeCompare(b.name, 'ru')); }

  // ---------- товары ----------
  product(id) { return this.db.get('product', Number(id)); }
  prices(pid) { return this.db.all('product_price').filter(p => p.product_id === pid).sort((a, b) => b.valid_from.localeCompare(a.valid_from)); }
  currentPrice(pid, onDate = todayISO()) {
    let best = null;
    for (const p of this.db.all('product_price')) if (p.product_id === pid && p.valid_from <= onDate && (!best || p.valid_from > best.valid_from)) best = p;
    return best?.price_kop ?? null;
  }
  /** Цена на дату записи, а если на ту дату цены нет — первая известная (схема 4.6) */
  priceAt(pid, date) {
    const on = this.currentPrice(pid, date.slice(0, 10));
    if (on != null) return on;
    const first = this.prices(pid).at(-1);
    return first?.price_kop ?? null;
  }
  bundleItems(bid) {
    return this.db.all('bundle_item').filter(b => b.bundle_id === bid)
      .map(b => ({ ...b, product: this.product(b.product_id) }))
      .filter(b => b.product)
      .sort((a, b) => (a.product.is_packaging - b.product.is_packaging) || a.product.name.localeCompare(b.product.name, 'ru'));
  }
  isBundle(pid) { return this.db.all('bundle_item').some(b => b.bundle_id === pid); }
  bundleIds() { return new Set(this.db.all('bundle_item').map(b => b.bundle_id)); }
  sectionNames(pid) { return this.db.all('product_section').filter(s => s.product_id === pid).map(s => this.dictName('section', s.section_id)); }
  bundlesContaining(pid) {
    return this.db.all('bundle_item').filter(b => b.product_id === pid).map(b => ({ ...b, bundle: this.product(b.bundle_id) })).filter(b => b.bundle);
  }
  /** Поступивший товар → предметы (комплект раскладывается, упаковка отбрасывается) */
  leaves(pid) {
    const items = this.bundleItems(pid).filter(b => !b.product.is_packaging);
    if (items.length) return items.map(b => ({ product: b.product, qty: b.quantity }));
    const p = this.product(pid);
    return p ? [{ product: p, qty: 1 }] : [];
  }
  /** Короткое название для экрана: без артикула, формы и рисунка (они показаны рядом) */
  short(p) {
    if (!p) return '—';
    let s = p.name;
    const kind = this.kindName(p.kind_id);
    if (!p.sold_separately && kind && kind.toLowerCase().startsWith(s.toLowerCase().trim()) && kind.length > s.trim().length) return kind;
    s = s.replace(/[,\s]*арт\.?\s*[\d.]+\d\s*$/i, '');
    if (!p.sold_separately) return s;
    const rm = (word, val) => {
      if (!val) return;
      const v = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\?[\s-]+/g, '[\\s\\-–]*');
      s = s.replace(new RegExp(`[,\\s]*(?:^|\\s)(?:${word})\\.?\\s*[«"]?\\s*${v}\\s*[»"]?`, 'i'), ' ');
    };
    rm('форма|ф', this.shapeName(p.shape_id));
    rm('рисунок|рис|р', this.patternName(p.pattern_id));
    s = s.replace(/[,\s]*(?:форма|рисунок)\s*(?=,|$)/gi, '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
    return s.length >= 3 ? s : p.name;
  }
  shapePattern(p) { return [this.shapeName(p.shape_id), this.patternName(p.pattern_id)].filter(Boolean).join(' · '); }

  searchProducts(q, { limit = 60, bundlesOnly = false, includePackaging = false, includeArchived = false, sectionId = null } = {}) {
    const raw = q.trim().toLowerCase().replace(/ё/g, 'е');
    const bundles = this.bundleIds();
    let list = this.db.all('product').filter(p => (includePackaging || !p.is_packaging) && (includeArchived || !p.is_archived) && (!bundlesOnly || bundles.has(p.id)));
    if (sectionId) { const inSec = new Set(this.db.all('product_section').filter(s => s.section_id === sectionId).map(s => s.product_id)); list = list.filter(p => inSec.has(p.id)); }
    if (raw) {
      const artLike = /^[\d.\s]+$/.test(raw);
      if (artLike) {
        const a = raw.replace(/\s/g, '');
        list = list.filter(p => p.article && p.article.includes(a));
      } else {
        const words = raw.split(/\s+/).filter(Boolean).map(w => w.replace(/[«»"]/g, ''));
        list = list.filter(p => {
          const hay = (p.name + ' ' + this.shapeName(p.shape_id) + ' ' + this.patternName(p.pattern_id) + ' ' + (p.article || '')).toLowerCase().replace(/ё/g, 'е');
          return words.every(w => hay.includes(w));
        });
      }
    }
    // сначала продаваемые отдельно, затем комплекты, затем «только в составе»
    const rank = p => (p.sold_separately ? 0 : 2) + (bundles.has(p.id) ? 0 : 0);
    list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'));
    return { total: list.length, items: list.slice(0, limit) };
  }

  // ---------- запросы и остатки ----------
  /** Позиция «комплект целиком»: товар позиции — комплект с составом */
  isWhole(ri) { return !!ri?.product_id && this.isBundle(ri.product_id); }
  purchasesOf(riId) { return this.db.all('purchase').filter(p => p.request_item_id === riId); }
  bought(riId) { return this.purchasesOf(riId).reduce((s, p) => s + p.qty, 0); }
  remaining(ri) { return Math.max(0, ri.qty_needed - this.bought(ri.id)); }
  requestItems(rid) { return this.db.all('request_item').filter(i => i.request_id === rid).sort((a, b) => a.id - b.id); }
  itemLabel(ri) {
    if (ri.product_id) return this.short(this.product(ri.product_id)) + (this.isWhole(ri) ? ' целиком' : '');
    return `${this.kindName(ri.kind_id)} · ${this.shapeName(ri.shape_id)} · ${this.patternName(ri.pattern_id)}`;
  }
  requestProgress(rid) {
    let need = 0, got = 0, waiting = 0;
    for (const ri of this.requestItems(rid)) {
      const b = this.bought(ri.id);
      got += b;
      if (ri.status === 'withdrawn' || ri.status === 'split') { need += b; continue; }
      need += ri.qty_needed;
      if (ri.status === 'waiting') waiting += Math.max(0, ri.qty_needed - b);
    }
    return { need, got, waiting };
  }
  clientRequests(cid) { return this.db.all('request').filter(r => r.client_id === cid).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  /** Название запроса: комплект или «Отдельные товары» */
  requestTitle(r) { return r.kind === 'loose' ? 'Отдельные товары' : this.short(this.product(r.bundle_id)); }
  requestSub(r) {
    if (r.kind === 'loose') return 'запрос без комплекта';
    const whole = this.requestItems(r.id).some(i => i.status === 'waiting' && i.product_id === r.bundle_id && this.isWhole(i));
    return [this.shapePattern(this.product(r.bundle_id) || {}), whole ? 'ждёт целиком' : null].filter(Boolean).join(' · ');
  }
  looseRequest(cid) { return this.db.all('request').find(r => r.client_id === cid && r.kind === 'loose' && r.status === 'active') || null; }
  /** Активный запрос клиента именно на этот комплект (самый новый) */
  bundleRequest(cid, bundleId) {
    return this.clientRequests(cid).find(r => r.status === 'active' && r.kind === 'bundle' && r.bundle_id === bundleId) || null;
  }

  /** Сколько клиентов ждут и сколько предметов в листе ожидания */
  stats() {
    const clients = new Set();
    let items = 0;
    const activeReq = new Map(this.db.all('request').filter(r => r.status === 'active').map(r => [r.id, r]));
    for (const ri of this.db.all('request_item')) {
      if (ri.status !== 'waiting') continue;
      const r = activeReq.get(ri.request_id);
      if (!r) continue;
      const c = this.db.get('client', r.client_id);
      if (!c || c.is_archived) continue;
      const rem = this.remaining(ri);
      if (rem > 0) { clients.add(c.id); items += rem; }
    }
    return { clients: clients.size, items };
  }

  /** Индекс ожидания для бейджей в поиске */
  waitingIndex() {
    const byProduct = new Set(), byCrit = new Set();
    const activeReq = new Set(this.db.all('request').filter(r => r.status === 'active' && !this.db.get('client', r.client_id)?.is_archived).map(r => r.id));
    for (const ri of this.db.all('request_item')) {
      if (ri.status !== 'waiting' || !activeReq.has(ri.request_id) || this.remaining(ri) <= 0) continue;
      if (ri.product_id) byProduct.add(ri.product_id);
      else byCrit.add(`${ri.kind_id}|${ri.shape_id}|${ri.pattern_id}`);
    }
    const any = byProduct.size + byCrit.size > 0;
    return {
      any,
      count: pid => {
        if (!any) return 0;
        const hit = byProduct.has(pid) || this.leaves(pid).some(l => byProduct.has(l.product.id) || byCrit.has(`${l.product.kind_id}|${l.product.shape_id}|${l.product.pattern_id}`));
        return hit ? new Set(this.queue([pid]).map(g => g.client.id)).size : 0;
      },
    };
  }

  /**
   * Очередь по поступившему товару (схема 4.1): группы «запрос клиента» по дате записи.
   * Пришёл комплект — ищем и ждущих его целиком, и ждущих его предметы.
   * Пришёл предмет комплекта, а клиент ждёт этот комплект целиком — группа с hint: в конце списка.
   */
  queue(pids) {
    const groups = new Map();
    const items = this.db.all('request_item').filter(ri => ri.status === 'waiting');
    const ok = ri => {
      const r = this.db.get('request', ri.request_id);
      if (!r || r.status !== 'active') return null;
      const c = this.db.get('client', r.client_id);
      if (!c || c.is_archived) return null;
      return { r, c };
    };
    const add = (key, pid, rc, ri, leaf, hint) => {
      const rem = this.remaining(ri);
      if (rem <= 0) return;
      if (!groups.has(key)) groups.set(key, { arrival: pid, request: rc.r, client: rc.c, bundle: rc.r.bundle_id ? this.product(rc.r.bundle_id) : null, items: [], since: ri.created_at, hint });
      const g = groups.get(key);
      if (g.items.some(x => x.ri.id === ri.id)) return;
      g.items.push({ ri, leaf, remaining: rem, bought: this.bought(ri.id), similar: !ri.product_id, whole: this.isWhole(ri) });
      if (ri.created_at < g.since) g.since = ri.created_at;
    };
    for (const pid of pids) {
      const self = this.product(pid);
      if (!self) continue;
      const leaves = this.leaves(pid);
      const cands = leaves.some(l => l.product.id === pid) ? leaves : [{ product: self, qty: 1 }, ...leaves];
      const leafIds = new Set(cands.map(l => l.product.id));
      for (const ri of items) {
        const leaf = cands.find(l => ri.product_id ? ri.product_id === l.product.id
          : l.product.kind_id && ri.kind_id === l.product.kind_id && ri.shape_id === l.product.shape_id && ri.pattern_id === l.product.pattern_id);
        if (leaf) { const rc = ok(ri); if (rc) add(`${pid}|${rc.r.id}`, pid, rc, ri, leaf, false); continue; }
        // подсказка «ждёт комплект целиком»
        if (ri.product_id && !leafIds.has(ri.product_id) && this.isWhole(ri)
          && this.bundleItems(ri.product_id).some(b => leafIds.has(b.product_id))) {
          const rc = ok(ri);
          if (rc) add(`${pid}|${rc.r.id}|hint`, pid, rc, ri, { product: this.product(ri.product_id), qty: 1 }, true);
        }
      }
    }
    const all = [...groups.values()];
    // если клиент уже есть в основном списке по этому же запросу, подсказку не дублируем
    const main = all.filter(g => !g.hint).sort((a, b) => a.since.localeCompare(b.since));
    const hints = all.filter(g => g.hint && !main.some(x => x.arrival === g.arrival && x.request.id === g.request.id)).sort((a, b) => a.since.localeCompare(b.since));
    return [...main, ...hints];
  }

  // ---------- действия (вызывающий делает db.commit) ----------
  createClient({ name, phone, note }) {
    return this.db.put('client', { name: name.trim(), phone: phone?.trim() || null, note: note?.trim() || null, is_archived: 0, created_at: nowISO() });
  }
  newItem(rid, product, qty, now) {
    return this.db.put('request_item', { request_id: rid, product_id: product.id, kind_id: null, shape_id: null, pattern_id: null, qty_needed: qty, price_kop: this.currentPrice(product.id), status: 'waiting', withdraw_reason: null, created_at: now, updated_at: null, closed_at: null, note: null });
  }
  /** Запрос на комплект. lines: [{ product_id, qty, full }] — qty 0 означает «уже есть» */
  createRequest(clientId, bundleId, lines, similar = [], note = null, { whole = 0 } = {}) {
    const now = nowISO();
    const r = this.db.put('request', { client_id: clientId, kind: 'bundle', bundle_id: bundleId, status: 'active', withdraw_reason: null, created_at: now, closed_at: null, note });
    if (whole > 0) { this.newItem(r.id, this.product(bundleId), whole, now); return r; }
    for (const l of lines) {
      const p = this.product(l.product_id);
      if (!p || p.is_packaging) continue;
      if (l.qty > 0) this.newItem(r.id, p, l.qty, now);
      else {
        const ri = this.newItem(r.id, p, Math.max(1, l.full || 1), now);
        this.db.put('request_item', { ...ri, status: 'withdrawn', withdraw_reason: 'уже есть', closed_at: now });
      }
    }
    for (const s of similar) this.addSimilar(r.id, s, now);
    this.closeIfDone(r.id);
    return r;
  }
  /** Активные запросы клиента на комплект, к которым подходит товар по форме и рисунку (ТЗ 4.3) */
  matchingRequests(cid, pid) {
    const p = this.product(pid);
    if (!p) return [];
    return this.clientRequests(cid).filter(r => {
      if (r.status !== 'active' || r.kind !== 'bundle') return false;
      const b = this.product(r.bundle_id);
      return b && p.shape_id && b.shape_id === p.shape_id && b.pattern_id === p.pattern_id;
    });
  }
  /**
   * «Записать клиента» на товар: в выбранный запрос, в «Отдельные товары» или, если товар — комплект и
   * newBundle = true, в новый запрос на этот комплект (в названии запроса — название комплекта).
   * Комплект «по частям» раскладывается на предметы, «целиком» — одна позиция.
   */
  addToList(cid, pid, qty, requestId = null, { whole = false, newBundle = false } = {}) {
    const now = nowISO();
    let r;
    if (newBundle && this.isBundle(pid)) r = this.db.put('request', { client_id: cid, kind: 'bundle', bundle_id: pid, status: 'active', withdraw_reason: null, created_at: now, closed_at: null, note: null });
    else r = requestId ? this.db.get('request', requestId) : this.looseRequest(cid);
    if (!r) r = this.db.put('request', { client_id: cid, kind: 'loose', bundle_id: null, status: 'active', withdraw_reason: null, created_at: now, closed_at: null, note: null });
    else if (r.status !== 'active') r = this.db.put('request', { ...r, status: 'active', closed_at: null, withdraw_reason: null });
    const added = [];
    if (whole && this.isBundle(pid)) added.push(this.newItem(r.id, this.product(pid), qty, now));
    else for (const l of this.leaves(pid)) if (!l.product.is_packaging) added.push(this.newItem(r.id, l.product, qty * l.qty, now));
    return { request: r, added };
  }
  addSimilar(rid, { kind_id, shape_id, pattern_id, qty, note }, now = nowISO()) {
    const r = this.db.get('request', rid);
    const ri = this.db.put('request_item', { request_id: rid, product_id: null, kind_id, shape_id, pattern_id, qty_needed: Math.max(1, qty), price_kop: null, status: 'waiting', withdraw_reason: null, created_at: now, updated_at: null, closed_at: null, note: note || null });
    if (r && r.status !== 'active') this.db.put('request', { ...r, status: 'active', closed_at: null, withdraw_reason: null });
    return ri;
  }
  /** «Купил»: запись покупки, остаток уменьшается; когда куплено всё — позиция закрыта */
  buy(riId, qty, note = null, date = todayISO()) {
    const ri = this.db.get('request_item', riId);
    if (!ri || qty <= 0) return;
    this.db.put('purchase', { request_item_id: riId, qty, purchased_at: date, note });
    if (ri.status === 'waiting' && this.bought(riId) >= ri.qty_needed) this.db.put('request_item', { ...ri, status: 'bought', closed_at: nowISO() });
    this.closeIfDone(ri.request_id);
  }
  /** «Изменить»: только нужное количество и заметка; не меньше купленного; дата записи и цена прежние */
  editItem(riId, qty, note) {
    const ri = this.db.get('request_item', riId);
    const bought = this.bought(riId);
    if (!ri) return;
    if (qty < Math.max(1, bought)) throw new Error('Нужно не может быть меньше уже купленного');
    const rec = { ...ri, qty_needed: qty, note: note?.trim() || null, updated_at: nowISO() };
    if (ri.status === 'waiting' && bought >= qty) Object.assign(rec, { status: 'bought', closed_at: nowISO() });
    if (ri.status === 'bought' && bought < qty) Object.assign(rec, { status: 'waiting', closed_at: null });
    this.db.put('request_item', rec);
    if (rec.status === 'waiting') this.activate(ri.request_id); else this.closeIfDone(ri.request_id);
  }
  /** Что получится при «Разбить на состав»: предметы × сколько комплектов ещё ждёт клиент */
  splitPreview(riId) {
    const ri = this.db.get('request_item', riId);
    const rem = this.remaining(ri);
    return this.bundleItems(ri.product_id).filter(b => !b.product.is_packaging)
      .map(b => ({ product: b.product, qty: b.quantity * rem, price: this.priceAt(b.product_id, ri.created_at) }));
  }
  /** «Разбить на состав» (схема 4.6). have — id товаров, которые у клиента уже есть */
  split(riId, have = []) {
    const ri = this.db.get('request_item', riId);
    if (!ri || ri.status !== 'waiting' || !this.isWhole(ri)) throw new Error('Разбить на состав можно только ждущий комплект целиком');
    const now = nowISO();
    for (const x of this.splitPreview(riId)) {
      if (x.qty <= 0) continue;
      const rec = { request_id: ri.request_id, product_id: x.product.id, kind_id: null, shape_id: null, pattern_id: null, qty_needed: x.qty, price_kop: x.price, status: 'waiting', withdraw_reason: null, split_from_id: ri.id, created_at: ri.created_at, updated_at: null, closed_at: null, note: null };
      if (have.includes(x.product.id)) Object.assign(rec, { status: 'withdrawn', withdraw_reason: 'уже есть', closed_at: now });
      this.db.put('request_item', rec);
    }
    this.db.put('request_item', { ...ri, status: 'split', closed_at: now });
    this.closeIfDone(ri.request_id);
  }
  /** «Снять с ожидания» с причиной */
  withdraw(riId, reason) {
    const ri = this.db.get('request_item', riId);
    if (!ri || ri.status !== 'waiting') return;
    this.db.put('request_item', { ...ri, status: 'withdrawn', withdraw_reason: reason || 'снято с ожидания', closed_at: nowISO(), with_request: 0 });
    this.closeIfDone(ri.request_id);
  }
  /** «Вернуть в ожидание»: прежние дата записи, цена и место в очереди */
  reopenItem(riId) {
    const ri = this.db.get('request_item', riId);
    if (!ri || ri.status === 'split') return;
    this.db.put('request_item', { ...ri, status: 'waiting', withdraw_reason: null, closed_at: null, with_request: 0 });
    this.activate(ri.request_id);
  }
  activate(rid) {
    const r = this.db.get('request', rid);
    if (r && r.status !== 'active') this.db.put('request', { ...r, status: 'active', closed_at: null, withdraw_reason: null });
  }
  /** Нет ждущих позиций: «закрыт», если что-то куплено, иначе «снят с ожидания» */
  closeIfDone(rid) {
    const r = this.db.get('request', rid);
    if (!r || r.status !== 'active') return;
    const items = this.requestItems(rid);
    if (items.some(i => i.status === 'waiting')) return;
    const anyBought = items.some(i => i.status === 'bought' || this.bought(i.id) > 0);
    this.db.put('request', { ...r, status: anyBought ? 'closed' : 'withdrawn', withdraw_reason: anyBought ? null : (items[0]?.withdraw_reason || 'снят с ожидания'), closed_at: nowISO() });
  }
  /** Снять весь запрос: ждущие позиции снимаются с одной причиной */
  withdrawRequest(rid, reason) {
    const now = nowISO();
    for (const ri of this.requestItems(rid)) if (ri.status === 'waiting') this.db.put('request_item', { ...ri, status: 'withdrawn', withdraw_reason: reason, closed_at: now, with_request: 1 });
    const r = this.db.get('request', rid);
    this.db.put('request', { ...r, status: 'withdrawn', withdraw_reason: reason, closed_at: now });
  }
  /** Вернуть запрос: возвращаются позиции, снятые вместе с ним */
  reopenRequest(rid) {
    const r = this.db.get('request', rid);
    const wd = this.requestItems(rid).filter(ri => ri.status === 'withdrawn');
    let back = wd.filter(ri => ri.with_request || ri.closed_at === r.closed_at);
    if (!back.length) back = wd;
    for (const ri of back) this.db.put('request_item', { ...ri, status: 'waiting', withdraw_reason: null, closed_at: null, with_request: 0 });
    this.db.put('request', { ...r, status: 'active', closed_at: null, withdraw_reason: null });
    this.closeIfDone(rid);
  }
  // ---------- удаление навсегда (только из архива) ----------
  deleteItem(riId) {
    const ri = this.db.get('request_item', riId);
    if (!ri) return;
    const r = this.db.get('request', ri.request_id);
    if (ri.status === 'waiting' && r?.status === 'active') throw new Error('Сначала снимите позицию с ожидания');
    for (const p of this.purchasesOf(riId)) this.db.del('purchase', p.id);
    for (const rem of this.db.all('reminder').filter(x => x.request_item_id === riId)) this.db.del('reminder', rem.id);
    for (const ch of this.db.all('request_item').filter(x => x.split_from_id === riId)) this.db.put('request_item', { ...ch, split_from_id: null });
    this.db.del('request_item', riId);
  }
  deleteRequest(rid) {
    const r = this.db.get('request', rid);
    if (!r) return;
    const c = this.db.get('client', r.client_id);
    if (r.status === 'active' && !c?.is_archived) throw new Error('Сначала снимите запрос с ожидания');
    for (const ri of this.requestItems(rid)) {
      for (const p of this.purchasesOf(ri.id)) this.db.del('purchase', p.id);
      this.db.del('request_item', ri.id);
    }
    for (const rem of this.db.all('reminder').filter(x => x.request_id === rid)) this.db.del('reminder', rem.id);
    this.db.del('request', rid);
  }
  /** Что исчезнет при удалении клиента (схема 4.5) */
  clientFootprint(cid) {
    const reqs = this.db.all('request').filter(r => r.client_id === cid);
    const items = this.db.all('request_item').filter(i => reqs.some(r => r.id === i.request_id));
    const purchases = this.db.all('purchase').filter(p => items.some(i => i.id === p.request_item_id));
    const reminders = this.db.all('reminder').filter(r => r.client_id === cid);
    return { reqs, items, purchases, reminders };
  }
  deleteClient(cid) {
    const c = this.db.get('client', cid);
    if (!c) return;
    if (!c.is_archived) throw new Error('Сначала перенесите клиента в архив');
    const f = this.clientFootprint(cid);
    for (const p of f.purchases) this.db.del('purchase', p.id);
    for (const i of f.items) this.db.del('request_item', i.id);
    for (const r of f.reqs) this.db.del('request', r.id);
    for (const r of f.reminders) this.db.del('reminder', r.id);
    this.db.del('client', cid);
  }
  appendNote(store, id, text) {
    if (!text?.trim()) return;
    const o = this.db.get(store, id);
    const line = `${todayISO().slice(8, 10)}.${todayISO().slice(5, 7)}: ${text.trim()}`;
    this.db.put(store, { ...o, note: o.note ? `${o.note}\n${line}` : line });
  }

  // ---------- напоминания ----------
  addReminder({ client_id, request_id = null, request_item_id = null, remind_at, note }) {
    return this.db.put('reminder', { client_id, request_id, request_item_id, remind_at, note: note?.trim() || null, status: 'waiting', done_at: null, created_at: nowISO() });
  }
  dueReminders() {
    const lim = todayISO() + ' 23:59';
    return this.db.all('reminder').filter(r => r.status === 'waiting' && r.remind_at <= lim && !this.db.get('client', r.client_id)?.is_archived).sort((a, b) => a.remind_at.localeCompare(b.remind_at));
  }
  upcomingReminders(days = 7) {
    const from = todayISO() + ' 23:59';
    const d = new Date(); d.setDate(d.getDate() + days);
    const to = todayISO(d) + ' 23:59';
    return this.db.all('reminder').filter(r => r.status === 'waiting' && r.remind_at > from && r.remind_at <= to).sort((a, b) => a.remind_at.localeCompare(b.remind_at));
  }
  clientReminders(cid) { return this.db.all('reminder').filter(r => r.client_id === cid).sort((a, b) => a.remind_at.localeCompare(b.remind_at)); }

  // ---------- товары вручную ----------
  saveProduct(p) {
    const old = p.id ? this.product(p.id) : null;
    const rec = { sold_separately: 1, is_packaging: 0, source: 'manual', is_archived: 0, created_at: todayISO(), ...p };
    if (old && old.kind_id !== rec.kind_id) rec.kind_locked = 1; // вид, исправленный вручную, загрузка из файла не перезапишет
    return this.db.put('product', rec);
  }
  addPrice(pid, kop, date = todayISO()) {
    const same = this.db.all('product_price').find(x => x.product_id === pid && x.valid_from === date);
    this.db.put('product_price', same ? { ...same, price_kop: kop } : { product_id: pid, price_kop: kop, valid_from: date });
  }
  dictAdd(store, name) {
    const n = name.trim();
    const ex = this.db.all(store).find(o => normKey(o.name) === normKey(n));
    if (ex) return ex;
    const o = { name: n };
    if (store === 'section') o.sort_order = this.db.count('section') + 1;
    return this.db.put(store, o);
  }
  dictUsage(store, id) {
    const field = { product_kind: 'kind_id', shape: 'shape_id', pattern: 'pattern_id', collection: 'collection_id' }[store];
    if (store === 'section') return this.db.all('product_section').filter(s => s.section_id === id).length;
    return this.db.all('product').filter(p => p[field] === id).length;
  }
}
