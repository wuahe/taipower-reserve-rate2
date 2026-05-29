const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiDateKey(date = new Date()): string {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function taipeiDayRange(date = new Date()): { start: Date; end: Date; key: string } {
  const key = taipeiDateKey(date);
  const [year, month, day] = key.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day) - TAIPEI_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key };
}

export function floorToTenMinutes(date = new Date()): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);
  next.setMinutes(Math.floor(next.getMinutes() / 10) * 10);
  return next;
}

export function formatTaipeiTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

export function parseTaipeiDateTime(value: string, fallback = new Date()): Date | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  const full = normalized.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\s*(?:T|\s)?(\d{1,2}):(\d{2})/);
  if (full) {
    const [, y, m, d, hh, mm] = full;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)) - TAIPEI_OFFSET_MS);
  }

  const roc = normalized.match(/(\d{2,3})[./-](\d{1,2})[./-](\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})/);
  if (roc) {
    const [, y, m, d, hh, mm] = roc;
    return new Date(Date.UTC(Number(y) + 1911, Number(m) - 1, Number(d), Number(hh), Number(mm)) - TAIPEI_OFFSET_MS);
  }

  const timeOnly = normalized.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?:[^\d]|$)/);
  if (timeOnly) {
    const key = taipeiDateKey(fallback);
    const [year, month, day] = key.split("-").map(Number);
    const [, hh, mm] = timeOnly;
    return new Date(Date.UTC(year, month - 1, day, Number(hh), Number(mm)) - TAIPEI_OFFSET_MS);
  }

  return null;
}
