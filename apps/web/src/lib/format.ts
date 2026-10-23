export function duration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '–';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function longDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${String(mins % 60).padStart(2, '0')} min`;
}

export function runTime(ms: number | null | undefined): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

export function clock(ts: number | null | undefined): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "21:00", "yesterday 21:00", "12 Oct 21:00". */
export function when(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  const now = new Date();
  const time = clock(ts);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `today ${time}`;
  if (diff === 1) return `yesterday ${time}`;
  if (diff === -1) return `tomorrow ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export function relative(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const fmt = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  let s: string;
  if (abs < 45_000) return diff > 0 ? 'any moment' : 'just now';
  else if (abs < 3_600_000) s = fmt(Math.round(abs / 60_000), 'min');
  else if (abs < 86_400_000) s = fmt(Math.round(abs / 3_600_000), 'hour');
  else s = fmt(Math.round(abs / 86_400_000), 'day');
  return diff > 0 ? `in ${s}` : `${s} ago`;
}

export function every(minutes: number): string {
  if (minutes < 60) return `every ${minutes} min`;
  if (minutes % 1440 === 0) return minutes === 1440 ? 'daily' : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'hourly' : `every ${minutes / 60} h`;
  return `every ${minutes} min`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function artists(list: string[]): string {
  return list.join(', ');
}
