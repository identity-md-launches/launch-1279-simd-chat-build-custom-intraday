export type Asset = "BTC" | "ETH" | "SOL";
export type Source = "Social" | "News" | "On-chain";
export type Page =
  | "overview"
  | "markets"
  | "signals"
  | "backtesting"
  | "portfolio"
  | "connections"
  | "settings";
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sentiment: number | null;
}
export interface FeedItem {
  id: string;
  source: Source;
  author: string;
  text: string;
  score: number;
  time: number;
  url?: string;
}
export interface Market {
  asset: Asset;
  price: number;
  change: number;
  volume: number;
  candles: Candle[];
  sources: { source: Source; score: number; count: number }[];
  feed: FeedItem[];
  updated: number;
  live: boolean;
  notes: string[];
}
export interface Signal {
  id: string;
  name: string;
  asset: Asset;
  direction: "above" | "below";
  threshold: number;
  rsiMax: number;
  useVwap: boolean;
  allocation: number;
  stopPct: number;
  enabled: boolean;
  auto: boolean;
  fired: boolean;
}
export interface Position {
  id: string;
  asset: Asset;
  quantity: number;
  entry: number;
  stop: number;
  time: number;
}
export interface Trade {
  id: string;
  asset: Asset;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  time: number;
  reason: string;
  pnl?: number;
}
export interface Account {
  cash: number;
  positions: Position[];
  trades: Trade[];
}
export interface AlertItem {
  id: string;
  title: string;
  body: string;
  time: number;
  read: boolean;
}
export interface Strategy {
  threshold: number;
  exitThreshold: number;
  rsiMax: number;
  useVwap: boolean;
  stopPct: number;
  takePct: number;
  allocationPct: number;
  feeBps: number;
  slippageBps: number;
  initial: number;
}
export interface Backtest {
  equity: number[];
  trades: { time: number; side: string; price: number; pnl: number }[];
  returnPct: number;
  drawdown: number;
  winRate: number;
  final: number;
}
export const ASSETS: Asset[] = ["BTC", "ETH", "SOL"];
export const INITIAL_CASH = 100_000;
export const assetNames: Record<Asset, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
};
export const money = (n: number, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
export const number = (n: number, digits = 2) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
export const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export const uid = () => crypto.randomUUID();

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  let previous = values[0] ?? 0;
  return values.map(
    (value, i) => (previous = i ? value * k + previous * (1 - k) : value),
  );
}
export function rsi(candles: Candle[], period = 14): number[] {
  let gain = 0,
    loss = 0;
  return candles.map((c, i) => {
    if (i === 0) return 50;
    const delta = c.close - candles[i - 1].close;
    if (i <= period) {
      gain += Math.max(delta, 0) / period;
      loss += Math.max(-delta, 0) / period;
    } else {
      gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
    }
    return i < period
      ? 50
      : !loss
        ? gain
          ? 100
          : 50
        : 100 - 100 / (1 + gain / loss);
  });
}
export function vwap(candles: Candle[]): number[] {
  let cumulative = 0,
    volume = 0,
    day = "";
  return candles.map((c) => {
    const nextDay = new Date(c.time).toISOString().slice(0, 10);
    if (nextDay !== day) {
      day = nextDay;
      cumulative = 0;
      volume = 0;
    }
    cumulative += ((c.high + c.low + c.close) / 3) * c.volume;
    volume += c.volume;
    return volume ? cumulative / volume : c.close;
  });
}
export function macd(candles: Candle[]) {
  const close = candles.map((c) => c.close),
    fast = ema(close, 12),
    slow = ema(close, 26);
  const line = fast.map((n, i) => n - slow[i]),
    signal = ema(line, 9);
  return { line, signal, histogram: line.map((n, i) => n - signal[i]) };
}
export function aggregate(market: Market): number | null {
  const sources = market.sources.filter((s) => s.count > 0);
  if (!sources.length) return null;
  const weights: Record<Source, number> = {
    Social: 0.5,
    News: 0.3,
    "On-chain": 0.2,
  };
  const total = sources.reduce((n, s) => n + weights[s.source], 0);
  return Math.round(
    sources.reduce((n, s) => n + s.score * weights[s.source], 0) / total,
  );
}
export function matches(signal: Signal, market: Market): boolean {
  const score = aggregate(market),
    bars = market.candles;
  if (!signal.enabled || score === null || bars.length < 15) return false;
  return (
    (signal.direction === "above"
      ? score >= signal.threshold
      : score <= signal.threshold) &&
    rsi(bars).at(-1)! <= signal.rsiMax &&
    (!signal.useVwap || market.price >= vwap(bars).at(-1)!)
  );
}
export function positionSize(
  equity: number,
  riskPct: number,
  entry: number,
  stop: number,
) {
  if (
    ![equity, riskPct, entry, stop].every(Number.isFinite) ||
    equity <= 0 ||
    riskPct <= 0 ||
    riskPct > 100 ||
    entry <= 0 ||
    stop <= 0 ||
    stop >= entry
  )
    throw new Error("Use a positive balance and a stop below the entry price.");
  const budget = (equity * riskPct) / 100,
    quantity = Math.min(budget / (entry - stop), equity / (entry * 1.001));
  return {
    budget,
    quantity,
    notional: quantity * entry,
    loss: quantity * (entry - stop),
  };
}
export function buy(
  account: Account,
  asset: Asset,
  allocation: number,
  price: number,
  stopPct: number,
  reason = "Manual paper order",
): Account {
  if (
    ![allocation, price, stopPct].every(Number.isFinite) ||
    allocation <= 0 ||
    price <= 0 ||
    stopPct <= 0 ||
    stopPct >= 100
  )
    throw new Error(
      "Enter a positive order value and a stop between 0 and 100%.",
    );
  const fee = allocation * 0.001;
  if (allocation + fee > account.cash)
    throw new Error(
      "Not enough paper cash. Reduce the order value, including the 0.1% fee.",
    );
  const quantity = allocation / price,
    time = Date.now();
  return {
    cash: account.cash - allocation - fee,
    positions: [
      ...account.positions,
      {
        id: uid(),
        asset,
        quantity,
        entry: price,
        stop: price * (1 - stopPct / 100),
        time,
      },
    ],
    trades: [
      { id: uid(), asset, side: "buy", quantity, price, fee, time, reason },
      ...account.trades,
    ],
  };
}
export function sell(
  account: Account,
  id: string,
  price: number,
  reason = "Manual close",
): Account {
  const position = account.positions.find((p) => p.id === id);
  if (!position || !Number.isFinite(price) || price <= 0)
    throw new Error("This position is no longer available.");
  const value = position.quantity * price,
    fee = value * 0.001;
  return {
    cash: account.cash + value - fee,
    positions: account.positions.filter((p) => p.id !== id),
    trades: [
      {
        id: uid(),
        asset: position.asset,
        side: "sell",
        quantity: position.quantity,
        price,
        fee,
        time: Date.now(),
        reason,
        pnl:
          (price - position.entry) * position.quantity -
          fee -
          position.entry * position.quantity * 0.001,
      },
      ...account.trades,
    ],
  };
}

