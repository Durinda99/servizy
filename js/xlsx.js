// Минимальное чтение и запись .xlsx без сторонних библиотек.
// Чтение: zip (deflate через DecompressionStream) + разбор XML листов.
// Запись: zip без сжатия, листы с inline-строками.

const td = new TextDecoder('utf-8');
const te = new TextEncoder();

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Это не файл Excel (.xlsx)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: Object.keys(files),
    async text(name) {
      const f = files[name];
      if (!f) return null;
      const lnl = dv.getUint16(f.off + 26, true);
      const lxl = dv.getUint16(f.off + 28, true);
      const start = f.off + 30 + lnl + lxl;
      const data = u8.subarray(start, start + f.csize);
      const out = f.method === 0 ? data : await inflateRaw(data);
      return td.decode(out);
    },
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unesc(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
function textOf(xml) {
  let s = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g;
  let m;
  while ((m = re.exec(xml))) s += m[1] ? unesc(m[1]) : '';
  return s;
}
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Читает книгу: { sheetNames: [...], sheets: { name: rows[][] } } */
export async function readXlsx(buf) {
  const z = await unzip(buf);
  const wb = await z.text('xl/workbook.xml');
  if (!wb) throw new Error('В файле нет книги Excel');
  const rels = (await z.text('xl/_rels/workbook.xml.rels')) || '';
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) relMap[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sst = [];
  const ss = await z.text('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) sst.push(textOf(m[1]));
  const sheetNames = [];
  const sheets = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(/\bname="([^"]*)"/.exec(m[0])[1]);
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    sheetNames.push(name);
    const path = 'xl/' + (relMap[rid] || '');
    const xml = await z.text(path);
    sheets[name] = xml ? parseSheet(xml, sst) : [];
  }
  return { sheetNames, sheets };
}

function parseSheet(xml, sst) {
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  let rm;
  let auto = 0;
  while ((rm = rowRe.exec(xml))) {
    const attrs = rm[1] || rm[3] || '';
    const rnum = /\br="(\d+)"/.exec(attrs);
    const ri = rnum ? parseInt(rnum[1], 10) - 1 : auto;
    auto = ri + 1;
    const row = [];
    const body = rm[2] || '';
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let ci = 0;
    while ((cm = cRe.exec(body))) {
      const a = cm[1];
      const ref = /\br="([A-Z]+)\d+"/.exec(a);
      if (ref) ci = colIndex(ref[1]);
      const t = /\bt="([^"]+)"/.exec(a)?.[1];
      const inner = cm[2] || '';
      let v = null;
      if (t === 'inlineStr') v = textOf(inner);
      else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vm) {
          const raw = unesc(vm[1]);
          if (t === 's') v = sst[parseInt(raw, 10)] ?? '';
          else if (t === 'str' || t === 'e') v = raw;
          else if (t === 'b') v = raw === '1';
          else { const num = Number(raw); v = Number.isFinite(num) ? num : raw; }
        }
      }
      row[ci] = v;
      ci++;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[ri] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

// ---------- запись ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nb = te.encode(name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const csize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
function colName(i) {
  let s = '';
  i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/** sheets: [{ name, rows: [[...]] }] → Blob .xlsx; первая строка каждого листа — заголовок */
export function writeXlsx(sheets) {
  const enc = s => te.encode(s);
  const files = [];
  const sheetXml = rows => {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>';
    rows.forEach((r, ri) => {
      x += `<row r="${ri + 1}">`;
      r.forEach((v, ci) => {
        if (v === null || v === undefined || v === '') return;
        const ref = colName(ci) + (ri + 1);
        const st = ri === 0 ? ' s="1"' : '';
        if (typeof v === 'number' && Number.isFinite(v)) x += `<c r="${ref}"${st}><v>${v}</v></c>`;
        else x += `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      });
      x += '</row>';
    });
    return x + '</sheetData></worksheet>';
  };
  files.push({ name: '[Content_Types].xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>') });
  files.push({ name: '_rels/.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
  files.push({ name: 'xl/workbook.xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>') });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) });
  files.push({ name: 'xl/styles.xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>') });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s.rows)) }));
  return zipStore(files);
}
