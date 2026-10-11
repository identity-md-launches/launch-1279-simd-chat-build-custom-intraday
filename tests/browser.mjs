import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { sampleMarket } from "../src/core.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;
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
const failures = [],
  requests = [],
  results = [],
  audits = [];
page.on("pageerror", (error) => failures.push(error.message));
page.on("response", (response) => {
  if (response.url().startsWith(url) && response.status() >= 400)
    requests.push(`${response.status()} ${response.url()}`);
});
const test = async (name, fn) => {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
};
const navigate = async (name) => {
  await page.goto(`${url}#${name}`);
  await page.waitForSelector("h1");
};
const screenshot = async (name) => {
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
};

try {
  await mkdir("artifacts", { recursive: true });
  await mkdir("test/scratch", { recursive: true });
  await test("Static export, metadata, local assets and typeface load under a subpath", async () => {
    await page.goto(url);
    await page.waitForSelector("h1");
    assert.match(await page.title(), /Sentra/);
    for (const selector of [
      'meta[name="description"]',
      'meta[property="og:title"]',
      'meta[property="og:image"]',
      'link[rel="icon"]',
    ])
      assert.equal(await page.locator(selector).count(), 1);
    assert.equal(
      await page.evaluate(() => document.fonts.check("14px Inter")),
      true,
    );
    for (const asset of [
      "social-card.png",
      "favicon.svg",
      "manifest.webmanifest",
      "sw.js",
    ])
      assert.equal((await page.request.get(url + asset)).status(), 200);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page
      .getByRole("button", { name: "Dismiss message", exact: true })
      .click();
  });
  await test("Overview reflows at 320, 390, 768, 1024, 1440 and 1920 CSS pixels", async () => {
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(180);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Overflow at ${width}px`,
      );
      assert.equal(
        await page.evaluate(() => {
          const panel = document
            .querySelector(".chart-panel")
            .getBoundingClientRect();
          return [...document.querySelectorAll(".chart-toolbar button")].every(
            (button) => {
              const box = button.getBoundingClientRect();
              return box.left >= panel.left && box.right <= panel.right;
            },
          );
        }),
        true,
        `Clipped chart control at ${width}px`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.waitForTimeout(180);
    await screenshot("desktop-overview");
  });
  await test("At 390px the product name and primary action are on the first screen", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(180);
    const action = await page
      .getByRole("button", { name: "Create signal", exact: true })
      .first()
      .boundingBox();
    const brand = await page.locator(".mobile-brand").boundingBox();
    assert.ok(action.y + action.height < 844 && brand.y + brand.height < 844);
    await page.screenshot({ path: "artifacts/mobile-first-screen.png" });
    await screenshot("mobile-overview");
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.getByRole("link", { name: "Signals", exact: true }).click();
    await page.getByRole("heading", { name: "Trading signals" }).waitFor();
    assert.equal(await page.locator(".sidebar.open").count(), 0);
  });
  await test("Native dialog keyboard path, Escape and focus return", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const trigger = page
      .getByRole("button", { name: "Create signal", exact: true })
      .first();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page.evaluate(
        () => document.activeElement.closest("dialog") !== null,
      ),
      true,
    );
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(
          () => document.activeElement.closest("dialog") !== null,
        ),
        true,
      );
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await trigger.evaluate((el) => el === document.activeElement),
      true,
    );
  });
  await test("Create a rule, edit it, pause it and persist it", async () => {
    await page
      .getByRole("button", { name: "Create signal", exact: true })
      .first()
      .click();
    await page.getByLabel("Signal name").fill("BTC strength");
    await page.locator("#signal-threshold").evaluate((el) => {
      el.value = "10";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByLabel("Maximum RSI (14)").fill("100");
    await page.getByLabel("Require price above session VWAP").uncheck();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create signal", exact: true })
      .click();
    await page
      .getByRole("button", { name: "BTC strength", exact: true })
      .waitFor();
    assert.match(
      await page.locator(".signal-grid").innerText(),
      /Sentiment ≥ 10/,
    );
    await page
      .getByRole("button", { name: "BTC strength", exact: true })
      .click();
    await page.getByLabel("Signal name").fill("BTC research rule");
    await page.getByRole("button", { name: "Save changes" }).click();
    const card = page.locator(".signal-card").filter({
      has: page.getByRole("button", {
        name: "BTC research rule",
        exact: true,
      }),
    });
    await card.getByRole("button", { name: "Pause", exact: true }).click();
    assert.match(await card.innerText(), /Paused/);
    await page.reload();
    await page
      .getByRole("button", { name: "BTC research rule", exact: true })
      .waitFor();
    assert.match(await card.innerText(), /Paused/);
  });
  await test("Cancel never submits a signal form", async () => {
    const before = await page.locator(".signal-grid .signal-card").count();
    await page
      .getByRole("button", { name: "Create signal", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await page.locator(".signal-grid .signal-card").count(),
      before,
    );
  });
  await test("Paper automation executes once per trigger and disarms on reload", async () => {
    await page
      .getByRole("button", { name: "BTC research rule", exact: true })
      .click();
    await page.getByLabel("When the signal triggers").selectOption("paper");
    await page.getByLabel("Paper order value (USD)").fill("200");
    await page.getByLabel("Enable signal", { exact: true }).check();
    await page.getByRole("button", { name: "Save changes" }).click();
    const initial = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("sentra-desk-v1")).account.trades
          .length,
    );
    assert.equal(initial, 1);
    await page.getByRole("button", { name: "Evaluate now" }).click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("sentra-desk-v1")).account.trades
            .length,
      ),
      initial,
    );
    await page.reload();
    assert.equal(
      await page
        .locator(".signal-grid")
        .getByText("Paper automation", { exact: true })
        .count(),
      0,
    );
  });
  await test("Paper order review, fees and closing a position update the portfolio", async () => {
    await navigate("portfolio");
    await page
      .getByRole("button", { name: "Place paper trade", exact: true })
      .first()
      .click();
    await page.getByLabel("Order value (USD)", { exact: true }).fill("1000");
    await page
      .getByRole("button", { name: "Review order", exact: true })
      .click();
    await page.getByRole("heading", { name: "Confirm paper order" }).waitFor();
    assert.match(await page.getByRole("dialog").innerText(), /\$1\.00/);
    await page
      .getByRole("button", { name: "Place paper order", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("sentra-desk-v1")).account.positions
            .length,
      ),
      2,
    );
    await page
      .getByRole("button", { name: "Close", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Close paper position", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("sentra-desk-v1")).account.positions
            .length,
      ),
      1,
    );
  });
  await test("Risk sizing handles valid inputs and recoverable invalid stops", async () => {
    await page.getByLabel("Account equity (USD)").fill("10000");
    await page.getByLabel("Risk per trade (%)").fill("1");
    await page.getByLabel("Entry price (USD)").fill("100");
    await page.getByLabel("Stop price (USD)").fill("98");
    await page.getByRole("button", { name: "Calculate position" }).click();
    assert.match(await page.locator("#risk-result").innerText(), /50 units/);
    await page.getByLabel("Stop price (USD)").fill("101");
    await page.getByRole("button", { name: "Calculate position" }).click();
    assert.match(await page.locator("#risk-error").innerText(), /stop below/);
  });
  await test("Trade export is a real CSV download", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const file = await download;
    assert.equal(file.suggestedFilename(), "sentra-paper-trades.csv");
    const body = await readFile(await file.path(), "utf8");
    assert.match(body, /realized_pnl/);
    assert.match(body, /BTC/);
  });
  await test("Chart controls change asset, timeframe, indicators and data table", async () => {
    await navigate("overview");
    await page.getByLabel("Chart asset").selectOption("ETH");
    await page.getByRole("button", { name: "1h", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "1h", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "RSI", exact: true }).click();
    await page.getByRole("button", { name: "MACD", exact: true }).click();
    assert.equal(await page.locator(".subchart").count(), 2);
    await page.getByRole("button", { name: "Switch to line chart" }).click();
    assert.equal(await page.locator(".candle").count(), 0);
    await page.getByRole("button", { name: "View candle data table" }).click();
    assert.equal(
      await page.getByRole("dialog").locator("tbody tr").count(),
      15,
    );
    await page.keyboard.press("Escape");
    await page.locator(".chart-interactive").focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator("#chart-tooltip").isVisible(), true);
  });
  await test("Feed filtering, search, empty state and observation detail", async () => {
    await navigate("markets");
    await page.getByLabel("Filter sentiment sources").selectOption("News");
    assert.equal(await page.locator(".feed-item").count(), 2);
    await page
      .getByRole("searchbox", { name: "Search the sentiment feed" })
      .fill("zzzz");
    await page
      .getByRole("heading", { name: "No matching observations" })
      .waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    assert.equal(await page.locator(".feed-item").count(), 6);
    await page.locator(".feed-title").first().click();
    assert.match(
      await page.getByRole("dialog").innerText(),
      /synthetic observation/,
    );
    await page.keyboard.press("Escape");
  });
  await test("Backtest runs, no-trade case is clear, CSV imports and results download", async () => {
    await navigate("backtesting");
    await page.getByRole("button", { name: "Run backtest" }).click();
    await page.getByRole("heading", { name: "Equity curve" }).waitFor();
    assert.ok((await page.locator(".result-table tbody tr").count()) > 1);
    await page.setViewportSize({ width: 320, height: 800 });
    assert.equal(
      await page
        .locator(".equity-caption")
        .evaluate((caption) => getComputedStyle(caption).fontSize),
      "12px",
    );
    await page.setViewportSize({ width: 1440, height: 1100 });
    await screenshot("backtest-results");
    await page.getByLabel("Entry sentiment ≥").fill("100");
    await page.getByRole("button", { name: "Run backtest" }).click();
    assert.match(
      await page.locator(".result-table").innerText(),
      /No trades matched/,
    );
    const sampleDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Sample CSV" }).click();
    const source = await sampleDownload;
    await page.locator("#history-import").setInputFiles(await source.path());
    await page.waitForFunction(() =>
      document
        .querySelector(".dataset-info")
        ?.textContent.includes("2,880 imported candles"),
    );
    assert.match(
      await page.locator(".dataset-info").innerText(),
      /2,880 imported candles/,
    );
    await page.getByLabel("Entry sentiment ≥").fill("65");
    await page.getByRole("button", { name: "Run backtest" }).click();
    const exportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export results" }).click();
    assert.equal(
      (await exportDownload).suggestedFilename(),
      "sentra-backtest.csv",
    );
    await page.locator("#history-import").setInputFiles({
      name: "bad.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,bad\n1,2"),
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#backtest-error")
        ?.textContent.includes("CSV header"),
    );
    assert.match(
      await page.locator("#backtest-error").innerText(),
      /CSV header/,
    );
  });
  await test("Notification event reaches the persistent alert inbox", async () => {
    await navigate("settings");
    await page.getByRole("button", { name: "Send test", exact: true }).click();
    await page.getByRole("button", { name: /Open alerts/ }).click();
    assert.match(
      await page.getByRole("dialog").innerText(),
      /Sentra test notification/,
    );
    await page.keyboard.press("Escape");
  });
  await test("Reset requires confirmation and clears paper positions", async () => {
    await page
      .getByRole("button", { name: "Reset portfolio", exact: true })
      .click();
    await page.getByRole("button", { name: "Keep portfolio" }).click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("sentra-desk-v1")).account.positions
            .length,
      ),
      1,
    );
    await page
      .getByRole("button", { name: "Reset portfolio", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reset paper portfolio", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("sentra-desk-v1")).account.cash,
      ),
      100000,
    );
  });
  await test("Connection errors retain honest sample labels; invalid service URLs are rejected", async () => {
    await navigate("connections");
    await page.getByLabel("Service URL").fill("http://remote.test");
    await page
      .getByLabel("Personal access token")
      .fill("browser-integration-fixture-token");
    await page
      .getByRole("button", { name: "Connect service", exact: true })
      .click();
    assert.match(
      await page.locator("#connection-error").innerText(),
      /Use HTTPS/,
    );
    await page.route("https://service.test/api/**", (route) => {
      if (route.request().url().endsWith("/health"))
        return route.fulfill({ json: { ok: true, liveTrading: true } });
      return route.fulfill({
        status: 502,
        json: { detail: "Provider unavailable" },
      });
    });
    await page.getByLabel("Service URL").fill("https://service.test");
    await page
      .getByRole("button", { name: "Connect service", exact: true })
      .click();
    await page.locator(".error-strip").waitFor();
    assert.match(await page.locator(".mode-pill").innerText(), /Sample data/);
    assert.match(
      await page.locator(".error-strip").innerText(),
      /still shows sample/,
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage
          .getItem("sentra-desk-v1")
          .includes("browser-integration-fixture-token"),
      ),
      false,
    );
    await page.unroute("https://service.test/api/**");
  });
  await test("Live data, manual order confirmation and automation use the private API contract", async () => {
    const submitted = [];
    await page.route("https://service.test/api/**", (route) => {
      const request = route.request(),
        requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith("/health"))
        return route.fulfill({ json: { ok: true, liveTrading: true } });
      if (requestUrl.pathname.endsWith("/snapshot"))
        return route.fulfill({
          json: {
            ...sampleMarket(requestUrl.searchParams.get("asset")),
            live: true,
          },
        });
      submitted.push({
        path: requestUrl.pathname,
        body: request.postDataJSON(),
      });
      return route.fulfill({
        json: {
          id: "offline-contract-test",
          status: "closed",
          enabled: request.postDataJSON()?.enabled ?? false,
        },
      });
    });
    await page
      .getByLabel("Personal access token")
      .fill("browser-integration-fixture-token");
    await page
      .getByRole("button", { name: "Reconnect service", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector(".mode-pill")?.textContent.includes("Live data"),
    );
    await page.locator('input[name="live-consent"]').check();
    await page.getByRole("button", { name: "Review live automation" }).click();
    await page.getByRole("button", { name: "Arm live strategy" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(
      submitted.find((s) => s.path.endsWith("/automation")).body.enabled,
      true,
    );
    await page.getByRole("button", { name: "Stop live automation" }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    // Hash navigation retains the session token; a page reload intentionally does not.
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "Trade", exact: true }).click();
    await page.getByLabel("Execution account").selectOption("live");
    await page.getByLabel("Order value (USD)", { exact: true }).fill("50");
    await page.getByRole("button", { name: "Review order" }).click();
    await page
      .getByRole("button", { name: "Place live order", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const request = submitted.find((s) => s.path.endsWith("/order"));
    assert.equal(request.body.notional, 50);
    assert.ok(request.body.requestId);
    await page.getByRole("link", { name: "Connections", exact: true }).click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.unroute("https://service.test/api/**");
  });
  await test("Automatic refresh preserves calculator drafts and results", async () => {
    await page.clock.install();
    await navigate("portfolio");
    await page.getByLabel("Account equity (USD)").fill("10000");
    await page.getByLabel("Risk per trade (%)").fill("1");
    await page.getByLabel("Entry price (USD)").fill("100");
    await page.getByLabel("Stop price (USD)").fill("98");
    await page.getByRole("button", { name: "Calculate position" }).click();
    await page.clock.fastForward(16000);
    assert.equal(
      await page.getByLabel("Account equity (USD)").inputValue(),
      "10000",
    );
    assert.equal(
      await page.getByLabel("Entry price (USD)").inputValue(),
      "100",
    );
    assert.match(await page.locator("#risk-result").innerText(), /50 units/);
    await page.clock.resume();
  });
  await test("Every page passes the automated accessibility scan and mobile reflow check", async () => {
    for (const view of [
      "overview",
      "markets",
      "signals",
      "backtesting",
      "portfolio",
      "connections",
      "settings",
    ]) {
      await navigate(view);
      await page.setViewportSize({ width: 1440, height: 1000 });
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      audits.push({
        view,
        violations: audit.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      });
      assert.equal(
        audit.violations.length,
        0,
        `${view}: ${JSON.stringify(audits.at(-1))}`,
      );
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(180);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `${view} overflows at ${width}`,
        );
      }
    }
  });
  assert.deepEqual(failures, [], "No unhandled JavaScript errors");
  assert.deepEqual(requests, [], "No failed local resources");
  await writeFile(
    "artifacts/browser-results.json",
    JSON.stringify(
      {
        status: "passed",
        transport: process.env.SENTRA_BROWSER_TRANSPORT || "native",
        results,
        audits,
        consoleErrors: failures,
        failedLocalResources: requests,
        preview: "/preview/",
        browser: await browser.version(),
      },
      null,
      2,
    ),
  );
  console.log(
    `${results.length} browser scenarios passed; ${audits.length} pages scanned.`,
  );
} catch (error) {
  await writeFile(
    "artifacts/browser-results.json",
    JSON.stringify(
      {
        status: "failed",
        results,
        audits,
        consoleErrors: failures,
        failedLocalResources: requests,
        error: String(error),
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "test/scratch/browser-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
