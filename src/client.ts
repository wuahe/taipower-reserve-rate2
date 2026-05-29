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

const formatter = new Intl.DateTimeFormat("zh-TW", {
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
  current: document.querySelector<HTMLElement>("#current-rate"),
  high: document.querySelector<HTMLElement>("#high-rate"),
  low: document.querySelector<HTMLElement>("#low-rate"),
  avg: document.querySelector<HTMLElement>("#avg-rate"),
  count: document.querySelector<HTMLElement>("#point-count"),
  updated: document.querySelector<HTMLElement>("#updated-at"),
  status: document.querySelector<HTMLElement>("#fetch-status"),
  empty: document.querySelector<HTMLElement>("#empty-state"),
  refresh: document.querySelector<HTMLButtonElement>("#refresh-now")
};

els.refresh?.addEventListener("click", () => {
  void loadAndRender();
});

window.addEventListener("resize", () => {
  void loadAndRender(false);
});

void loadAndRender();
setInterval(() => void loadAndRender(), 60 * 1000);

async function loadAndRender(showLoading = true): Promise<void> {
  if (showLoading) setStatus("讀取中", "neutral");
  try {
    const response = await fetch("/api/today", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as TodayResponse;
    renderStats(data);
    drawChart(data.points);
    renderStatus(data);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function renderStats(data: TodayResponse): void {
  const okPoints = data.points.filter(hasRate);
  const latest = okPoints.at(-1) ?? null;
  setText(els.current, latest ? `${latest.reserveRate.toFixed(2)}%` : "--");
  setText(els.high, formatRate(data.summary.maxRate));
  setText(els.low, formatRate(data.summary.minRate));
  setText(els.avg, formatRate(data.summary.avgRate));
  setText(els.count, `${data.summary.count}`);
  setText(els.updated, latest ? fullFormatter.format(new Date(latest.observedAt)) : "--");
  if (els.empty) els.empty.hidden = okPoints.length > 0;
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

function drawChart(points: ReserveReading[]): void {
  const canvas = els.canvas;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(260, Math.floor(rect.height * dpr));

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const padding = { top: 24, right: 24, bottom: 44, left: 54 };
  ctx.clearRect(0, 0, width, height);

  const okPoints = points.filter(hasRate);
  drawGrid(ctx, width, height, padding, okPoints);
  if (okPoints.length === 0) return;

  const xMin = new Date(okPoints[0].observedAt).getTime();
  const xMax = Math.max(new Date(okPoints.at(-1)!.observedAt).getTime(), xMin + 60 * 1000);
  const rates = okPoints.map((point) => point.reserveRate);
  const yMin = Math.max(0, Math.floor(Math.min(...rates) - 1));
  const yMax = Math.ceil(Math.max(...rates) + 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const toX = (iso: string) => padding.left + ((new Date(iso).getTime() - xMin) / (xMax - xMin)) * plotWidth;
  const toY = (rate: number) => padding.top + (1 - (rate - yMin) / Math.max(1, yMax - yMin)) * plotHeight;

  ctx.beginPath();
  okPoints.forEach((point, index) => {
    const x = toX(point.observedAt);
    const y = toY(point.reserveRate);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#116466";
  ctx.lineWidth = 3;
  ctx.stroke();

  okPoints.forEach((point) => {
    const x = toX(point.observedAt);
    const y = toY(point.reserveRate);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#f28c28";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  const last = okPoints.at(-1)!;
  const lastX = toX(last.observedAt);
  const lastY = toY(last.reserveRate);
  ctx.fillStyle = "#222831";
  ctx.font = "600 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`${last.reserveRate.toFixed(2)}%`, Math.min(lastX + 8, width - 76), Math.max(18, lastY - 10));
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
  points: ReserveReading[]
): void {
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  ctx.strokeStyle = "#d8dee2";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#5b6470";
  ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (plotHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.strokeStyle = "#8b949e";
  ctx.stroke();

  if (points.length > 0) {
    const first = points[0];
    const last = points.at(-1)!;
    ctx.fillText(formatter.format(new Date(first.observedAt)), padding.left, height - 16);
    ctx.fillText(formatter.format(new Date(last.observedAt)), width - padding.right - 42, height - 16);
  }
}

function hasRate(point: ReserveReading): point is ReserveReading & { reserveRate: number } {
  return point.status === "ok" && typeof point.reserveRate === "number";
}

function formatRate(value: number | null): string {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "--";
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}

function setStatus(message: string, tone: "ok" | "error" | "neutral"): void {
  if (!els.status) return;
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}
