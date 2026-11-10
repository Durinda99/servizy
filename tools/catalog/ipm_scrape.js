// ============================================================================
// Сбор каталога ipm.ru (Императорский фарфоровый завод) в JSON.
//
// КАК ЗАПУСТИТЬ (вручную, без Claude):
//   1. Откройте в Chrome https://www.ipm.ru/catalog/  (если сайт покажет капчу — пройдите её).
//   2. Нажмите F12 → вкладка «Console» (Консоль).
//   3. Вставьте весь этот файл и нажмите Enter. (Chrome может попросить сначала
//      набрать «allow pasting» — наберите и вставьте снова.)
//   4. Ждите. Прогресс пишется в консоль. ~2000 товаров ≈ 15–25 минут.
//      Вкладку не закрывайте; можно свернуть.
//   5. В конце браузер скачает файл ipm_all.json в папку «Загрузки».
//   6. Дальше: python3 ipm_build_xlsx.py ipm_all.json ipm_catalog.xlsx
//
// Через Claude: то же самое выполняется во встроенном браузере (javascript_tool),
// файл так же скачивается в «Загрузки», откуда Claude его забирает.
//
// Что собирается по каждому товару:
//   name, sku, price, avail, url, image   — из JSON-LD на страницах списка
//   cats  — раздел(ы) верхнего уровня (товар из нескольких разделов — один раз)
//   ch    — таблица «Характеристики» с карточки (Материал, Вид изделия, Коллекция, Вес, Год…)
//   set   — таблица «Состав комплекта» [артикул, название, шт, высота, длина, ширина, объём, вес]
//   bc    — хлебные крошки (раздел/подраздел)
//   photos— сколько фото в галерее
//   img   — ссылка на главное фото в JPG/PNG (оригинал)
//   th    — превью главного фото 240px, JPEG в base64 (для вставки в Excel)
// ============================================================================
(async () => {
  // Разделы: [адрес, как называть в колонке «Раздел»].
  // ВАЖНО: «Фарфоровые чашки» — отдельный раздел сайта, хотя в меню он показан
  // внутри «Чайно-кофейных предметов». Его товары НЕ выводятся на страницах
  // /catalog/chayno-kofeynye_predmety/, поэтому он перечислен отдельно.
  // Чтобы собрать другие разделы — добавьте строки (адреса видны в меню сайта).
  const SECTIONS = [
    ['/catalog/stolovye-predmety/', 'Столовые предметы'],
    ['/catalog/chayno-kofeynye_predmety/', 'Чайно-кофейные предметы'],
    ['/catalog/chashki_s_blyudtsami/', 'Чайно-кофейные предметы'],
    ['/catalog/servizy/', 'Сервизы'],
  ];
  const THREADS = 3;        // одновременных запросов; больше — выше риск капчи
  const PAUSE_MS = 150;     // пауза между товарами в одном потоке
  const THUMB = 240;        // размер превью, px по большей стороне

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const J = window._ipmJob = { stage: 'list', done: 0, total: 0, err: [], captcha: false };
  const log = (...a) => console.log('[ipm]', ...a);

  async function getText(u, tries = 3) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(u);
        if (r.status === 404) throw new Error('404');
        if (r.ok) {
          const t = await r.text();
          if (/Проверка CAPTCHA/i.test(t.slice(0, 3000))) { J.captcha = true; throw new Error('captcha'); }
          return t;
        }
      } catch (e) { if (e.message === '404' || J.captcha) throw e; }
      await sleep(1500 * (i + 1));
    }
    throw new Error('fetch failed ' + u);
  }
  const parse = h => new DOMParser().parseFromString(h, 'text/html');

  // ---------- 1. Списки товаров (JSON-LD ItemList на каждой странице ?PAGEN_1=N) ----------
  const P = new Map();
  for (const [path, secName] of SECTIONS) {
    for (let p = 1; p <= 200; p++) {
      let html;
      try { html = await getText(path + (p > 1 ? `?PAGEN_1=${p}` : '')); }
      catch (e) { J.err.push(`list ${path} p${p}: ${e.message}`); if (J.captcha) break; continue; }
      const d = parse(html);
      let n = 0;
      for (const s of d.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          for (const x of j?.mainEntity?.itemListElement || []) {
            const it = x.item; n++;
            if (P.has(it.url)) { const o = P.get(it.url); if (!o.cats.includes(secName)) o.cats.push(secName); }
            else P.set(it.url, { name: it.name, sku: it.sku, price: it.offers?.price, avail: (it.offers?.availability || '').split('/').pop(), url: it.url, image: it.image, cats: [secName] });
          }
        } catch (e) {}
      }
      const hasNext = new RegExp(`PAGEN_1=${p + 1}\\b`).test(html);
      log(path, 'стр.', p, 'товаров на странице', n, 'всего', P.size);
      if (!hasNext) break;
      await sleep(300);
    }
    if (J.captcha) break;
  }
  if (J.captcha) { log('САЙТ ПОКАЗАЛ КАПЧУ. Обновите страницу, пройдите капчу и запустите снова.'); return; }

  // ---------- 2. Карточки товаров ----------
  const items = [...P.values()];
  J.stage = 'details'; J.total = items.length;
  log('Карточек к обработке:', items.length);

  async function thumb(url) {
    const b = await fetch(url).then(r => { if (!r.ok) throw new Error('img ' + r.status); return r.blob(); });
    const bmp = await createImageBitmap(b);
    const k = Math.min(THUMB / bmp.width, THUMB / bmp.height, 1);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
  }
  // Сайт отдаёт фото в AVIF (Excel его не показывает). Оригинал JPG/PNG лежит по тому же
  // пути без «/resize_cache/avif»: .../upload/resize_cache/avif/upload/iblock/17b/x.avif → .../upload/iblock/17b/x.jpg
  async function originalPhoto(src) {
    let path; try { path = new URL(src, location.href).pathname; } catch (e) { return null; }
    const base = 'https://cdn.ipm.ru' + path.replace('/upload/resize_cache/avif/upload/', '/upload/').replace(/\.\w+$/, '');
    for (const ext of ['.jpg', '.png', '.jpeg', '.webp']) {
      try { const r = await fetch(base + ext, { method: 'HEAD' }); if (r.ok && /image/.test(r.headers.get('content-type'))) return base + ext; } catch (e) {}
    }
    return null;
  }

  async function one(it) {
    try {
      const d = parse(await getText(it.url));
      const ch = {};
      d.querySelectorAll('.char_block tr').forEach(tr => {
        const k = tr.querySelector('.char_name')?.textContent.trim();
        const v = tr.querySelector('.char_value')?.textContent.replace(/\s+/g, ' ').trim();
        if (k) ch[k] = v;
      });
      it.ch = ch;
      it.set = [...d.querySelectorAll('.complectTable tr')]
        .map(tr => [...tr.querySelectorAll('td')].map(c => c.textContent.replace(/\s+/g, ' ').trim()))
        .filter(r => r.length >= 3);
      it.bc = [...d.querySelectorAll('.breadcrumbs [itemprop="name"]')].map(e => e.textContent.trim()).slice(2, -1);
      const gal = [...new Set([...d.querySelectorAll('.item_slider .slides a.popup_link')].map(a => a.getAttribute('href')).filter(Boolean))];
      it.photos = gal.length;
      it.img = await originalPhoto(gal[0] || it.image);
      try { it.th = await thumb(it.img || it.image); } catch (e) { J.err.push('thumb ' + it.sku); }
    } catch (e) { J.err.push(`page ${e.message} ${it.url}`); }
    J.done++;
    if (J.done % 50 === 0) log(`готово ${J.done} из ${J.total}, ошибок ${J.err.length}`);
  }

  let i = 0;
  await Promise.all(Array.from({ length: THREADS }, async () => {
    while (i < items.length && !J.captcha) { const it = items[i++]; await one(it); await sleep(PAUSE_MS); }
  }));
  if (J.captcha) log('ВНИМАНИЕ: во время сбора появилась капча — часть карточек не собрана. Файл всё равно сохранится.');

  // ---------- 3. Сохранение ----------
  window._ipmAll = items;
  const blob = new Blob([JSON.stringify(items)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'ipm_all.json';
  document.body.appendChild(a); a.click();
  J.stage = 'done';
  log(`ГОТОВО: ${items.length} товаров, ${Math.round(blob.size / 1048576)} МБ, ошибок ${J.err.length}. Файл ipm_all.json скачан.`);
  if (J.err.length) console.table(J.err);
})();
