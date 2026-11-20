export {};

interface ReserveReading {
  observedAt: string;
  reserveMw: number | null;
  reserveRate: number | null;
  sourceUrl: string;
  status: "ok" | "error";
  message: string | null;
  raw: unknown;
  createdAt: string;
}

interface TodayResponse {
  date: string;
  timezone: "Asia/Taipei";
  points: ReserveReading[];
  summary: {
    count: number;
    minRate: number | null;
    maxRate: number | null;
    avgRate: number | null;
  };
  lastFetch: ReserveReading | null;
}

interface DatesResponse {
  month: string;
  timezone: "Asia/Taipei";
  dates: string[];
}

interface ChartPoint {
  observedAt: string;
  reserveRate: number;
  reserveMw: number | null;
  loadMw: number | null;
  supplyMw: number | null;
}

const timeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const fullFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const els = {
  canvas: document.querySelector<HTMLCanvasElement>("#reserve-chart"),
  tooltip: document.querySelector<HTMLElement>("#chart-tooltip"),
  current: document.querySelector<HTMLElement>("#current-rate"),
  high: document.querySelector<HTMLElement>("#high-rate"),
  low: document.querySelector<HTMLElement>("#low-rate"),
  avg: document.querySelector<HTMLElement>("#avg-rate"),
  count: document.querySelector<HTMLElement>("#point-count"),
  updated: document.querySelector<HTMLElement>("#updated-at"),
  loadMw: document.querySelector<HTMLElement>("#load-mw"),
  supplyMw: document.querySelector<HTMLElement>("#supply-mw"),
  reserveMw: document.querySelector<HTMLElement>("#reserve-mw"),
  statusPill: document.querySelector<HTMLElement>("#status-pill"),
  status: document.querySelector<HTMLElement>("#fetch-status"),
  empty: document.querySelector<HTMLElement>("#empty-state"),
  dateControl: document.querySelector<HTMLElement>("#date-control"),
  dateButton: document.querySelector<HTMLButtonElement>("#date-button"),
  calendarPopover: document.querySelector<HTMLElement>("#calendar-popover"),
  calendarTitle: document.querySelector<HTMLElement>("#calendar-title"),
  calendarPrev: document.querySelector<HTMLButtonElement>("#calendar-prev"),
  calendarNext: document.querySelector<HTMLButtonElement>("#calendar-next"),
  calendarGrid: document.querySelector<HTMLElement>("#calendar-grid"),
  refresh: document.querySelector<HTMLButtonElement>("#refresh-now"),
  heroCard: document.querySelector<HTMLElement>("#hero-card"),
  rateLight: document.querySelector<HTMLElement>("#rate-light"),
  rateDelta: document.querySelector<HTMLElement>("#rate-delta"),
  gaugeMarker: document.querySelector<HTMLElement>("#rate-gauge-marker")
};

interface ChartLayout {
  left: number;
  right: number;
  xMin: number;
  xMax: number;
}

const chartState: {
  points: ChartPoint[];
  hoverIndex: number | null;
  layout: ChartLayout | null;
  lastFetchStatus: "ok" | "error" | "neutral";
  selectedDate: string;
  calendarMonth: string;
  availableDates: Set<string>;
} = {
  points: [],
  hoverIndex: null,
  layout: null,
  lastFetchStatus: "neutral",
  selectedDate: initialDate(),
  calendarMonth: initialDate().slice(0, 7),
  availableDates: new Set()
};

els.refresh?.addEventListener("click", () => {
  void loadAndRender();
});

els.dateButton?.addEventListener("click", () => {
  void toggleCalendar();
});

els.calendarPrev?.addEventListener("click", () => {
  chartState.calendarMonth = shiftMonth(chartState.calendarMonth, -1);
  void renderCalendar();
});

els.calendarNext?.addEventListener("click", () => {
  chartState.calendarMonth = shiftMonth(chartState.calendarMonth, 1);
  void renderCalendar();
});

