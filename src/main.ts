import "./style.css";
import {
  ASSETS,
  INITIAL_CASH,
  assetNames,
  sampleMarket,
  aggregate,
  matches,
  buy,
  sell,
  backtest,
  positionSize,
  parseHistory,
  money,
  number,
  escape as esc,
  uid,
  type Asset,
  type Source,
  type Page,
  type Market,
  type Signal,
  type Account,
  type AlertItem,
  type Candle,
  type Strategy,
  type Backtest,
} from "./core.ts";
import { icon, logo } from "./icons.ts";
import {
  renderChart,
  candleTime,
  sparkline,
  equityChart,
  type ChartOptions,
} from "./chart.ts";

const defaultSignals: Signal[] = [
  {
    id: "btc-momentum",
    name: "Bitcoin momentum",
    asset: "BTC",
    direction: "above",
    threshold: 70,
    rsiMax: 80,
    useVwap: true,
    allocation: 1000,
    stopPct: 2,
    enabled: true,
    auto: false,
    fired: false,
  },
  {
    id: "eth-optimism",
    name: "Ethereum sentiment breakout",
    asset: "ETH",
    direction: "above",
    threshold: 75,
    rsiMax: 70,
    useVwap: false,
    allocation: 1000,
    stopPct: 2,
    enabled: true,
    auto: false,
    fired: false,
  },
  {
    id: "sol-caution",
    name: "Solana sentiment reversal",
    asset: "SOL",
    direction: "below",
    threshold: 40,
    rsiMax: 100,
    useVwap: false,
    allocation: 500,
    stopPct: 3,
    enabled: true,
    auto: false,
    fired: false,
  },
];
const freshAccount = (): Account => ({
  cash: INITIAL_CASH,
  positions: [],
  trades: [],
});
const storageKey = "sentra-desk-v1";
interface Saved {
  account: Account;
  liveAccount?: Account;
  signals: Signal[];
  alerts: AlertItem[];
  desktop: boolean;
  bridgeUrl: string;
}
function readSaved(): Partial<Saved> {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) ?? "{}",
    ) as Partial<Saved>;
    for (const key of ["account", "liveAccount"] as const) {
      if (
        saved[key] &&
        (!Number.isFinite(saved[key].cash) ||
          saved[key].cash < 0 ||
          !Array.isArray(saved[key].positions) ||
          !Array.isArray(saved[key].trades) ||
          saved[key].positions.some(
            (p) =>
              !p ||
              !ASSETS.includes(p.asset) ||
              typeof p.id !== "string" ||
              ![p.quantity, p.entry, p.stop, p.time].every(Number.isFinite) ||
              p.quantity <= 0 ||
              p.entry <= 0 ||
              p.stop <= 0,
          ) ||
          saved[key].trades.some(
            (t) =>
              !t ||
              !ASSETS.includes(t.asset) ||
              !["buy", "sell"].includes(t.side) ||
              typeof t.reason !== "string" ||
              ![t.quantity, t.price, t.fee, t.time].every(Number.isFinite),
          ))
      )
        delete saved[key];
    }
    if (
      saved.signals &&
      (!Array.isArray(saved.signals) ||
        saved.signals.some(
          (s) => !ASSETS.includes(s.asset) || !Number.isFinite(s.threshold),
        ))
    )
      delete saved.signals;
    if (
      saved.alerts &&
      (!Array.isArray(saved.alerts) ||
        saved.alerts.some(
          (a) =>
            !a ||
            typeof a.title !== "string" ||
            typeof a.body !== "string" ||
            !Number.isFinite(a.time),
        ))
    )
      delete saved.alerts;
    if (typeof saved.bridgeUrl !== "string") delete saved.bridgeUrl;
    if (typeof saved.desktop !== "boolean") delete saved.desktop;
    return saved;
  } catch {
    return {};
  }
}
const saved = readSaved();
let sampleAccount = saved.account ?? freshAccount(),
  liveAccount = saved.liveAccount ?? freshAccount(),
  account = sampleAccount,
  signals = (saved.signals ?? structuredClone(defaultSignals)).map((s) => ({
    ...s,
    auto: false,
    fired: false,
  })),
  alerts = saved.alerts ?? [];
let page: Page = "overview",
  asset: Asset = "BTC",
  interval = 15,
  tick = 0,
  playing = true,
  menuOpen = false,
  sourceFilter = "All sources",
  feedQuery = "",
  portfolioTab = "positions";
let desktop = saved.desktop ?? false,
  bridgeUrl = saved.bridgeUrl ?? "",
  bridgeToken = "",
  connected = false,
  liveTrading = false,
  liveMode = false,
  fetching = false,
  lastError = "";
let markets: Record<Asset, Market> = {
  BTC: sampleMarket("BTC"),
  ETH: sampleMarket("ETH"),
  SOL: sampleMarket("SOL"),
};
let imported: Candle[] | null = null,
  importName = "",
  testResult: Backtest | null = null,
  testDescription = "",
  savedStrategy: Strategy = {
    threshold: 65,
    exitThreshold: 40,
    rsiMax: 75,
    useVwap: true,
    stopPct: 2,
    takePct: 4,
    allocationPct: 25,
    feeBps: 10,
    slippageBps: 5,
    initial: 10000,
  };
const chartOptions: ChartOptions = {
  line: false,
  vwap: true,
  volume: true,
  sentiment: true,
  rsi: false,
  macd: false,
  zoom: 64,
};
const app = document.querySelector<HTMLElement>("#app")!,
  modalRoot = document.querySelector<HTMLElement>("#modal-root")!;
const pageNames: Record<Page, string> = {
  overview: "Overview",
  markets: "Markets",
  signals: "Signals",
  backtesting: "Backtesting",
  portfolio: "Portfolio",
  connections: "Connections",
  settings: "Settings",
};
const navIcons: Record<Page, string> = {
  overview: "grid",
  markets: "chart",
  signals: "signal",
  backtesting: "flask",
  portfolio: "wallet",
  connections: "plug",
  settings: "settings",
};
const scoreLabel = (score: number | null) =>
  score === null
    ? "Unavailable"
    : score >= 65
      ? "Bullish"
      : score <= 40
        ? "Bearish"
        : "Neutral";
const scoreTone = (score: number | null) =>
  score === null
    ? ""
    : score >= 65
      ? "positive"
      : score <= 40
        ? "negative"
        : "warning";
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const chip = (text: string, tone = "") =>
  `<span class="badge ${tone}">${esc(text)}</span>`;
const sourceIcon = (source: Source) =>
  source === "Social" ? "social" : source === "News" ? "news" : "layers";
const button = (action: string, text: string, symbol = "", cls = "button") =>
  `<button type="button" class="${cls}" data-action="${action}">${symbol ? icon(symbol) : ""}${text}</button>`;
const current = () => markets[asset];
const equity = () =>
  account.cash +
  account.positions.reduce(
    (n, p) => n + p.quantity * markets[p.asset].price,
    0,
  );
const time = (n: number) =>
  new Date(n).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

