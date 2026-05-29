import type { AppConfig } from "./config.js";
import type { ReadingStore } from "./store.js";
import { fetchTaipowerReserve } from "./taipower.js";
import type { ReserveReading } from "./types.js";

export class Collector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly store: ReadingStore
  ) {}

  start(): void {
    void this.collectOnce();
    this.timer = setInterval(() => {
      void this.collectOnce();
    }, this.config.collectIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async collectOnce(): Promise<ReserveReading | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const reading = await fetchTaipowerReserve(this.config.sourceUrls);
      await this.store.upsert(reading);
      const label = reading.status === "ok" ? `${reading.reserveRate}%` : reading.message;
      console.log(`[collector] ${reading.status} ${reading.observedAt} ${label ?? ""}`);
      return reading;
    } finally {
      this.running = false;
    }
  }
}
