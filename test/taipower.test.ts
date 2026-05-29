import assert from "node:assert/strict";
import test from "node:test";
import { parseReservePayload } from "../src/taipower.js";

test("parseReservePayload parses HTML text with reserve rate", () => {
  const parsed = parseReservePayload(
    "<div>更新時間 2026/05/29 15:40 備轉容量率 12.34% 備轉容量 345.6 萬瓩</div>",
    "fixture",
    new Date("2026-05-29T07:50:00.000Z")
  );
  assert.equal(parsed?.observedAt.toISOString(), "2026-05-29T07:40:00.000Z");
  assert.equal(parsed?.reserveRate, 12.34);
  assert.equal(parsed?.reserveMw, 3456);
});

test("parseReservePayload parses JSON object", () => {
  const parsed = parseReservePayload(
    JSON.stringify({
      updateTime: "2026-05-29 15:50",
      operatingReserveRate: "11.22",
      operatingReserve: "2800 MW"
    }),
    "fixture",
    new Date("2026-05-29T07:55:00.000Z")
  );
  assert.equal(parsed?.observedAt.toISOString(), "2026-05-29T07:50:00.000Z");
  assert.equal(parsed?.reserveRate, 11.22);
  assert.equal(parsed?.reserveMw, 2800);
});

test("parseReservePayload parses official d006020 JSON", () => {
  const parsed = parseReservePayload(
    JSON.stringify({
      success: "true",
      result: { resource_id: "-" },
      records: [
        { curr_load: "3765.8", curr_util_rate: "80" },
        {
          fore_maxi_sply_capacity: "4531.0",
          fore_peak_dema_load: "3950.0",
          fore_peak_resv_capacity: "581.0",
          fore_peak_resv_rate: "14.71",
          fore_peak_resv_indicator: "G",
          fore_peak_hour_range: "13:00-16:00",
          publish_time: "115.05.29(五)16:10"
        }
      ]
    }),
    "fixture",
    new Date("2026-05-29T08:12:00.000Z")
  );
  assert.equal(parsed?.observedAt.toISOString(), "2026-05-29T08:10:00.000Z");
  assert.equal(parsed?.reserveRate, 14.71);
  assert.equal(parsed?.reserveMw, 5810);
});
