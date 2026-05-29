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
  refresh: document.querySelector<HTMLButtonElement>("#refresh-now")
};

const chartState: {
  points: ChartPoint[];
  hoverIndex: number | null;
  lastFetchStatus: "ok" | "error" | "neutral";
} = {
  points: [],
  hoverIndex: null,
  lastFetchStatus: "neutral"
};

els.refresh?.addEventListener("click", () => {
  void loadAndRender();
});

window.addEventListener("resize", () => {
  drawChart();
});

els.canvas?.addEventListener("mousemove", (event) => {
  if (!els.canvas || chartState.points.length === 0) return;
  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  chartState.hoverIndex = nearestIndexByX(x, rect.width, chartState.points.length);
  drawChart();
});

els.canvas?.addEventListener("mouseleave", () => {
  chartState.hoverIndex = null;
  if (els.tooltip) els.tooltip.hidden = true;
  drawChart();
});

void loadAndRender();
setInterval(() => void loadAndRender(), 60 * 1000);

async function loadAndRender(showLoading = true): Promise<void> {
  if (showLoading) setStatus("讀取中", "neutral");
  try {
    const response = await fetch("/api/today", { cache: "no-store" });
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

function normalizePoints(points: ReserveReading[]): ChartPoint[] {
  return points
    .filter((point): point is ReserveReading & { reserveRate: number } => point.status === "ok" && typeof point.reserveRate === "number")
    .map((point) => {
      const candidate = extractCandidate(point.raw);
      const loadMw = toNumber(candidate?.fore_peak_dema_load);
      const supplyMw = toNumber(candidate?.fore_maxi_sply_capacity);
      return {
        observedAt: point.observedAt,
        reserveRate: point.reserveRate,
        reserveMw: point.reserveMw,
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

function renderStats(data: TodayResponse, points: ChartPoint[]): void {
  const latest = points.at(-1) ?? null;
  setText(els.current, latest ? `${latest.reserveRate.toFixed(2)}%` : "--");
  setText(els.high, formatRate(data.summary.maxRate));
  setText(els.low, formatRate(data.summary.minRate));
  setText(els.avg, formatRate(data.summary.avgRate));
  setText(els.count, `${data.summary.count}`);
  setText(els.updated, latest ? fullFormatter.format(new Date(latest.observedAt)) : "--");
  setText(els.reserveMw, latest?.reserveMw != null ? `${latest.reserveMw.toLocaleString()} MW` : "--");
  setText(els.loadMw, latest?.loadMw != null ? `${Math.round(latest.loadMw).toLocaleString()} MW` : "--");
  setText(els.supplyMw, latest?.supplyMw != null ? `${Math.round(latest.supplyMw).toLocaleString()} MW` : "--");
  if (els.empty) els.empty.hidden = points.length > 0;
}

function renderStatus(data: TodayResponse): void {
  const fetch = data.lastFetch;
  if (!fetch) {
    setStatus("尚未抓取資料", "neutral");
    return;
  }

  const time = fullFormatter.format(new Date(fetch.createdAt));
  if (fetch.status === "ok") {
    setStatus(`正常，最近抓取 ${time}`, "ok");
  } else {
    setStatus(`抓取失敗，${fetch.message ?? "原因不明"}，最近嘗試 ${time}`, "error");
  }
}

function setStatus(message: string, tone: "ok" | "error" | "neutral"): void {
  chartState.lastFetchStatus = tone;
  if (els.statusPill) {
    els.statusPill.textContent = message;
    els.statusPill.dataset.tone = tone;
  }
  if (els.status) {
    els.status.textContent = message;
  }
}

function drawChart(): void {
  const canvas = els.canvas;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(350, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);

  const points = chartState.points;
  drawPanelBackground(ctx, width, height);
  if (points.length === 0) return;

  const padding = { top: 36, right: 84, bottom: 44, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const times = points.map((point) => new Date(point.observedAt).getTime());
  const xMin = times[0];
  const xMax = Math.max(times.at(-1) ?? xMin, xMin + 60_000);

  const rateMin = Math.max(0, Math.floor(Math.min(...points.map((point) => point.reserveRate)) - 2));
  const rateMax = Math.ceil(Math.max(...points.map((point) => point.reserveRate)) + 2);
  const mwValues = points
    .flatMap((point) => [point.loadMw, point.supplyMw])
    .filter((value): value is number => typeof value === "number");
  const mwMin = mwValues.length === 0 ? 0 : Math.floor(Math.min(...mwValues) * 0.9);
  const mwMax = mwValues.length === 0 ? 100 : Math.ceil(Math.max(...mwValues) * 1.1);

  const toX = (iso: string) => padding.left + ((new Date(iso).getTime() - xMin) / (xMax - xMin)) * plotWidth;
  const toRateY = (value: number) => padding.top + (1 - (value - rateMin) / Math.max(1, rateMax - rateMin)) * plotHeight;
  const toMwY = (value: number) => padding.top + (1 - (value - mwMin) / Math.max(1, mwMax - mwMin)) * plotHeight;

  drawAxes(ctx, width, height, padding, rateMin, rateMax, mwMin, mwMax);
  drawThresholdLine(ctx, padding, plotWidth, toRateY(10), "10% 黃燈線");

  drawSeries(
    ctx,
    points,
    toX,
    (point) => toRateY(point.reserveRate),
    "rgba(89, 172, 255, 0.23)",
    "#59acff",
    true
  );

  drawSeries(
    ctx,
    points.filter((point) => point.loadMw != null),
    toX,
    (point) => toMwY(point.loadMw as number),
    null,
    "#4ce38d"
  );

  drawSeries(
    ctx,
    points.filter((point) => point.supplyMw != null),
    toX,
    (point) => toMwY(point.supplyMw as number),
    null,
    "#f3dd61"
  );

  const activeIndex = chartState.hoverIndex ?? points.length - 1;
  const activePoint = points[activeIndex];
  const activeX = toX(activePoint.observedAt);
  const activeY = toRateY(activePoint.reserveRate);

  ctx.strokeStyle = "rgba(201, 223, 247, 0.45)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(activeX, padding.top);
  ctx.lineTo(activeX, height - padding.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(activeX, activeY, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ff9842";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = "#9fb4cf";
  ctx.font = "13px 'SF Pro Display', 'Noto Sans TC', sans-serif";
  ctx.fillText(timeFormatter.format(new Date(points[0].observedAt)), padding.left, height - 14);
  ctx.fillText(timeFormatter.format(new Date(points.at(-1)!.observedAt)), width - padding.right - 42, height - 14);

  renderTooltip(activePoint, activeX, activeY, width, height, padding);
}

function drawPanelBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(23, 43, 66, 0.95)");
  gradient.addColorStop(1, "rgba(15, 31, 50, 0.95)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
  rateMin: number,
  rateMax: number,
  mwMin: number,
  mwMax: number
): void {
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  ctx.strokeStyle = "rgba(114, 145, 177, 0.25)";
  ctx.fillStyle = "#87a1bc";
  ctx.font = "12px 'SF Pro Display', 'Noto Sans TC', sans-serif";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 6; i += 1) {
    const ratio = i / 6;
    const y = padding.top + plotHeight * ratio;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    const rateValue = rateMax - (rateMax - rateMin) * ratio;
    ctx.fillText(`${Math.round(rateValue)}%`, 8, y + 4);

    const mwValue = mwMax - (mwMax - mwMin) * ratio;
    ctx.fillText(Math.round(mwValue).toLocaleString(), width - padding.right + 10, y + 4);
  }

  ctx.strokeStyle = "rgba(170, 197, 222, 0.35)";
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  ctx.fillStyle = "#c5d9ef";
  ctx.font = "600 14px 'SF Pro Display', 'Noto Sans TC', sans-serif";
  ctx.fillText("備轉率 ％", padding.left - 6, padding.top - 12);
  ctx.fillText("MW", width - padding.right + 8, padding.top - 12);
}

function drawThresholdLine(
  ctx: CanvasRenderingContext2D,
  padding: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  y: number,
  label: string
): void {
  ctx.strokeStyle = "rgba(243, 221, 97, 0.85)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(padding.left, y);
  ctx.lineTo(padding.left + plotWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#f3dd61";
  ctx.font = "12px 'SF Pro Display', 'Noto Sans TC', sans-serif";
  ctx.fillText(label, padding.left + plotWidth - 88, y - 6);
}

function drawSeries<T extends { observedAt: string }>(
  ctx: CanvasRenderingContext2D,
  points: T[],
  toX: (iso: string) => number,
  toY: (point: T) => number,
  fill: string | null,
  stroke: string,
  thick = false
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = toX(point.observedAt);
    const y = toY(point);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = stroke;
  ctx.lineWidth = thick ? 3.2 : 2.3;
  ctx.stroke();

  if (!fill) return;
  const firstX = toX(points[0].observedAt);
  const lastX = toX(points.at(-1)!.observedAt);
  const canvas = ctx.canvas;
  const height = canvas.height / (window.devicePixelRatio || 1);

  ctx.lineTo(lastX, height - 44);
  ctx.lineTo(firstX, height - 44);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function renderTooltip(
  point: ChartPoint,
  x: number,
  y: number,
  width: number,
  _height: number,
  padding: { top: number; right: number; bottom: number; left: number }
): void {
  const tooltip = els.tooltip;
  if (!tooltip) return;

  tooltip.hidden = false;
  tooltip.innerHTML = [
    `<div>${timeFormatter.format(new Date(point.observedAt))}</div>`,
    `<div>備轉容量率：${point.reserveRate.toFixed(2)}%</div>`,
    `<div>即時負載：${point.loadMw != null ? Math.round(point.loadMw).toLocaleString() : "--"} MW</div>`,
    `<div>供電能力：${point.supplyMw != null ? Math.round(point.supplyMw).toLocaleString() : "--"} MW</div>`,
    `<div>備轉容量：${point.reserveMw != null ? Math.round(point.reserveMw).toLocaleString() : "--"} MW</div>`
  ].join("");

  const tooltipRect = tooltip.getBoundingClientRect();
  const left = Math.min(width - tooltipRect.width - 8, Math.max(padding.left + 8, x + 12));
  const top = Math.max(padding.top + 10, y - tooltipRect.height - 14);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function nearestIndexByX(x: number, width: number, count: number): number {
  if (count <= 1) return 0;
  const ratio = Math.max(0, Math.min(1, x / Math.max(width, 1)));
  return Math.round(ratio * (count - 1));
}

function formatRate(value: number | null): string {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "--";
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}
