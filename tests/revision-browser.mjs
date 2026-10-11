import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { sampleMarket } from "../src/core.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve("dist");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (!pathname.startsWith("/preview/")) {
    response.writeHead(404).end();
    return;
  }
  const target = path.resolve(
    root,
    pathname.slice("/preview/".length) || "index.html",
  );
  if (!target.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    response.writeHead(200, {
      "Content-Type": types[path.extname(target)] || "application/octet-stream",
    });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: "reduce",
  ...(process.env.SENTRA_BROWSER_TRANSPORT === "node"
    ? { serviceWorkers: "block" }
    : {}),
});
const page = await context.newPage();
// Some managed sandboxes allow Node HTTP but block child Chromium sockets. This
// explicit test-only transport still serves the production bytes from our HTTP
// server. Use normal transport for deployment checks and service-worker testing.
if (process.env.SENTRA_BROWSER_TRANSPORT === "node") {
  await page.route(`${url}**`, async (route) => {
    const response = await fetch(route.request().url());
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}
const failures = [], requests = [];
page.on("pageerror", (error) => failures.push(error.message));
page.on("response", (response) => {
  if (response.url().startsWith(url) && response.status() >= 400)
    requests.push(`${response.status()} ${response.url()}`);
});
const navigate = async (name) => {
  await page.goto(`${url}#${name}`);
  await page.waitForSelector("h1");
};
const screenshot = async (name) => {
  const dismiss = page.getByRole("button", { name: "Dismiss message", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  if (name.includes("chart"))
    await page.locator(".chart-panel").screenshot({ path: `artifacts/revision-${name}.png` });
  else await page.screenshot({ path: `artifacts/revision-${name}.png`, fullPage: true });
};

const reproduce = process.argv.includes("--reproduce");
const observations = {};
const check = (name, actual, predicate) => {
  observations[name] = { actual, passed: predicate(actual) };
  console.log(`${observations[name].passed ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`);
};
try {
  await navigate("overview");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Create signal", exact: true }).first().click();
  await page.getByLabel("Signal name").fill("Review: hidden RSI");
  await page.locator("#signal-threshold").fill("0");
  await page.getByLabel("Maximum RSI (14)").fill("0");
  await page.getByLabel("Require price above session VWAP").check();
  await page.getByRole("dialog").getByRole("button", { name: "Create signal", exact: true }).click();
  const card = page.locator(".signal-card").filter({ has: page.getByRole("button", { name: "Review: hidden RSI", exact: true }) });
  check("compact signal discloses RSI and VWAP", await card.innerText(), t => t.includes("Sentiment ≥ 0 · RSI ≤ 0 · Price above VWAP"));
  await navigate("signals");
  check("full signal discloses RSI and VWAP", await card.innerText(), t => t.includes("Sentiment ≥ 0 · RSI ≤ 0 · Price above VWAP"));
  await card.getByRole("button", { name: "Review: hidden RSI", exact: true }).click();
  check("RSI setting persists with VWAP enabled", {
    rsi: await page.getByLabel("Maximum RSI (14)").inputValue(),
    vwap: await page.getByLabel("Require price above session VWAP").isChecked(),
  }, v => v.rsi === "0" && v.vwap);
  await page.keyboard.press("Escape");

  await navigate("portfolio");
  await page.setViewportSize({ width: 320, height: 844 });
  check("portfolio export fits its panel at 320px", await page.getByRole("button", { name: "Export CSV", exact: true }).evaluate(el => {
    const b = el.getBoundingClientRect(), p = el.closest(".panel").getBoundingClientRect();
    return { clippedPixels: Math.max(0, b.right - p.right), width: b.width, height: b.height, label: el.textContent.trim() };
  }), b => b.clippedPixels === 0 && b.height >= 24 && b.label === "Export CSV");
  if (!reproduce) await screenshot("portfolio-320");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  check("portfolio export downloads", (await download).suggestedFilename(), n => n === "sentra-paper-trades.csv");

  await navigate("overview");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Show fewer candles" }).click({ clickCount: 2 });
  await page.getByRole("button", { name: "4h", exact: true }).click();
  check("multi-day axis includes dates", await page.locator(".chart-interactive .chart-axis").allTextContents(), labels => labels.some(t => /\d{2} [A-Z][a-z]{2}/.test(t)));
  await page.locator(".chart-interactive").focus();
  await page.keyboard.press("ArrowLeft");
  check("tooltip has full UTC timestamp", await page.locator("#chart-tooltip strong").innerText(), t => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(t));
  if (!reproduce) await screenshot("dated-chart");
  await page.getByRole("button", { name: "View candle data table" }).click();
  check("table has full UTC timestamps", await page.getByRole("dialog").locator("tbody tr td:first-child").allTextContents(), rows => rows.length === 15 && rows.every(t => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(t)));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "5m", exact: true }).click();
  check("single-day axis keeps clock labels", await page.locator(".chart-interactive .chart-axis").allTextContents(), labels => labels.filter(t => t.includes(":")).every(t => /^\d{2}:\d{2}$/.test(t)));

  const subtitles = {
    overview: "Monitor prices, sentiment, signals, and paper positions.",
    signals: "Set sentiment thresholds, RSI limits, and execution rules.",
    backtesting: "Test sentiment and technical rules against historical candles.",
    portfolio: "Review paper positions, fills, and position sizes.",
    connections: "Connect your private data and exchange service.",
    settings: "Manage notifications, refresh, and local data.",
  };
  for (const [view, expected] of Object.entries(subtitles)) {
    await navigate(view);
    check(`${view} task guidance`, await page.locator(".page-heading > div > p").innerText(), t => t === expected);
  }
  check("sidebar slogan removed", await page.locator(".desk-note").count(), n => n === 0);

  // Simulate the documented private API; no external account or real order.
  let sentimentMode = "sparse";
  await page.route("https://service.test/api/**", route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("health")) return route.fulfill({ json: { ok: true, liveTrading: false } });
    const snapshot = sampleMarket(u.searchParams.get("asset"), 0, 15, 180);
    snapshot.candles.forEach((c, i) => {
      // A deterministic range crossing midnight, with no invented observations.
      c.time = Date.UTC(2026, 9, 11, 12) - (179 - i) * 900000;
      c.sentiment = sentimentMode === "full" || (sentimentMode === "sparse" && i >= 170) || (sentimentMode === "runs" && [160, 164, 165, 166, 173, 174].includes(i)) ? 69 + i % 4 : null;
    });
    return route.fulfill({ json: { ...snapshot, live: true } });
  });
  await navigate("connections");
  await page.getByLabel("Service URL").fill("https://service.test");
  await page.getByLabel("Personal access token").fill("browser-integration-fixture-token");
  await page.getByRole("button", { name: "Connect service", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".mode-pill")?.textContent.includes("Live data"));
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "15m", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-action="interval-15"]')?.getAttribute("aria-pressed") === "true");
  // Restore a 64-candle view after the separate date inspection.
  while (Number((await page.locator(".chart-interactive svg").first().getAttribute("aria-label")).match(/^\d+/)[0]) < 64)
    await page.getByRole("button", { name: "Show more candles" }).click();
  const geometry = () => page.locator(".chart-interactive").evaluate(el => ({
    paths: [...el.querySelectorAll(".sentiment-line")].map(p => p.getAttribute("d")),
    points: el.querySelectorAll(".sentiment-point").length,
    label: el.querySelector("svg").getAttribute("aria-label"),
  }));
  check("sparse history displays the ten observations", await geometry(), g => g.paths.length === 1 && (g.paths[0].match(/[ML]/g) || []).length === 10 && g.label.includes("sentiment"));
  if (!reproduce) await screenshot("sparse-chart");
  await page.getByRole("button", { name: "View candle data table" }).click();
  check("sparse fixture preserves missing table values", await page.getByRole("dialog").locator("tbody tr td:last-child").allTextContents(), rows => rows.filter(t => t !== "—").length === 10);
  await page.keyboard.press("Escape");
  for (const mode of ["runs", "empty", "full"]) {
    sentimentMode = mode;
    // Changing interval requests a fresh snapshot without dropping the session.
    await page.getByRole("button", { name: mode === "empty" ? "15m" : "5m", exact: true }).click();
    await page.waitForFunction(interval => document.querySelector(`[data-action="interval-${interval}"]`)?.getAttribute("aria-pressed") === "true", mode === "empty" ? 15 : 5);
    // Wait on the next data-bearing render, not a wall-clock refresh interval.
    await page.getByRole("button", { name: "View candle data table" }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    if (mode === "runs") check("gaps split runs and isolated observations stay visible", await geometry(), g => g.paths.length === 2 && g.points === 1 && g.paths.every(p => (p.match(/M/g) || []).length === 1));
    if (mode === "empty") {
      check("empty history has no sentiment geometry", await geometry(), g => g.paths.length === 0 && g.points === 0);
      check("empty selected indicator explains missing history", await page.locator(".chart-indicators").innerText(), t => t.includes("No recorded sentiment in this range"));
      if (!reproduce) await screenshot("empty-chart");
      await page.getByRole("button", { name: "Sentiment", exact: true }).click();
      check("disabled overlay hides empty message", await page.locator(".chart-indicators").innerText(), t => !t.includes("No recorded sentiment in this range"));
      await page.getByRole("button", { name: "Sentiment", exact: true }).click();
    }
    if (mode === "full") check("full history remains one continuous overlay", await geometry(), g => g.paths.length === 1 && g.points === 0);
  }
  check("browser has no runtime errors", failures, e => e.length === 0);
  check("production resources load", requests, e => e.length === 0);
  await writeFile(`artifacts/revision-${reproduce ? "before" : "after"}.json`, JSON.stringify({ browser: await browser.version(), transport: process.env.SENTRA_BROWSER_TRANSPORT || "native", observations }, null, 2) + "\n");
  if (!reproduce) assert.ok(Object.values(observations).every(o => o.passed), "All revision checks must pass");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
