import assert from "node:assert/strict";
import test from "node:test";
import { findLowEpisodes } from "../src/lowReserve.js";
import type { ReserveReading } from "../src/types.js";

function reading(observedAt: string, reserveRate: number | null, status: "ok" | "error" = "ok"): ReserveReading {
  return {
    observedAt,
    reserveMw: reserveRate === null ? null : reserveRate * 100,
    reserveRate,
    sourceUrl: "fixture",
    status,
    message: null,
    raw: null,
    createdAt: observedAt
  };
}

test("findLowEpisodes merges consecutive low points into one episode", () => {
  const episodes = findLowEpisodes(
    [
      reading("2026-11-05T09:50:00.000Z", 11),
      reading("2026-11-05T10:00:00.000Z", 9.5),
      reading("2026-11-05T10:10:00.000Z", 6.9),
      reading("2026-11-05T10:20:00.000Z", 8.1),
      reading("2026-11-05T10:30:00.000Z", 12)
    ],
    10
  );

  assert.equal(episodes.length, 1);
  const [episode] = episodes;
  assert.equal(episode.date, "2026-11-05");
  assert.equal(episode.startAt, "2026-11-05T10:00:00.000Z");
  assert.equal(episode.endAt, "2026-11-05T10:20:00.000Z");
  assert.equal(episode.pointCount, 3);
  assert.equal(episode.durationMinutes, 30);
  assert.equal(episode.minRate, 6.9);
  assert.equal(episode.minAt, "2026-11-05T10:10:00.000Z");
});

test("findLowEpisodes splits on recovery and on data gaps, newest first", () => {
  const episodes = findLowEpisodes(
    [
      reading("2026-11-04T10:00:00.000Z", 9),
      reading("2026-11-04T10:10:00.000Z", 11),
      reading("2026-11-04T10:20:00.000Z", 9),
      // 50 分鐘沒資料，即使都低於門檻也要拆開
      reading("2026-11-04T11:10:00.000Z", 9)
    ],
    10
  );

  assert.deepEqual(
    episodes.map((episode) => episode.startAt),
    ["2026-11-04T11:10:00.000Z", "2026-11-04T10:20:00.000Z", "2026-11-04T10:00:00.000Z"]
  );
});

test("findLowEpisodes ignores failed fetches and uses Taipei date", () => {
  const episodes = findLowEpisodes(
    [
      reading("2026-11-04T16:30:00.000Z", 8), // 台北 11/05 00:30
      reading("2026-11-04T16:40:00.000Z", null, "error")
    ],
    10
  );

  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].date, "2026-11-05");
  assert.equal(episodes[0].pointCount, 1);
  assert.equal(episodes[0].durationMinutes, 10);
});

test("findLowEpisodes returns nothing when all points are at or above threshold", () => {
  assert.deepEqual(findLowEpisodes([reading("2026-11-05T10:00:00.000Z", 10)], 10), []);
});
