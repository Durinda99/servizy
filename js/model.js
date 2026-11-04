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
  bundleItems(bid) {
    return this.db.all('bundle_item').filter(b => b.bundle_id === bid)
      .map(b => ({ ...b, product: this.product(b.product_id) }))
      .filter(b => b.product)
      .sort((a, b) => (a.product.is_packaging - b.product.is_packaging) || a.product.name.localeCompare(b.product.name, 'ru'));
  }
  isBundle(pid) { return this.db.all('bundle_item').some(b => b.bundle_id === pid); }
  bundleIds() { return new Set(this.db.all('bundle_item').map(b => b.bundle_id)); }
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
    s = s.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
    return s.length >= 3 ? s : p.name;
  }
  shapePattern(p) { return [this.shapeName(p.shape_id), this.patternName(p.pattern_id)].filter(Boolean).join(' · '); }

  searchProducts(q, { limit = 60, bundlesOnly = false, includePackaging = false, includeArchived = false } = {}) {
    const raw = q.trim().toLowerCase().replace(/ё/g, 'е');
    const bundles = this.bundleIds();
    let list = this.db.all('product').filter(p => (includePackaging || !p.is_packaging) && (includeArchived || !p.is_archived) && (!bundlesOnly || bundles.has(p.id)));
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
  purchasesOf(riId) { return this.db.all('purchase').filter(p => p.request_item_id === riId); }
  bought(riId) { return this.purchasesOf(riId).reduce((s, p) => s + p.qty, 0); }
  remaining(ri) { return Math.max(0, ri.qty_needed - this.bought(ri.id)); }
  requestItems(rid) { return this.db.all('request_item').filter(i => i.request_id === rid).sort((a, b) => a.id - b.id); }
  itemLabel(ri) {
    if (ri.product_id) return this.short(this.product(ri.product_id));
    return `${this.kindName(ri.kind_id)} · ${this.shapeName(ri.shape_id)} · ${this.patternName(ri.pattern_id)}`;
  }
  requestProgress(rid) {
    let need = 0, got = 0, waiting = 0;
    for (const ri of this.requestItems(rid)) {
      if (ri.status === 'not_needed') { got += 0; continue; }
      const b = this.bought(ri.id);
      need += ri.qty_needed; got += Math.min(b, ri.qty_needed);
      if (ri.status === 'waiting') waiting += Math.max(0, ri.qty_needed - b);
    }
    return { need, got, waiting };
  }
  clientRequests(cid) { return this.db.all('request').filter(r => r.client_id === cid).sort((a, b) => b.created_at.localeCompare(a.created_at)); }

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

  /** Индекс ожидания для бейджей в поиске: id предмета → число ждущих позиций, критерий → число */
  waitingIndex() {
    const byProduct = new Map(), byCrit = new Map();
    const activeReq = new Set(this.db.all('request').filter(r => r.status === 'active' && !this.db.get('client', r.client_id)?.is_archived).map(r => r.id));
    for (const ri of this.db.all('request_item')) {
      if (ri.status !== 'waiting' || !activeReq.has(ri.request_id) || this.remaining(ri) <= 0) continue;
      if (ri.product_id) byProduct.set(ri.product_id, (byProduct.get(ri.product_id) || 0) + 1);
      else { const k = `${ri.kind_id}|${ri.shape_id}|${ri.pattern_id}`; byCrit.set(k, (byCrit.get(k) || 0) + 1); }
    }
    return {
      count: pid => {
        const clients = new Set();
        for (const l of this.leaves(pid)) {
          if (byProduct.has(l.product.id) || byCrit.has(`${l.product.kind_id}|${l.product.shape_id}|${l.product.pattern_id}`)) clients.add(1);
        }
        return clients.size ? this.queue([pid]).length : 0;
      },
      any: byProduct.size + byCrit.size > 0,
    };
  }

  /**
   * Очередь по поступившему товару (схема 4.1): группы «запрос клиента» по дате записи.
   */
  queue(pids) {
    const groups = new Map();
    for (const pid of pids) {
      const leaves = this.leaves(pid);
      for (const ri of this.db.all('request_item')) {
        if (ri.status !== 'waiting') continue;
        const leaf = leaves.find(l => ri.product_id ? ri.product_id === l.product.id
          : ri.kind_id === l.product.kind_id && ri.shape_id === l.product.shape_id && ri.pattern_id === l.product.pattern_id && l.product.kind_id);
        if (!leaf) continue;
        const r = this.db.get('request', ri.request_id);
        if (!r || r.status !== 'active') continue;
        const c = this.db.get('client', r.client_id);
        if (!c || c.is_archived) continue;
        const rem = this.remaining(ri);
        if (rem <= 0) continue;
        const key = `${pid}|${r.id}`;
        if (!groups.has(key)) groups.set(key, { arrival: pid, request: r, client: c, bundle: this.product(r.bundle_id), items: [], since: ri.created_at });
        const g = groups.get(key);
        g.items.push({ ri, leaf, remaining: rem, bought: this.bought(ri.id), similar: !ri.product_id });
        if (ri.created_at < g.since) g.since = ri.created_at;
      }
    }
    return [...groups.values()].sort((a, b) => a.since.localeCompare(b.since));
  }

  // ---------- действия (вызывающий делает db.commit) ----------
  createClient({ name, phone, note }) {
    return this.db.put('client', { name: name.trim(), phone: phone?.trim() || null, note: note?.trim() || null, is_archived: 0, created_at: nowISO() });
  }
  /** lines: [{ product_id, qty, full }] — qty 0 означает «уже есть»; similar: [{ kind_id, shape_id, pattern_id, qty }] */
  createRequest(clientId, bundleId, lines, similar = [], note = null) {
    const now = nowISO();
    const r = this.db.put('request', { client_id: clientId, bundle_id: bundleId, status: 'active', created_at: now, closed_at: null, note });
    for (const l of lines) {
      const p = this.product(l.product_id);
      if (!p || p.is_packaging) continue;
      const base = { request_id: r.id, product_id: p.id, kind_id: null, shape_id: null, pattern_id: null, price_kop: this.currentPrice(p.id), created_at: now, note: null };
      if (l.qty > 0) this.db.put('request_item', { ...base, qty_needed: l.qty, status: 'waiting', closed_at: null });
      else this.db.put('request_item', { ...base, qty_needed: Math.max(1, l.full || 1), status: 'not_needed', closed_at: now, note: 'есть у клиента' });
    }
    for (const s of similar) this.addSimilar(r.id, s, now);
    this.closeIfDone(r.id);
    return r;
  }
  addSimilar(rid, { kind_id, shape_id, pattern_id, qty, note }, now = nowISO()) {
    const r = this.db.get('request', rid);
    const ri = this.db.put('request_item', { request_id: rid, product_id: null, kind_id, shape_id, pattern_id, qty_needed: Math.max(1, qty), price_kop: null, status: 'waiting', created_at: now, closed_at: null, note: note || null });
    if (r && r.status === 'closed') this.db.put('request', { ...r, status: 'active', closed_at: null });
    return ri;
  }
  buy(riId, qty, note = null, date = todayISO()) {
    const ri = this.db.get('request_item', riId);
    if (!ri || qty <= 0) return;
    this.db.put('purchase', { request_item_id: riId, qty, purchased_at: date, note });
    if (this.bought(riId) >= ri.qty_needed) this.db.put('request_item', { ...ri, status: 'bought', closed_at: nowISO() });
    this.closeIfDone(ri.request_id);
  }
  notNeeded(riId, note = null) {
    const ri = this.db.get('request_item', riId);
    if (!ri) return;
    const bought = this.bought(riId);
    this.db.put('request_item', { ...ri, status: bought > 0 && bought >= ri.qty_needed ? 'bought' : 'not_needed', closed_at: nowISO(), note: note || ri.note });
    this.closeIfDone(ri.request_id);
  }
  reopenItem(riId) {
    const ri = this.db.get('request_item', riId);
    if (!ri) return;
    this.db.put('request_item', { ...ri, status: 'waiting', closed_at: null });
    const r = this.db.get('request', ri.request_id);
    if (r.status === 'closed') this.db.put('request', { ...r, status: 'active', closed_at: null });
  }
  closeIfDone(rid) {
    const r = this.db.get('request', rid);
    if (!r || r.status !== 'active') return;
    if (!this.requestItems(rid).some(i => i.status === 'waiting')) this.db.put('request', { ...r, status: 'closed', closed_at: nowISO() });
  }
  closeRequest(rid) {
    for (const ri of this.requestItems(rid)) if (ri.status === 'waiting') this.db.put('request_item', { ...ri, status: 'not_needed', closed_at: nowISO(), note: ri.note || 'запрос закрыт' });
    const r = this.db.get('request', rid);
    this.db.put('request', { ...r, status: 'closed', closed_at: nowISO() });
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
    const rec = { sold_separately: 1, is_packaging: 0, source: 'manual', is_archived: 0, created_at: todayISO(), ...p };
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
