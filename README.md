# Sentra

A single-user intraday crypto desk that connects sentiment research, technical analysis, paper trading, and strategy testing. Open the site directly into the workspace—no account or wallet is required.

**The private Python service renders the workspace through Jinja2, with an optional static demo in `dist/`.** The demo is usable immediately with clearly labeled synthetic data. External sources and real exchange orders require the private service and your own configuration. No credentials are included in the source or export.

## Install, preview, and rebuild

Use Node.js 22.18+ (Node 24 was used for validation).

```sh
npm ci
npm run dev
```

For the production version:

```sh
npm run typecheck
npm run build
npm run preview
```

Open the URL printed by Vite. `dist/index.html`, its JavaScript/CSS, Inter font, favicon, share image, manifest, and notification service worker are included in this submission. The publisher can serve **the contents of `dist/` without rebuilding**.

## Publish the static site

Upload everything inside `dist/` to a static host, including `assets/`. HTTPS enables browser notifications and service workers. Vite uses `base: './'`; asset paths are relative and navigation uses URL hashes, so a gateway subpath works without a server rewrite. The export was tested under `/preview/`.

After choosing your public URL, you can set `og:image` in `index.html` to that host's absolute `social-card.png` URL for crawlers that require an absolute image URL, then rebuild. The default relative image works independently of a particular hosting domain.

Do not publish the Python service, local database, exchange credentials, or dependency directories as static assets. A static host does not run the optional service.

## Use the workspace

| View | Working interactions |
| --- | --- |
| Overview | Select BTC, ETH, or SOL; change candle intervals; switch candles/line; zoom the visible history; toggle VWAP, volume, sentiment, RSI, and MACD; inspect candles with pointer or arrow keys; open a data table. |
| Markets | Compare assets, select a market, filter source types, search observations, and open the full observation. |
| Signals | Create, edit, enable, pause, and delete rules. Combine a sentiment threshold with maximum RSI and an optional VWAP filter. Choose alerts or automatic paper buys. |
| Backtesting | Change entry/exit sentiment, RSI, VWAP, stop, target, allocation, fees, and slippage. Run a test, inspect equity and fills, import historical CSV, and download results. |
| Portfolio | Review a paper market order before filling it, close positions, inspect trade history, export CSV, and calculate a position size. |
| Connections | Connect your private service; review real market orders; arm, inspect, stop, or clear resolved live automation state. |
| Settings | Enable browser notifications, send a test event, pause refresh, export trades, and confirm a portfolio reset. |

Sample playback advances once every 15 seconds. Use **Pause** below the chart or the refresh setting to stop it. Sample headlines, scores, prices, volumes, and dates are illustrative; they are not current market claims.

Paper accounts start with $100,000 and charge a 0.1% simulated fee on each fill. Sample-price and live-price paper portfolios are stored separately, so switching data sources does not revalue one portfolio using unrelated prices. Reloading starts in sample mode; reconnect to access the live-price paper portfolio. The static site never sends a real order by itself.

Signals trigger once when all conditions become true, then wait for the conditions to become false before firing again. Paper automation is turned off on reload. Browser refresh and paper stops run only while the tab is visible, refresh is enabled, and no dialog or input edit is active. Paper stops fill at the observed price, which can be beyond the stop. For continuously running automation, use the private service.

## Sentiment and technical calculations

The index uses **50% social, 30% news, and 20% on-chain**. Missing sources are excluded and the remaining weights are normalized. With no observations, the index is unavailable and sentiment rules do not trigger. Scores at or above 65 are labeled bullish; scores at or below 40 bearish. Scores are heuristics, not calibrated probabilities.

- **Social:** TwitterAPI.io's latest English posts, up to three pages per poll, with early stopping on cached IDs and a SQLite cache. The current sample uses posts from the last 24 hours, capped at 500. Keyword polarity is the default; configured Jev scoring can replace the aggregate score. Individual feed rows retain keyword scores. Jev failure is disclosed as a fallback note.
- **News:** Your RSS 2.0 feed, filtered for the selected asset's symbol/name. Undated headlines are omitted. Keyword scoring and a 24-hour window are used.
- **On-chain:** Ethereum mainnet transaction counts across two successive sets of six blocks, two blocks behind the head. This is an activity proxy, not a directional price forecast. BTC and SOL do not receive a fabricated Ethereum score.
- **VWAP:** Cumulative volume-weighted typical price, reset at midnight UTC.
- **RSI:** Wilder-smoothed 14-period RSI, with a 14-bar warm-up.
- **MACD:** 12/26-period EMAs and a 9-period signal EMA, initialized from the first available close.
- **Suggested paper stop:** Twice the average high–low range over the last 14 bars, constrained to a 0.5–10% distance. This is a simple volatility heuristic, not ATR or a guaranteed loss limit.
- **Position sizing:** Risk budget divided by entry-to-stop distance, capped by cash with a 0.1% entry-fee allowance. Displayed price risk excludes fees, gaps, and slippage.

