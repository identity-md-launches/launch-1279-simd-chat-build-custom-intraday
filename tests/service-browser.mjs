import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const runtime = await mkdtemp(join(tmpdir(), "sentra-service-check-"));
const token = randomBytes(32).toString("hex");
const service = spawn(process.env.SENTRA_PYTHON || "python3", ["-c", `
import socket
import uvicorn
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
print(sock.getsockname()[1], flush=True)
uvicorn.run('service.main:app', fd=sock.fileno(), log_level='warning')
`], { env: {
  ...process.env, PYTHONDONTWRITEBYTECODE: "1", SENTRA_ADMIN_TOKEN: token,
  SENTRA_DB_PATH: join(runtime, "test.sqlite3"),
  ENABLE_LIVE_TRADING: "false", EXCHANGE_SANDBOX: "false",
}, stdio: ["ignore", "pipe", "pipe"] });
let browser;
const errors = [], resources = [];
try {
  const [port] = await once(service.stdout, "data");
  const url = `http://127.0.0.1:${Number(port.toString().trim())}/`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(url)).ok; } catch { /* Wait for process startup. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Jinja service starts and responds within 10 seconds");
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", r => { if (r.url().startsWith(url) && r.status() >= 400) resources.push(`${r.status()} ${r.url()}`); });
  const html = await (await page.goto(url)).text();
  assert.ok(!html.includes(token) && !html.includes("{{"));
  await page.getByRole("heading", { name: "Market overview", exact: true }).waitFor();
  assert.equal(await page.title(), "Sentra — Your sentiment trading desk");
  assert.equal(await page.evaluate(() => document.fonts.check("14px Inter")), true);
  const health = await page.request.get(url + "api/health", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).liveTrading, false);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Create signal", exact: true }).first().click();
  await page.getByLabel("Signal name").fill("Jinja workspace rule");
  await page.getByRole("dialog").getByRole("button", { name: "Create signal", exact: true }).click();
  await page.getByRole("button", { name: "Jinja workspace rule", exact: true }).waitFor();
  await page.getByRole("button", { name: "Trade", exact: true }).click();
  await page.getByLabel("Order value (USD)", { exact: true }).fill("250");
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await page.getByRole("button", { name: "Place paper order", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("sentra-desk-v1")).account.positions.length), 1);
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const host = document.getElementById("price-chart");
    return host.querySelector("svg").viewBox.baseVal.width === Math.max(260, host.clientWidth);
  });
  const action = await page.getByRole("button", { name: "Create signal", exact: true }).first().boundingBox();
  assert.ok(action.y + action.height < 844);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (await page.getByRole("button", { name: "Dismiss message", exact: true }).count())
    await page.getByRole("button", { name: "Dismiss message", exact: true }).click();
  await page.screenshot({ path: "artifacts/revision-service-mobile.png" });
  assert.deepEqual(errors, []);
  assert.deepEqual(resources, []);
  await writeFile("artifacts/service-browser-results.json", JSON.stringify({
    status: "passed", browser: await browser.version(), transport: "native HTTP",
    checks: ["Jinja root and current Vite assets", "metadata and local font", "authenticated health with live execution disabled", "signal creation", "paper order review and fill", "root-scoped notification worker activates", "390px first screen and reflow"],
    errors, failedResources: resources,
  }, null, 2) + "\n");
  console.log("PASS Jinja service: assets, authenticated health, signals, paper orders, notification worker, and mobile reflow");
} finally {
  await browser?.close();
  if (service.exitCode === null && service.signalCode === null) {
    const stopped = once(service, "exit");
    service.kill("SIGTERM");
    await stopped;
  }
  await rm(runtime, { recursive: true, force: true });
}
