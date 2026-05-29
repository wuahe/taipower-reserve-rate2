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

export interface LatestResponse {
  latest: ReserveReading | null;
  lastFetch: ReserveReading | null;
  generatedAt: string;
}