// Signals use completed bar i-1; fills use the following open. Stops win ambiguous bars.
export function backtest(candles: Candle[], s: Strategy): Backtest {
  if (candles.length < 30) throw new Error("At least 30 candles are required.");
  const values = Object.values(s).filter((v) => typeof v === "number");
  if (
    !values.every(Number.isFinite) ||
    s.initial <= 0 ||
    s.allocationPct <= 0 ||
    s.allocationPct > 100 ||
    s.stopPct <= 0 ||
    s.stopPct >= 100 ||
    s.takePct <= 0 ||
    s.feeBps < 0 ||
    s.slippageBps < 0
  )
    throw new Error("Enter valid strategy parameters.");
  if (candles.some((c) => c.sentiment === null))
    throw new Error(
      "This dataset has no historical sentiment. Import paired candle and sentiment observations.",
    );
  const rsis = rsi(candles),
    vwaps = vwap(candles),
    fee = s.feeBps / 10000,
    slip = s.slippageBps / 10000;
  let cash = s.initial,
    quantity = 0,
    entry = 0,
    cost = 0,
    peak = cash,
    drawdown = 0;
  const equity: number[] = [cash],
    trades: Backtest["trades"] = [];
  for (let i = 15; i < candles.length; i++) {
    const c = candles[i],
      prev = candles[i - 1];
    if (quantity) {
      const stop = entry * (1 - s.stopPct / 100),
        take = entry * (1 + s.takePct / 100);
      let fill: number | null = null;
      if (c.open <= stop) fill = c.open;
      else if (c.open >= take) fill = take;
      else if (prev.sentiment! <= s.exitThreshold) fill = c.open;
      else if (c.low <= stop) fill = stop;
      else if (c.high >= take) fill = take;
      if (fill !== null || i === candles.length - 1) {
        const price = (fill ?? c.close) * (1 - slip),
          proceeds = quantity * price * (1 - fee);
        cash += proceeds;
        trades.push({
          time: c.time,
          side: "Sell",
          price,
          pnl: proceeds - cost,
        });
        quantity = 0;
      }
    } else if (
      i < candles.length - 1 &&
      prev.sentiment! >= s.threshold &&
      rsis[i - 1] <= s.rsiMax &&
      (!s.useVwap || prev.close >= vwaps[i - 1])
    ) {
      entry = c.open * (1 + slip);
      cost = (cash * s.allocationPct) / 100;
      quantity = cost / (entry * (1 + fee));
      cash -= cost;
      trades.push({ time: c.time, side: "Buy", price: entry, pnl: 0 });
      // Apply stop/target even on the entry candle; stop takes precedence.
      const stop = entry * (1 - s.stopPct / 100),
        take = entry * (1 + s.takePct / 100);
      if (c.low <= stop || c.high >= take) {
        const price = (c.low <= stop ? stop : take) * (1 - slip),
          proceeds = quantity * price * (1 - fee);
        cash += proceeds;
        trades.push({
          time: c.time,
          side: "Sell",
          price,
          pnl: proceeds - cost,
        });
        quantity = 0;
      }
    }
    const value = cash + quantity * c.close;
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, ((peak - value) / peak) * 100);
    equity.push(value);
  }
  const closed = trades.filter((t) => t.side === "Sell"),
    final = equity.at(-1)!;
  return {
    equity,
    trades,
    returnPct: (final / s.initial - 1) * 100,
    drawdown,
    winRate: closed.length
      ? (closed.filter((t) => t.pnl > 0).length / closed.length) * 100
      : 0,
    final,
  };
}

