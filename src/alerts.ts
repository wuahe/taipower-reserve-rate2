import type { AppConfig } from "./config.js";
import { findLowEpisodes } from "./lowReserve.js";
import type { ReadingStore } from "./store.js";
import { normalizeReadingInstantReserve } from "./taipower.js";
import type { LowReserveEpisode, ReserveReading } from "./types.js";

/** 兩段偏低之間間隔不超過這個時間，視為同一次事件（避免在門檻上下跳動時洗版） */
const MERGE_GAP_MS = 60 * 60_000;
/** 連續在門檻以上這麼久，才發「恢復」 */
const RECOVER_AFTER_MS = 30 * 60_000;
/** 最新資料太舊就不判斷 */
const STALE_MS = 40 * 60_000;
const LOOKBACK_MS = 3 * 24 * 60 * 60_000;
const SAMPLE_MS = 10 * 60_000;

export interface AlertField {
  label: string;
  value: string;
}

export interface AlertPayload {
  level: "info" | "ok" | "warning" | "alert";
  title: string;
  text: string;
  /** 通知中心會逐行顯示成「label：value」 */
  fields: AlertField[];
  url: string;
  source: string;
}

export interface PlannedAlert {
  key: string;
  payload: AlertPayload;
}

export interface Incident {
  startAt: string;
  endAt: string;
  minRate: number;
  minAt: string;
}

export interface AlertOptions {
  threshold: number;
  severeThreshold: number;
  siteUrl: string;
}

/** 把相鄰的偏低時段合併成「事件」，新的在前 */
export function mergeIncidents(episodes: LowReserveEpisode[]): Incident[] {
  const sorted = [...episodes].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const merged: Incident[] = [];
  for (const episode of sorted) {
    const last = merged.at(-1);
    if (last && Date.parse(episode.startAt) - Date.parse(last.endAt) <= MERGE_GAP_MS) {
      last.endAt = episode.endAt;
      if (episode.minRate < last.minRate) {
        last.minRate = episode.minRate;
        last.minAt = episode.minAt;
      }
    } else {
      merged.push({ startAt: episode.startAt, endAt: episode.endAt, minRate: episode.minRate, minAt: episode.minAt });
    }
  }
  return merged.reverse();
}

/**
 * 決定這次要發哪些通知（純函式，方便測試）。
 * 每則通知有唯一的 key（例：low:2026-11-05T08:00:00.000Z），已發過的不再發，重新部署也不會重複。
 */
export function planAlerts(
  latest: ReserveReading | null,
  episodes: LowReserveEpisode[],
  alreadySent: (key: string) => boolean,
  now: number,
  options: AlertOptions
): PlannedAlert[] {
  if (!latest || latest.status !== "ok" || typeof latest.reserveRate !== "number") return [];
  const latestAt = Date.parse(latest.observedAt);
  if (now - latestAt > STALE_MS) return [];

  const current = mergeIncidents(episodes)[0];
  if (!current) return [];
  const rate = latest.reserveRate;
  const plans: PlannedAlert[] = [];

  if (rate < options.threshold && Date.parse(current.endAt) === latestAt) {
    const lowKey = `low:${current.startAt}`;
    if (!alreadySent(lowKey)) plans.push({ key: lowKey, payload: dropPayload(latest, options.threshold, "warning", options) });

    const severeKey = `severe:${current.startAt}`;
    if (rate < options.severeThreshold && !alreadySent(severeKey)) {
      plans.push({ key: severeKey, payload: dropPayload(latest, options.severeThreshold, "alert", options) });
    }
    return plans;
  }

  if (rate >= options.threshold) {
    const recoverKey = `recover:${current.startAt}`;
    const recoveredLongEnough = latestAt - Date.parse(current.endAt) >= RECOVER_AFTER_MS;
    if (recoveredLongEnough && alreadySent(`low:${current.startAt}`) && !alreadySent(recoverKey)) {
      plans.push({ key: recoverKey, payload: recoveryPayload(latest, current, options) });
    }
  }
  return plans;
}

