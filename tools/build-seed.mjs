// Сборка встроенного каталога: файл с сайта + таблица соответствия видов → data/catalog.json, data/kindmap.json
// node tools/build-seed.mjs <каталог.xlsx> [Соответствие_видов.xlsx] [дата цен YYYY-MM-DD]
// Без файла соответствия берётся текущий data/kindmap.json, новым товарам вид подбирается по правилам.
import { readFile, writeFile } from 'node:fs/promises';
import { readXlsx } from '../js/xlsx.js';
import { MemDB } from '../js/db.js';
import { importCatalog, catalogToWorkbook } from '../js/importer.js';
import { normKey } from '../js/util.js';

const [catPath, kindsArg, dateArg] = process.argv.slice(2);
const kindsPath = kindsArg && kindsArg.endsWith('.xlsx') ? kindsArg : null;
const fileDate = (kindsPath ? dateArg : kindsArg) || new Date().toISOString().slice(0, 10);

// --- таблица соответствия видов ---
let kindmap = { byArticle: {}, byComp: {}, byName: {} };
if (!kindsPath) kindmap = JSON.parse(await readFile('data/kindmap.json', 'utf8'));
else {
const kw = await readXlsx(await readFile(kindsPath));
const LID_FIX = new Set(['80.04229.00.1', '80.97404.00.1', '80.56214.00.1']); // крышки чайников → «Крышка»
const votes = {};
const vote = (name, kind) => { const k = normKey(name); (votes[k] ??= {})[kind] = (votes[k][kind] || 0) + 1; };
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
// по названию — только если все строки с таким названием получили один и тот же вид
for (const [k, v] of Object.entries(votes)) if (Object.keys(v).length === 1) kindmap.byName[k] = Object.keys(v)[0];
await writeFile('data/kindmap.json', JSON.stringify(kindmap));
}

// --- каталог: строки двух листов без тяжёлых колонок ---
const wb = await readXlsx(await readFile(catPath));
const tov = wb.sheets['Товары'].map(r => r.map((v, i) => (i === 1 || i === 9 ? null : v === '' ? null : v)));
const comp = wb.sheets['Состав комплектов'].map(r => r.map(v => (v === '' ? null : v)));
const cat = { source: catPath.split('/').pop(), fileDate, tov, comp };
await writeFile('data/catalog.json', JSON.stringify(cat));

// --- пробная загрузка в пустую базу ---
const db = new MemDB();
for (const [i, n] of ['Столовые предметы', 'Чайно-кофейные предметы', 'Сервизы'].entries()) db.put('section', { name: n, sort_order: i + 1 });
const rep = importCatalog(db, catalogToWorkbook(cat), { fileDate, kindmap });
const { mismatches, missingBundles, ...short } = rep;
console.log(short, { mismatches: mismatches.map(m => m.article), missingBundles });
