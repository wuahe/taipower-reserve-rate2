import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { taipeiDayRange } from "./time.js";
import type { ReserveReading } from "./types.js";

export interface ReadingStore {
  init(): Promise<void>;
  upsert(reading: ReserveReading): Promise<void>;
  latestSuccess(): Promise<ReserveReading | null>;
  lastFetch(): Promise<ReserveReading | null>;
  today(date?: Date): Promise<ReserveReading[]>;
}

export class FileStore implements ReadingStore {
  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, "[]\n", "utf8");
    }
  }

  async upsert(reading: ReserveReading): Promise<void> {
    const readings = await this.readAll();
    const index = readings.findIndex((item) => item.observedAt === reading.observedAt);
    if (index >= 0) {
      readings[index] = reading;
    } else {
      readings.push(reading);
    }
    readings.sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
    await writeFile(this.filePath, `${JSON.stringify(readings, null, 2)}\n`, "utf8");
  }

  async latestSuccess(): Promise<ReserveReading | null> {
    const readings = await this.readAll();
    return readings
      .filter((item) => item.status === "ok" && typeof item.reserveRate === "number")
      .sort(descObservedAt)[0] ?? null;
  }

  async lastFetch(): Promise<ReserveReading | null> {
    const readings = await this.readAll();
    return readings.sort(descCreatedAt)[0] ?? null;
  }

  async today(date = new Date()): Promise<ReserveReading[]> {
    const { start, end } = taipeiDayRange(date);
    const readings = await this.readAll();
    return readings.filter((item) => {
      const observedAt = new Date(item.observedAt);
      return observedAt >= start && observedAt < end;
    });
  }

  private async readAll(): Promise<ReserveReading[]> {
    const text = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(text) as ReserveReading[];
    return Array.isArray(parsed) ? parsed : [];
  }
}

export class PostgresStore implements ReadingStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string, ssl: boolean, connectTimeoutMs: number) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: connectTimeoutMs,
      ssl: ssl ? { rejectUnauthorized: false } : false
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS reserve_readings (
        observed_at timestamptz PRIMARY KEY,
        reserve_mw numeric,
        reserve_rate numeric,
        source_url text NOT NULL,
        status text NOT NULL,
        message text,
        raw jsonb,
        created_at timestamptz NOT NULL
      );
    `);
    await this.pool.query("CREATE INDEX IF NOT EXISTS reserve_readings_created_at_idx ON reserve_readings (created_at DESC);");
  }

  async upsert(reading: ReserveReading): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO reserve_readings (
          observed_at, reserve_mw, reserve_rate, source_url, status, message, raw, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (observed_at) DO UPDATE SET
          reserve_mw = EXCLUDED.reserve_mw,
          reserve_rate = EXCLUDED.reserve_rate,
          source_url = EXCLUDED.source_url,
          status = EXCLUDED.status,
          message = EXCLUDED.message,
          raw = EXCLUDED.raw,
          created_at = EXCLUDED.created_at;
      `,
      [
        reading.observedAt,
        reading.reserveMw,
        reading.reserveRate,
        reading.sourceUrl,
        reading.status,
        reading.message,
        JSON.stringify(reading.raw ?? null),
        reading.createdAt
      ]
    );
  }

  async latestSuccess(): Promise<ReserveReading | null> {
    const result = await this.pool.query(
      `
        SELECT * FROM reserve_readings
        WHERE status = 'ok' AND reserve_rate IS NOT NULL
        ORDER BY observed_at DESC
        LIMIT 1;
      `
    );
    return result.rows[0] ? rowToReading(result.rows[0]) : null;
  }

  async lastFetch(): Promise<ReserveReading | null> {
    const result = await this.pool.query("SELECT * FROM reserve_readings ORDER BY created_at DESC LIMIT 1;");
    return result.rows[0] ? rowToReading(result.rows[0]) : null;
  }

  async today(date = new Date()): Promise<ReserveReading[]> {
    const { start, end } = taipeiDayRange(date);
    const result = await this.pool.query(
      `
        SELECT * FROM reserve_readings
        WHERE observed_at >= $1 AND observed_at < $2
        ORDER BY observed_at ASC;
      `,
      [start.toISOString(), end.toISOString()]
    );
    return result.rows.map(rowToReading);
  }
}

export function createStore(
  databaseUrl: string | null,
  dataFile: string,
  databaseSsl = false,
  databaseConnectTimeoutMs = 3000
): ReadingStore {
  return databaseUrl
    ? new PostgresStore(databaseUrl, databaseSsl, databaseConnectTimeoutMs)
    : new FileStore(dataFile);
}

function descObservedAt(a: ReserveReading, b: ReserveReading): number {
  return new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime();
}

function descCreatedAt(a: ReserveReading, b: ReserveReading): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function rowToReading(row: Record<string, unknown>): ReserveReading {
  return {
    observedAt: new Date(row.observed_at as string).toISOString(),
    reserveMw: row.reserve_mw === null ? null : Number(row.reserve_mw),
    reserveRate: row.reserve_rate === null ? null : Number(row.reserve_rate),
    sourceUrl: String(row.source_url),
    status: row.status === "ok" ? "ok" : "error",
    message: row.message === null ? null : String(row.message),
    raw: row.raw ?? null,
    createdAt: new Date(row.created_at as string).toISOString()
  };
}
