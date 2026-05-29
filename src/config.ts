export interface AppConfig {
  port: number;
  collectIntervalMs: number;
  databaseUrl: string | null;
  databaseConnectionSource: string | null;
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
  return firstNamedEnv(...names)?.value ?? null;
}

function firstNamedEnv(...names: string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

function buildPostgresUrlFromParts(): { source: string; url: string } | null {
  const host = firstNamedEnv("POSTGRESQL_HOST", "POSTGRES_HOST");
  const username = firstNamedEnv("POSTGRESQL_USERNAME", "POSTGRES_USERNAME", "POSTGRES_USER", "PGUSER");
  const password = firstNamedEnv("POSTGRESQL_PASSWORD", "POSTGRES_PASSWORD", "PGPASSWORD");
  const database = firstNamedEnv("POSTGRESQL_DATABASE", "POSTGRES_DATABASE", "POSTGRES_DB", "PGDATABASE");

  if (!host || !username || !password || !database) return null;

  const port = firstEnv("POSTGRESQL_PORT", "POSTGRES_PORT", "PGPORT") ?? "5432";
  const url = `postgresql://${encodeURIComponent(username.value)}:${encodeURIComponent(password.value)}@${host.value}:${port}/${encodeURIComponent(database.value)}`;
  return {
    source: `${host.name}+${username.name}+${password.name}+${database.name}`,
    url
  };
}

function resolveDatabaseUrl(): { source: string | null; url: string | null } {
  const componentUrl = buildPostgresUrlFromParts();
  if (componentUrl) {
    return componentUrl;
  }

  const generatedUrl = firstNamedEnv("DATABASE_URL", "POSTGRES_URI", "POSTGRES_CONNECTION_STRING");
  return {
    source: generatedUrl?.name ?? null,
    url: generatedUrl?.value ?? null
  };
}

export function loadConfig(): AppConfig {
  const database = resolveDatabaseUrl();
  const databaseUrl = database.url;
  const databaseInitMaxAttempts = numberFromEnv("DATABASE_INIT_MAX_ATTEMPTS", databaseUrl ? 3 : 1);
  return {
    port: numberFromEnv("PORT", 3000),
    collectIntervalMs: numberFromEnv("COLLECT_INTERVAL_MS", 10 * 60 * 1000),
    databaseUrl,
    databaseConnectionSource: database.source,
    databaseSsl: process.env.DATABASE_SSL === "true" || Boolean(databaseUrl?.includes("sslmode=require")),
    databaseConnectTimeoutMs: numberFromEnv("DATABASE_CONNECT_TIMEOUT_MS", 3000),
    databaseInitMaxAttempts,
    databaseInitRetryDelayMs: numberFromEnv("DATABASE_INIT_RETRY_DELAY_MS", 1000),
    dataFile: process.env.DATA_FILE?.trim() || "data/reserve-readings.json",
    sourceUrls: listFromEnv("TAIPOWER_SOURCE_URLS", defaultSourceUrls),
    nodeEnv: process.env.NODE_ENV?.trim() || "development"
  };
}
