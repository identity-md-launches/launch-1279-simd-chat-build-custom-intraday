import { type Candle, money, number, rsi, vwap, macd, escape } from "./core.ts";
export interface ChartOptions {
  line: boolean;
  vwap: boolean;
  volume: boolean;
  sentiment: boolean;
  rsi: boolean;
  macd: boolean;
  zoom: number;
}
const price = (n: number) => number(n, n > 1000 ? 0 : 2);
const linePath = (
  values: number[],
  x: (i: number) => number,
  y: (n: number) => number,
) =>
  values
    .map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(n).toFixed(2)}`)
    .join(" ");
export function renderChart(
  host: HTMLElement,
  all: Candle[],
  options: ChartOptions,
) {
  const bars = all.slice(-options.zoom),
    width = Math.max(260, host.clientWidth),
    small = width < 500,
    height = small ? 285 : 300;
  const right = small ? 55 : 67,
    left = 10,
    top = 15,
    bottom = 27,
    plotW = width - right - left,
    plotH = height - bottom - top;
  const lows = bars.map((c) => c.low),
    highs = bars.map((c) => c.high),
    min = Math.min(...lows),
    max = Math.max(...highs),
    gap = (max - min) * 0.12 || 1;
  const y = (p: number) =>
      top + ((max + gap - p) / (max - min + gap * 2)) * plotH,
    x = (i: number) => left + ((i + 0.5) / bars.length) * plotW;
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = min - gap + ((max - min + gap * 2) * i) / 4,
      py = y(value);
    return `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${py}" y2="${py}"/><text class="chart-axis" x="${width - right + 8}" y="${py + 4}">${price(value)}</text>`;
  }).join("");
  const volumeMax = Math.max(...bars.map((c) => c.volume), 1);
  const volumes = options.volume
    ? bars
        .map(
          (c, i) =>
            `<rect class="chart-volume ${c.close >= c.open ? "rise" : "fall"}" x="${x(i) - (plotW / bars.length) * 0.34}" y="${height - bottom - (c.volume / volumeMax) * 45}" width="${(plotW / bars.length) * 0.68}" height="${(c.volume / volumeMax) * 45}"/>`,
        )
        .join("")
    : "";
  const candles = options.line
    ? `<path class="price-line" d="${linePath(
        bars.map((c) => c.close),
        x,
        y,
      )}"/>`
    : bars
        .map(
          (c, i) =>
            `<g class="candle ${c.close >= c.open ? "rise" : "fall"}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(c.high)}" y2="${y(c.low)}"/><rect x="${x(i) - (plotW / bars.length) * 0.31}" y="${Math.min(y(c.open), y(c.close))}" width="${Math.max(1, (plotW / bars.length) * 0.62)}" height="${Math.max(1.3, Math.abs(y(c.close) - y(c.open)))}" rx=".6"/></g>`,
        )
        .join("");
  const vwaps = vwap(all).slice(-bars.length),
    hasSentiment = bars.every((c) => c.sentiment !== null);
  const overlays =
    (options.vwap
      ? `<path class="vwap-line" d="${linePath(vwaps, x, y)}"/>`
      : "") +
    (options.sentiment && hasSentiment
      ? `<path class="sentiment-line" d="${linePath(
          bars.map((c) => c.sentiment!),
          x,
          (n) => height - bottom - 35 - (n / 100) * plotH * 0.65,
        )}"/>`
      : "");
  const labels = Array.from({ length: small ? 3 : 6 }, (_, i) => {
    const index = Math.round((i / (small ? 2 : 5)) * (bars.length - 1));
    return `<text class="chart-axis" x="${x(index)}" y="${height - 6}" text-anchor="${i === 0 ? "start" : "middle"}">${new Date(bars[index].time).toISOString().slice(11, 16)}</text>`;
  }).join("");
  const last = bars.at(-1)!,
    latestY = y(last.close);
  host.innerHTML = `<div class="chart-interactive" tabindex="0" role="group" aria-label="Price chart. Use left and right arrow keys to inspect candles."><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${bars.length} price candles with ${options.vwap ? "VWAP, " : ""}${options.volume ? "volume, " : ""}${options.sentiment && hasSentiment ? "sentiment, " : ""}overlays. Latest close ${money(last.close)}.">${grid}${volumes}${overlays}${candles}<line class="last-price-line" x1="0" x2="${width - right}" y1="${latestY}" y2="${latestY}"/><rect class="last-price-bg" x="${width - right}" y="${latestY - 10}" width="${right}" height="20" rx="3"/><text class="last-price-text" x="${width - right + 5}" y="${latestY + 4}">${price(last.close)}</text>${labels}<line id="crosshair" x1="0" x2="0" y1="0" y2="${height - bottom}" class="crosshair" visibility="hidden"/></svg><div class="chart-tooltip" id="chart-tooltip" hidden></div></div>`;
  let index = bars.length - 1;
  const inspect = (i: number) => {
    index = Math.min(bars.length - 1, Math.max(0, i));
    const c = bars[index];
    const tooltip = host.querySelector<HTMLElement>("#chart-tooltip")!;
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${new Date(c.time).toISOString().slice(11, 16)} UTC</strong><span>O ${price(c.open)} · H ${price(c.high)}</span><span>L ${price(c.low)} · C ${price(c.close)}</span><span>Volume ${number(c.volume)} · Sentiment ${c.sentiment ?? "unavailable"}</span>`;
    tooltip.style.insetInlineStart = `${Math.min(Math.max(8, x(index) - 85), Math.max(8, width - 225))}px`;
    const crosshair = host.querySelector("#crosshair")!;
    crosshair.setAttribute("visibility", "visible");
    crosshair.setAttribute("x1", String(x(index)));
    crosshair.setAttribute("x2", String(x(index)));
  };
  const target = host.querySelector<HTMLElement>(".chart-interactive")!;
  target.onpointermove = (e) =>
    inspect(
      Math.floor(
        ((e.clientX - target.getBoundingClientRect().left - left) / plotW) *
          bars.length,
      ),
    );
  target.onpointerleave = () => {
    host.querySelector<HTMLElement>("#chart-tooltip")!.hidden = true;
    host.querySelector("#crosshair")!.setAttribute("visibility", "hidden");
  };
  target.onkeydown = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      inspect(index + (e.key === "ArrowLeft" ? -1 : 1));
    }
  };
  if (options.rsi) {
    const values = rsi(all).slice(-bars.length),
      py = (n: number) => 62 - (n / 100) * 50;
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="subchart"><span>RSI (14) <strong>${values.at(-1)!.toFixed(1)}</strong></span><svg viewBox="0 0 ${width} 76" role="img" aria-label="RSI ${values.at(-1)!.toFixed(1)}"><line class="chart-grid" x1="0" x2="${plotW}" y1="${py(70)}" y2="${py(70)}"/><line class="chart-grid" x1="0" x2="${plotW}" y1="${py(30)}" y2="${py(30)}"/><path class="sentiment-line" d="${linePath(values, x, py)}"/><text class="chart-axis" x="${width - right + 8}" y="${py(70) + 4}">70</text><text class="chart-axis" x="${width - right + 8}" y="${py(30) + 4}">30</text></svg></div>`,
    );
  }
  if (options.macd) {
    const m = macd(all),
      line = m.line.slice(-bars.length),
      signal = m.signal.slice(-bars.length),
      hist = m.histogram.slice(-bars.length),
      extent = Math.max(...line.map(Math.abs), ...signal.map(Math.abs), 1),
      py = (n: number) => 42 - (n / extent) * 28;
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="subchart"><span>MACD (12, 26, 9) <strong>${line.at(-1)!.toFixed(2)}</strong></span><svg viewBox="0 0 ${width} 80" role="img" aria-label="MACD line ${line.at(-1)!.toFixed(2)}"><line class="chart-grid" x1="0" x2="${plotW}" y1="42" y2="42"/>${hist.map((n, i) => `<rect class="chart-volume ${n >= 0 ? "rise" : "fall"}" x="${x(i)}" y="${Math.min(py(n), 42)}" width="${(plotW / bars.length) * 0.7}" height="${Math.max(1, Math.abs(py(n) - 42))}"/>`).join("")}<path class="price-line" d="${linePath(line, x, py)}"/><path class="vwap-line" d="${linePath(signal, x, py)}"/></svg></div>`,
    );
  }
}
export function sparkline(values: number[], tone = "positive"): string {
  const lo = Math.min(...values),
    hi = Math.max(...values),
    range = hi - lo || 1;
  return `<svg class="sparkline ${escape(tone)}" viewBox="0 0 110 36" aria-hidden="true"><path d="${linePath(
    values,
    (i) => (i / Math.max(1, values.length - 1)) * 110,
    (n) => 32 - ((n - lo) / range) * 28,
  )}"/></svg>`;
}
export function equityChart(values: number[]): string {
  const lo = Math.min(...values) * 0.998,
    hi = Math.max(...values) * 1.002;
  const path = linePath(
    values,
    (i) => 10 + (i / Math.max(1, values.length - 1)) * 830,
    (n) => 200 - ((n - lo) / (hi - lo)) * 170,
  );
  return `<figure class="equity-figure"><svg class="equity-chart" viewBox="0 0 900 225" role="img" aria-label="Equity curve from ${money(values[0])} to ${money(values.at(-1)!)}"><defs><linearGradient id="equity-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#65d7aa" stop-opacity=".18"/><stop offset="1" stop-color="#65d7aa" stop-opacity="0"/></linearGradient></defs>${[40, 90, 140, 190].map((y) => `<line class="chart-grid" x1="0" x2="850" y1="${y}" y2="${y}"/>`).join("")}<path d="${path} L840,220 L10,220Z" fill="url(#equity-fill)"/><path d="${path}" class="price-line"/></svg><figcaption class="equity-caption"><span>Start</span><span>End of test</span></figcaption></figure>`;
}