function persist() {
  if (liveMode) liveAccount = account;
  else sampleAccount = account;
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        account: sampleAccount,
        liveAccount,
        signals,
        alerts: alerts.slice(0, 100),
        desktop,
        bridgeUrl,
      } satisfies Saved),
    );
  } catch {
    toast(
      "Storage is unavailable. Keep this tab open or export your trades before leaving.",
    );
  }
}
function toast(text: string) {
  const root = document.querySelector<HTMLElement>("#toast")!;
  root.innerHTML = `<span>${esc(text)}</span><button class="icon-button" data-action="dismiss-toast" aria-label="Dismiss message">${icon("close")}</button>`;
  root.classList.add("visible");
}
async function notify(title: string, body: string) {
  alerts.unshift({ id: uid(), title, body, time: Date.now(), read: false });
  alerts = alerts.slice(0, 100);
  persist();
  if (
    desktop &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    try {
      const registration =
        "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistration()
          : undefined;
      if (registration)
        await registration.showNotification(title, {
          body,
          icon: "./favicon.svg",
          tag: title,
        });
      else new Notification(title, { body });
    } catch {
      toast(
        "Browser notifications are unavailable. Events are saved in the alert inbox.",
      );
    }
  }
}
function navLink(key: Page) {
  return `<a href="#${key}" aria-label="${pageNames[key]}" class="nav-link ${page === key ? "selected" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(navIcons[key])}<span>${pageNames[key]}</span>${key === "signals" ? `<span class="nav-count">${signals.filter((s) => s.enabled).length}</span>` : ""}</a>`;
}
function render(preserveForms = false) {
  const drafts = preserveForms
    ? [
        ...app.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          "form input, form select",
        ),
      ].map((input) => ({
        key: input.id || input.name,
        value: input.value,
        checked: input instanceof HTMLInputElement ? input.checked : false,
      }))
    : [];
  const riskResult = preserveForms
    ? document.getElementById("risk-result")?.innerHTML
    : undefined;
  const riskError = preserveForms
    ? document.getElementById("risk-error")?.textContent
    : undefined;
  const active = document.activeElement as HTMLElement | null,
    action = active?.dataset.action,
    activeId = active?.id,
    activeHref = active?.getAttribute("href");
  app.innerHTML = `<aside class="sidebar ${menuOpen ? "open" : ""}" ${menuOpen ? 'role="dialog" aria-modal="true"' : ""} aria-label="Workspace navigation">${menuOpen ? `<button type="button" class="icon-button sidebar-close" data-action="menu" aria-label="Close navigation">${icon("close")}</button>` : ""}<a class="brand" href="#overview" aria-label="Sentra overview">${logo}<span>sentra<span class="brand-dot">.</span></span></a><div class="workspace-label">Personal workspace ${icon("down")}</div><nav aria-label="Main">${(["overview", "markets", "signals", "backtesting", "portfolio"] as Page[]).map(navLink).join("")}</nav><div class="sidebar-bottom"><nav aria-label="Configuration">${navLink("connections")}${navLink("settings")}</nav><div class="profile"><span class="avatar">P</span><div><strong>Personal desk</strong><span>Single-user workspace</span></div><span class="status-dot"></span></div></div></aside>
  ${menuOpen ? '<button class="menu-scrim" aria-label="Close navigation" data-action="menu"></button>' : ""}
  <div class="workspace" ${menuOpen ? "inert" : ""}><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="Toggle navigation" aria-expanded="${menuOpen}">${icon("menu")}</button><span class="desktop-only">Workspace</span><span class="desktop-only slash">/</span><span class="desktop-page">${pageNames[page]}</span><a href="#overview" class="mobile-brand" aria-label="Sentra overview">${logo}<span>sentra.</span></a></div><div class="topbar-right"><span class="mode-pill"><span class="status-dot ${liveMode ? "" : "sample-dot"}"></span>${liveMode ? (lastError ? "Live data · Stale" : "Live data") : "Sample data"}</span><span class="topbar-separator"></span><button class="icon-button notification-button" data-action="alerts" aria-label="Open alerts${alerts.some((a) => !a.read) ? ", unread events" : ""}">${icon("bell")}${alerts.some((a) => !a.read) ? '<span class="notification-dot"></span>' : ""}</button><span class="small-avatar desktop-only">P</span></div></header>
  <main id="main" tabindex="-1">${lastError ? `<div class="info-strip error-strip" role="status">${icon("info")}<p>${esc(lastError)} ${liveMode ? "Displayed live observations are stale." : "The workspace still shows sample data."} Automatic refresh is paused.</p>${button("refresh", "Retry data", "refresh", "button compact")}</div>` : ""}${pageContent()}</main><footer class="workspace-footer"><span><span class="status-dot ${liveMode ? "" : "sample-dot"}"></span>${liveMode ? "Connected to your private data service" : "Sample market data · Paper trading only"}</span><span>All times UTC <span class="footer-divider">/</span> Sentra v1.0</span></footer></div>`;
  for (const draft of drafts) {
    const input = app.querySelector<HTMLInputElement | HTMLSelectElement>(
      `form [id="${CSS.escape(draft.key)}"], form [name="${CSS.escape(draft.key)}"]`,
    );
    if (input && input.type !== "file") {
      input.value = draft.value;
      if (input instanceof HTMLInputElement) input.checked = draft.checked;
    }
  }
  if (riskResult !== undefined && document.getElementById("risk-result"))
    document.getElementById("risk-result")!.innerHTML = riskResult;
  if (riskError !== undefined && document.getElementById("risk-error"))
    document.getElementById("risk-error")!.textContent = riskError;
  mountChart();
  if (activeId)
    document.getElementById(activeId)?.focus({ preventScroll: true });
  else if (action)
    app
      .querySelector<HTMLElement>(`[data-action="${CSS.escape(action)}"]`)
      ?.focus({ preventScroll: true });
  else if (activeHref)
    app
      .querySelector<HTMLElement>(`a[href="${CSS.escape(activeHref)}"]`)
      ?.focus({ preventScroll: true });
  if (menuOpen) app.querySelector<HTMLElement>(".sidebar-close")?.focus();
}
function heading(
  title: string,
  subtitle: string,
  actions = button("new-signal", "Create signal", "plus", "button primary"),
) {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function pageContent(): string {
  switch (page) {
    case "overview":
      return overview();
    case "markets":
      return marketsPage();
    case "signals":
      return signalsPage();
    case "backtesting":
      return backtestingPage();
    case "portfolio":
      return portfolioPage();
    case "connections":
      return connectionsPage();
    case "settings":
      return settingsPage();
  }
}
function overview() {
  const market = current(),
    score = aggregate(market),
    activeSignals = signals.filter((s) => s.enabled);
  return `${heading("Market overview", "Monitor prices, sentiment, signals, and paper positions.", `<span class="session-label">${icon("clock")} Intraday workspace</span>${button("new-signal", "Create signal", "plus", "button primary")}`)}
  <section class="metrics-grid" aria-label="Workspace metrics"><article class="metric-card"><div class="metric-label">${coin(asset)}<span>${assetNames[asset]} price</span><span class="metric-corner">${asset}</span></div><div class="metric-value">${money(market.price)}</div><div class="metric-bottom"><span class="${market.change >= 0 ? "positive" : "negative"}">${signed(market.change)} <span class="muted">24h</span></span>${sparkline(market.candles.slice(-24).map((c) => c.close))}</div></article>
  <article class="metric-card"><div class="metric-label">${icon("signal")}<span>Market sentiment</span>${icon("info", "metric-corner")}</div><div class="metric-value">${score ?? "—"}<span class="metric-unit">/ 100</span>${chip(scoreLabel(score), scoreTone(score))}</div><div class="metric-bottom"><span class="muted">Across ${market.sources.length} source types</span><span class="mini-bars" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => `<i class="${i < (score ?? 0) / 7 ? "filled" : ""}"></i>`).join("")}</span></div></article>
  <article class="metric-card"><div class="metric-label">${icon("layers")}<span>Active signals</span><a href="#signals" aria-label="Manage signals" class="metric-corner">${icon("up")}</a></div><div class="metric-value">${String(activeSignals.length).padStart(2, "0")}<span class="metric-unit small-unit">monitoring the market</span></div><div class="metric-bottom"><span class="muted"><span class="status-dot"></span>${activeSignals.filter((s) => matches(s, markets[s.asset])).length} ${activeSignals.filter((s) => matches(s, markets[s.asset])).length === 1 ? "condition" : "conditions"} met</span><span class="muted">${signals.filter((s) => s.auto).length} automated</span></div></article>
  <article class="metric-card"><div class="metric-label">${icon("wallet")}<span>Paper equity</span>${chip("Paper")}</div><div class="metric-value">${money(equity())}</div><div class="metric-bottom"><span class="${equity() >= INITIAL_CASH ? "positive" : "negative"}">${signed((equity() / INITIAL_CASH - 1) * 100)} <span class="muted">all time</span></span><a class="subtle-link" href="#portfolio">View portfolio ${icon("arrow")}</a></div></article></section>
  <div class="desk-grid"><section class="panel chart-panel">${chartPanel()}</section><section class="panel sentiment-panel">${sentimentPanel()}</section><section class="panel feed-panel">${feedPanel()}</section><section class="panel signals-panel">${signalPanel()}</section></div>
  <section class="panel positions-panel"><div class="panel-heading"><h2>Open positions <span class="count">${account.positions.length}</span></h2><a class="subtle-link" href="#portfolio">View portfolio ${icon("arrow")}</a></div>${positionsTable()}</section>`;
}
function coin(a: Asset) {
  return `<span class="coin coin-${a.toLowerCase()}" aria-hidden="true">${a === "BTC" ? "₿" : a === "ETH" ? "♦" : "≋"}</span>`;
}
function chartPanel() {
  const market = current(),
    last = market.candles.at(-1)!;
  return `<div class="panel-heading chart-heading"><div class="pair-heading">${coin(asset)}<div><label class="sr-only" for="chart-asset">Chart asset</label><select id="chart-asset" class="pair-select">${ASSETS.map((a) => `<option value="${a}" ${asset === a ? "selected" : ""}>${a} / USDT</option>`).join("")}</select><span class="muted caption">${liveMode ? "Connected exchange" : "Sample spot market"}</span></div><div class="pair-price"><strong>${money(market.price)}</strong><span class="${market.change >= 0 ? "positive" : "negative"} caption">${signed(market.change)}</span></div></div>${button("trade", "Trade", "up", "button compact")}</div>
  <div class="chart-toolbar"><div class="segmented" aria-label="Candle interval">${[5, 15, 60, 240].map((n) => `<button data-action="interval-${n}" aria-pressed="${interval === n}" class="${interval === n ? "active" : ""}">${n < 60 ? `${n}m` : `${n / 60}h`}</button>`).join("")}</div><div class="chart-tools"><button class="icon-button ${!chartOptions.line ? "active" : ""}" data-action="chart-type" aria-label="Switch to ${chartOptions.line ? "candlestick" : "line"} chart">${icon("chart")}</button><button class="icon-button" data-action="zoom-out" aria-label="Show more candles">−</button><button class="icon-button" data-action="zoom-in" aria-label="Show fewer candles">+</button><button class="icon-button" data-action="chart-data" aria-label="View candle data table">${icon("layers")}</button></div></div>
  <div class="chart-indicators" aria-label="Chart indicators">${(["vwap", "sentiment", "volume", "rsi", "macd"] as const).map((key) => `<button class="indicator ${chartOptions[key] ? "active" : ""} indicator-${key}" data-action="indicator-${key}" aria-pressed="${chartOptions[key]}"><span class="indicator-dot"></span>${key === "sentiment" ? "Sentiment" : key === "volume" ? "Volume" : key.toUpperCase()}${chartOptions[key] ? icon("check") : ""}</button>${key === "sentiment" && chartOptions.sentiment && !market.candles.slice(-chartOptions.zoom).some((c) => c.sentiment !== null) ? '<span class="indicator-note">No recorded sentiment in this range</span>' : ""}`).join("")}</div><div class="ohlc"><span>O <b>${number(last.open)}</b></span><span>H <b>${number(last.high)}</b></span><span>L <b>${number(last.low)}</b></span><span>C <b class="positive">${number(last.close)}</b></span></div><div id="price-chart" class="price-chart"></div><div class="chart-footer"><span>${icon("info")} ${liveMode ? "Price: exchange · Sentiment: recorded observations" : "Illustrative candles & sentiment"} · UTC</span><button class="text-button" data-action="playback">${icon(playing ? "pause" : "play")}${playing ? "Pause" : "Resume"}</button></div>`;
}
function mountChart() {
  const host = document.getElementById("price-chart");
  if (host) renderChart(host, current().candles, chartOptions);
}
function sentimentPanel() {
  const market = current(),
    score = aggregate(market),
    s = score ?? 0;
  const angle = Math.PI - (s / 100) * Math.PI,
    dotX = 120 + Math.cos(angle) * 90,
    dotY = 113 - Math.sin(angle) * 90;
  return `<div class="panel-heading"><h2>Sentiment index</h2><button class="icon-button" data-action="methodology" aria-label="How sentiment is calculated">${icon("info")}</button></div><div class="gauge"><svg viewBox="0 0 240 135" aria-hidden="true"><path d="M30 113 A90 90 0 0 1 210 113" fill="none" stroke="#2b3033" stroke-width="13" stroke-linecap="round"/>${[
    { end: 0.32, start: 0, color: "#ed858b" },
    { end: 0.64, start: 0.35, color: "#ddc27a" },
    { end: 1, start: 0.67, color: "#65d7aa" },
  ]
    .map((seg) => {
      const x1 = 120 + Math.cos(Math.PI - seg.start * Math.PI) * 90,
        y1 = 113 - Math.sin(Math.PI - seg.start * Math.PI) * 90,
        x2 = 120 + Math.cos(Math.PI - seg.end * Math.PI) * 90,
        y2 = 113 - Math.sin(Math.PI - seg.end * Math.PI) * 90;
      return `<path d="M${x1} ${y1} A90 90 0 0 1 ${x2} ${y2}" fill="none" stroke="${seg.color}" stroke-width="13" stroke-linecap="round"/>`;
    })
    .join(
      "",
    )}<circle cx="${dotX}" cy="${dotY}" r="9" fill="#f0f3f0" stroke="#171a1c" stroke-width="4"/></svg><div class="gauge-label"><strong>${score ?? "—"}</strong><span class="${scoreTone(score)}">${scoreLabel(score)}</span></div></div><div class="gauge-scale"><span>Bearish</span><span>Neutral</span><span>Bullish</span></div><p class="sentiment-caption">${score === null ? "Connect a sentiment source to calculate the index." : score >= 65 ? "Positive sentiment across the market." : "A mixed market. Keep an eye on momentum."}</p><div class="source-breakdown">${market.sources.map((source) => `<div class="source-row"><span>${icon(sourceIcon(source.source))}${source.source}</span><div class="source-meter"><i style="width:${source.score}%"></i></div><strong>${source.score}</strong></div>`).join("") || '<p class="muted">No source observations available.</p>'}</div><div class="sentiment-footer"><span>${number(
    market.sources.reduce((n, source) => n + source.count, 0),
    0,
  )} observations</span><span>${liveMode ? "Updated" : "Sample"} ${time(market.updated)}</span></div>`;
}
function feedPanel(full = false) {
  const market = current(),
    feed = market.feed.filter(
      (f) =>
        (sourceFilter === "All sources" || sourceFilter === f.source) &&
        `${f.text} ${f.author}`.toLowerCase().includes(feedQuery.toLowerCase()),
    );
  return `<div class="panel-heading"><h2>Sentiment feed <span class="live-label"><span class="status-dot ${liveMode ? "" : "sample-dot"}"></span>${liveMode ? "Live" : "Sample"}</span></h2><label class="sr-only" for="source-filter">Filter sentiment sources</label><select id="source-filter" class="small-select">${["All sources", "Social", "News", "On-chain"].map((s) => `<option ${sourceFilter === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>${full ? `<label class="search-field">${icon("search")}<input id="feed-search" type="search" placeholder="Search the sentiment feed" aria-label="Search the sentiment feed" value="${esc(feedQuery)}"></label>` : ""}<div class="feed-list">${
    feed
      .slice(0, full ? 20 : 4)
      .map(
        (f, i) =>
          `<article class="feed-item"><span class="source-icon source-${f.source === "Social" ? "social" : f.source === "News" ? "news" : "chain"}">${icon(sourceIcon(f.source))}</span><div class="feed-copy"><div class="feed-meta"><strong>${esc(f.author)}</strong><span>·</span><span>${f.source}</span><span class="feed-time">${time(f.time)}</span></div><button class="feed-title" data-action="feed-${i}">${esc(f.text)}</button><span class="feed-sentiment ${scoreTone(f.score)}"><span class="status-dot"></span>${scoreLabel(f.score)} <span class="muted">· ${f.score}/100</span></span></div><span class="feed-arrow">${icon("chevron")}</span></article>`,
      )
      .join("") ||
    `<div class="empty-state compact-empty">${icon("search")}<h3>No matching observations</h3><p>Try another source or clear your search.</p>${button("clear-feed", "Clear filters")}</div>`
  }</div>${full ? "" : '<a class="panel-bottom-link" href="#markets">Explore market intelligence ' + icon("arrow") + "</a>"}`;
}
function signalPanel() {
  return `<div class="panel-heading"><h2>Your signals <span class="count">${signals.length}</span></h2><a href="#signals" class="subtle-link">View all ${icon("arrow")}</a></div><div class="signal-list">${
    signals
      .slice(0, 3)
      .map((s) => signalCard(s, true))
      .join("") ||
    `<div class="empty-state"><h3>Let the market come to you</h3><p>Create a sentiment signal to start monitoring.</p></div>`
  }</div><button class="panel-bottom-link full-width" data-action="new-signal">${icon("plus")} Create a signal</button>`;
}
function signalCard(s: Signal, compact = false) {
  const met = matches(s, markets[s.asset]);
  return `<article class="signal-card ${compact ? "compact-signal" : ""}"><div class="signal-card-top"><span class="signal-asset">${coin(s.asset)}${s.asset} / USDT</span>${chip(!s.enabled ? "Paused" : met ? "Condition met" : "Watching", !s.enabled ? "" : met ? "positive" : "watching")}</div><button class="signal-name" data-action="edit-${esc(s.id)}">${esc(s.name)}</button><p>Sentiment ${s.direction === "above" ? "≥" : "≤"} ${s.threshold} · RSI ≤ ${s.rsiMax}${s.useVwap ? " · Price above VWAP" : ""}</p><div class="signal-card-bottom"><span>${icon(s.auto ? "play" : "bell")}${s.auto ? "Paper automation" : "Alert only"}</span>${compact ? `<button class="icon-button" data-action="edit-${esc(s.id)}" aria-label="Edit ${esc(s.name)}">${icon("chevron")}</button>` : `<div class="inline-actions"><button class="text-button" data-action="toggle-${esc(s.id)}">${s.enabled ? "Pause" : "Enable"}</button><button class="text-button" data-action="edit-${esc(s.id)}">Edit signal</button></div>`}</div></article>`;
}
function positionsTable() {
  if (!account.positions.length)
    return `<div class="empty-position"><span class="empty-position-icon">${icon("wallet")}</span><div><strong>A clean slate for your next trade.</strong><p>Open a paper position to track entry, risk, and performance.</p></div>${button("trade", "Place paper trade", "plus", "button compact")}</div>`;
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable data table"><table><thead><tr><th>Asset</th><th>Quantity</th><th>Entry price</th><th>Market price</th><th>Stop loss</th><th>Unrealized P&L</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${account.positions
    .map((p) => {
      const value = (markets[p.asset].price - p.entry) * p.quantity;
      return `<tr><td><span class="table-asset">${coin(p.asset)}${p.asset} / USDT</span></td><td>${number(p.quantity, 6)}</td><td>${money(p.entry)}</td><td>${money(markets[p.asset].price)}</td><td>${money(p.stop)}</td><td class="${value >= 0 ? "positive" : "negative"}">${value >= 0 ? "+" : ""}${money(value)}</td><td><button class="button compact" data-action="close-position-${p.id}">Close</button></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function marketsPage() {
  return `${heading("Market intelligence", "Connect price action with the conversation behind it.", button("refresh", fetching ? "Refreshing…" : "Refresh data", "refresh"))}<section class="panel market-watch"><div class="panel-heading"><h2>Watchlist</h2>${chip(liveMode ? "Live providers" : "Sample prices")}</div><div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable data table"><table><thead><tr><th>Asset</th><th>Price</th><th>24h change</th><th>24h volume</th><th>Sentiment</th><th>Trend</th><th><span class="sr-only">Select asset</span></th></tr></thead><tbody>${ASSETS.map(
    (a) => {
      const m = markets[a],
        score = aggregate(m);
      return `<tr class="${a === asset ? "selected-row" : ""}"><td><span class="table-asset">${coin(a)}<span>${assetNames[a]} <span class="muted">${a}</span></span></span></td><td>${money(m.price)}</td><td class="${m.change >= 0 ? "positive" : "negative"}">${signed(m.change)}</td><td>$${(m.volume / 1e9).toFixed(2)}B</td><td>${chip(`${score ?? "—"} · ${scoreLabel(score)}`, scoreTone(score))}</td><td>${sparkline(
        m.candles.slice(-24).map((c) => c.close),
        m.change >= 0 ? "positive" : "negative",
      )}</td><td><button class="button compact" data-action="asset-${a}" aria-label="Analyze ${assetNames[a]}">${a === asset ? "Selected" : "Analyze"}</button></td></tr>`;
    },
  ).join(
    "",
  )}</tbody></table></div></section><div class="desk-grid markets-grid"><section class="panel chart-panel">${chartPanel()}</section><section class="panel sentiment-panel">${sentimentPanel()}</section><section class="panel wide-panel">${feedPanel(true)}</section></div>`;
}
function signalsPage() {
  return `${heading("Trading signals", "Set sentiment thresholds, RSI limits, and execution rules.")}<div class="info-strip">${icon("shield")}<p>Signals evaluate sentiment and technical conditions. Automation places paper spot buys while this tab is open; each rule triggers once until its condition resets.</p>${button("evaluate", "Evaluate now", "refresh", "button compact")}</div><div class="signal-grid">${signals.map((s) => signalCard(s)).join("")}<button class="new-signal-card" data-action="new-signal">${icon("plus")}<strong>Create a signal</strong><span>Turn your market thesis into a rule.</span></button></div><section class="panel strategy-explainer"><div>${icon("signal")}<h2>From sentiment to a signal</h2><p>Combine a sentiment threshold with an RSI limit and a VWAP filter. You can receive an alert or simulate an entry with a defined order size and stop.</p></div><div><h3>Research before execution</h3><p>Test your rules against historical observations. Backtests include fees, slippage, and conservative stop handling.</p><a class="button" href="#backtesting">Open backtesting ${icon("arrow")}</a></div></section>`;
}
function input(
  label: string,
  name: string,
  value: string | number,
  attrs = "",
) {
  return `<label class="field"><span>${label}</span><input name="${name}" id="${name}" value="${esc(value)}" ${attrs}></label>`;
}
function backtestingPage() {
  const s = savedStrategy;
  return `${heading("Strategy lab", "Test sentiment and technical rules against historical candles.", button("export-backtest", "Export results", "download"))}<div class="backtest-layout"><section class="panel strategy-form-panel"><div class="panel-heading"><h2>Strategy parameters</h2>${chip("Spot · Long only")}</div><form id="backtest-form"><label class="field"><span>Asset</span><select name="testAsset" id="test-asset">${ASSETS.map((a) => `<option ${asset === a ? "selected" : ""}>${a}</option>`).join("")}</select></label><div class="dataset-info">${icon("layers")}<div><strong>${imported ? esc(importName) : "Sample historical dataset"}</strong><span>${imported ? `${number(imported.length)} imported candles` : "2,880 synthetic 15-minute candles · 30 days"}</span></div></div><div class="form-grid">${input("Entry sentiment ≥", "threshold", s.threshold, 'type="number" min="0" max="100" required')}${input("Exit sentiment ≤", "exitThreshold", s.exitThreshold, 'type="number" min="0" max="100" required')}${input("Maximum RSI", "rsiMax", s.rsiMax, 'type="number" min="0" max="100" required')}${input("Allocation (%)", "allocationPct", s.allocationPct, 'type="number" min="1" max="100" required')}${input("Stop loss (%)", "stopPct", s.stopPct, 'type="number" min="0.1" max="50" step="0.1" required')}${input("Take profit (%)", "takePct", s.takePct, 'type="number" min="0.1" max="100" step="0.1" required')}${input("Fees (basis points)", "feeBps", s.feeBps, 'type="number" min="0" max="100" required')}${input("Slippage (basis points)", "slippageBps", s.slippageBps, 'type="number" min="0" max="100" required')}</div>${input("Starting balance (USD)", "initial", s.initial, 'type="number" min="100" max="100000000" required')}<label class="check-field"><input name="useVwap" type="checkbox" ${s.useVwap ? "checked" : ""}> Require price above VWAP</label><p class="form-error" id="backtest-error" role="alert"></p><button class="button primary full-width" type="submit">${icon("play")}Run backtest</button><div class="import-actions"><label class="button compact">${icon("upload")}Import CSV<input class="file-input" type="file" id="history-import" accept=".csv,text/csv"></label>${button("download-sample", "Sample CSV", "download", "text-button")}</div>${imported ? button("clear-import", "Use sample data", "", "text-button") : ""}</form></section><div class="backtest-results">${testResult ? resultsPanel(testResult) : `<section class="panel backtest-empty"><div class="lab-illustration">${icon("flask")}<span class="lab-orbit"></span></div><h2>A hypothesis is a good start.</h2><p>Choose your sentiment and risk parameters, then run your first backtest to see the equity curve and every trade.</p><div class="backtest-features"><span>${icon("check")} Trading fees</span><span>${icon("check")} Slippage</span><span>${icon("check")} Stop losses</span></div></section>`}<div class="info-strip">${icon("info")}<p>Sample data is synthetic. Historical performance does not predict future results. Entries use the next candle’s open; stops take precedence when both stop and target are touched.</p></div></div></div>`;
}
function resultsPanel(result: Backtest) {
  return `<div class="results-metrics"><article class="metric-card"><span class="muted">Total return</span><strong class="result-value ${result.returnPct >= 0 ? "positive" : "negative"}">${signed(result.returnPct)}</strong></article><article class="metric-card"><span class="muted">Max drawdown</span><strong class="result-value">${result.drawdown.toFixed(2)}%</strong></article><article class="metric-card"><span class="muted">Win rate</span><strong class="result-value">${result.winRate.toFixed(1)}%</strong></article></div><section class="panel"><div class="panel-heading"><h2>Equity curve</h2><strong>${money(result.final)}</strong></div><p class="panel-description">${esc(testDescription)}</p>${equityChart(result.equity)}</section><section class="panel"><div class="panel-heading"><h2>Trade log</h2><span class="muted">${result.trades.filter((t) => t.side === "Sell").length} completed trades</span></div><div class="table-wrap result-table" tabindex="0" role="region" aria-label="Backtest trade log"><table><thead><tr><th>Time (UTC)</th><th>Side</th><th>Fill price</th><th>Net P&L</th></tr></thead><tbody>${result.trades.length ? result.trades.map((t) => `<tr><td>${new Date(t.time).toISOString().slice(0, 16).replace("T", " ")}</td><td>${chip(t.side, t.side === "Buy" ? "positive" : "")}</td><td>${money(t.price)}</td><td class="${t.pnl >= 0 ? "positive" : "negative"}">${t.side === "Sell" ? money(t.pnl) : "—"}</td></tr>`).join("") : '<tr><td colspan="4">No trades matched these conditions. Adjust the thresholds and run again.</td></tr>'}</tbody></table></div></section>`;
}
function portfolioPage() {
  const pnl = account.trades.reduce((n, t) => n + (t.pnl ?? 0), 0);
  return `${heading("Paper portfolio", liveMode ? "Paper fills at live prices. Separate from your sample portfolio." : "Review paper positions, fills, and position sizes.", button("trade", "Place paper trade", "plus", "button primary"))}<section class="metrics-grid portfolio-metrics"><article class="metric-card"><span class="muted">Total equity</span><strong class="metric-value">${money(equity())}</strong><span class="caption muted">Marked to ${liveMode ? "live" : "sample"} prices</span></article><article class="metric-card"><span class="muted">Available cash</span><strong class="metric-value">${money(account.cash)}</strong><span class="caption muted">USD · 0.1% fee per fill</span></article><article class="metric-card"><span class="muted">Realized P&L</span><strong class="metric-value ${pnl >= 0 ? "positive" : "negative"}">${money(pnl)}</strong><span class="caption muted">Includes entry and exit fees</span></article><article class="metric-card"><span class="muted">Open positions</span><strong class="metric-value">${account.positions.length}</strong><span class="caption muted">Unleveraged spot positions</span></article></section><section class="panel"><div class="panel-heading portfolio-toolbar"><div class="segmented"><button class="${portfolioTab === "positions" ? "active" : ""}" data-action="portfolio-positions" aria-pressed="${portfolioTab === "positions"}">Positions</button><button class="${portfolioTab === "history" ? "active" : ""}" data-action="portfolio-history" aria-pressed="${portfolioTab === "history"}">Trade history</button></div>${button("export-trades", "Export CSV", "download", "button compact")}</div>${portfolioTab === "positions" ? positionsTable() : `<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable data table"><table><thead><tr><th>Time (UTC)</th><th>Asset</th><th>Side</th><th>Quantity</th><th>Price</th><th>Fee</th><th>Reason</th></tr></thead><tbody>${account.trades.map((t) => `<tr><td>${time(t.time)}</td><td>${t.asset}</td><td>${chip(t.side, t.side === "buy" ? "positive" : "")}</td><td>${number(t.quantity, 6)}</td><td>${money(t.price)}</td><td>${money(t.fee)}</td><td>${esc(t.reason)}</td></tr>`).join("") || '<tr><td colspan="7">No trades yet. Place a paper trade to begin your journal.</td></tr>'}</tbody></table></div>`}</section><section class="panel risk-panel"><div class="panel-heading"><h2>${icon("shield")}Position size calculator</h2>${chip("Long spot")}</div><form id="risk-form"><div class="risk-form-grid">${input("Account equity (USD)", "risk-equity", equity().toFixed(2), 'type="number" min="1" step="0.01" required')}${input("Risk per trade (%)", "risk-percent", 1, 'type="number" min="0.01" max="100" step="0.01" required')}${input("Entry price (USD)", "risk-entry", current().price.toFixed(2), 'type="number" min="0.01" step="0.01" required')}${input("Stop price (USD)", "risk-stop", (current().price * 0.98).toFixed(2), 'type="number" min="0.01" step="0.01" required')}</div><div class="risk-form-bottom"><p class="muted">Size = risk budget ÷ distance to stop, capped by available equity.</p><button class="button" type="submit">Calculate position ${icon("arrow")}</button></div><div id="risk-result" class="risk-result" role="status"></div><p id="risk-error" class="form-error" role="alert"></p></form></section>`;
}
function connectionsPage() {
  return `${heading("Connections", "Connect your private data and exchange service.", chip(connected ? "Service connected" : "Sample mode", connected ? "positive" : ""))}<div class="connections-layout"><section class="panel"><div class="panel-heading"><h2>Private service</h2>${icon("plug")}</div><p class="panel-description">Connect the included FastAPI service to stream provider data and access your exchange. Credentials stay on your service.</p><form id="connection-form">${input("Service URL", "bridge-url", bridgeUrl, 'type="url" placeholder="https://your-private-service" required autocomplete="url"')}${input("Personal access token", "bridge-token", "", 'type="password" placeholder="Your service access token" required autocomplete="off"')}<p class="field-hint">Use an HTTPS service, or localhost for local development. The token stays in this tab’s memory.</p><p class="form-error" id="connection-error" role="alert"></p><div class="inline-actions"><button class="button primary" type="submit">${icon("plug")}${connected ? "Reconnect service" : "Connect service"}</button>${connected ? button("disconnect", "Disconnect") : ""}</div></form></section><section class="panel"><div class="panel-heading"><h2>Data & execution</h2>${chip("Owner configured")}</div><div class="integration-row"><span class="integration-icon">${icon("chart")}</span><div><strong>Kraken · Binance · Coinbase</strong><p>CCXT market data and spot order APIs</p></div>${chip(connected ? "Available" : "Not connected", connected ? "positive" : "")}</div><div class="integration-row"><span class="integration-icon">${icon("social")}</span><div><strong>Social sentiment</strong><p>TwitterAPI.io · optional Jev scoring</p></div>${icon("shield")}</div><div class="integration-row"><span class="integration-icon">${icon("news")}</span><div><strong>News & on-chain</strong><p>RSS feeds and Ethereum block activity</p></div>${icon("shield")}</div><div class="integration-row"><span class="integration-icon">${icon("bell")}</span><div><strong>Mobile notifications</strong><p>Private ntfy topic from your service</p></div>${icon("shield")}</div></section></div><div class="info-strip">${icon("info")}<p>Static hosting runs the sample workspace independently. Live data requires your configured service. Live orders require a server-side enable flag and a separate order confirmation. Paper balances are always separate.</p></div><section class="panel automation-panel"><div class="panel-heading"><h2>Live automation</h2>${chip("Service controlled")}</div><p class="panel-description">Arm one long-only strategy for the selected asset on your private service. It runs every 60 seconds, buys once per trigger, and exits on its stop or sentiment reversal. Rules and caps are enforced by the service.</p><form id="live-auto-form"><div class="form-grid"><label class="field"><span>Asset</span><select name="live-asset" id="live-asset">${ASSETS.map((a) => `<option ${a === asset ? "selected" : ""}>${a}</option>`).join("")}</select></label>${input("Entry sentiment ≥", "live-threshold", 75, 'type="number" min="1" max="100" required')}${input("Exit sentiment ≤", "live-exit", 40, 'type="number" min="0" max="99" required')}${input("Order value (USD)", "live-allocation", 50, 'type="number" min="1" step="0.01" required')}${input("Stop loss (%)", "live-stop", 2, 'type="number" min="0.1" max="20" step="0.1" required')}${input("Maximum RSI", "live-rsi", 70, 'type="number" min="1" max="100" required')}</div><label class="check-field"><input type="checkbox" name="live-consent" required> I authorize real spot orders from this strategy.</label><p class="form-error" id="live-auto-error" role="alert"></p><div class="inline-actions"><button class="button" type="submit" ${!connected || !liveTrading ? "disabled" : ""}>Review live automation ${icon("arrow")}</button>${button("stop-live", "Stop live automation", "pause")}${button("status-live", "Check status", "refresh")}${button("reconcile-live", "Clear resolved state", "check")}</div><p class="field-hint">${liveTrading ? "Live trading is enabled on your service." : "Connect a service with live trading enabled to arm a strategy."} Stopping automation leaves any open position on the exchange; manage it there.</p></form></section>`;
}
function settingsPage() {
  return `${heading("Workspace settings", "Manage notifications, refresh, and local data.", "")}<div class="settings-layout"><section class="panel"><div class="panel-heading"><h2>Notifications & playback</h2>${icon("bell")}</div><div class="setting-row"><div><h3>Browser notifications</h3><p>Signal triggers and trade events, while this desk is open.</p><span class="caption muted">Browser permission: ${"Notification" in window ? Notification.permission : "unsupported"}</span></div><button class="button" data-action="notifications">${desktop ? "Disable" : "Enable"} notifications</button></div><div class="setting-row"><div><h3>Test notification</h3><p>Send an event to the alert inbox and any enabled channels.</p></div>${button("test-notification", "Send test", "bell")}</div><div class="setting-row"><div><h3>Automatic refresh</h3><p>Sample playback every 15 seconds; live service every 60 seconds.</p></div><button role="switch" aria-checked="${playing}" aria-label="Automatic refresh" class="switch ${playing ? "on" : ""}" data-action="playback"><span></span></button></div></section><section class="panel"><div class="panel-heading"><h2>Local workspace data</h2>${icon("shield")}</div><div class="setting-row"><div><h3>Export trade history</h3><p>Download your paper fills as CSV.</p></div>${button("export-trades", "Export CSV", "download")}</div><div class="setting-row"><div><h3>Reset paper portfolio</h3><p>Clear paper positions and trades. Start again with $100,000.</p></div>${button("reset", "Reset portfolio", "", "button danger-outline")}</div><div class="local-note">${icon("info")}<p>Settings, signals, and paper trades are stored in this browser. Automatic execution is turned off when you reopen the app. Use a private device for this single-user workspace.</p></div></section><section class="panel"><div class="panel-heading"><h2>About Sentra</h2>${chip("Version 1.0")}</div><p class="panel-description">A personal intraday research and trading workspace inspired by Jev-X Sentiment Analysis. Sample mode uses synthetic data. Live source availability is shown explicitly; missing data never becomes a trading signal.</p><button class="text-button panel-description" data-action="methodology">Read the sentiment methodology ${icon("arrow")}</button></section></div>`;
}

let returnFocus: HTMLElement | null = null;
function openModal(title: string, content: string, wide = false) {
  if (!modalRoot.querySelector("dialog"))
    returnFocus = document.activeElement as HTMLElement;
  modalRoot.innerHTML = `<dialog class="modal ${wide ? "wide-modal" : ""}" aria-labelledby="modal-title"><div class="modal-heading"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></div>${content}</dialog>`;
  const dialog = modalRoot.querySelector("dialog")!;
  dialog.showModal();
  dialog.addEventListener("close", () => {
    modalRoot.innerHTML = "";
    returnFocus?.focus({ preventScroll: true });
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex="0"]',
      ),
    ].filter(
      (el) => !el.hasAttribute("disabled") && el.getClientRects().length,
    );
    const first = focusable[0],
      last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (
        e.clientX < box.left ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom
      )
        dialog.close();
    }
  });
}
function closeModal() {
  modalRoot.querySelector("dialog")?.close();
}
function signalModal(id?: string) {
  const existing = signals.find((s) => s.id === id),
    s: Signal = existing ?? {
      id: uid(),
      name: `${assetNames[asset]} momentum`,
      asset,
      direction: "above",
      threshold: 70,
      rsiMax: 80,
      useVwap: true,
      allocation: 1000,
      stopPct: 2,
      enabled: true,
      auto: false,
      fired: false,
    };
  openModal(
    existing ? "Edit signal" : "Create a signal",
    `<p class="modal-description">Define what matters. Sentra watches for the conditions.</p><form id="signal-form" data-id="${s.id}">${input("Signal name", "signal-name", s.name, 'type="text" maxlength="64" required')}<div class="form-grid"><label class="field"><span>Market</span><select name="asset">${ASSETS.map((a) => `<option value="${a}" ${a === s.asset ? "selected" : ""}>${a} / USDT</option>`).join("")}</select></label><label class="field"><span>Sentiment condition</span><select name="direction"><option value="above" ${s.direction === "above" ? "selected" : ""}>At or above</option><option value="below" ${s.direction === "below" ? "selected" : ""}>At or below</option></select></label></div><label class="field range-field"><span>Sentiment threshold <output id="threshold-output">${s.threshold}</output></span><input name="threshold" id="signal-threshold" type="range" min="0" max="100" value="${s.threshold}"><span class="range-labels"><span>0 · Bearish</span><span>100 · Bullish</span></span></label>${input("Maximum RSI (14)", "signal-rsi", s.rsiMax, 'type="number" min="0" max="100" required')}<label class="check-field"><input type="checkbox" name="useVwap" ${s.useVwap ? "checked" : ""}> Require price above session VWAP</label><div class="form-divider"></div><label class="check-field"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}> Enable signal</label><label class="field"><span>When the signal triggers</span><select name="execution"><option value="alert" ${!s.auto ? "selected" : ""}>Send an alert</option><option value="paper" ${s.auto ? "selected" : ""}>Send an alert and place a paper buy</option></select></label><div class="form-grid">${input("Paper order value (USD)", "signal-allocation", s.allocation, 'type="number" min="10" max="100000" step="0.01" required')}${input("Stop loss (%)", "signal-stop", s.stopPct, 'type="number" min="0.1" max="50" step="0.1" required')}</div><p class="field-hint">Paper automation runs while this tab is open. A stop is checked at each refresh and can fill below its level. No live order is placed here.</p><p class="form-error" id="signal-error" role="alert"></p><div class="modal-actions">${existing ? button(`delete-signal-${s.id}`, "Delete signal", "", "text-button negative") : button("close-modal", "Cancel")}<button class="button primary" type="submit">${icon("check")}${existing ? "Save changes" : "Create signal"}</button></div></form>`,
  );
}
function tradeModal() {
  const m = current(),
    closes = m.candles.slice(-14),
    atr = closes.reduce((n, c) => n + c.high - c.low, 0) / closes.length,
    stopPct = Math.max(0.5, Math.min(10, ((atr * 2) / m.price) * 100));
  openModal(
    `Trade ${asset} / USDT`,
    `<div class="trade-market"><span>${coin(asset)}${assetNames[asset]}</span><strong>${money(m.price)}</strong></div><form id="trade-form"><label class="field"><span>Execution account</span><select name="execution" id="execution-account"><option value="paper">Paper portfolio · ${money(account.cash)} available</option>${connected && liveTrading && liveMode && !lastError ? '<option value="live">Live exchange · Real funds</option>' : ""}</select></label><div class="form-grid"><label class="field"><span>Side</span><select name="side"><option value="buy">Buy spot</option>${connected && liveTrading && liveMode && !lastError ? '<option value="sell">Sell spot (live only)</option>' : ""}</select></label><label class="field"><span>Order type</span><select name="type"><option value="market">Market</option></select></label></div>${input("Order value (USD)", "trade-value", 1000, 'type="number" min="10" step="0.01" required')}${input("Paper stop loss (%)", "trade-stop", stopPct.toFixed(2), 'type="number" min="0.1" max="50" step="0.01" required')}<p class="field-hint">Suggested stop distance: 2 × the mean high–low range of the last 14 bars (${stopPct.toFixed(2)}%). This is a volatility heuristic, not a guarantee. Live manual orders have no attached stop; manage protection on the exchange.</p><div class="trade-estimate" id="trade-estimate">Estimated size: ${number(1000 / m.price, 6)} ${asset} · Paper fee: $1.00</div><p class="form-error" id="trade-error" role="alert"></p><div class="modal-actions">${button("close-modal", "Cancel")}<button type="submit" class="button primary">Review order ${icon("arrow")}</button></div></form>`,
  );
}
async function api(path: string, data?: unknown): Promise<unknown> {
  if (!bridgeUrl || !bridgeToken)
    throw new Error("Connect your private service first.");
  const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${bridgeToken}`,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "The service rejected this request. Check your settings and try again.",
    );
  return result;
}
function validateMarket(value: unknown, a: Asset): Market {
  const m = value as Market;
  if (
    !m ||
    m.asset !== a ||
    !Number.isFinite(m.price) ||
    m.price <= 0 ||
    !Number.isFinite(m.change) ||
    !Number.isFinite(m.volume) ||
    !Number.isFinite(m.updated) ||
    !Array.isArray(m.candles) ||
    m.candles.length < 30 ||
    !Array.isArray(m.sources) ||
    !Array.isArray(m.feed) ||
    !Array.isArray(m.notes)
  )
    throw new Error("The service returned invalid market data.");
  if (
    m.candles.some(
      (c) =>
        ![c.time, c.open, c.high, c.low, c.close, c.volume].every(
          Number.isFinite,
        ) ||
        (c.sentiment !== null &&
          (!Number.isFinite(c.sentiment) ||
            c.sentiment < 0 ||
            c.sentiment > 100)),
    ) ||
    m.sources.some(
      (s) =>
        !["Social", "News", "On-chain"].includes(s.source) ||
        !Number.isFinite(s.score) ||
        s.score < 0 ||
        s.score > 100 ||
        !Number.isFinite(s.count),
    )
  )
    throw new Error("The service returned invalid observations.");
  if (
    m.feed.some(
      (f) =>
        !f ||
        !["Social", "News", "On-chain"].includes(f.source) ||
        typeof f.text !== "string" ||
        typeof f.author !== "string" ||
        !Number.isFinite(f.time) ||
        !Number.isFinite(f.score) ||
        f.score < 0 ||
        f.score > 100,
    )
  )
    throw new Error("The service returned invalid feed data.");
  return { ...m, live: true };
}
async function refresh(manual = false) {
  if (fetching) return;
  fetching = true;
  try {
    if (connected) {
      const results = await Promise.all(
        ASSETS.map(async (a) =>
          validateMarket(
            await api(`/api/snapshot?asset=${a}&interval=${interval}`),
            a,
          ),
        ),
      );
      markets = { BTC: results[0], ETH: results[1], SOL: results[2] };
      if (!liveMode) {
        sampleAccount = account;
        account = liveAccount;
      }
      liveMode = true;
    } else {
      tick++;
      markets = {
        BTC: sampleMarket("BTC", tick, interval),
        ETH: sampleMarket("ETH", tick, interval),
        SOL: sampleMarket("SOL", tick, interval),
      };
    }
    lastError = "";
    evaluateSignals();
    if (manual)
      toast(
        liveMode
          ? "Market data updated from your service."
          : "Sample playback advanced by one candle.",
      );
  } catch (e) {
    lastError = errorMessage(e);
    playing = false;
    toast(`${lastError} Auto refresh paused. Reconnect or refresh to retry.`);
  } finally {
    fetching = false;
    if (!modalRoot.querySelector("dialog")) render(!manual);
  }
}
function evaluateSignals() {
  if (liveMode && lastError) return;
  for (const p of [...account.positions]) {
    if (markets[p.asset].price <= p.stop) {
      account = sell(account, p.id, markets[p.asset].price, "Paper stop loss");
      void notify(
        `${p.asset} stop triggered`,
        `Paper position closed at ${money(markets[p.asset].price)}.`,
      );
    }
  }
  for (const signal of signals) {
    const met = matches(signal, markets[signal.asset]);
    if (met && !signal.fired) {
      signal.fired = true;
      void notify(
        `${signal.asset} signal triggered`,
        `${signal.name}: sentiment ${aggregate(markets[signal.asset])}/100.`,
      );
      if (signal.auto) {
        try {
          account = buy(
            account,
            signal.asset,
            signal.allocation,
            markets[signal.asset].price,
            signal.stopPct,
            `Signal: ${signal.name}`,
          );
          void notify(
            "Paper order filled",
            `${money(signal.allocation)} of ${signal.asset}.`,
          );
        } catch (e) {
          signal.auto = false;
          void notify("Paper automation paused", errorMessage(e));
        }
      }
    } else if (!met) signal.fired = false;
  }
  persist();
}
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something failed. Please try again.";
function formError(id: string, message: string) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = message;
    el.scrollIntoView({ block: "nearest" });
  }
}
function download(filename: string, text: string, mime = "text/csv") {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([text], { type: mime }));
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = (v: unknown) =>
  `"${String(v)
    .replace(/^[=+@-]/, "'$&")
    .replaceAll('"', '""')}"`;
