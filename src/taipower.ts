import { floorToTenMinutes, parseTaipeiDateTime } from "./time.js";
import type { ReserveReading } from "./types.js";

interface ParsedReserve {
  observedAt: Date;
  reserveMw: number | null;
  reserveRate: number;
  raw: unknown;
}

export async function fetchTaipowerReserve(sourceUrls: string[], now = new Date()): Promise<ReserveReading> {
  const errors: string[] = [];

  for (const sourceUrl of sourceUrls) {
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          accept: "application/json,text/html;q=0.9,*/*;q=0.8",
          "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "user-agent": "Mozilla/5.0 TaipeiPowerReserve/0.1"
        }
      });
      const wafAction = response.headers.get("x-amzn-waf-action");
      if (response.status === 202 && wafAction === "challenge") {
        errors.push(`${sourceUrl}: 台電站台回傳 WAF challenge`);
        continue;
      }
      if (!response.ok) {
        errors.push(`${sourceUrl}: HTTP ${response.status}`);
        continue;
      }

      const text = await response.text();
      const parsed = parseReservePayload(text, sourceUrl, now);
      if (!parsed) {
        errors.push(`${sourceUrl}: 無法解析備轉容量率`);
        continue;
      }

      return {
        observedAt: parsed.observedAt.toISOString(),
        reserveMw: parsed.reserveMw,
        reserveRate: parsed.reserveRate,
        sourceUrl,
        status: "ok",
        message: null,
        raw: parsed.raw,
        createdAt: now.toISOString()
      };
    } catch (error) {
      errors.push(`${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    observedAt: floorToTenMinutes(now).toISOString(),
    reserveMw: null,
    reserveRate: null,
    sourceUrl: sourceUrls[0] ?? "unknown",
    status: "error",
    message: errors.join("；") || "沒有可用資料來源",
    raw: null,
    createdAt: now.toISOString()
  };
}

export function parseReservePayload(text: string, sourceUrl = "inline", now = new Date()): ParsedReserve | null {
  const json = tryParseJson(text);
  if (json !== null) {
    return parseFromJson(json, sourceUrl, now);
  }
  return parseFromText(stripHtml(text), sourceUrl, now);
}

function parseFromJson(json: unknown, sourceUrl: string, now: Date): ParsedReserve | null {
  const candidates = collectJsonCandidates(json, now);
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates.find((item) => typeof item.reserveRate === "number");
  if (!best || best.reserveRate === null) return null;
  return {
    observedAt: best.observedAt ?? floorToTenMinutes(now),
    reserveMw: best.reserveMw,
    reserveRate: best.reserveRate,
    raw: { sourceUrl, candidate: best.raw }
  };
}

function collectJsonCandidates(value: unknown, now: Date): Array<{
  observedAt: Date | null;
  reserveMw: number | null;
  reserveRate: number | null;
  score: number;
  raw: unknown;
}> {
  const candidates: Array<{
    observedAt: Date | null;
    reserveMw: number | null;
    reserveRate: number | null;
    score: number;
    raw: unknown;
  }> = [];

  function visit(node: unknown, path: string[]): void {
    if (Array.isArray(node)) {
      const rowText = node.map((item) => stringifyScalar(item)).filter(Boolean).join(" ");
      const row = parseFromText(rowText, path.join("."), now);
      if (row) {
        candidates.push({
          observedAt: row.observedAt,
          reserveMw: row.reserveMw,
          reserveRate: row.reserveRate,
          score: 5 + (row.reserveMw === null ? 0 : 2),
          raw: node
        });
      }
      node.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }

    if (node && typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>);
      let reserveRate: number | null = null;
      let reserveMw: number | null = null;
      let observedAt: Date | null = null;
      let score = 0;

      for (const [key, item] of entries) {
        const label = key.toLowerCase();
        const scalar = stringifyScalar(item);
        if (scalar) {
          const numeric = parseNumeric(scalar);
          if (numeric !== null && isRateKey(label, key)) {
            reserveRate = numeric;
            score += 5;
          } else if (numeric !== null && isReserveMwKey(label, key)) {
            reserveMw = convertReserveToMw(numeric, `${key} ${scalar}`);
            score += 3;
          }

          if (!observedAt && isTimeKey(label, key)) {
            observedAt = parseTaipeiDateTime(scalar, now);
            if (observedAt) score += 2;
          }
        }
      }

      const text = entries.map(([key, item]) => `${key}:${stringifyScalar(item)}`).filter(Boolean).join(" ");
      const textParsed = parseFromText(text, path.join("."), now);
      if (textParsed) {
        reserveRate = reserveRate ?? textParsed.reserveRate;
        reserveMw = reserveMw ?? textParsed.reserveMw;
        observedAt = observedAt ?? textParsed.observedAt;
        score += 4;
      }

      if (reserveRate !== null) {
        candidates.push({ observedAt, reserveMw, reserveRate, score, raw: node });
      }

      entries.forEach(([key, item]) => visit(item, [...path, key]));
    }
  }

  visit(value, []);
  return candidates;
}

function parseFromText(text: string, sourceUrl: string, now: Date): ParsedReserve | null {
  const clean = text.replace(/\s+/g, " ").trim();
  const reserveRate =
    matchNumber(clean, /備轉容量率[^0-9-]*(-?\d+(?:\.\d+)?)\s*%?/) ??
    matchNumber(clean, /operating\s*reserve\s*rate[^0-9-]*(-?\d+(?:\.\d+)?)\s*%?/i) ??
    matchNumber(clean, /reserve\s*rate[^0-9-]*(-?\d+(?:\.\d+)?)\s*%?/i) ??
    matchNumber(clean, /(-?\d+(?:\.\d+)?)\s*%\s*(?:備轉容量率|operating\s*reserve\s*rate|reserve\s*rate)/i);

  if (reserveRate === null) return null;

  const reserveRaw =
    matchNumber(clean, /備轉容量(?!率)[^0-9-]*([\d,]+(?:\.\d+)?)/) ??
    matchNumber(clean, /operating\s*reserve(?!\s*rate)[^0-9-]*([\d,]+(?:\.\d+)?)/i) ??
    null;
  const reserveMw = reserveRaw === null ? null : convertReserveToMw(reserveRaw, clean);
  const observedAt = parseTaipeiDateTime(clean, now) ?? floorToTenMinutes(now);

  return {
    observedAt,
    reserveMw,
    reserveRate,
    raw: { sourceUrl, text: clean.slice(0, 1000) }
  };
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/");
}

function stringifyScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function parseNumeric(value: string): number | null {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchNumber(text: string, pattern: RegExp): number | null {
  const match = text.replace(/,/g, "").match(pattern);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRateKey(lowerKey: string, originalKey: string): boolean {
  return (
    originalKey.includes("備轉容量率") ||
    lowerKey.includes("reserve_rate") ||
    lowerKey.includes("reserverate") ||
    lowerKey.includes("resv_rate") ||
    lowerKey.includes("operatingreserverate") ||
    lowerKey.includes("operating_reserve_rate") ||
    lowerKey.includes("percent")
  );
}

function isReserveMwKey(lowerKey: string, originalKey: string): boolean {
  return (
    (originalKey.includes("備轉容量") && !originalKey.includes("率")) ||
    lowerKey.includes("reserve_mw") ||
    lowerKey.includes("resv_capacity") ||
    lowerKey.includes("reservecapacity") ||
    lowerKey.includes("operating_reserve")
  );
}

function isTimeKey(lowerKey: string, originalKey: string): boolean {
  return (
    originalKey.includes("時間") ||
    originalKey.includes("日期") ||
    lowerKey.includes("time") ||
    lowerKey.includes("date") ||
    lowerKey.includes("update")
  );
}

function convertReserveToMw(value: number, context: string): number {
  if (context.includes("萬瓩") || context.includes("resv_capacity")) return value * 10;
  return value;
}
