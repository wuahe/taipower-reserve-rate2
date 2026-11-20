export type FetchStatus = "ok" | "error";

export interface ReserveReading {
  observedAt: string;
  reserveMw: number | null;
  reserveRate: number | null;
  sourceUrl: string;
  status: FetchStatus;
  message: string | null;
  raw: unknown;
  createdAt: string;
}

export interface ReserveSummary {
  count: number;
  minRate: number | null;
  maxRate: number | null;
  avgRate: number | null;
}

export interface TodayResponse {
  date: string;
  timezone: "Asia/Taipei";
  points: ReserveReading[];
  summary: ReserveSummary;
  lastFetch: ReserveReading | null;
}

export interface LowReserveEpisode {
  /** 台北日期（YYYY-MM-DD），以這段開始的時間為準 */
  date: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  pointCount: number;
  minRate: number;
  minAt: string;
  minReserveMw: number | null;
}

export interface LowReserveResponse {
  threshold: number;
  days: number;
  from: string;
  to: string;
  timezone: "Asia/Taipei";
  dayCount: number;
  episodes: LowReserveEpisode[];
}

export interface DatesResponse {
  month: string;
  timezone: "Asia/Taipei";
  dates: string[];
}

export interface LatestResponse {
  latest: ReserveReading | null;
  lastFetch: ReserveReading | null;
  generatedAt: string;
}

export interface StatusResponse {
  ok: true;
  generatedAt: string;
  timezone: "Asia/Taipei";
  storage: {
    type: "postgres" | "file";
    persistent: boolean;
    databaseConfigured: boolean;
    databaseConnectionSource: string | null;
    fallbackReason: string | null;
  };
  collection: {
    intervalMs: number;
    intervalMinutes: number;
    sourceCount: number;
  };
  today: {
    date: string;
    pointCount: number;
    lastObservedAt: string | null;
  };
  lastFetch: {
    status: FetchStatus;
    observedAt: string;
    createdAt: string;
    sourceUrl: string;
    message: string | null;
  } | null;
}
