import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AlertNotifier, type AlertPayload } from "../src/alerts.js";
import { loadConfig } from "../src/config.js";
import { FileStore } from "../src/store.js";
import type { ReserveReading } from "../src/types.js";

const START = Date.parse("2026-11-05T07:00:00.000Z"); // 台北 15:00

/** 依序產生每 10 分鐘一筆的資料；rate 由 load/supply 推算，與正式環境相同 */
function readings(rates: number[]): ReserveReading[] {
  return rates.map((rate, index) => {
    const supply = 4000;
    const load = supply * (1 - rate / 100);
    const observedAt = new Date(START + index * 10 * 60_000).toISOString();
    return {
      observedAt,
      reserveMw: (supply - load) * 10,
      reserveRate: rate,
      sourceUrl: "fixture",
      status: "ok",
      message: null,
      raw: { candidate: { curr_load: load.toFixed(1), real_hr_maxi_sply_capacity: supply.toFixed(1) } },
      createdAt: observedAt
    };
  });
}

/** 一筆一筆寫進 store，每筆之後跑兩次檢查（模擬重複觸發），回傳發出的通知 */
async function replay(rates: number[]): Promise<AlertPayload[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taipei-power-alerts-"));
  const store = new FileStore(path.join(dir, "readings.json"));
  await store.init();
  const config = { ...loadConfig(), notifyWebhookUrl: "http://example.invalid/hook", notifyThreshold: 10, notifySevereThreshold: 6 };
  const sent: AlertPayload[] = [];
  const notifier = new AlertNotifier(config, store, async (payload) => {
    sent.push(payload);
  });

  for (const reading of readings(rates)) {
    await store.upsert(reading);
    const now = Date.parse(reading.observedAt) + 8 * 60_000;
    await notifier.check(now);
    await notifier.check(now + 60_000);
  }
  return sent;
}

test("alerts once when dropping below 10%, then once on recovery", async () => {
  const sent = await replay([12, 11, 9.5, 8.8, 9.2, 11, 12, 12, 12]);
  assert.deepEqual(
    sent.map((payload) => payload.level),
    ["warning", "ok"]
  );
  assert.match(sent[0].text, /9\.50%/);
  const field = (payload: AlertPayload, label: string) => payload.fields.find((item) => item.label === label)?.value;
  assert.equal(field(sent[0], "供電餘裕率"), "9.50%");
  assert.equal(field(sent[0], "供電能力"), "40,000 MW");
  assert.equal(field(sent[0], "備轉容量"), "3,800 MW");
  assert.match(field(sent[1], "期間最低") ?? "", /^8\.80%/);
  assert.match(field(sent[1], "偏低時段") ?? "", /（30 分鐘）$/);
});

test("short bounces above 10% within an hour stay one incident", async () => {
  const sent = await replay([12, 9, 10.5, 9.4, 10.2, 9.8, 11, 11, 11, 11]);
  assert.deepEqual(
    sent.map((payload) => payload.level),
    ["warning", "ok"]
  );
});

test("sends an extra alert below 6%", async () => {
  const sent = await replay([12, 8, 5.5, 5.2, 8, 12, 12, 12, 12]);
  assert.deepEqual(
    sent.map((payload) => payload.level),
    ["warning", "alert", "ok"]
  );
});

test("does not recover until 30 minutes above threshold", async () => {
  const sent = await replay([12, 9, 11, 11]);
  assert.deepEqual(
    sent.map((payload) => payload.level),
    ["warning"]
  );
});

test("failed delivery is retried on the next check", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taipei-power-alerts-"));
  const store = new FileStore(path.join(dir, "readings.json"));
  await store.init();
  const config = { ...loadConfig(), notifyWebhookUrl: "http://example.invalid/hook" };
  let attempts = 0;
  const notifier = new AlertNotifier(config, store, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network down");
  });
  const [reading] = readings([9]);
  await store.upsert(reading);
  const now = Date.parse(reading.observedAt) + 5 * 60_000;
  assert.equal((await notifier.check(now)).length, 0);
  assert.equal((await notifier.check(now)).length, 1);
  assert.equal((await notifier.check(now)).length, 0);
});

test("disabled when NOTIFY_WEBHOOK_URL is not set", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taipei-power-alerts-"));
  const store = new FileStore(path.join(dir, "readings.json"));
  const notifier = new AlertNotifier({ ...loadConfig(), notifyWebhookUrl: null }, store, async () => {
    throw new Error("should not send");
  });
  assert.equal(notifier.enabled, false);
  assert.deepEqual(await notifier.check(), []);
});
