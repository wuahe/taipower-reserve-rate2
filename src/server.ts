import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config.js";
import { Collector } from "./scheduler.js";
import { createStore, type ReadingStore } from "./store.js";
import { findLowEpisodes } from "./lowReserve.js";
import { normalizeReadingInstantReserve } from "./taipower.js";
import { taipeiDayRange } from "./time.js";
import type { DatesResponse, LatestResponse, LowReserveResponse, ReserveReading, ReserveSummary, StatusResponse, TodayResponse } from "./types.js";

const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, "public");

const config = loadConfig();
const storeState = await createReadyStore();
const store = storeState.store;

const collector = new Collector(config, store);
collector.start();

const server = http.createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "Missing URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/api/latest") {
      const latest = normalizeReadingInstantReserve(await store.latestSuccess());
      const lastFetch = normalizeReadingInstantReserve(await store.lastFetch());
      const body: LatestResponse = {
        latest,
        lastFetch,
        generatedAt: new Date().toISOString()
      };
      sendJson(response, 200, body);
      return;
    }

    if (url.pathname === "/api/today") {
      const targetDate = parseDateQuery(url.searchParams.get("date"));
      if (url.searchParams.has("date") && !targetDate) {
        sendJson(response, 400, { error: "Invalid date. Use YYYY-MM-DD." });
        return;
      }

      const day = taipeiDayRange(targetDate ?? new Date());
      const points = (await store.today(targetDate ?? new Date())).map((point) => normalizeReadingInstantReserve(point) ?? point);
      const body: TodayResponse = {
        date: day.key,
        timezone: "Asia/Taipei",
        points,
        summary: summarize(points),
        lastFetch: normalizeReadingInstantReserve(await store.lastFetch())
      };
      sendJson(response, 200, body);
      return;
    }

    if (url.pathname === "/api/dates") {
      const targetMonth = parseMonthQuery(url.searchParams.get("month"));
      if (!targetMonth) {
        sendJson(response, 400, { error: "Invalid month. Use YYYY-MM." });
        return;
      }

      const body: DatesResponse = {
        month: url.searchParams.get("month") ?? "",
        timezone: "Asia/Taipei",
        dates: await store.datesWithData(targetMonth)
      };
      sendJson(response, 200, body);
      return;
    }

    if (url.pathname === "/api/low") {
      const threshold = parseNumberQuery(url.searchParams.get("threshold"), 10, 1, 50);
      const days = parseNumberQuery(url.searchParams.get("days"), 30, 1, 366);
      if (threshold === null || days === null) {
        sendJson(response, 400, { error: "Invalid query. threshold: 1–50, days: 1–366." });
        return;
      }

      const today = taipeiDayRange();
      const end = today.end;
      const start = new Date(today.start.getTime() - (Math.round(days) - 1) * 24 * 60 * 60 * 1000);
      const readings = (await store.between(start, end)).map((point) => normalizeReadingInstantReserve(point) ?? point);
      const episodes = findLowEpisodes(readings, threshold);
      const body: LowReserveResponse = {
        threshold,
        days: Math.round(days),
        from: taipeiDayRange(start).key,
        to: today.key,
        timezone: "Asia/Taipei",
        dayCount: new Set(episodes.map((episode) => episode.date)).size,
        episodes
      };
      sendJson(response, 200, body);
      return;
    }

    if (url.pathname === "/api/status" || url.pathname === "/api/debug") {
      const day = taipeiDayRange();
      const points = await store.today();
      const lastFetch = await store.lastFetch();
      const body: StatusResponse = {
        ok: true,
        generatedAt: new Date().toISOString(),
        timezone: "Asia/Taipei",
        storage: {
          type: store.kind,
          persistent: store.kind === "postgres",
          databaseConfigured: Boolean(config.databaseUrl),
          databaseConnectionSource: config.databaseConnectionSource,
          fallbackReason: storeState.fallbackReason
        },
        collection: {
          intervalMs: config.collectIntervalMs,
          intervalMinutes: config.collectIntervalMs / 60_000,
          sourceCount: config.sourceUrls.length
        },
        today: {
          date: day.key,
          pointCount: points.length,
          lastObservedAt: points.at(-1)?.observedAt ?? null
        },
        lastFetch: lastFetch
          ? {
              status: lastFetch.status,
              observedAt: lastFetch.observedAt,
              createdAt: lastFetch.createdAt,
              sourceUrl: lastFetch.sourceUrl,
              message: lastFetch.message
            }
          : null
      };
      sendJson(response, 200, body);
      return;
    }

    if (url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }

    await serveStatic(url.pathname, url.searchParams.has("v"), response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(config.port, () => {
  console.log(`[server] listening on ${config.port}`);
});

process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());

