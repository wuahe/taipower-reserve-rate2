import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileStore } from "../src/store.js";
import type { ReserveReading } from "../src/types.js";

test("FileStore upserts duplicate observedAt", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taipei-power-"));
  const store = new FileStore(path.join(dir, "readings.json"));
  await store.init();

  const base: ReserveReading = {
    observedAt: "2026-05-29T07:40:00.000Z",
    reserveMw: 1000,
    reserveRate: 10,
    sourceUrl: "fixture",
    status: "ok",
    message: null,
    raw: null,
    createdAt: "2026-05-29T07:41:00.000Z"
  };

  await store.upsert(base);
  await store.upsert({ ...base, reserveRate: 11, createdAt: "2026-05-29T07:42:00.000Z" });

  const readings = await store.today(new Date("2026-05-29T08:00:00.000Z"));
  assert.equal(readings.length, 1);
  assert.equal(readings[0].reserveRate, 11);
});
