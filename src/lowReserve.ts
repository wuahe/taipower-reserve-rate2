import { taipeiDateKey } from "./time.js";
import type { LowReserveEpisode, ReserveReading } from "./types.js";

/** 兩筆資料間隔超過這個時間，就算成不同段 */
const MAX_GAP_MS = 20 * 60_000;
/** 每筆資料代表的時間長度（台電每 10 分鐘發布一次） */
const SAMPLE_MS = 10 * 60_000;

/**
 * 找出供電餘裕率低於門檻的「連續時段」。
 * 連續低於門檻的資料點合併成一段，回傳時新的在前。
 */
export function findLowEpisodes(readings: ReserveReading[], threshold: number): LowReserveEpisode[] {
  const points = readings
    .filter((item) => item.status === "ok" && typeof item.reserveRate === "number")
    .map((item) => ({ time: new Date(item.observedAt).getTime(), rate: item.reserveRate as number, reserveMw: item.reserveMw }))
    .sort((a, b) => a.time - b.time);

  const episodes: LowReserveEpisode[] = [];
  let current: typeof points = [];

  const flush = () => {
    if (current.length === 0) return;
    const lowest = current.reduce((min, point) => (point.rate < min.rate ? point : min));
    const start = current[0].time;
    const end = current[current.length - 1].time;
    episodes.push({
      date: taipeiDateKey(new Date(start)),
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      durationMinutes: Math.round((end - start + SAMPLE_MS) / 60_000),
      pointCount: current.length,
      minRate: lowest.rate,
      minAt: new Date(lowest.time).toISOString(),
      minReserveMw: lowest.reserveMw
    });
    current = [];
  };

  let previousTime = -Infinity;
  for (const point of points) {
    const isLow = point.rate < threshold;
    const contiguous = point.time - previousTime <= MAX_GAP_MS;
    if (!isLow || !contiguous) flush();
    if (isLow) current.push(point);
    previousTime = point.time;
  }
  flush();

  return episodes.reverse();
}