function shutdown(): void {
  collector.stop();
  server.close(() => process.exit(0));
}

function summarize(points: ReserveReading[]): ReserveSummary {
  const values = points
    .filter((point) => point.status === "ok" && typeof point.reserveRate === "number")
    .map((point) => point.reserveRate as number);

  if (values.length === 0) {
    return { count: 0, minRate: null, maxRate: null, avgRate: null };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    minRate: Math.min(...values),
    maxRate: Math.max(...values),
    avgRate: total / values.length
  };
}

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function parseDateQuery(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(`${year}-${month}-${day}T12:00:00+08:00`);
}

function parseNumberQuery(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseMonthQuery(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const [, year, month] = match;
  return new Date(`${year}-${month}-01T12:00:00+08:00`);
}

async function serveStatic(pathname: string, versioned: boolean, response: http.ServerResponse): Promise<void> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const decoded = decodeURIComponent(safePath);
  const target = path.normalize(path.join(publicDir, decoded));

  if (!target.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await stat(target);
    if (!file.isFile()) throw new Error("Not a file");

    if (target.endsWith(".html")) {
      // 把 CSS／JS 的網址加上內容雜湊，檔案一改網址就變，瀏覽器一定抓新版
      const html = await withAssetVersions(await readFile(target, "utf8"));
      response.writeHead(200, { "content-type": contentType(target), "cache-control": "no-store" });
      response.end(html);
      return;
    }

    response.writeHead(200, {
      "content-type": contentType(target),
      // 帶版本號的網址內容永遠不變，可以長期快取；沒帶的每次都要回伺服器確認
      "cache-control": versioned ? "public, max-age=31536000, immutable" : "no-cache"
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const VERSIONED_ASSETS = ["/styles.css", "/client.js"];
const assetHashCache = new Map<string, { mtimeMs: number; hash: string }>();

async function assetHash(publicPath: string): Promise<string | null> {
  const target = path.join(publicDir, publicPath);
  try {
    const { mtimeMs } = await stat(target);
    const cached = assetHashCache.get(publicPath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.hash;
    const hash = createHash("sha256").update(await readFile(target)).digest("hex").slice(0, 10);
    assetHashCache.set(publicPath, { mtimeMs, hash });
    return hash;
  } catch {
    return null;
  }
}

async function withAssetVersions(html: string): Promise<string> {
  let result = html;
  for (const asset of VERSIONED_ASSETS) {
    const hash = await assetHash(asset);
    if (hash) result = result.replaceAll(`"${asset}"`, `"${asset}?v=${hash}"`);
  }
  return result;
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

interface StoreState {
  store: ReadingStore;
  fallbackReason: string | null;
}

async function createReadyStore(): Promise<StoreState> {
  const primary = createStore(
    config.databaseUrl,
    config.dataFile,
    config.databaseSsl,
    config.databaseConnectTimeoutMs
  );
  try {
    await initStoreWithRetry(primary);
    return { store: primary, fallbackReason: null };
  } catch (error) {
    if (!config.databaseUrl) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[store] PostgreSQL unavailable after retries, falling back to file storage: ${message}`);
    const fallback = createStore(null, config.dataFile);
    await fallback.init();
    return { store: fallback, fallbackReason: message };
  }
}

async function initStoreWithRetry(targetStore: ReadingStore): Promise<void> {
  const maxAttempts = config.databaseUrl ? config.databaseInitMaxAttempts : 1;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await targetStore.init();
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[store] init failed ${attempt}/${maxAttempts}: ${message}`);
      if (attempt < maxAttempts) {
        await delay(config.databaseInitRetryDelayMs);
      }
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
