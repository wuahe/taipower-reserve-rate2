export interface AppConfig {
  port: number;
  collectIntervalMs: number;
  databaseUrl: string | null;
  databaseSsl: boolean;
  databaseConnectTimeoutMs: number;
  databaseInitMaxAttempts: number;
  databaseInitRetryDelayMs: number;
  dataFile: string;
  sourceUrls: string[];
  nodeEnv: string;
}

const defaultSourceUrls = [
  "https://service.taipower.com.tw/data/opendata/apply/file/d006020/001.json",
  "https://www.taipower.com.tw/d006/loadGraph/loadGraph/data/loadpara.json",
  "https://www.taipower.com.tw/2289/2363/2367/2368/10266/normalPost",
  "https://www.taipower.com.tw/2289/2363/2367/2368/10265/normalPost"
];

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  const urls = value
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return urls.length > 0 ? urls : fallback;
}

function firstEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function loadConfig(): AppConfig {
  const databaseUrl = firstEnv("DATABASE_URL", "POSTGRES_URI", "POSTGRES_CONNECTION_STRING");
  const databaseInitMaxAttempts = numberFromEnv("DATABASE_INIT_MAX_ATTEMPTS", databaseUrl ? 3 : 1);
  return {
    port: numberFromEnv("PORT", 3000),
    collectIntervalMs: numberFromEnv("COLLECT_INTERVAL_MS", 10 * 60 * 1000),
    databaseUrl,
    databaseSsl: process.env.DATABASE_SSL === "true" || Boolean(databaseUrl?.includes("sslmode=require")),
    databaseConnectTimeoutMs: numberFromEnv("DATABASE_CONNECT_TIMEOUT_MS", 3000),
    databaseInitMaxAttempts,
    databaseInitRetryDelayMs: numberFromEnv("DATABASE_INIT_RETRY_DELAY_MS", 1000),
    dataFile: process.env.DATA_FILE?.trim() || "data/reserve-readings.json",
    sourceUrls: listFromEnv("TAIPOWER_SOURCE_URLS", defaultSourceUrls),
    nodeEnv: process.env.NODE_ENV?.trim() || "development"
  };
}
