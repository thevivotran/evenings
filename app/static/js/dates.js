// Times are local wall-clock strings: "YYYY-MM-DDTHH:MM".
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => new Date(s);
export const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const nowStr = () => { const n = new Date(); return `${ymd(n)}T${hhmm(n)}`; };

export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const longDay = (d) => `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;

// "Today", "Tomorrow", "Yesterday", else "Wed 11 Nov".
export function relDay(d) {
  const a = new Date(d); a.setHours(0, 0, 0, 0);
  const b = new Date(); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return longDay(d);
}
