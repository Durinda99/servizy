// Общие помощники: нормализация названий, деньги, даты.

/** Ключ для склейки одинаковых значений, записанных по-разному */
export const normKey = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[\s\-–—«»"'.,()]+/g, '');

export const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};
export const toInt = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(String(v).replace(',', '.').replace(/\s/g, '')));
  return Number.isFinite(n) ? n : null;
};

export const rub = kop => kop == null ? '' : (Math.round(kop) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/ /g, ' ') + ' ₽';

const pad = n => String(n).padStart(2, '0');
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowISO = (d = new Date()) => `${todayISO(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
export const fmtShort = iso => { if (!iso) return ''; const [, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}`; };
export const parseISO = iso => { const [d, t = '00:00'] = iso.split(' '); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const longToday = (d = new Date()) => `${WDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const humanDT = iso => {
  if (!iso) return '';
  const d = parseISO(iso);
  const t = iso.length > 10 ? iso.slice(11, 16) : '';
  const today = todayISO();
  const day = iso.slice(0, 10);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  let ds;
  if (day === today) ds = 'Сегодня';
  else if (day === todayISO(y)) ds = 'Вчера';
  else if (day === todayISO(tm)) ds = 'Завтра';
  else ds = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return t ? `${ds} · ${t}` : ds;
};
export const daysAgo = iso => Math.floor((Date.now() - parseISO(iso).getTime()) / 86400000);

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const telHref = phone => 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
export const smsHref = phone => 'sms:' + String(phone || '').replace(/[^\d+]/g, '');
export const waHref = phone => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return 'https://wa.me/' + d;
};