The chart's sentiment line has an independent normalized 0–100 scale; it is not a price series. Recorded observations form separate runs across missing history; isolated observations remain visible as points. When the selected overlay has no observations in view, its indicator says so. Tooltips and the candle table expose full UTC dates and exact values; multi-day axes include day/month labels. Live historical sentiment is shown only where the service actually recorded observations; today's score is never backfilled over past candles.

## Historical analysis

The built-in backtest uses **2,880 synthetic 15-minute candles (30 days)**. It is a reproducible demonstration, not evidence of a profitable strategy. Tests are long-only, unleveraged spot strategies.

Entries use the previous completed candle's signal and fill at the next open. Fees and slippage apply on both sides. A gap through a stop fills at the worse opening price. If stop and target are both touched in the same candle, the stop wins, including the entry candle. Remaining positions close on the final candle. Drawdown is based on the bar-by-bar marked equity, not every intrabar excursion. There is no liquidity, funding, tax, or order-book model.

Import a UTF-8 numeric CSV with this exact header:

```csv
time,open,high,low,close,volume,sentiment
```

Use ascending epoch **milliseconds**, valid OHLC prices, nonnegative volume, and sentiment in 0–100. Supply 30–50,000 rows in a file no larger than 8 MiB. The **Sample CSV** button downloads a valid example. Imports remain in memory; export results before leaving. The service's authenticated `GET /api/history?asset=ETH&interval=15` exports only candles with recorded sentiment; it takes time to accumulate enough observations for a meaningful test.

## Run the private service