export function sampleMarket(
  asset: Asset,
  tick = 0,
  interval = 15,
  count = 180,
): Market {
  const base = { BTC: 67_482.9, ETH: 3_521.68, SOL: 172.84 }[asset],
    seed = ASSETS.indexOf(asset) + 1;
  const end = Date.UTC(2026, 9, 11, 14, 30) + tick * interval * 60_000;
  let previous = base * 0.975;
  const candles = Array.from({ length: count }, (_, i): Candle => {
    const n = i + tick,
      oscillation =
        Math.sin(n * 0.41 + seed) * 0.003 + Math.sin(n * 0.12) * 0.006;
    const close = base * (0.975 + (i / count) * 0.023 + oscillation),
      open = previous;
    previous = close;
    return {
      time: end - (count - i - 1) * interval * 60_000,
      open,
      close,
      high:
        Math.max(open, close) +
        base * (0.0008 + (Math.sin(n * 8.2) + 1) * 0.0007),
      low:
        Math.min(open, close) -
        base * (0.0008 + (Math.cos(n * 7.6) + 1) * 0.0005),
      volume: (70 + (Math.sin(n * 5.4) + 1) * 160) * seed,
      sentiment: Math.round(
        clamp(59 + Math.sin(n * 0.12) * 19 + Math.cos(n * 0.31) * 8, 0, 100),
      ),
    };
  });
  const shift = Math.round(Math.sin(tick * 0.8) * 5),
    score = asset === "BTC" ? 78 : asset === "ETH" ? 72 : 61;
  const sources: Market["sources"] = [
    { source: "Social", score: score + shift, count: 1248 },
    { source: "News", score: score - 10 + shift, count: 86 },
    { source: "On-chain", score: score - 14 + shift, count: 312 },
  ];
  const items: [Source, string, string, number][] = [
    [
      "Social",
      "Market conversation",
      `${asset} traders lean bullish as buying momentum builds`,
      score,
    ],
    [
      "News",
      "Market wire",
      "Institutional demand puts spot markets back in focus",
      74,
    ],
    [
      "On-chain",
      "Exchange flows",
      `${asset} exchange outflows suggest reduced sell pressure`,
      82,
    ],
    [
      "Social",
      "Trading community",
      "Traders watch resistance as intraday volume picks up",
      56,
    ],
    [
      "News",
      "Research brief",
      "Macro uncertainty tempers the latest market rally",
      38,
    ],
    [
      "On-chain",
      "Network activity",
      "Active addresses rise alongside renewed network demand",
      69,
    ],
  ];
  return {
    asset,
    price: candles.at(-1)!.close,
    change: { BTC: 2.34, ETH: 1.87, SOL: -0.64 }[asset],
    volume: { BTC: 28.42e9, ETH: 14.61e9, SOL: 3.82e9 }[asset],
    candles,
    sources,
    feed: items.map((item, i) => ({
      id: `${asset}-${i}`,
      source: item[0],
      author: item[1],
      text: item[2],
      score: clamp(item[3] + shift, 0, 100),
      time: end - (i + 1) * 120_000,
    })),
    updated: end,
    live: false,
    notes: ["Synthetic sample data. Not current market information."],
  };
}
export function parseHistory(text: string): Candle[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines[0].trim() !== "time,open,high,low,close,volume,sentiment")
    throw new Error(
      "Use the CSV header: time,open,high,low,close,volume,sentiment",
    );
  if (lines.length < 31 || lines.length > 50001)
    throw new Error("Import between 30 and 50,000 rows.");
  let previous = 0;
  return lines.slice(1).map((line, i) => {
    const parts = line.split(",");
    const [time, open, high, low, close, volume, sentiment] = parts.map(Number);
    if (
      parts.length !== 7 ||
      parts.some((p) => !p.trim()) ||
      ![time, open, high, low, close, volume, sentiment].every(
        Number.isFinite,
      ) ||
      time <= previous ||
      time < 1e12 ||
      open <= 0 ||
      close <= 0 ||
      low <= 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      volume < 0 ||
      sentiment < 0 ||
      sentiment > 100
    )
      throw new Error(
        `Row ${i + 2} is invalid. Use ascending epoch milliseconds, valid OHLC prices, and sentiment from 0 to 100.`,
      );
    previous = time;
    return { time, open, high, low, close, volume, sentiment };
  });
}