function downloadHistory() {
  const rows = sampleMarket(asset, 0, 15, 2880).candles;
  download(
    `sentra-${asset}-sample.csv`,
    "time,open,high,low,close,volume,sentiment\n" +
      rows
        .map((c) =>
          [c.time, c.open, c.high, c.low, c.close, c.volume, c.sentiment].join(
            ",",
          ),
        )
        .join("\n"),
  );
}

document.addEventListener("click", async (event) => {
  const target = (event.target as Element).closest<HTMLElement>(
    "[data-action]",
  );
  if (!target || target.hasAttribute("disabled")) return;
  const action = target.dataset.action!;
  if (action === "dismiss-toast") {
    document.getElementById("toast")!.classList.remove("visible");
    return;
  }
  if (action === "close-modal") {
    closeModal();
    return;
  }
  if (action === "menu") {
    menuOpen = !menuOpen;
    render();
    return;
  }
  if (action === "new-signal") {
    signalModal();
    return;
  }
  if (action.startsWith("edit-")) {
    signalModal(action.slice(5));
    return;
  }
  if (action.startsWith("toggle-")) {
    const signal = signals.find((s) => s.id === action.slice(7))!;
    signal.enabled = !signal.enabled;
    signal.fired = false;
    persist();
    render();
    return;
  }
  if (action.startsWith("delete-signal-")) {
    const id = action.slice(14),
      signal = signals.find((s) => s.id === id);
    if (signal)
      openModal(
        "Delete this signal?",
        `<p class="modal-description">${esc(signal.name)} will stop monitoring and its rule will be removed. Existing paper positions stay open.</p><div class="modal-actions">${button("close-modal", "Keep signal")}${button(`confirm-delete-${id}`, "Delete signal", "", "button danger")}</div>`,
      );
    return;
  }
  if (action.startsWith("confirm-delete-")) {
    const id = action.slice(15);
    signals = signals.filter((s) => s.id !== id);
    closeModal();
    persist();
    render();
    toast("Signal deleted.");
    return;
  }
  if (action === "trade") {
    tradeModal();
    return;
  }
  if (action.startsWith("indicator-")) {
    const key = action.slice(10) as
      "vwap" | "rsi" | "macd" | "sentiment" | "volume";
    chartOptions[key] = !chartOptions[key];
    render();
    return;
  }
  if (action.startsWith("interval-")) {
    interval = Number(action.slice(9));
    if (!liveMode) {
      ASSETS.forEach((a) => (markets[a] = sampleMarket(a, tick, interval)));
      render();
    } else await refresh();
    return;
  }
  if (action === "chart-type") {
    chartOptions.line = !chartOptions.line;
    render();
    return;
  }
  if (action === "zoom-in" || action === "zoom-out") {
    chartOptions.zoom = Math.min(
      180,
      Math.max(24, chartOptions.zoom + (action === "zoom-in" ? -20 : 20)),
    );
    render();
    return;
  }
  if (action === "playback") {
    playing = !playing;
    render();
    toast(playing ? "Automatic refresh resumed." : "Automatic refresh paused.");
    return;
  }
  if (action === "refresh") {
    await refresh(true);
    return;
  }
  if (action === "evaluate") {
    if (liveMode && lastError) {
      toast("Refresh live data successfully before evaluating signals.");
      return;
    }
    evaluateSignals();
    render();
    toast("Signals evaluated against the latest available observations.");
    return;
  }
  if (action.startsWith("asset-")) {
    asset = action.slice(6) as Asset;
    render();
    return;
  }
  if (action === "clear-feed") {
    sourceFilter = "All sources";
    feedQuery = "";
    render();
    return;
  }
  if (action.startsWith("feed-")) {
    const feed = current().feed.filter(
      (f) =>
        (sourceFilter === "All sources" || sourceFilter === f.source) &&
        `${f.text} ${f.author}`.toLowerCase().includes(feedQuery.toLowerCase()),
    );
    const item = feed[Number(action.slice(5))];
    if (!item) return;
    openModal(
      item.author,
      `<div class="observation-detail">${chip(item.source)}${chip(scoreLabel(item.score), scoreTone(item.score))}<h3>${esc(item.text)}</h3><p>Sentiment score: <strong>${item.score}/100</strong> · ${time(item.time)} UTC</p><p class="muted">${liveMode ? "Provider observation. Sentiment is a model or heuristic score, not an independently verified fact." : "This is a synthetic observation included to demonstrate the sentiment workflow. It is not a real social post, news report, or on-chain claim."}</p>${item.url && /^https?:\/\//.test(item.url) ? `<a class="button" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open source ${icon("external")}</a>` : ""}</div>`,
    );
    return;
  }
  if (action === "methodology") {
    openModal(
      "How sentiment is calculated",
      `<div class="prose"><p>The index is a weighted mean of available source scores, from 0 (bearish) to 100 (bullish).</p><ul><li><strong>Social: 50%</strong> — keyword polarity of recent posts, or Jev when configured.</li><li><strong>News: 30%</strong> — keyword polarity of recent RSS headlines.</li><li><strong>On-chain: 20%</strong> — Ethereum block activity relative to earlier blocks. Activity is a proxy, not a directional price forecast.</li></ul><p>Missing sources are omitted and the remaining weights are normalized. With no sources, sentiment is unavailable and no sentiment signal triggers.</p><p>Scores ≥65 are labeled bullish; scores ≤40 bearish. The sample workspace uses deterministic synthetic scores. Source scores are not probabilities or investment advice.</p>${current()
        .notes.map((n) => `<p class="muted">${esc(n)}</p>`)
        .join("")}</div>`,
    );
    return;
  }
  if (action === "chart-data") {
    openModal(
      "Recent candle data",
      `<p class="modal-description">Latest 15 candles · ${asset} · ${interval}-minute interval · ${liveMode ? "Live provider" : "Synthetic sample"}</p><div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable data table"><table><thead><tr><th>UTC</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th><th>Sentiment</th></tr></thead><tbody>${current()
        .candles.slice(-15)
        .reverse()
        .map(
          (c) =>
            `<tr><td>${candleTime(c.time)}</td><td>${number(c.open)}</td><td>${number(c.high)}</td><td>${number(c.low)}</td><td>${number(c.close)}</td><td>${number(c.volume)}</td><td>${c.sentiment ?? "—"}</td></tr>`,
        )
        .join("")}</tbody></table></div>`,
      true,
    );
    return;
  }
  if (action === "alerts") {
    const items = [...alerts];
    alerts.forEach((a) => (a.read = true));
    persist();
    openModal(
      "Alert inbox",
      `<div class="alerts-list">${items.length ? items.map((a) => `<article class="alert-item">${icon(a.title.includes("order") ? "wallet" : "bell")}<div><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p><span class="muted caption">${new Date(a.time).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</span></div></article>`).join("") : `<div class="empty-state">${icon("bell")}<h3>You’re all caught up</h3><p>Signal triggers and trade events will appear here.</p><a href="#signals" class="button" data-action="close-modal">Manage signals</a></div>`}</div>`,
    );
    return;
  }
  if (action.startsWith("portfolio-")) {
    portfolioTab = action.slice(10);
    render();
    return;
  }
  if (action.startsWith("close-position-")) {
    const id = action.slice(15),
      p = account.positions.find((p) => p.id === id);
    if (!p) return;
    openModal(
      "Close paper position",
      `<p class="modal-description">Sell ${number(p.quantity, 6)} ${p.asset} at the current ${liveMode ? "live" : "sample"} price of ${money(markets[p.asset].price)}. A 0.1% paper fee applies.</p><div class="modal-actions">${button("close-modal", "Cancel")}${button(`confirm-close-${p.id}`, "Close paper position", "", "button primary")}</div>`,
    );
    return;
  }
  if (action.startsWith("confirm-close-")) {
    const id = action.slice(14),
      p = account.positions.find((p) => p.id === id);
    if (p) {
      account = sell(account, id, markets[p.asset].price);
      await notify(
        "Paper position closed",
        `${p.asset} sold at ${money(markets[p.asset].price)}.`,
      );
      closeModal();
      persist();
      render();
      toast("Paper position closed.");
    }
    return;
  }
  if (action === "export-trades") {
    download(
      "sentra-paper-trades.csv",
      "time,asset,side,quantity,price,fee,reason,realized_pnl\n" +
        account.trades
          .map((t) =>
            [
              new Date(t.time).toISOString(),
              t.asset,
              t.side,
              t.quantity,
              t.price,
              t.fee,
              t.reason,
              t.pnl ?? "",
            ]
              .map(csvCell)
              .join(","),
          )
          .join("\n"),
    );
    toast("Paper trade history exported.");
    return;
  }
  if (action === "download-sample") {
    downloadHistory();
    return;
  }
  if (action === "clear-import") {
    imported = null;
    importName = "";
    testResult = null;
    render();
    return;
  }
  if (action === "export-backtest") {
    if (!testResult) {
      toast("Run a backtest before exporting results.");
      return;
    }
    download(
      "sentra-backtest.csv",
      "time,side,price,net_pnl\n" +
        testResult.trades
          .map((t) =>
            [new Date(t.time).toISOString(), t.side, t.price, t.pnl]
              .map(csvCell)
              .join(","),
          )
          .join("\n"),
    );
    return;
  }
  if (action === "notifications") {
    if (desktop) desktop = false;
    else if (!("Notification" in window))
      toast(
        "This browser does not support notifications. Use the alert inbox or configure mobile delivery on your service.",
      );
    else {
      const permission = await Notification.requestPermission();
      desktop = permission === "granted";
      if (!desktop)
        toast(
          "Notifications are blocked. Change the browser’s site permission to allow them.",
        );
    }
    persist();
    render();
    return;
  }
  if (action === "test-notification") {
    await notify(
      "Sentra test notification",
      "Your alert inbox is ready for signal and trade events.",
    );
    if (connected) {
      try {
        await api("/api/notify", {
          title: "Sentra test notification",
          body: "Your mobile delivery is connected.",
        });
      } catch (e) {
        toast(errorMessage(e));
        return;
      }
    }
    render();
    toast("Test event saved to the alert inbox.");
    return;
  }
  if (action === "reset") {
    openModal(
      "Reset paper portfolio?",
      `<p class="modal-description">This clears all paper positions and trade history and restores $100,000. Signal automation will be paused. Export your trade history first if you need a copy.</p><div class="modal-actions">${button("close-modal", "Keep portfolio")}${button("confirm-reset", "Reset paper portfolio", "", "button danger")}</div>`,
    );
    return;
  }
  if (action === "confirm-reset") {
    account = freshAccount();
    signals.forEach((s) => (s.auto = false));
    persist();
    closeModal();
    render();
    toast("Paper portfolio reset to $100,000.");
    return;
  }
  if (action === "disconnect") {
    if (liveMode) {
      liveAccount = account;
      account = sampleAccount;
    }
    lastError = "";
    connected = false;
    liveMode = false;
    liveTrading = false;
    bridgeToken = "";
    signals.forEach((s) => (s.auto = false));
    tick = 0;
    ASSETS.forEach((a) => (markets[a] = sampleMarket(a, 0, interval)));
    render();
    toast(
      "Service disconnected. Paper automation paused. Server automation must be stopped separately.",
    );
    return;
  }
  if (action === "reconcile-live") {
    if (!connected) {
      toast("Connect your private service first.");
      return;
    }
    openModal(
      "Clear resolved automation state?",
      `<p class="modal-description">First stop automation, then check and close its orders and positions on the exchange. This clears local tracking only; it does not cancel orders or sell assets. The order audit log is retained.</p><form id="reconcile-form"><label class="check-field"><input type="checkbox" name="confirmed" required> I checked the exchange and closed all automation positions.</label><p id="reconcile-error" class="form-error" role="alert"></p><div class="modal-actions">${button("close-modal", "Cancel")}<button class="button" type="submit">Clear resolved state</button></div></form>`,
    );
    return;
  }
  if (action === "stop-live" || action === "status-live") {
    try {
      const result = await api(
        "/api/automation",
        action === "stop-live" ? { enabled: false } : undefined,
      );
      openModal(
        "Live automation status",
        `<div class="prose"><pre>${esc(JSON.stringify(result, null, 2))}</pre><p>Open positions remain on your exchange when automation is stopped.</p></div>`,
      );
    } catch (e) {
      toast(errorMessage(e));
    }
    return;
  }
});

document.addEventListener("change", async (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (target.id === "chart-asset") {
    asset = target.value as Asset;
    render();
  }
  if (target.id === "source-filter") {
    sourceFilter = target.value;
    render();
  }
  if (target.id === "history-import") {
    const file = (target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Choose a CSV smaller than 8 MiB.");
      imported = parseHistory(await file.text());
      importName = file.name;
      testResult = null;
      render();
      toast(`Imported ${number(imported.length)} historical observations.`);
    } catch (e) {
      formError("backtest-error", errorMessage(e));
    }
  }
});
document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "signal-threshold")
    document.getElementById("threshold-output")!.textContent = target.value;
  if (target.id === "trade-value")
    document.getElementById("trade-estimate")!.textContent =
      `Estimated size: ${number(Number(target.value) / current().price, 6)} ${asset} · Paper fee: ${money(Number(target.value) * 0.001)}`;
  if (target.id === "feed-search") {
    const pos = target.selectionStart;
    feedQuery = target.value;
    render();
    const input = document.getElementById("feed-search") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(pos, pos);
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target as HTMLFormElement;
  event.preventDefault();
  const data = new FormData(form),
    n = (key: string) => Number(data.get(key));
  if (form.id === "signal-form") {
    const name = String(data.get("signal-name")).trim();
    if (!name) {
      formError("signal-error", "Enter a name for this signal.");
      return;
    }
    const signal: Signal = {
      id: form.dataset.id!,
      name,
      asset: data.get("asset") as Asset,
      direction: data.get("direction") as "above" | "below",
      threshold: n("threshold"),
      rsiMax: n("signal-rsi"),
      useVwap: data.has("useVwap"),
      allocation: n("signal-allocation"),
      stopPct: n("signal-stop"),
      auto: data.get("execution") === "paper",
      enabled: data.has("enabled"),
      fired: false,
    };
    const index = signals.findIndex((s) => s.id === signal.id);
    if (index < 0) signals.unshift(signal);
    else signals[index] = signal;
    persist();
    closeModal();
    evaluateSignals();
    render();
    toast(
      `${signal.name} saved. ${!signal.enabled ? "Signal remains paused." : signal.auto ? "Paper automation enabled for this session." : "Alert monitoring enabled."}`,
    );
    return;
  }
  if (form.id === "trade-form") {
    const value = n("trade-value"),
      stop = n("trade-stop"),
      live = data.get("execution") === "live",
      side = String(data.get("side")),
      tradeAsset = asset,
      quote = current().price;
    if (!live && side === "sell") {
      formError(
        "trade-error",
        "Close a paper position from your portfolio to sell.",
      );
      return;
    }
    try {
      if (!live) buy(account, tradeAsset, value, quote, stop);
    } catch (e) {
      formError("trade-error", errorMessage(e));
      return;
    }
    const requestId = uid();
    openModal(
      live ? "Confirm live order" : "Confirm paper order",
      `<div class="review-order">${chip(live ? "Real funds" : "Paper trade", live ? "warning" : "")}<dl><div><dt>Market</dt><dd>${tradeAsset} / USDT</dd></div><div><dt>Side</dt><dd>${side === "buy" ? "Buy" : "Sell"} · Market</dd></div><div><dt>Order value</dt><dd>${money(value)}</dd></div><div><dt>Estimated quantity</dt><dd>${number(value / quote, 6)} ${tradeAsset}</dd></div><div><dt>${live ? "Protection" : "Stop price"}</dt><dd>${live ? "Manage on exchange" : money(quote * (1 - stop / 100))}</dd></div><div><dt>${live ? "Fees" : "Paper fee"}</dt><dd>${live ? "Exchange schedule" : money(value * 0.001)}</dd></div></dl><p class="field-hint">${live ? "This sends a real market order to your configured exchange. Final fill price and fees can differ. Do not resubmit an uncertain order; check the exchange first." : "This simulates a fill at the displayed price using paper funds."}</p><p id="confirm-error" class="form-error" role="alert"></p><div class="modal-actions">${button("close-modal", "Cancel")}<button class="button ${live ? "danger" : "primary"}" id="confirm-order">${live ? "Place live order" : "Place paper order"}</button></div></div>`,
    );
    document.getElementById("confirm-order")!.onclick = async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "Placing order…";
      try {
        if (live) {
          const result = await api("/api/order", {
            asset: tradeAsset,
            side,
            notional: value,
            requestId,
          });
          await notify("Live order submitted", JSON.stringify(result));
        } else {
          account = buy(account, tradeAsset, value, quote, stop);
          await notify(
            "Paper order filled",
            `${money(value)} of ${tradeAsset} at ${money(quote)}.`,
          );
        }
        persist();
        closeModal();
        render();
        toast(
          live
            ? "Order submitted. Verify the fill on your exchange."
            : `Paper buy filled. ${tradeAsset} is now in your portfolio.`,
        );
      } catch (error) {
        formError("confirm-error", errorMessage(error));
        if (live) button.textContent = "Check exchange before retrying";
        else {
          button.disabled = false;
          button.textContent = "Place paper order";
        }
      }
    };
    return;
  }
  if (form.id === "backtest-form") {
    try {
      asset = data.get("testAsset") as Asset;
      savedStrategy = {
        threshold: n("threshold"),
        exitThreshold: n("exitThreshold"),
        rsiMax: n("rsiMax"),
        useVwap: data.has("useVwap"),
        stopPct: n("stopPct"),
        takePct: n("takePct"),
        allocationPct: n("allocationPct"),
        feeBps: n("feeBps"),
        slippageBps: n("slippageBps"),
        initial: n("initial"),
      };
      const bars = imported ?? sampleMarket(asset, 0, 15, 2880).candles;
      testResult = backtest(bars, savedStrategy);
      testDescription = `${imported ? importName : "Synthetic sample"} · ${asset} · ${bars.length} observations · ${savedStrategy.feeBps} bps fee / ${savedStrategy.slippageBps} bps slippage`;
      render();
      toast(
        `Backtest complete. ${testResult.trades.filter((t) => t.side === "Sell").length} trades closed.`,
      );
    } catch (e) {
      formError("backtest-error", errorMessage(e));
    }
    return;
  }
  if (form.id === "risk-form") {
    try {
      const result = positionSize(
        n("risk-equity"),
        n("risk-percent"),
        n("risk-entry"),
        n("risk-stop"),
      );
      document.getElementById("risk-result")!.innerHTML =
        `<strong>${number(result.quantity, 6)} units</strong><span>${money(result.notional)} position value</span><span>${money(result.loss)} price risk before fees & slippage</span>`;
      formError("risk-error", "");
    } catch (e) {
      document.getElementById("risk-result")!.textContent = "";
      formError("risk-error", errorMessage(e));
    }
    return;
  }
  if (form.id === "connection-form") {
    const candidate = String(data.get("bridge-url")).trim();
    const previous = {
      bridgeUrl,
      bridgeToken,
      connected,
      liveTrading,
      liveMode,
    };
    try {
      const url = new URL(candidate);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname)
          ))
      )
        throw new Error(
          "Use HTTPS, or HTTP on localhost, without credentials, query parameters, or fragments.",
        );
      bridgeUrl = candidate.replace(/\/$/, "");
      bridgeToken = String(data.get("bridge-token"));
      const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      submit.disabled = true;
      submit.textContent = "Connecting…";
      const health = (await api("/api/health")) as { liveTrading: boolean };
      connected = true;
      liveTrading = health.liveTrading === true;
      signals.forEach((s) => {
        s.auto = false;
        s.fired = false;
      });
      await refresh();
      persist();
      render();
      toast(
        lastError
          ? `Service connected, but market data failed: ${lastError}`
          : "Service connected. Switched to your separate live-price paper portfolio.",
      );
    } catch (e) {
      ({ bridgeUrl, bridgeToken, connected, liveTrading, liveMode } = previous);
      formError("connection-error", errorMessage(e));
      const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Connect service";
      }
    }
    return;
  }
  if (form.id === "reconcile-form") {
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    submit.disabled = true;
    try {
      await api("/api/automation/reconcile", {
        confirmation: "exchange-checked-and-positions-closed",
      });
      closeModal();
      toast("Resolved automation tracking cleared. The order log is retained.");
    } catch (e) {
      formError("reconcile-error", errorMessage(e));
      submit.disabled = false;
    }
    return;
  }
  if (form.id === "live-auto-form") {
    const payload = {
      enabled: true,
      asset: data.get("live-asset") as Asset,
      threshold: n("live-threshold"),
      exitThreshold: n("live-exit"),
      notional: n("live-allocation"),
      stopPct: n("live-stop"),
      rsiMax: n("live-rsi"),
    };
    openModal(
      "Arm live automation?",
      `<div class="prose"><p>This authorizes real ${payload.asset} buys of ${money(payload.notional)} when sentiment reaches ${payload.threshold}, with an RSI limit of ${payload.rsiMax}.</p><p>The service will attempt to exit at a ${payload.stopPct}% stop or sentiment ≤${payload.exitThreshold}. Stops are polled, not guaranteed exchange orders. The strategy continues after this tab closes.</p><p id="arm-error" class="form-error" role="alert"></p></div><div class="modal-actions">${button("close-modal", "Cancel")}<button id="confirm-arm" class="button danger">Arm live strategy</button></div>`,
    );
    document.getElementById("confirm-arm")!.onclick = async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        await api("/api/automation", payload);
        closeModal();
        toast("Live strategy armed on your private service.");
      } catch (error) {
        formError("arm-error", errorMessage(error));
        button.disabled = false;
      }
    };
    return;
  }
});

