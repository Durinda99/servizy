// База данных: таблицы из схемы v2. Всё держится в памяти (данных немного),
// каждое изменение пачкой пишется в IndexedDB одной транзакцией.

export const SCHEMA_VERSION = 2;

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
  nextId(store) {
    if (this.maxId[store] === undefined) {
      let m = 0;
      for (const o of this.t[store].values()) if (o.id > m) m = o.id;
      this.maxId[store] = m;
    }
    return ++this.maxId[store];
  }
  put(store, obj) {
    if (STORES[store] === 'id' && obj.id == null) obj.id = this.nextId(store);
    else if (STORES[store] === 'id' && (this.maxId[store] ?? 0) < obj.id) this.maxId[store] = obj.id;
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
    this.pending = [];
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
