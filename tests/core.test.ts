import test from "node:test";
import assert from "node:assert/strict";
import {
  ema,
  rsi,
  vwap,
  macd,
  aggregate,
  sampleMarket,
  matches,
  positionSize,
  buy,
  sell,
  backtest,
  parseHistory,
  escape,
  type Candle,
  type Strategy,
  type Signal,
} from "../src/core.ts";

const candle = (close: number, i = 0): Candle => ({
  time: Date.UTC(2026, 9, 1) + i * 900000,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 10,
  sentiment: 80,
});
const strategy: Strategy = {
  threshold: 70,
  exitThreshold: 40,
  rsiMax: 100,
  useVwap: false,
  stopPct: 2,
  takePct: 4,
  allocationPct: 10,
  feeBps: 0,
  slippageBps: 0,
  initial: 10000,
};
test("EMA uses the documented smoothing coefficient", () => {
  assert.deepEqual(ema([10, 20, 30], 3), [10, 15, 22.5]);
});
test("RSI identifies flat, increasing, and decreasing markets", () => {
  assert.equal(
    rsi(Array.from({ length: 30 }, (_, i) => candle(100, i))).at(-1),
    50,
  );
  assert.equal(
    rsi(Array.from({ length: 30 }, (_, i) => candle(100 + i, i))).at(-1),
    100,
  );
  assert.equal(
    rsi(Array.from({ length: 30 }, (_, i) => candle(100 - i, i))).at(-1),
    0,
  );
});
test("VWAP weights typical prices by volume and resets at UTC midnight", () => {
  const a = { ...candle(100), volume: 10 },
    b = { ...candle(200, 1), volume: 30 },
    c = { ...candle(50), time: Date.UTC(2026, 9, 2) };
  assert.deepEqual(vwap([a, b, c]), [100, 175, 50]);
});
test("MACD is zero for constant prices", () => {
  assert.ok(
    macd(Array.from({ length: 60 }, (_, i) => candle(100, i))).histogram.every(
      (n) => n === 0,
    ),
  );
});
test("sentiment reweights available sources and never replaces missing data", () => {
  const market = sampleMarket("BTC");
  assert.equal(aggregate(market), 72);
  assert.equal(
    aggregate({
      ...market,
      sources: [{ source: "News", score: 80, count: 1 }],
    }),
    80,
  );
  assert.equal(aggregate({ ...market, sources: [] }), null);
});
test("signal needs all configured conditions and available sentiment", () => {
  const market = sampleMarket("BTC");
  const signal: Signal = {
    id: "test",
    name: "Rule",
    asset: "BTC",
    direction: "above",
    threshold: 70,
    rsiMax: 100,
    useVwap: false,
    allocation: 1000,
    stopPct: 2,
    auto: false,
    enabled: true,
    fired: false,
  };
  assert.equal(matches(signal, market), true);
  assert.equal(matches({ ...signal, threshold: 90 }, market), false);
  assert.equal(matches({ ...signal, enabled: false }, market), false);
  assert.equal(matches(signal, { ...market, sources: [] }), false);
});
test("position sizing caps notional for a cash spot account", () => {
  assert.equal(positionSize(10000, 1, 100, 98).quantity, 50);
  const capped = positionSize(1000, 50, 100, 99);
  assert.ok(capped.notional * 1.001 <= 1000.00001);
  assert.throws(() => positionSize(1000, 1, 100, 101), /stop below/);
  assert.throws(() => positionSize(1000, NaN, 100, 95));
});
test("paper order ledger conserves cash and includes entry and exit fees", () => {
  const start = { cash: 10000, positions: [], trades: [] };
  const opened = buy(start, "BTC", 1000, 100, 2);
  assert.equal(opened.cash, 8999);
  assert.equal(opened.positions[0].quantity, 10);
  assert.equal(opened.positions[0].stop, 98);
  const closed = sell(opened, opened.positions[0].id, 110);
  assert.equal(closed.cash, 10097.9);
  assert.equal(closed.positions.length, 0);
  assert.equal(closed.trades[0].pnl, 97.9);
  assert.equal(start.cash, 10000);
  assert.throws(() => buy(start, "BTC", 10000, 100, 2), /Not enough/);
  assert.throws(() => buy(start, "BTC", -1, 100, 2));
});
test("backtester fills at next open, never at the signal close", () => {
  const bars = Array.from({ length: 30 }, (_, i) => candle(100, i));
  bars[15] = { ...candle(110, 15), open: 110 };
  const result = backtest(bars, strategy);
  assert.equal(result.trades[0].time, bars[15].time);
  assert.equal(result.trades[0].price, 110);
});
test("backtester conservatively stops a bar touching both stop and target", () => {
  const bars = Array.from({ length: 30 }, (_, i) => candle(100, i));
  bars[15] = { ...bars[15], high: 110, low: 90 };
  const result = backtest(bars, strategy);
  assert.equal(result.trades[1].side, "Sell");
  assert.equal(result.trades[1].price, 98);
  assert.equal(result.trades[1].pnl, -20);
});
test("backtester accounts for gaps below stops", () => {
  const bars = Array.from({ length: 30 }, (_, i) => candle(100, i));
  bars[16] = { ...candle(90, 16), open: 90 };
  assert.equal(backtest(bars, strategy).trades[1].price, 90);
});
test("fees and slippage reduce a flat-market backtest result", () => {
  const bars = Array.from({ length: 40 }, (_, i) => candle(100, i));
  assert.equal(backtest(bars, strategy).final, 10000);
  assert.ok(
    backtest(bars, { ...strategy, feeBps: 10, slippageBps: 5 }).final < 10000,
  );
});
test("backtester reports zero trades when no entry conditions match", () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({
    ...candle(100, i),
    sentiment: 10,
  }));
  const result = backtest(bars, strategy);
  assert.equal(result.trades.length, 0);
  assert.equal(result.returnPct, 0);
  assert.equal(result.winRate, 0);
});
test("historical sentiment is required rather than fabricated", () => {
  assert.throws(
    () =>
      backtest(
        Array.from({ length: 30 }, (_, i) => ({
          ...candle(100, i),
          sentiment: null,
        })),
        strategy,
      ),
    /no historical sentiment/,
  );
});
test("CSV validates headers, timestamps, price bounds and blank fields", () => {
  const rows = Array.from({ length: 30 }, (_, i) => candle(100, i));
  const csv =
    "time,open,high,low,close,volume,sentiment\n" +
    rows
      .map((c) =>
        [c.time, c.open, c.high, c.low, c.close, c.volume, c.sentiment].join(
          ",",
        ),
      )
      .join("\n");
  assert.equal(parseHistory(csv).length, 30);
  assert.throws(() => parseHistory(csv.replace("101", "99")), /Row/);
  assert.throws(() => parseHistory(csv.replace("100,101", ",101")), /Row/);
  assert.throws(
    () => parseHistory(csv.replace("time,open", "date,open")),
    /header/,
  );
});
test("provider text is escaped before HTML rendering", () => {
  assert.equal(escape('<script>"&'), "&lt;script&gt;&quot;&amp;");
});
