# Сборка Excel из ipm_all.json (результат ipm_scrape.js).
# Запуск:  python3 ipm_build_xlsx.py ipm_all.json ipm_catalog.xlsx
# Нужно:   pip install openpyxl pillow
# Результат: лист «Товары» (с превью фото внутри файла) и лист «Состав комплектов».
# Формат листов совпадает с тем, что ждёт приложение «Сервизы» (js/importer.js) и tools/build-seed.mjs.
import json, re, sys, base64, os, tempfile, datetime
from PIL import Image as PI
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.drawing.image import Image as XI
from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.utils.units import pixels_to_EMU

src, out = sys.argv[1], sys.argv[2]
items = json.load(open(src, encoding='utf-8'))
TMP = tempfile.mkdtemp(prefix='ipm_thumbs_')
TODAY = datetime.date.today().strftime('%d.%m.%Y')

# Форма и рисунок берутся из названия: «… форма Весенняя 2 рисунок Сад мечты, 6 персон …».
# Если в названии нет — из характеристик карточки («Форма», «Вид рисунка»).
STOP = r'(?=,|\s+\d+\s+персон|\s+на\s+\d|\s+в\s+упаковке|\s+арт\b|\s+[Рр]исун|$)'
def parse_fr(n):
    n = re.sub(r'\s+', ' ', n)
    f = re.search(r'форм[аы]\s+(.+?)' + STOP, n)
    r = re.search(r'[Рр]исун(?:ок|ка)\s+(.+?)' + STOP, n)
    return (f.group(1).strip(' ,') if f else ''), (r.group(1).strip(' ,') if r else '')
def toint(v):
    if v is None: return None
    m = re.search(r'\d+', str(v).replace(' ', ''))
    return int(m.group()) if m else None
def num(v):
    v = (v or '').strip().replace(',', '.')
    if v in ('', '-'): return None
    try:
        f = float(v); return int(f) if f.is_integer() else f
    except ValueError:
        return v
AV = {'InStock': 'В наличии', 'OutOfStock': 'Нет в наличии', 'PreOrder': 'Под заказ', 'LimitedAvailability': 'Количество ограничено'}

wb = Workbook(); ws = wb.active; ws.title = 'Товары'
hdr = ['№', 'Фото', 'Название', 'Раздел', 'Подраздел', 'Форма', 'Рисунок', 'Персон', 'Предметов', 'Состав комплекта',
       'Материал', 'Вид изделия', 'Коллекция', 'Вес, г', 'Год начала выпуска', 'Артикул', 'Цена, руб.', 'Наличие',
       'Фото в галерее, шт.', 'Ссылка на товар', 'Ссылка на фото']
ws.append(hdr)
HF = Font(name='Arial', size=10, bold=True, color='FFFFFF'); FILL = PatternFill('solid', fgColor='1F3864')
for c in ws[1]:
    c.font = HF; c.fill = FILL; c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
F = Font(name='Arial', size=10); FS = Font(name='Arial', size=9)
LINK = Font(name='Arial', size=10, color='0563C1', underline='single')

s2 = wb.create_sheet('Состав комплектов')
s2.append(['Артикул комплекта', 'Название комплекта', 'Артикул предмета', 'Предмет', 'Шт. в комплекте',
           'Высота, мм', 'Длина, мм', 'Ширина, мм', 'Объём, мл', 'Вес, г'])
for c in s2[1]:
    c.font = HF; c.fill = FILL; c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

