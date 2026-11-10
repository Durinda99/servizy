// База данных: таблицы из схемы v2. Всё держится в памяти (данных немного),
// каждое изменение пачкой пишется в IndexedDB одной транзакцией.

export const SCHEMA_VERSION = 4;

const REASON_FROM_NOTE = { 'есть у клиента': 'уже есть', 'запрос закрыт': 'снят с ожидания', 'не нужно': 'не нужно' };

/**
 * Перевод данных схемы v2 → v3 (ТЗ 1.6): статус «не нужно» → «снято с ожидания» с причиной,
 * у запроса появляется вид (комплект / отдельные товары). Возвращает true, если что-то изменилось.
 */
export function migrate(db) {
  let changed = false;
  const items = db.t.request_item;
  for (const [k, ri] of items) {
    if (ri.status === 'not_needed') {
      items.set(k, { ...ri, status: 'withdrawn', withdraw_reason: REASON_FROM_NOTE[ri.note] || ri.note || 'не нужно', note: REASON_FROM_NOTE[ri.note] ? null : ri.note });
      changed = true;
    }
  }
  for (const [k, r] of db.t.request) {
    let n = r;
    if (!r.kind) n = { ...n, kind: r.bundle_id ? 'bundle' : 'loose' };
    if (n.status === 'closed') {
      const its = [...items.values()].filter(i => i.request_id === r.id);
      const anyBought = its.some(i => i.status === 'bought') || [...db.t.purchase.values()].some(p => its.some(i => i.id === p.request_item_id));
      if (!anyBought) n = { ...n, status: 'withdrawn', withdraw_reason: n.withdraw_reason || 'снят с ожидания' };
    }
    if (n !== r) { db.t.request.set(k, n); changed = true; }
  }
  const sv = db.t.settings.get('schema_version');
  if (sv?.value !== String(SCHEMA_VERSION)) { db.t.settings.set('schema_version', { key: 'schema_version', value: String(SCHEMA_VERSION) }); changed = true; }
  return changed;
}

export const STORES = {
  section: 'id',
  product_section: ['product_id', 'section_id'],
  product_kind: 'id',
  shape: 'id',
  pattern: 'id',
  collection: 'id',
  product: 'id',
  product_price: 'id',
  bundle_item: ['bundle_id', 'product_id'],
  client: 'id',
  request: 'id',
  request_item: 'id',
  purchase: 'id',
  reminder: 'id',
  settings: 'key',
};

const keyStr = k => (Array.isArray(k) ? k.join('|') : String(k));

export class MemDB {
  constructor() {
    this.t = {};
    for (const s of Object.keys(STORES)) this.t[s] = new Map();
    this.maxId = {};
    this.pending = [];
  }
  keyOf(store, obj) {
    const kp = STORES[store];
    return Array.isArray(kp) ? kp.map(k => obj[k]) : obj[kp];
  }
  get(store, key) { return this.t[store].get(keyStr(key)); }
  all(store) { return [...this.t[store].values()]; }
  count(store) { return this.t[store].size; }
  ensureMax(store) {
    if (this.maxId[store] === undefined) {
      let m = 0;
      for (const o of this.t[store].values()) if (o.id > m) m = o.id;
      this.maxId[store] = m;
    }
    return this.maxId[store];
  }
  nextId(store) { this.ensureMax(store); return ++this.maxId[store]; }
  put(store, obj) {
    if (STORES[store] === 'id' && obj.id == null) obj.id = this.nextId(store);
    else if (STORES[store] === 'id' && this.ensureMax(store) < obj.id) this.maxId[store] = obj.id;
    this.t[store].set(keyStr(this.keyOf(store, obj)), obj);
    this.pending.push({ op: 'put', store, obj });
    this.onChange?.(store);
    return obj;
  }
  del(store, key) {
    this.t[store].delete(keyStr(key));
    this.pending.push({ op: 'del', store, key });
    this.onChange?.(store);
  }
  setting(key, def = null) { return this.get('settings', key)?.value ?? def; }
  setSetting(key, value) { this.put('settings', { key, value }); }
  dump() {
    const stores = {};
    for (const s of Object.keys(STORES)) stores[s] = this.all(s);
    return { app: 'servizy', schema_version: SCHEMA_VERSION, exported_at: new Date().toISOString(), stores };
  }
  loadDump(d, { track = true } = {}) {
    if (!d || d.app !== 'servizy' || !d.stores) throw new Error('Это не резервная копия приложения «Сервизы»');
    for (const s of Object.keys(STORES)) {
      this.t[s].clear();
      this.maxId[s] = undefined;
      for (const o of d.stores[s] || []) this.t[s].set(keyStr(this.keyOf(s, o)), o);
    }
    migrate(this);
    this.pending = track ? [{ op: 'replaceAll' }] : [];
  }
  async commit() { this.pending = []; }
}

export class IdbDB extends MemDB {
  async open(name = 'servizy') {
    this.idb = await new Promise((res, rej) => {
      const r = indexedDB.open(name, SCHEMA_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const [s, kp] of Object.entries(STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: kp });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = this.idb.transaction(Object.keys(STORES), 'readonly');
    await Promise.all(Object.keys(STORES).map(s => new Promise((res, rej) => {
      const q = tx.objectStore(s).getAll();
      q.onsuccess = () => { for (const o of q.result) this.t[s].set(keyStr(this.keyOf(s, o)), o); res(); };
      q.onerror = () => rej(q.error);
    })));
    this.pending = migrate(this) ? [{ op: 'replaceAll' }] : [];
    if (this.pending.length) await this.commit();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    return this;
  }
  async commit() {
    const ops = this.pending;
    this.pending = [];
    if (!ops.length) return;
    const replace = ops.some(o => o.op === 'replaceAll');
    await new Promise((res, rej) => {
      const tx = this.idb.transaction(Object.keys(STORES), 'readwrite');
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Запись прервана'));
      if (replace) {
        for (const s of Object.keys(STORES)) {
          const os = tx.objectStore(s);
          os.clear();
          for (const o of this.t[s].values()) os.put(o);
        }
        return;
      }
      for (const o of ops) {
        const os = tx.objectStore(o.store);
        if (o.op === 'put') os.put(o.obj);
        else os.delete(o.key);
      }
    });
  }
}