/** 每次抓到新資料後檢查一次，需要時呼叫 n8n 通知中心的 Webhook */
export class AlertNotifier {
  constructor(
    private readonly config: AppConfig,
    private readonly store: ReadingStore,
    private readonly send: (payload: AlertPayload) => Promise<void> = (payload) => postWebhook(config, payload)
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.notifyWebhookUrl);
  }

  async check(now = Date.now()): Promise<PlannedAlert[]> {
    if (!this.enabled) return [];
    const readings = (await this.store.between(new Date(now - LOOKBACK_MS), new Date(now + SAMPLE_MS))).map(
      (reading) => normalizeReadingInstantReserve(reading) ?? reading
    );
    const okReadings = readings.filter((reading) => reading.status === "ok" && typeof reading.reserveRate === "number");
    const latest = okReadings.at(-1) ?? null;
    const episodes = findLowEpisodes(okReadings, this.config.notifyThreshold);

    const sent = new Set<string>();
    for (const key of this.candidateKeys(episodes)) {
      if (await this.store.hasNotified(key)) sent.add(key);
    }

    const plans = planAlerts(latest, episodes, (key) => sent.has(key), now, {
      threshold: this.config.notifyThreshold,
      severeThreshold: this.config.notifySevereThreshold,
      siteUrl: this.config.siteUrl
    });

    const delivered: PlannedAlert[] = [];
    for (const plan of plans) {
      try {
        await this.send(plan.payload);
        await this.store.markNotified(plan.key);
        delivered.push(plan);
        console.log(`[alerts] sent ${plan.key}`);
      } catch (error) {
        // 沒標記成已發送，下次抓到資料會再試
        console.error(`[alerts] failed ${plan.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return delivered;
  }

  private candidateKeys(episodes: LowReserveEpisode[]): string[] {
    const current = mergeIncidents(episodes)[0];
    if (!current) return [];
    return ["low", "severe", "recover"].map((kind) => `${kind}:${current.startAt}`);
  }
}

async function postWebhook(config: AppConfig, payload: AlertPayload): Promise<void> {
  if (!config.notifyWebhookUrl) return;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.notifyWebhookToken) headers[config.notifyTokenHeader] = config.notifyWebhookToken;
  const response = await fetch(config.notifyWebhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
}

const SOURCE = "台電供電餘裕率";

function dropPayload(latest: ReserveReading, threshold: number, level: "warning" | "alert", options: AlertOptions): AlertPayload {
  const rate = latest.reserveRate as number;
  return {
    level,
    title: `供電餘裕率低於 ${threshold}%`,
    text: `${monthDayTime(latest.observedAt)} 供電餘裕率 ${rate.toFixed(2)}%，${level === "alert" ? "進入警戒" : "供電吃緊"}。`,
    fields: [
      { label: "供電餘裕率", value: `${rate.toFixed(2)}%` },
      ...readingFields(latest)
    ],
    url: options.siteUrl,
    source: SOURCE
  };
}

function recoveryPayload(latest: ReserveReading, incident: Incident, options: AlertOptions): AlertPayload {
  const rate = latest.reserveRate as number;
  const end = Date.parse(incident.endAt) + SAMPLE_MS;
  const minutes = Math.round((end - Date.parse(incident.startAt)) / 60_000);
  const duration = minutes < 60 ? `${minutes} 分鐘` : `${Math.floor(minutes / 60)} 小時${minutes % 60 ? ` ${minutes % 60} 分` : ""}`;
  return {
    level: "ok",
    title: `供電餘裕率恢復到 ${options.threshold}% 以上`,
    text: `${monthDayTime(latest.observedAt)} 供電餘裕率回到 ${rate.toFixed(2)}%，已連續 30 分鐘在 ${options.threshold}% 以上。`,
    fields: [
      { label: "偏低時段", value: `${time(incident.startAt)}–${time(new Date(end).toISOString())}（${duration}）` },
      { label: "期間最低", value: `${incident.minRate.toFixed(2)}%（${time(incident.minAt)}）` },
      { label: "目前餘裕率", value: `${rate.toFixed(2)}%` },
      ...readingFields(latest)
    ],
    url: options.siteUrl,
    source: SOURCE
  };
}

/** 從台電原始資料取出負載、供電能力等數值 */
function readingFields(latest: ReserveReading): AlertField[] {
  const raw = latest.raw as { candidate?: Record<string, unknown> } | null;
  const candidate = raw?.candidate ?? {};
  const num = (value: unknown) => {
    const parsed = Number(String(value ?? "").replace(/,/g, ""));
    return value === undefined || value === null || value === "" || !Number.isFinite(parsed) ? null : parsed;
  };
  const mw = (value: number) => `${Math.round(value * 10).toLocaleString("en-US")} MW`;
  const load = num(candidate.curr_load);
  const supply = num(candidate.real_hr_maxi_sply_capacity);
  const util = num(candidate.curr_util_rate);
  const forePeakRate = num(candidate.fore_peak_resv_rate);
  const forePeakHours = typeof candidate.fore_peak_hour_range === "string" ? candidate.fore_peak_hour_range : null;

  const fields: AlertField[] = [];
  if (load !== null) fields.push({ label: "即時負載", value: mw(load) });
  if (supply !== null) fields.push({ label: "供電能力", value: mw(supply) });
  if (load !== null && supply !== null) fields.push({ label: "備轉容量", value: mw(Math.max(0, supply - load)) });
  if (util !== null) fields.push({ label: "使用率", value: `${util}%` });
  if (forePeakRate !== null) {
    fields.push({ label: "台電預估今日尖峰備轉率", value: `${forePeakRate}%${forePeakHours ? `（${forePeakHours}）` : ""}` });
  }
  return fields;
}

const timeFormatter = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
const monthDayTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function time(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

function monthDayTime(iso: string): string {
  return monthDayTimeFormatter.format(new Date(iso));
}