document.addEventListener("click", (event) => {
  if (!els.dateControl || !els.calendarPopover || !els.dateButton) return;
  if (event.target instanceof Node && els.dateControl.contains(event.target)) return;
  closeCalendar();
});

window.addEventListener("resize", () => {
  drawChart();
});

els.canvas?.addEventListener("pointermove", (event) => {
  if (!els.canvas || chartState.points.length === 0 || !chartState.layout) return;
  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const index = nearestIndexByTime(x, chartState.layout, chartState.points);
  if (index === chartState.hoverIndex) return;
  chartState.hoverIndex = index;
  drawChart();
});

els.canvas?.addEventListener("pointerleave", () => {
  chartState.hoverIndex = null;
  if (els.tooltip) els.tooltip.hidden = true;
  drawChart();
});

updateDateButton();
void loadAndRender();
void renderCalendar();
setInterval(() => {
  if (chartState.selectedDate === taipeiDateKey(new Date())) {
    void loadAndRender(false);
    void renderCalendar();
  }
}, 60 * 1000);

async function loadAndRender(showLoading = true): Promise<void> {
  if (showLoading) setStatus("讀取中", "neutral");
  try {
    const response = await fetch(`/api/today?date=${encodeURIComponent(chartState.selectedDate)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as TodayResponse;
    const points = normalizePoints(data.points);
    chartState.points = points;
    renderStats(data, points);
    renderStatus(data);
    drawChart();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function loadAvailableDates(month: string): Promise<Set<string>> {
  const response = await fetch(`/api/dates?month=${encodeURIComponent(month)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as DatesResponse;
  return new Set(data.dates);
}

async function renderCalendar(): Promise<void> {
  if (!els.calendarGrid || !els.calendarTitle) return;
  try {
    chartState.availableDates = await loadAvailableDates(chartState.calendarMonth);
  } catch {
    chartState.availableDates = new Set([chartState.selectedDate]);
  }

  const [year, month] = chartState.calendarMonth.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leading = firstDay.getDay();
  els.calendarTitle.textContent = `${year} 年 ${String(month).padStart(2, "0")} 月`;
  els.calendarGrid.innerHTML = "";

  for (let i = 0; i < leading; i += 1) {
    const filler = document.createElement("span");
    filler.className = "calendar-day outside";
    els.calendarGrid.append(filler);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasData = chartState.availableDates.has(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.textContent = String(day);
    button.disabled = !hasData;
    button.dataset.hasData = hasData ? "true" : "false";
    if (hasData && date === chartState.selectedDate) button.dataset.selected = "true";
    if (date === taipeiDateKey(new Date())) button.dataset.today = "true";
    button.addEventListener("click", () => {
      if (!hasData) return;
      chartState.selectedDate = date;
      chartState.calendarMonth = date.slice(0, 7);
      updateDateButton();
      closeCalendar();
      void loadAndRender();
    });
    els.calendarGrid.append(button);
  }
}

function toggleCalendar(): void {
  if (!els.calendarPopover || !els.dateButton) return;
  const isOpen = !els.calendarPopover.hidden;
  if (isOpen) {
    closeCalendar();
    return;
  }
  chartState.calendarMonth = chartState.selectedDate.slice(0, 7);
  els.calendarPopover.hidden = false;
  els.dateButton.setAttribute("aria-expanded", "true");
  void renderCalendar();
}

function closeCalendar(): void {
  if (els.calendarPopover) els.calendarPopover.hidden = true;
  els.dateButton?.setAttribute("aria-expanded", "false");
}

function updateDateButton(): void {
  if (els.dateButton) {
    els.dateButton.textContent = chartState.selectedDate.replaceAll("-", "/");
  }
  syncDateToUrl();
}

/** 網址帶 ?date=YYYY-MM-DD 時直接顯示那一天（偏低紀錄頁會連過來） */
function initialDate(): string {
  const today = taipeiDateKey(new Date());
  const param = new URLSearchParams(location.search).get("date");
  return param && /^\d{4}-\d{2}-\d{2}$/.test(param) && param <= today ? param : today;
}

/** 選的日期寫回網址，方便分享；今天就用乾淨的網址 */
function syncDateToUrl(): void {
  const url = new URL(location.href);
  if (chartState.selectedDate === taipeiDateKey(new Date())) url.searchParams.delete("date");
  else url.searchParams.set("date", chartState.selectedDate);
  if (url.href !== location.href) history.replaceState(null, "", url);
}

function shiftMonth(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function normalizePoints(points: ReserveReading[]): ChartPoint[] {
  return points
    .filter((point): point is ReserveReading & { reserveRate: number } => point.status === "ok" && typeof point.reserveRate === "number")
    .map((point) => {
      const candidate = extractCandidate(point.raw);
      const currentLoadMw = toNumber(candidate?.curr_load);
      const peakLoadMw = toNumber(candidate?.fore_peak_dema_load);
      const loadMw = currentLoadMw ?? peakLoadMw;
      const currentSupplyMw = toNumber(candidate?.real_hr_maxi_sply_capacity);
      const peakSupplyMw = toNumber(candidate?.fore_maxi_sply_capacity);
      const supplyMw = currentSupplyMw ?? peakSupplyMw;
      const instantReserveRate =
        currentLoadMw !== null && currentSupplyMw !== null && currentSupplyMw > 0
          ? ((currentSupplyMw - currentLoadMw) / currentSupplyMw) * 100
          : null;
      const instantReserveMw =
        currentLoadMw !== null && currentSupplyMw !== null
          ? roundTo(Math.max(0, (currentSupplyMw - currentLoadMw) * 10), 3)
          : null;
      return {
        observedAt: point.observedAt,
        reserveRate: instantReserveRate ?? point.reserveRate,
        reserveMw: instantReserveMw ?? point.reserveMw,
        loadMw: loadMw === null ? null : loadMw * 10,
        supplyMw: supplyMw === null ? null : supplyMw * 10
      };
    });
}

function extractCandidate(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const candidate = source.candidate;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function renderStats(data: TodayResponse, points: ChartPoint[]): void {
  const latest = points.at(-1) ?? null;
  const summary = summarizePoints(points);
  setText(els.current, latest ? `${latest.reserveRate.toFixed(2)}%` : "--");
  setText(els.high, formatRate(summary.maxRate));
  setText(els.low, formatRate(summary.minRate));
  setText(els.avg, formatRate(summary.avgRate));
  setText(els.count, `${summary.count}`);
  setText(els.updated, latest ? fullFormatter.format(new Date(latest.observedAt)) : "--");
  setMw(els.reserveMw, latest?.reserveMw ?? null);
  setMw(els.loadMw, latest?.loadMw ?? null);
  setMw(els.supplyMw, latest?.supplyMw ?? null);
  renderLight(latest, points.at(-2) ?? null);
  if (els.empty) els.empty.hidden = points.length > 0;
}

const GAUGE_MAX = 40;

function lightFor(rate: number): { tone: "green" | "yellow" | "orange"; text: string } {
  if (rate >= 10) return { tone: "green", text: "供電充裕" };
  if (rate >= 6) return { tone: "yellow", text: "供電吃緊" };
  return { tone: "orange", text: "供電警戒" };
}

function renderLight(latest: ChartPoint | null, previous: ChartPoint | null): void {
  if (!latest) {
    if (els.heroCard) els.heroCard.dataset.tone = "neutral";
    setText(els.rateLight, "--");
    setText(els.rateDelta, "");
    if (els.gaugeMarker) els.gaugeMarker.style.left = "0%";
    return;
  }

  const light = lightFor(latest.reserveRate);
  if (els.heroCard) els.heroCard.dataset.tone = light.tone;
  setText(els.rateLight, light.text);

  if (els.gaugeMarker) {
    const ratio = Math.max(0, Math.min(1, latest.reserveRate / GAUGE_MAX));
    els.gaugeMarker.style.left = `${ratio * 100}%`;
  }

  if (els.rateDelta) {
    if (previous) {
      const diff = latest.reserveRate - previous.reserveRate;
      const dir = Math.abs(diff) < 0.005 ? "flat" : diff > 0 ? "up" : "down";
      const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
      els.rateDelta.textContent = `${arrow} ${Math.abs(diff).toFixed(2)} 較前一筆`;
      els.rateDelta.dataset.dir = dir;
    } else {
      els.rateDelta.textContent = "";
    }
  }
}

function setMw(element: HTMLElement | null, value: number | null): void {
  if (!element) return;
  if (value == null) {
    element.textContent = "--";
    return;
  }
  element.textContent = Math.round(value).toLocaleString("en-US");
  const unit = document.createElement("small");
  unit.textContent = "MW";
  element.append(unit);
}

function summarizePoints(points: ChartPoint[]): TodayResponse["summary"] {
  if (points.length === 0) {
    return { count: 0, minRate: null, maxRate: null, avgRate: null };
  }

  const values = points.map((point) => point.reserveRate);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    minRate: Math.min(...values),
    maxRate: Math.max(...values),
    avgRate: total / values.length
  };
}

function renderStatus(data: TodayResponse): void {
  const fetch = data.lastFetch;
  if (!fetch) {
    setStatus("尚未抓取資料", "neutral");
    return;
  }

  const time = fullFormatter.format(new Date(fetch.createdAt));
  const shortTime = timeFormatter.format(new Date(fetch.createdAt));
  if (fetch.status === "ok") {
    setStatus(`正常，最近抓取 ${time}`, "ok", `資料正常 · ${shortTime}`);
  } else {
    setStatus(`抓取失敗，${fetch.message ?? "原因不明"}，最近嘗試 ${time}`, "error", `抓取失敗 · ${shortTime}`);
  }
}

function taipeiDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function setStatus(message: string, tone: "ok" | "error" | "neutral", short = message): void {
  chartState.lastFetchStatus = tone;
  if (els.statusPill) {
    els.statusPill.textContent = short;
    els.statusPill.title = message;
    els.statusPill.dataset.tone = tone;
  }
  if (els.status) {
    els.status.textContent = message;
  }
}

const COLORS = {
  rate: "#3ed1f0",
  load: "#ff8a65",
  supply: "#a7a3ff",
  reserve: "#94a3c4",
  warn: "#fbbf24",
  grid: "rgba(148, 163, 214, 0.11)",
  axis: "#8088a6",
  font: "-apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC', sans-serif",
  mono: "'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace"
};

const HOUR = 3_600_000;
const GAP_BREAK_MS = 25 * 60_000;

type Padding = { top: number; right: number; bottom: number; left: number };

function drawChart(): void {
  const canvas = els.canvas;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(260, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);

  const points = chartState.points;
  if (points.length === 0) {
    chartState.layout = null;
    if (els.tooltip) els.tooltip.hidden = true;
    return;
  }

  const compact = width < 560;
  const padding: Padding = compact
    ? { top: 24, right: 12, bottom: 30, left: 44 }
    : { top: 26, right: 16, bottom: 32, left: 56 };
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotWidth = plotRight - plotLeft;
  const panelGap = compact ? 34 : 38;
  const usable = height - padding.top - padding.bottom - panelGap;

  // 上區：供電餘裕率（%）；下區：即時負載／供電能力（MW）
  const rateTop = padding.top;
  const rateBottom = rateTop + usable * 0.5;
  const mwTop = rateBottom + panelGap;
  const mwBottom = height - padding.bottom;

  // X：固定顯示選定日期的 00:00–24:00（台北時間）
  const xMin = Date.parse(`${chartState.selectedDate}T00:00:00+08:00`);
  const xMax = xMin + 24 * HOUR;
  chartState.layout = { left: plotLeft, right: plotRight, xMin, xMax };
  const toX = (iso: string) => plotLeft + ((new Date(iso).getTime() - xMin) / (xMax - xMin)) * plotWidth;

  // 上區刻度：餘裕率取整
  const maxRate = Math.max(...points.map((point) => point.reserveRate));
  const rateStep = maxRate > 60 ? 20 : 10;
  const rateTicks = Math.max(2, Math.ceil((maxRate + 2) / rateStep));
  const rateMax = rateTicks * rateStep;
  const toRateY = (value: number) => rateBottom - (value / rateMax) * (rateBottom - rateTop);

  // 下區刻度：MW 取整
  const mwValues = points
    .flatMap((point) => [point.loadMw, point.supplyMw])
    .filter((value): value is number => typeof value === "number");
  const mwLow = mwValues.length ? Math.min(...mwValues) : 0;
  const mwHigh = mwValues.length ? Math.max(...mwValues) : 1;
  const mwTicks = 4;
  const mwStep = niceStep((mwHigh * 1.03 - mwLow * 0.95) / mwTicks);
  const mwMin = Math.max(0, Math.floor((mwLow * 0.97) / mwStep) * mwStep);
  const mwMax = Math.max(mwMin + mwStep * mwTicks, Math.ceil((mwHigh * 1.02) / mwStep) * mwStep);
  const mwTickCount = Math.round((mwMax - mwMin) / mwStep);
  const toMwY = (value: number) => mwBottom - ((value - mwMin) / (mwMax - mwMin)) * (mwBottom - mwTop);

  // 上區燈號區帶
  const band10 = toRateY(10);
  const band6 = toRateY(6);
  ctx.fillStyle = "rgba(251, 191, 36, 0.06)";
  ctx.fillRect(plotLeft, band10, plotWidth, band6 - band10);
  ctx.fillStyle = "rgba(251, 124, 74, 0.08)";
  ctx.fillRect(plotLeft, band6, plotWidth, rateBottom - band6);

  // 水平格線與刻度
  ctx.font = `11px ${COLORS.mono}`;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= mwTickCount; i += 1) {
    const value = mwMin + mwStep * i;
    const y = toMwY(value);
    ctx.strokeStyle = i === 0 ? "rgba(148, 163, 214, 0.28)" : COLORS.grid;
    line(ctx, plotLeft, y, plotRight, y);
    ctx.fillStyle = COLORS.axis;
    ctx.fillText(formatMwTick(value), plotLeft - 8, y);
  }
  for (let i = 0; i <= rateTicks; i += 1) {
    const y = toRateY(i * rateStep);
    ctx.strokeStyle = i === 0 ? "rgba(148, 163, 214, 0.32)" : COLORS.grid;
    line(ctx, plotLeft, y, plotRight, y);
    ctx.fillStyle = COLORS.axis;
    ctx.fillText(`${i * rateStep}%`, plotLeft - 8, y);
  }

  // 垂直時間格線（兩區共用）與底部時間刻度
  const hourStep = compact ? 6 : 3;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let h = 0; h <= 24; h += hourStep) {
    const x = plotLeft + (h / 24) * plotWidth;
    if (h > 0 && h < 24) {
      ctx.strokeStyle = "rgba(148, 163, 214, 0.07)";
      line(ctx, x, mwTop, x, mwBottom);
      line(ctx, x, rateTop, x, rateBottom);
    }
    ctx.fillStyle = COLORS.axis;
    ctx.textAlign = h === 24 && compact ? "right" : "center";
    ctx.fillText(`${String(h).padStart(2, "0")}:00`, h === 24 && compact ? x + 4 : x, mwBottom + 9);
  }

  // 區塊標題
  ctx.font = `600 11.5px ${COLORS.font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = COLORS.axis;
  ctx.fillText("負載／供電能力（MW）", 2, mwTop - 10);
  ctx.fillStyle = COLORS.rate;
  ctx.fillText("供電餘裕率（%）", 2, rateTop - 10);

  // 10% 黃燈線
  ctx.strokeStyle = "rgba(251, 191, 36, 0.65)";
  ctx.setLineDash([4, 5]);
  line(ctx, plotLeft, band10, plotRight, band10);
  ctx.setLineDash([]);
  ctx.font = `600 11px ${COLORS.font}`;
  ctx.fillStyle = COLORS.warn;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("10% 黃燈線", plotRight - 6, band10 - 4);

  // 下區曲線
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, mwTop - 4, plotWidth, mwBottom - mwTop + 8);
  ctx.clip();
  const supplyPts = points.filter((point) => point.supplyMw != null);
  const loadPts = points.filter((point) => point.loadMw != null);
  const loadFill = ctx.createLinearGradient(0, mwTop, 0, mwBottom);
  loadFill.addColorStop(0, "rgba(255, 138, 101, 0.16)");
  loadFill.addColorStop(1, "rgba(255, 138, 101, 0.01)");
  fillSeries(ctx, loadPts, toX, (point) => toMwY(point.loadMw as number), mwBottom, loadFill);
  strokeSeries(ctx, supplyPts, toX, (point) => toMwY(point.supplyMw as number), COLORS.supply, 2, 0.95);
  strokeSeries(ctx, loadPts, toX, (point) => toMwY(point.loadMw as number), COLORS.load, 2, 0.95);
  ctx.restore();

  // 上區曲線
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, rateTop - 4, plotWidth, rateBottom - rateTop + 4);
  ctx.clip();
  const fill = ctx.createLinearGradient(0, rateTop, 0, rateBottom);
  fill.addColorStop(0, "rgba(62, 209, 240, 0.34)");
  fill.addColorStop(1, "rgba(62, 209, 240, 0.02)");
  fillSeries(ctx, points, toX, (point) => toRateY(point.reserveRate), rateBottom, fill);
  ctx.shadowColor = "rgba(62, 209, 240, 0.55)";
  ctx.shadowBlur = 10;
  strokeSeries(ctx, points, toX, (point) => toRateY(point.reserveRate), COLORS.rate, 2.6, 1);
  ctx.shadowBlur = 0;
  ctx.restore();

  // 最新點或滑鼠所在點
  const hovering = chartState.hoverIndex !== null;
  const activeIndex = chartState.hoverIndex ?? points.length - 1;
  const active = points[activeIndex];
  const activeX = toX(active.observedAt);
  const activeY = toRateY(active.reserveRate);

  if (hovering) {
    ctx.strokeStyle = "rgba(220, 226, 247, 0.35)";
    ctx.setLineDash([3, 4]);
    line(ctx, activeX, rateTop, activeX, mwBottom);
    ctx.setLineDash([]);
  } else {
    ctx.beginPath();
    ctx.arc(activeX, activeY, 9, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(62, 209, 240, 0.18)";
    ctx.fill();
  }
  if (active.supplyMw != null) dot(ctx, activeX, toMwY(active.supplyMw), COLORS.supply, 3.5);
  if (active.loadMw != null) dot(ctx, activeX, toMwY(active.loadMw), COLORS.load, 3.5);
  dot(ctx, activeX, activeY, COLORS.rate, 4.5);

  if (hovering) {
    renderTooltip(active, activeX, (rateBottom + mwTop) / 2, width, rateTop);
  } else if (els.tooltip) {
    els.tooltip.hidden = true;
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#080b16";
  ctx.stroke();
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1000;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
}

function formatMwTick(value: number): string {
  return value >= 10_000 ? `${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : Math.round(value).toLocaleString("en-US");
}

/** 把資料切成連續段落，超過 25 分鐘沒資料就斷線，避免把缺口畫成直線 */
function segments<T extends { observedAt: string }>(points: T[]): T[][] {
  const result: T[][] = [];
  let current: T[] = [];
  let lastTime = -Infinity;
  for (const point of points) {
    const time = new Date(point.observedAt).getTime();
    if (current.length && time - lastTime > GAP_BREAK_MS) {
      result.push(current);
      current = [];
    }
    current.push(point);
    lastTime = time;
  }
  if (current.length) result.push(current);
  return result;
}

/** 以中點二次曲線平滑連線 */
function tracePath<T extends { observedAt: string }>(
  ctx: CanvasRenderingContext2D,
  points: T[],
  toX: (iso: string) => number,
  toY: (point: T) => number,
  move = true
): void {
  points.forEach((point, index) => {
    const x = toX(point.observedAt);
    const y = toY(point);
    if (index === 0) {
      if (move) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      return;
    }
    const prev = points[index - 1];
    const px = toX(prev.observedAt);
    const py = toY(prev);
    const mx = (px + x) / 2;
    const my = (py + y) / 2;
    ctx.quadraticCurveTo(px, py, mx, my);
    if (index === points.length - 1) ctx.lineTo(x, y);
  });
}

function strokeSeries<T extends { observedAt: string }>(
  ctx: CanvasRenderingContext2D,
  points: T[],
  toX: (iso: string) => number,
  toY: (point: T) => number,
  color: string,
  width: number,
  alpha: number
): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const segment of segments(points)) {
    ctx.beginPath();
    tracePath(ctx, segment, toX, toY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function fillSeries<T extends { observedAt: string }>(
  ctx: CanvasRenderingContext2D,
  points: T[],
  toX: (iso: string) => number,
  toY: (point: T) => number,
  baseline: number,
  fill: CanvasGradient
): void {
  ctx.fillStyle = fill;
  for (const segment of segments(points)) {
    ctx.beginPath();
    ctx.moveTo(toX(segment[0].observedAt), baseline);
    tracePath(ctx, segment, toX, toY, false);
    ctx.lineTo(toX(segment.at(-1)!.observedAt), baseline);
    ctx.closePath();
    ctx.fill();
  }
}

function renderTooltip(point: ChartPoint, x: number, y: number, width: number, plotTop: number): void {
  const tooltip = els.tooltip;
  if (!tooltip) return;

  const mw = (value: number | null) => (value != null ? `${Math.round(value).toLocaleString("en-US")} MW` : "--");
  const rows: Array<[string, string, string]> = [
    [COLORS.rate, "供電餘裕率", `${point.reserveRate.toFixed(2)}%`],
    [COLORS.load, "即時負載", mw(point.loadMw)],
    [COLORS.supply, "供電能力", mw(point.supplyMw)],
    [COLORS.reserve, "備轉容量", mw(point.reserveMw)]
  ];

  tooltip.hidden = false;
  tooltip.innerHTML =
    `<div class="tt-time">${timeFormatter.format(new Date(point.observedAt))}</div>` +
    rows.map(([color, label, value]) => `<div class="tt-row"><i style="background:${color}"></i><span>${label}</span><b>${value}</b></div>`).join("");

  const box = tooltip.getBoundingClientRect();
  const flip = x + 16 + box.width > width - 8;
  const left = flip ? x - 16 - box.width : x + 16;
  const top = Math.max(plotTop, Math.min(y - box.height / 2, tooltip.parentElement!.clientHeight - box.height - 8));
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${top}px`;
}

function nearestIndexByTime(x: number, layout: ChartLayout, points: ChartPoint[]): number {
  const ratio = (x - layout.left) / Math.max(1, layout.right - layout.left);
  const target = layout.xMin + ratio * (layout.xMax - layout.xMin);
  let best = 0;
  let bestDiff = Infinity;
  points.forEach((point, index) => {
    const diff = Math.abs(new Date(point.observedAt).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = index;
    }
  });
  return best;
}

function formatRate(value: number | null): string {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "--";
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}