BOX = 120
for i, it in enumerate(items, 1):
    r = i + 1
    ch = it.get('ch') or {}
    name = it['name']
    f, p = parse_fr(name)
    f = f or ch.get('Форма', ''); p = p or ch.get('Вид рисунка', '')
    pers = re.search(r'(\d+)\s+персон', name); pcs = re.search(r'(\d+)\s+предмет', name)
    pers = int(pers.group(1)) if pers else toint(ch.get('Количество персон'))
    pcs = int(pcs.group(1)) if pcs else toint(ch.get('Количество предметов'))
    sets = it.get('set') or []
    lines = []
    for row in sets:
        row = (row + [''] * 8)[:8]
        art, nm, q = row[0], row[1], row[2]
        lines.append(f'{art} — {nm} — {q} шт.' if art else f'{nm} — {q} шт.')
        s2.append([it['sku'], name, art or None, nm] + [num(v) for v in row[2:8]])
    year = re.search(r'\d{4}', ch.get('Год начала выпуска', '') or '')
    bc = it.get('bc') or []
    sub = bc[1] if len(bc) > 1 else (bc[0] if bc and bc[0] not in ('Столовые предметы','Чайно-кофейные предметы','Сервизы') else '')
    price = float(it['price']) if it.get('price') else None
    ws.append([i, None, name, ', '.join(it.get('cats', [])), sub, f, p, pers, pcs, '\n'.join(lines),
               ch.get('Материал', ''), ch.get('Вид изделия', ''), ch.get('Коллекция', ''), toint(ch.get('Вес, г')),
               int(year.group()) if year else None, it['sku'], price, AV.get(it.get('avail'), it.get('avail')),
               it.get('photos'), it['url'], it.get('img') or it.get('image')])
    ws.row_dimensions[r].height = max(95, 12 * len(lines) + 8)
    for c in ws[r]:
        c.font = F; c.alignment = Alignment(vertical='center', wrap_text=True)
    ws[f'J{r}'].font = FS
    for col in 'HINOS': ws[f'{col}{r}'].alignment = Alignment(horizontal='center', vertical='center')
    ws[f'Q{r}'].number_format = '#,##0'; ws[f'N{r}'].number_format = '#,##0'
    for col in 'TU':
        if ws[f'{col}{r}'].value:
            ws[f'{col}{r}'].hyperlink = ws[f'{col}{r}'].value; ws[f'{col}{r}'].font = LINK
    if it.get('th'):
        pth = os.path.join(TMP, f"{i}.jpg")
        open(pth, 'wb').write(base64.b64decode(it['th']))
        w, h = PI.open(pth).size; k = BOX / max(w, h); dw, dh = round(w * k), round(h * k)
        img = XI(pth); img.width, img.height = dw, dh
        rowpx = ws.row_dimensions[r].height * 96 / 72
        img.anchor = OneCellAnchor(_from=AnchorMarker(col=1, colOff=pixels_to_EMU((131 - dw) // 2), row=r - 1,
                                                      rowOff=pixels_to_EMU(max(2, int((rowpx - dh) // 2)))),
                                   ext=XDRPositiveSize2D(pixels_to_EMU(dw), pixels_to_EMU(dh)))
        ws.add_image(img)

n = len(items)
widths = [6, 18, 45, 18, 20, 16, 22, 8, 10, 55, 16, 18, 18, 9, 10, 15, 12, 13, 10, 40, 40]
for idx, w in enumerate(widths):
    ws.column_dimensions[chr(65 + idx)].width = w
ws.freeze_panes = 'D2'; ws.auto_filter.ref = f'A1:U{n + 1}'
ws.cell(n + 3, 1, 'Источник: ipm.ru, разделы «Столовые предметы», «Чайно-кофейные предметы» (включая «Фарфоровые чашки» — на сайте это отдельный раздел, показанный в меню внутри чайно-кофейных), «Сервизы»; данные на ' + TODAY + '. '
        'Фото в колонке B — уменьшенные превью главного фото, оригинал по ссылке в колонке U. Форма, рисунок, персоны и предметы '
        'выделены из названия (при отсутствии — из характеристик). Материал, вид изделия, коллекция, вес, год и состав — '
        'из карточки товара; пустая ячейка = на сайте не указано. Товар, входящий в несколько разделов, указан один раз.').font = Font(name='Arial', size=9, italic=True)
for row in s2.iter_rows(min_row=2):
    for c in row:
        c.font = F; c.alignment = Alignment(vertical='center', wrap_text=c.column in (2, 4))
for k, w in zip('ABCDEFGHIJ', [15, 50, 15, 38, 10, 10, 10, 10, 10, 10]):
    s2.column_dimensions[k].width = w
s2.freeze_panes = 'A2'; s2.auto_filter.ref = f'A1:J{s2.max_row}'
wb.save(out)
print(n, 'items;', s2.max_row - 1, 'set rows;', sum(1 for x in items if x.get('th')), 'thumbs;', os.path.getsize(out) // 1024, 'KB')
