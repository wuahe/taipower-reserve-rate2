import assert from "node:assert/strict";
import test from "node:test";
import { floorToTenMinutes, parseTaipeiDateTime, taipeiDateKey, taipeiDayRange } from "../src/time.js";

test("taipeiDateKey uses UTC+8 day", () => {
  assert.equal(taipeiDateKey(new Date("2026-05-28T16:30:00.000Z")), "2026-05-29");
});

test("taipeiDayRange returns UTC boundaries for Taipei day", () => {
  const range = taipeiDayRange(new Date("2026-05-29T07:00:00.000Z"));
  assert.equal(range.key, "2026-05-29");
  assert.equal(range.start.toISOString(), "2026-05-28T16:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-05-29T16:00:00.000Z");
});

test("parseTaipeiDateTime parses Taiwan local date time", () => {
  const parsed = parseTaipeiDateTime("2026/05/29 15:40");
  assert.equal(parsed?.toISOString(), "2026-05-29T07:40:00.000Z");
});

test("parseTaipeiDateTime parses ROC date time with weekday", () => {
  const parsed = parseTaipeiDateTime("115.05.29(五)16:10");
  assert.equal(parsed?.toISOString(), "2026-05-29T08:10:00.000Z");
});

test("floorToTenMinutes floors minutes", () => {
  assert.equal(floorToTenMinutes(new Date("2026-05-29T07:49:37.123Z")).toISOString(), "2026-05-29T07:40:00.000Z");
});