The architecture follows the reference [Jev-X Sentiment Analysis repository](https://github.com/brainstormity/Jev-X-Sentiment-Analysis): Python, FastAPI, **Jinja2 templates, Pydantic Settings with python-dotenv**, SQLite, CCXT, HTTPX, TwitterAPI.io, and TypeSafe's Jev SDK. FastAPI renders `service/templates/index.html` with `Jinja2Templates` and `TemplateResponse`. It reads `dist/build-manifest.json` to select the current hashed JavaScript/CSS assets. The existing browser interface remains native JavaScript/CSS, authored in TypeScript and built with Vite. The same build produces the independent static demo in `dist/index.html`. No React, wallet connection, external font CDN, or runtime charting dependency is required.

Use Python 3.12 on Linux for the supplied dependency lock. On another platform, install from `requirements.txt` and resolve compatible platform packages; `requirements-lock.txt` records the exact validated Linux environment.

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-lock.txt
export SENTRA_ADMIN_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
uvicorn service.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Use the generated token and `http://127.0.0.1:8000` in **Connections**. The token must contain at least 32 characters; there is no default token. It stays in the browser tab's memory and is discarded on reload. The service renders the workspace at its root. Keep `service/templates/` and the complete `dist/` directory together on the private host, including `build-manifest.json`; run `npm run build` after frontend changes. The manifest is a runtime dependency for Jinja rendering, not a disposable cache. A missing manifest produces a clear HTTP 503 build instruction.

Configure the variables below in your shell/process manager or an optional private `.env` in the directory from which you launch the service, then restart it. Pydantic Settings parses the UTF-8 dotenv file through python-dotenv. Explicit Python configuration values take precedence over process environment, which takes precedence over dotenv, then defaults. Existing variable names and comma-separated `ALLOWED_ORIGINS` are preserved. Invalid typed settings fail early; a short token or unsafe live-trading configuration prevents startup. The dotenv file is optional, must remain private, and must never be added to the static export or source control.

| Variable | Meaning / default |
| --- | --- |
| `SENTRA_ADMIN_TOKEN` | Required private bearer token for every API endpoint. |
| `SENTRA_EXCHANGE` | `kraken` (default), `binance`, or `coinbase`. BTC/USDT, ETH/USDT, and SOL/USDT spot pairs must be supported by the chosen venue/region. |
| `ALLOWED_ORIGINS` | Comma-separated exact frontend origins. Defaults to localhost/127.0.0.1 on ports 5173 (development), 4173 (preview), and 8000 (service). Set your actual static origin when hosting elsewhere. Wildcards are rejected. |
| `TWITTER_API_KEY` | Your TwitterAPI.io key. Unset means social data is unavailable. |
| `TYPESAFE_API_KEY` | Your Jev key. Unset uses disclosed keyword scoring. |
| `NEWS_RSS_URL` | Your chosen English RSS 2.0 feed URL. Unset means news is unavailable. |
| `ETH_RPC_URL` | Your Ethereum mainnet RPC URL. The service verifies chain ID 1. |
| `EXCHANGE_API_KEY`, `EXCHANGE_API_SECRET` | Owner-managed exchange credentials, needed only for real orders. |
| `EXCHANGE_API_PASSPHRASE` | Set when required by the exchange credential format. |
| `EXCHANGE_SANDBOX` | `false` by default; `true` asks CCXT to use the selected exchange's sandbox if it supports one. Unsupported sandbox configurations fail at startup. |
| `ENABLE_LIVE_TRADING` | `false` by default. Explicitly set `true` to allow real orders. |
| `LIVE_MAX_ORDER_USD` | Required positive per-order cap when enabling real trading. No operative default. Values are USDT quote notional; no fiat conversion is performed. |
| `LIVE_DAILY_BUY_LIMIT_USD` | Required daily buy cap, at least the per-order cap. UTC reset. Pending/uncertain orders consume this budget. |
| `NTFY_TOPIC_URL` | Your complete private ntfy topic URL for mobile alerts. No recipient/topic is assumed. |
| `NTFY_ACCESS_TOKEN` | Your ntfy access token if the topic requires it. |
| `SENTRA_DB_PATH` | Defaults to `runtime/sentra.sqlite3`. Keep the database private and back it up if you need the audit history. |

Run **one service process / one worker** for this personal workspace. For access from a hosted frontend, put the private service behind HTTPS and configure its exact allowed origin. Keep exchange secrets on the service. An HTTPS frontend cannot reliably call an HTTP service because of browser mixed-content and private-network restrictions.

### Live execution and recovery

The service requires explicit enablement, credentials, and finite order caps. The UI then exposes a distinct **Live exchange · Real funds** account with a second confirmation. Orders are market spot buys/sells; quantities are precision-adjusted and checked against minimums and free balances. Displayed dollar formatting represents the USDT quote price, without an FX conversion. Live fees and fills come from the exchange.

Each order has a UUID and a SQLite reservation written **before** submission. Identical requests return the existing response. Requests with uncertain results are not retried. After an uncertain result, check the exchange order history before taking another action. A timeout cannot prove whether an exchange accepted an order.

Live automation runs one strategy every 60 seconds, independently of the browser. Entry requires the sentiment and RSI conditions; exit uses the configured stop or sentiment threshold. The service starts disarmed after every restart. Stops are software checks, not exchange-hosted protective orders. Provider outages, ambiguous fills, and exchange failures pause automation. Partial/unconfirmed fills require owner review. Manual live orders do not attach a stop; manage protection on the exchange.

**Stop live automation** leaves an existing position on the exchange. If you close/manage it there, stop the strategy and use **Clear resolved state** only after verifying its orders and positions. This clears the service's tracking and keeps the order audit log. It does not send any exchange order. If a known tracked position is still open, rearming its same asset resumes monitoring it; changing to a different asset is rejected.

### Notifications

The inbox records browser signal and trade events. Permission-gated browser notifications use the Notification API and the local service worker. They require a supported secure browser and an open desk; permission denial leaves the inbox usable. Browser/OS background restrictions still apply.

The configured ntfy topic receives **service-side live signal, live order, and automation-pause events**, even when the browser is closed, as long as the service runs. Subscribe to that private topic in the ntfy mobile app. **Send test** checks delivery through the connected service. Browser paper events are kept in the inbox/browser notification channel; they are not forwarded to ntfy.

## Customize

- `src/style.css`: semantic color tokens, six-size typography scale, layout, responsive rules, and interaction states. See [DESIGN.md](DESIGN.md).
- `src/main.ts`: views, forms, event handlers, persistence, notifications, and private-service client.
- `src/core.ts`: types, deterministic sample data, indicators, signal matching, paper ledger, risk sizing, CSV parsing, and backtesting.
- `src/chart.ts`: native SVG candles, overlays, inspection, sparklines, and equity curve.
- `service/providers.py`: provider adapters, source scoring, real observations, and snapshot cache.
- `service/main.py`: Jinja workspace route, authenticated API, order preflight/idempotency, and live automation.
- `service/config.py`: Pydantic settings, environment aliases, dotenv loading, and startup guards.
- `service/templates/index.html`: service HTML shell and metadata. Keep metadata consistent with the static shell in root `index.html`; both use the same compiled interface. `vite.config.ts` enables the relative static export and build manifest.
- `service/database.py`: SQLite observations, sentiment history, orders, and strategy state.

To add a market, extend `Asset`/`ASSETS`, names/sample fixtures, and the service's `Asset`/provider maps together; verify pair support on your exchange. To add an indicator or strategy rule, keep its calculation in `core.ts` and test the timing and fill assumptions before exposing it in a form. Never put a provider or exchange secret in `src/`, `public/`, or a Vite-prefixed environment variable.

## Checks and actual results

```sh
npm run typecheck
npm run build
npm test
pip install -r requirements-dev.txt
python -m pytest tests/test_service.py -q -p no:cacheprovider
npx playwright install chromium
npm run test:browser
node tests/revision-browser.mjs
node tests/service-browser.mjs
```

The revision worker ran the production build and strict TypeScript check successfully, **16 calculation/ledger tests**, **16 service tests**, **19 existing browser scenarios**, and the targeted revision and Jinja-service browser checks. Service tests cover dotenv parsing and precedence, typed validation, the actual Jinja response, subpath asset URLs, and unchanged API authorization/execution guards. All seven pages report zero axe violations. Before/after evidence, viewport coverage, and exact outcomes are recorded in [artifacts/validation.md](artifacts/validation.md), [artifacts/revision-after.json](artifacts/revision-after.json), and [artifacts/service-browser-results.json](artifacts/service-browser-results.json).

Chromium 156.0.8078.4 loaded the production export at `/preview/` and the Jinja service at its root over ordinary HTTP. No Node transport workaround was needed in this revision. The Jinja-served UI created a signal and a paper order, and its root-scoped notification worker activated. The supplied browser connector could not launch its expected browser; locally installed Playwright provided the rendered inspection and screenshots instead.

Worker frontend dependencies were installed outside the repository at `/tmp/sentra-revision-js`, with its executable directory added to `PATH` and `NODE_PATH` set for the test runners. Python dependencies and browser binaries were also isolated under `/tmp`; no repository dependency directory was created. Normal installations use the commands above. Nothing depends on these worker-specific paths at runtime. `tests/service-browser.mjs` uses the active `python3`, or `SENTRA_PYTHON` when set, and removes its temporary database after stopping its test server.

Limitations: paid Twitter/Jev providers, authenticated exchange trading, and actual mobile/desktop notification delivery were not exercised with owner credentials. The prior round's read-only provider checks were not repeated for this rendering/configuration revision. Native screen-reader sessions, physical mobile devices, Safari/Firefox, and browser-native 200% zoom were not tested. Use one active browser tab; local paper state has no multi-tab locking. No live funds were traded and no site was publicly deployed during validation.

## Attribution and submission budget

Design review follows Jakub Krehel's **Better Interface**, pinned at `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). Design-documentation guidance is adapted from Paul Bakaus's **Impeccable**, pinned at `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). Their supplied license texts are preserved in [licenses/design-guidance.txt](licenses/design-guidance.txt). Inter is bundled locally under the [SIL Open Font License](licenses/Inter-OFL.txt). The Jev-X repository is an architectural reference; its source is not vendored here.

The explicit path budget is `.gitignore` ≤1 KiB, source/service/tests/configuration ≤1 MiB, `dist/` ≤2 MiB, and documentation/evidence ≤2 MiB, with the complete submission below 8 MiB. Dependency/cache directories are excluded at every nesting level. Required runtime assets and the finished export remain included. See validation for the measured final size.
