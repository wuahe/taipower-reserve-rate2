import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config.js";
import { Collector } from "./scheduler.js";
import { createStore, type ReadingStore } from "./store.js";
import { taipeiDayRange } from "./time.js";
import type { LatestResponse, ReserveReading, ReserveSummary, StatusResponse, TodayResponse } from "./types.js";

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
      const body: LatestResponse = {
        latest: await store.latestSuccess(),
        lastFetch: await store.lastFetch(),
        generatedAt: new Date().toISOString()
      };
      sendJson(response, 200, body);
      return;
    }

    if (url.pathname === "/api/today") {
      const day = taipeiDayRange();
      const points = await store.today();
      const body: TodayResponse = {
        date: day.key,
        timezone: "Asia/Taipei",
        points,
        summary: summarize(points),
        lastFetch: await store.lastFetch()
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

    await serveStatic(url.pathname, response);
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

async function serveStatic(pathname: string, response: http.ServerResponse): Promise<void> {
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
    response.writeHead(200, {
      "content-type": contentType(target),
      "cache-control": target.endsWith("index.html") ? "no-store" : "public, max-age=300"
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
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
