// Сборка стартовых данных: таблица соответствия видов + каталог → app/data/*.json
import { readFile, writeFile } from 'node:fs/promises';
import { readXlsx } from '../js/xlsx.js';
import { MemDB, SCHEMA_VERSION } from '../js/db.js';
import { importCatalog } from '../js/importer.js';
import { normKey } from '../js/util.js';

// node tools/build-seed.mjs <каталог.xlsx> [Соответствие_видов.xlsx] [дата цен YYYY-MM-DD]
// Без файла соответствия берётся текущий data/kindmap.json, новые товары получают вид по правилам guessKind.
const [catPath, kindsArg, dateArg] = process.argv.slice(2);
const kindsPath = kindsArg && kindsArg.endsWith('.xlsx') ? kindsArg : null;
const fileDate = (kindsPath ? dateArg : kindsArg) || new Date().toISOString().slice(0, 10);
const LID_FIX = new Set(['80.04229.00.1', '80.97404.00.1', '80.56214.00.1']);
let kindmap = { byArticle: {}, byComp: {}, byName: {} };
if (!kindsPath) kindmap = JSON.parse(await readFile('data/kindmap.json', 'utf8'));
else {
const kw = await readXlsx(await readFile(kindsPath));
const nameVotes = {};
const vote = (name, kind) => { const k = normKey(name); (nameVotes[k] ??= {})[kind] = (nameVotes[k][kind] || 0) + 1; };
for (const r of kw.sheets['Товары каталога'].slice(1)) {
  const art = r[0] && String(r[0]).trim(); if (!art || !r[3]) continue;
  const kind = LID_FIX.has(art) ? 'Крышка' : String(r[3]).trim();
  kindmap.byArticle[art] = kind; vote(r[1], kind);
}
for (const r of kw.sheets['Предметы состава'].slice(1)) {
  if (!r[0] || !r[3] || !r[5]) continue;
  const kind = String(r[5]).trim();
  kindmap.byComp[`${String(r[0]).trim()}|${r[2] ? String(r[2]).trim() : ''}|${normKey(r[3])}`] = kind;
  vote(r[3], kind);
}
for (const [k, v] of Object.entries(nameVotes)) kindmap.byName[k] = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0];
await writeFile('data/kindmap.json', JSON.stringify(kindmap));
}

const db = new MemDB();
for (const [i, n] of ['Столовые предметы', 'Чайно-кофейные предметы', 'Сервизы'].entries()) db.put('section', { name: n, sort_order: i + 1 });
db.setSetting('schema_version', String(SCHEMA_VERSION));
const wb = await readXlsx(await readFile(catPath));
const rep = importCatalog(db, wb, { fileDate, kindmap });
const { mismatches, ...short } = rep;
console.log(short, mismatches);
const kinds = new Set(db.all('product').filter(p => !p.is_packaging).map(p => p.kind_id));
console.log('kinds used (no packaging):', kinds.size, 'total kinds:', db.count('product_kind'));
const d = db.dump(); d.seed = true;
const bundlesN = new Set(db.all('bundle_item').map(b => b.bundle_id)).size;
console.log('seed:', fileDate, 'products sold separately:', db.all('product').filter(p => p.sold_separately).length, 'bundles:', bundlesN);
await writeFile('data/seed.json', JSON.stringify(d));