function navigate() {
  const name = location.hash.slice(1);
  if (name === "main") return;
  page = Object.hasOwn(pageNames, name) ? (name as Page) : "overview";
  menuOpen = false;
  closeModal();
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", navigate);
document.addEventListener("keydown", (e) => {
  if (!menuOpen) return;
  if (e.key === "Escape") {
    menuOpen = false;
    render();
    app.querySelector<HTMLElement>(".mobile-menu")?.focus();
  }
  if (e.key === "Tab") {
    const items = [
      ...app.querySelectorAll<HTMLElement>(".sidebar button, .sidebar a[href]"),
    ].filter((el) => el.getClientRects().length);
    const first = items[0],
      last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
let resizeTimer: ReturnType<typeof setTimeout>;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (menuOpen && window.innerWidth > 650) {
      menuOpen = false;
      render();
    } else mountChart();
  }, 150);
});
let pulse = 0;
setInterval(() => {
  pulse++;
  const editing = ["INPUT", "SELECT", "TEXTAREA"].includes(
    document.activeElement?.tagName ?? "",
  );
  if (
    playing &&
    !menuOpen &&
    !document.hidden &&
    !modalRoot.querySelector("dialog") &&
    !editing &&
    (!liveMode || pulse % 4 === 0)
  )
    void refresh();
}, 15000);
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {
    /* Alert inbox works without a service worker. */
  });
navigate();
