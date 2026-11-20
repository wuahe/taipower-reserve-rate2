export {};

// 偏低紀錄頁（/low）：列出供電餘裕率低於門檻的時段，每一列連回首頁那一天的圖表

interface LowReserveEpisode {
  date: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  pointCount: number;
  minRate: number;
  minAt: string;
  minReserveMw: number | null;
}

interface LowReserveResponse {
  threshold: number;
  days: number;
  from: string;
  to: string;
  dayCount: number;
  episodes: LowReserveEpisode[];
}

const THRESHOLDS = ["6", "10", "15"];
const PERIODS = ["7", "30", "90", "366"];
const PAGE_SIZE = 30;

const timeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
const weekdayFormatter = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", weekday: "short" });

const els = {
  summary: document.querySelector<HTMLElement>("#low-summary"),
  list: document.querySelector<HTMLElement>("#low-list"),
  threshold: document.querySelector<HTMLSelectElement>("#low-threshold"),
  days: document.querySelector<HTMLSelectElement>("#low-days"),
  refresh: document.querySelector<HTMLButtonElement>("#refresh-now")
};

const state: { episodes: LowReserveEpisode[]; expanded: boolean; requestId: number } = {
  episodes: [],
  expanded: false,
  requestId: 0
};

// 網址上的查詢條件（/low?threshold=10&days=90）優先，方便分享
const params = new URLSearchParams(location.search);
if (els.threshold && THRESHOLDS.includes(params.get("threshold") ?? "")) els.threshold.value = params.get("threshold")!;
if (els.days && PERIODS.includes(params.get("days") ?? "")) els.days.value = params.get("days")!;

els.threshold?.addEventListener("change", () => void load());
els.days?.addEventListener("change", () => void load());
els.refresh?.addEventListener("click", () => void load());
void load();

async function load(): Promise<void> {
  if (!els.list || !els.summary) return;
  const threshold = els.threshold?.value ?? "10";
  const days = els.days?.value ?? "30";
  syncQueryToUrl(threshold, days);
  const requestId = ++state.requestId;
  els.summary.textContent = "讀取中";

  try {
    const response = await fetch(`/api/low?threshold=${encodeURIComponent(threshold)}&days=${encodeURIComponent(days)}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as LowReserveResponse;
    if (requestId !== state.requestId) return;
    state.episodes = data.episodes;
    state.expanded = false;
    renderSummary(data);
    renderList();
  } catch (error) {
    if (requestId !== state.requestId) return;
    els.summary.textContent = `讀取失敗：${error instanceof Error ? error.message : String(error)}`;
    els.list.replaceChildren();
  }
}

function syncQueryToUrl(threshold: string, days: string): void {
  const url = new URL(location.href);
  url.searchParams.set("threshold", threshold);
  url.searchParams.set("days", days);
  if (url.href !== location.href) history.replaceState(null, "", url);
}

function renderSummary(data: LowReserveResponse): void {
  const summary = els.summary;
  if (!summary) return;
  const period = data.days >= 366 ? "所有資料" : `最近 ${data.days} 天`;
  summary.replaceChildren();

  if (data.episodes.length === 0) {
    summary.textContent = `${period}沒有低於 ${data.threshold}% 的時段`;
    return;
  }

  const lowest = data.episodes.reduce((min, episode) => (episode.minRate < min.minRate ? episode : min));
  summary.append(
    `${period}有 `,
    strong(`${data.dayCount}`),
    " 天、",
    strong(`${data.episodes.length}`),
    ` 段低於 ${data.threshold}%，最低 `,
    strong(`${lowest.minRate.toFixed(2)}%`),
    `（${shortDate(lowest.date)} ${timeFormatter.format(new Date(lowest.minAt))}）`
  );
}

function renderList(): void {
  const list = els.list;
  if (!list) return;
  list.replaceChildren();

  if (state.episodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "low-empty";
    empty.textContent = "這段期間都在門檻以上";
    list.append(empty);
    return;
  }

  const visible = state.expanded ? state.episodes : state.episodes.slice(0, PAGE_SIZE);
  for (const episode of visible) list.append(row(episode));

  const hidden = state.episodes.length - visible.length;
  if (hidden > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "low-more";
    more.textContent = `顯示其餘 ${hidden} 段`;
    more.addEventListener("click", () => {
      state.expanded = true;
      renderList();
    });
    list.append(more);
  }
}

function row(episode: LowReserveEpisode): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "low-row";
  link.href = `/?date=${episode.date}`;
  link.title = "查看這一天的全日曲線";
  link.setAttribute("role", "row");

  const date = cell("c-date");
  const dateNum = document.createElement("span");
  dateNum.className = "num";
  dateNum.textContent = shortDate(episode.date);
  const weekday = document.createElement("span");
  weekday.className = "weekday";
  weekday.textContent = weekdayFormatter.format(new Date(`${episode.date}T12:00:00+08:00`));
  date.append(dateNum, weekday);

  const start = timeFormatter.format(new Date(episode.startAt));
  const end = timeFormatter.format(new Date(new Date(episode.endAt).getTime() + 10 * 60_000));
  const time = cell("c-time num");
  time.textContent = episode.pointCount === 1 ? start : `${start}–${end}`;

  const duration = cell("c-dur");
  duration.textContent = formatDuration(episode.durationMinutes);

  const min = cell("c-min");
  const minWrap = document.createElement("span");
  minWrap.className = "min";
  minWrap.dataset.tone = episode.minRate < 6 ? "orange" : episode.minRate < 10 ? "yellow" : "green";
  const minValue = document.createElement("b");
  minValue.textContent = `${episode.minRate.toFixed(2)}%`;
  const minTime = document.createElement("small");
  minTime.textContent = timeFormatter.format(new Date(episode.minAt));
  minWrap.append(minValue, minTime);
  min.append(minWrap);

  link.append(date, time, duration, min);
  return link;
}

function cell(className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("role", "cell");
  return span;
}

function strong(text: string): HTMLElement {
  const element = document.createElement("strong");
  element.textContent = text;
  return element;
}

function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${month}/${day}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小時` : `${hours} 小時 ${rest} 分`;
}
