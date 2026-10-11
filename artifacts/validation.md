# Sentra implementation and validation

## Revision review — 11 October 2026

**Complete for the revision scope**, with the limitations below. This is the worker's own evidence, not an independent certification. All six reported findings reproduced before implementation and are answered as fixed in root `.imd-responses.json`. Existing trading calculations, provider adapters, visual tokens, navigation, and paper/live execution flows were retained.

The upstream `requirements.txt`, `app/main.py`, and `app/core/config.py` were retrieved from `https://raw.githubusercontent.com/brainstormity/Jev-X-Sentiment-Analysis/main/`. They respectively declare Jinja2/Pydantic Settings/python-dotenv, use `Jinja2Templates`/`TemplateResponse`, and subclass `BaseSettings` with `env_file=".env"`. The revised service now uses those same layers. Its HTML shell selects the shared compiled interface via `dist/build-manifest.json`. `dist/index.html` remains a complete optional static demo. Environment names, typed configuration, secret handling, authorization, and existing live-execution guards are preserved; dotenv is optional and private.

### Reproductions, fixes, and rechecks

Frontend before/after observations are saved in `revision-before.json` and `revision-after.json`. The first file was captured against the original delivered export before source fixes. The latter contains **25 passing assertions** against the rebuilt export. Source locations below refer to the revised files.

| Finding / severity | Source | Reproduction and result |
| --- | --- | --- |
| `eba9b4e…` · High · Stack fidelity | `service/main.py:316`, `service/config.py:9`, `service/templates/index.html:1` | Original service had a static root mount, dataclass/os.getenv settings, and none of the three reference dependencies. Added a real Jinja route, asset manifest, BaseSettings/dotenv layer, dependency declarations and exact locks. TestClient confirms an actual Jinja template response and asset loading under `/desk`, with authenticated APIs unchanged and settings absent from HTML. A separate Chromium test loads the running service over HTTP, creates a signal, fills a paper order, and observes notification-worker activation. |
| `d6fb8eb6…` · Medium · Writing/data disclosure | `src/main.ts:483`, `src/style.css:1333` | At 390px a threshold-0, RSI-0, VWAP-enabled rule displayed Watching but omitted RSI from both card variants. Both now print sentiment, RSI, and optional VWAP, with wrapping. Same-rule UI assertions and edit persistence pass. |
| `677eeeaef…` · Medium · Chart data | `src/chart.ts:73`, `src/main.ts:424`, `src/style.css:954` | With 170 null candles and ten observed candles, the old chart drew no sentiment path although the table held ten observations. It now renders one ten-point run, or multiple runs plus singleton points, without filling gaps. Tests also cover fully observed and empty ranges and toggling off the missing-history message. |
| `9d8e207e…` · Medium · Layout | `src/main.ts:531`, `src/style.css:2688` | At 320×844 the original Export CSV button extended 18px beyond its panel. Measured before focus/scrollIntoView, which can scroll an overflow-hidden ancestor and conceal the issue. `.portfolio-toolbar` now wraps with a 12px row gap below 650px. Button remains 114×32px, with zero clipped pixels; clicking downloads the CSV. |
| `3e0a1425…` · Medium · Typography/data identity | `src/chart.ts:12`, `src/chart.ts:94`, `src/main.ts:964` | The original 24-bar/4h range showed repeated clock times in the axis, keyboard tooltip, and table. Tooltip and all 15 table rows now include full UTC dates. Multi-day axes show day/month plus clock labels; a single-day control case retains clock-only labels. Rendered desktop and mobile charts were inspected. |
| `243aa935…` · Medium · Writing | `src/main.ts:349`, `src/main.ts:408`, `src/main.ts:511` | Six reported subtitles and the sidebar slogan were present. Replaced those six subtitles with the requested task guidance and deleted the sidebar note and unused CSS. Six route assertions and an absent-note assertion pass. The live-price portfolio explanation and unrelated copy are preserved. |

A packaging check found that the workspace ignores `.vite/`. The build manifest therefore uses the explicit filename `dist/build-manifest.json` instead of Vite's default cache-like directory. The manifest is included without changing any ignore file. No required runtime artifact was removed.

### Better Interface: coverage of the final revision

The pinned workflow, all six core domains, and design-documentation method were read and applied. The existing design system was preserved. `DESIGN.md` now documents the actual revised chart, signal summary, portfolio wrapping, copy, and Jinja shell.

| Domain | Checked in this revision | Limits / not applicable |
| --- | --- | --- |
| Accessibility | Existing keyboard dialog/focus-return suite; keyboard candle inspection; named indicator pressed states; working CSV button; seven page axe scans with zero violations. Visible chart/toolbar focus outlines were inspected in screenshots. | No native screen reader, forced-colors pass, exhaustive focus-background audit, or physical-device session. Axe is not a compliance certification. |
| Layout | Original 18px clipping measured and eliminated. Overview assertions at 320/390/768/1024/1440/1920; all seven views checked for page overflow at 320/390/768. First-screen product and Create signal verified at 390×844 in the export and Jinja service. Reviewed desktop/mobile overview, narrow portfolio, sparse/empty charts. | No browser-native 200% zoom or physical safe-area test. English-only scope; RTL/localization variants are not implemented. |
| Writing | Replaced reported slogans; complete condition disclosure; explicit missing sentiment; unambiguous dates. Existing error recovery, sample/live labels, and execution confirmations remain covered by the original interaction suite. | No change to unrelated accepted copy. No live-market accuracy claim for synthetic or controlled data. |
| Typography | Retained Inter and six-size scale; font loads; full condition summaries wrap; full timestamps fit the tooltip and remain accessible in the horizontal table scroller. Multi-day axes use two lines at the existing 12px size without overlap in inspected screenshots. | No native iOS focus-zoom, cross-OS typography, or text-enlargement test. |
| Colors | Source token/opacity review, current screenshots, and axe text-contrast checks. New sentiment points reuse the existing sentiment token and 0.85 opacity; empty-range note uses the existing muted token. No color-token changes. | Prior measured ratios in `contrast-measurements.json` are retained as historical evidence, not newly measured ratios. Every possible overlapping chart mark was not contrast-tested. No light theme is implemented. |
| UI details | Retained button/dialog states and paper/live distinctions. Tested sparse, isolated, full, empty, selected and deselected chart states, both signal card variants, and CSV download after toolbar wrapping. Existing refresh-draft preservation, error paths, and confirmations pass. | No animation timeline slow-motion review or OS-level reduced-motion test. Browser tests request reduced motion; source motion guards are unchanged. |

### Commands and actual results

Dependencies were installed in `/tmp/sentra-revision-js` and `/tmp/sentra-revision-py`, with browser binaries in `/tmp/sentra-browsers`. No repository `node_modules/`, cache, environment file, database, or Git metadata was written. The system lacked `ensurepip`, so pip was bootstrapped only into the temporary Python environment. These are worker setup details; normal install/publish steps remain in README.

```sh
PATH=/tmp/sentra-revision-js/node_modules/.bin:$PATH npm run typecheck
PATH=/tmp/sentra-revision-js/node_modules/.bin:$PATH npm run build
npm test
PYTHONDONTWRITEBYTECODE=1 /tmp/sentra-revision-py/bin/python -m pytest tests/test_service.py -q -p no:cacheprovider
/tmp/sentra-revision-py/bin/pip check
NODE_PATH=/tmp/sentra-revision-js/node_modules PLAYWRIGHT_BROWSERS_PATH=/tmp/sentra-browsers npm run test:browser
NODE_PATH=/tmp/sentra-revision-js/node_modules PLAYWRIGHT_BROWSERS_PATH=/tmp/sentra-browsers node tests/revision-browser.mjs
NODE_PATH=/tmp/sentra-revision-js/node_modules PLAYWRIGHT_BROWSERS_PATH=/tmp/sentra-browsers SENTRA_PYTHON=/tmp/sentra-revision-py/bin/python node tests/service-browser.mjs
```

| Check | Actual result |
| --- | --- |
| Typecheck and production build | Exit 0. Vite 7.3.7, seven modules. Export: HTML 1.31 kB; JS 77.26 kB; CSS 48.08 kB; Inter 48.26 kB; build manifest 0.38 kB, plus existing public assets. Asset URLs in `dist/index.html` remain relative. |
| Core calculations/ledger | Exit 0, **16/16**. Existing indicators, signal matching, risk sizing, paper cash/fees, backtest timing/stops and CSV checks. |
| Service | Exit 0, **16/16**. All 13 previous API/execution/provider tests retained, plus dotenv precedence/typed validation/startup guards and Jinja rendering with subpath assets. `pip check`: no broken requirements. No real exchange orders or owner credentials. |
| Existing browser suite | Exit 0, **19/19 scenarios**, **7/7 axe page scans with zero violations**, no unhandled JavaScript errors or failed local resources. `browser-results.json` records scenario names and native transport. |
| Targeted revision browser checks | Exit 0, **25/25 assertions**. Reproduction fixtures, both summaries, clipped-control measurement, actual CSV download, UTC inspection, all six subtitles, and chart data states. `revision-after.json` contains observed values. |
| Running Jinja service | Exit 0; seven checks in `service-browser-results.json`. Real HTTP, HTML/asset/font loading, authenticated health, signal creation, two-step paper order, root-scoped worker activation, and 390px first screen/reflow. The script starts/stops the service and removes its temporary database. |
| Package integrity | Current candidate byte counts, manifest/asset references and path-budget results are in `package-check.json`. Read-only Git enumeration only; submission is collected by the assignment, with no commit/bundle written by the worker. |

Chromium **156.0.8078.4** successfully opened ordinary local HTTP sockets in this revision; the earlier round's Node routing workaround was not used. The supplied browser connector failed to launch because its expected `/home/seat/.cache/ms-playwright/chromium-1246/...` executable was absent. A separately installed Playwright browser provided actual rendered screenshots and interactions. Browser checks were not substituted with source-only inspection. All test servers ran inside bounded foreground validation commands and were stopped afterward.

### Current rendered evidence and limitations

Viewed final screenshots: `desktop-overview.png`, `mobile-first-screen.png` (390×844), `revision-portfolio-320.png`, `revision-dated-chart.png`, `revision-sparse-chart.png`, `revision-empty-chart.png`, and `revision-service-mobile.png`. The sparse/empty images use controlled API fixtures and do not establish an external provider connection. The revised chart screenshots show the actual production SVG and current CSS. Earlier untouched native-browser and narrow-view artifacts remain prior-round evidence only.

Paid Twitter/Jev access, owner RSS/RPC availability, authenticated exchange execution, OS notification delivery, public deployment, Safari/Firefox, physical devices, native screen readers, and native zoom remain unverified. No live funds were traded. Jinja serving and dotenv configuration were verified locally; the code still requires the owner's real settings for live operation. The previous round's read-only external provider check was not repeated. One active user/tab and one service worker process remain the documented operational scope.

---

## Prior round record — historical

The following accepted record is preserved for continuity. Its old template substitution, dependency counts, bundle hashes, browser transport/tool observations, source line numbers, and native-browser evidence describe the **pre-revision** implementation and are superseded by the revision results above. Previously fixed unrelated behavior was retained. Some standard-suite screenshots were refreshed in this revision as noted above.

## Scope and implementation

The production export is `dist/`. The seven views are Overview, Markets, Signals, Backtesting, Portfolio, Connections, and Settings. They form a single-user, dark-theme, English workspace with hash navigation. Sample data and paper trading work without a backend. The optional FastAPI/SQLite service supplies real exchange prices, social/news/on-chain adapters, authenticated manual spot orders, one continuously running live strategy, and ntfy notifications. Credentials, provider feed/topic choices, and live order limits are owner configuration; none are invented or embedded.

The Jev-X reference stack was inspected: FastAPI, SQLite, CCXT, HTTPX, TwitterAPI.io, TypeSafe/Jev, and native browser JavaScript/CSS. This implementation uses TypeScript and Vite for checked browser code and a static export in place of server-rendered Jinja. The optional service can serve that same export. Indicators and charts are local code; there is no runtime chart CDN or wallet dependency.

The pinned Better Interface workflow and the core principles of all six domains were read and applied during implementation. Relevant supporting sections included forms, keyboard/focus, reflow, color contrast, numeric typography, states, and design documentation. `DESIGN.md` records the implemented system after the final interface fixes.

## Six-domain coverage

| Domain | Status and evidence | Unperformed / not applicable |
| --- | --- | --- |
| Accessibility | **Checked.** Native links/buttons/forms/dialogs, visible labels, named icon buttons, skip link, pressed/current states, focus outlines, keyboard chart inspection, Escape and focus return. Automated dialog cycling and cancellation tests passed. The supplied browser showed the actual focused signal dialog. All seven pages passed axe's WCAG 2 A/AA, 2.1 AA, and 2.2 AA tags with zero reported violations. Table scrollers are named and focusable. | **Not verified:** a native screen-reader session, physical touch devices, forced-colors rendering, and every focus ring on every possible background. Automated accessibility results do not establish complete compliance. |
| Layout | **Checked.** Source grouping/reading order, responsive grids, mobile menu, contained table scrolling, long forms, and real rendered desktop/mobile states. Overview: 320, 390, 768, 1024, 1440, and 1920 CSS px. Every view: 320, 390, and 768 px root-overflow assertions. At 390, the wordmark and Create signal button are visible in the first 844 px. At 320, every chart-toolbar control fits inside its panel after correction. | **Not verified:** browser-native 200% zoom and physical safe-area behavior. **Not applicable:** RTL/localization variants, because English is the requested and implemented language. Narrow reflow is not described as a zoom test. |
| Writing | **Checked.** Action labels matched their handlers; forms retained labels; empty states offered a next action; validation/provider errors explained recovery. Sample/live/stale labels and paper/real-funds confirmations were reviewed. Source provenance and calculation/backtest limitations are visible or documented. Failed connections retain honest sample labels. | **Not applicable:** translations and multi-user onboarding. No claim of a trained financial model or guaranteed stop execution is made. |
| Typography | **Checked.** Inter loaded locally; root size is 16 px with six UI sizes (12/14/16/20/28/36), numeric figures are tabular, body weights and line heights were inspected. Desktop, 390, 320, and intermediate-width screenshots were viewed for wrapping. Price-chart geometry is recalculated on resize. Equity captions now remain 12 px outside the scaling SVG. | **Not verified:** native iOS focus-zoom behavior, browser-native text zoom, and font rendering on other operating systems. |
| Colors | **Checked.** Semantic tokens and supported sRGB colors were inspected. Actual computed foreground/background pairs were measured in the rendered application, with alpha compositing for volume bars. Final ratios appear in `contrast-measurements.json`: muted labels 7.05:1, primary text 15.66:1, primary-button text 12.68:1, selected navigation 10.71:1, positive badge 8.02:1, rising volume 4.87:1, falling volume 3.65:1. Status words/signs and named/dashed series supplement hue. | **Not verified:** every possible overlapping chart stroke and OS forced-color substitution. **Not applicable:** light theme and P3 color variants; neither is implemented. Decorative grid/separator lines are not treated as text or controls. |
| UI details | **Checked.** Shared control, panel, badge, dialog, notification, table, loading/error/empty, and disabled states were inspected. Buttons give immediate feedback; dialogs separate order review from execution. Refresh preserves active drafts and calculated results. Motion is limited to 120 ms color/press feedback under `prefers-reduced-motion: no-preference`; charts do not animate. | **Not verified:** motion replay at 10% speed and an OS-level reduced-motion session. The CSS guard was reviewed. **Not applicable:** page entrance choreography and theme-swap animation. |

## Findings, corrections, and rechecks

Locations refer to the final source. Each row reports one underlying issue, including where multiple components shared it.

| Severity / domain | Source location | Observed issue and impact | Correction and recheck |
| --- | --- | --- | --- |
| High · Accessibility | `src/main.ts:540` | Repeated Tab presses could leave the dialog controls and reach browser chrome, disrupting the primary signal flow. | Explicit forward/backward focus cycling, native Escape, and focus restoration. Automated cycling/return passed; keyboard focus was viewed in `signal-dialog.png`. |
| High · UI | `src/main.ts:253` | Generic Cancel buttons inside forms inherited submit behavior and could create a rule. | Action helper explicitly uses `type="button"`; submit controls are explicit. Cancel test confirms signal count does not change. |
| High · Writing/data state | `src/main.ts:637`, `src/main.ts:691` | A failed initial provider refresh could label retained synthetic data as live. Switching source prices could also distort paper equity. | Validate snapshots before activating live mode; failed reconnect preserves the prior connection; persistent stale/retry messages; separate sample/live paper ledgers. Mocked API error/success and portfolio checks passed. |
| Medium · Typography | `src/style.css:8` | A 14 px root made the intended 12 px captions resolve to 10.5 px. | Set a 16 px root and retained the six-size scale. Computed font checks and rendered mobile/desktop review passed. |
| Medium · Layout | `src/style.css:3369` | The mobile shell hid the product name; compact metric adornments crowded the first screen. | Added a mobile wordmark and simplified optional adornments. Screenshot and bounding-box assertions show product plus main action at 390 px. |
| High · UI | `src/main.ts:326`, `src/main.ts:1487` | Periodic rendering could discard risk-calculator drafts/results. | Preserve form values and calculated output on automatic refresh; avoid refresh during active edits/dialogs. A virtual-clock 16-second interaction test passed without waiting on a real timer. |
| High · Layout | `src/style.css:3423` | An offscreen table label widened the 320 px Markets page to 735 px; the backtest result grid also overflowed to 412 px. | Position table scrollers and give result grids `min-width: 0`. Every view now has root width equal to viewport at 320/390/768 px. Real tables retain contained horizontal scrolling. |
| High · Accessibility | `src/main.ts:526` | Axe found the backtest log's scroll region was not keyboard focusable. | Added a named region and `tabindex="0"`. Repeated all seven page audits: zero reported violations. |
| Medium · Layout | `src/style.css:3412` | The duplicate chart-header price defeated a mobile hide rule and crowded Trade. | More specific responsive selector hides the duplicate price at constrained widths. Trade is fully visible at 390 and 320 px. |
| Medium · Colors | `src/style.css:952` | Volume bars at 0.17 opacity measured only about 1.44:1 and 1.33:1 against the chart surface. | Raised opacity to 0.65. Rendered alpha-composited ratios are now 4.87:1 and 3.65:1; screenshot reviewed. |
| High · Layout | `src/style.css:813` | At 320 px the last chart-toolbar control was clipped by the panel, despite no page-level overflow. | Toolbar groups can wrap. Final browser checks assert every control lies inside the panel at all six overview widths; native screenshot is `narrow-controls.png`. |
| Medium · Typography | `src/chart.ts:151`, `src/style.css:1856` | Scaling the equity SVG reduced its captions to approximately 3.39 effective pixels at 320 px. | Moved captions to a normal HTML figure caption. Computed size is 12 px; native rendered recheck is `narrow-backtest.png`. |

Additional implementation defects corrected during service checks: the Jev SDK imports from `typesafe_sdk` (verified against installed 0.7.4), interval query parsing accepts and validates numeric URL parameters, and unresolved automation requests persist before exchange side effects so a restart cannot silently forget them. Offline service tests cover restart disarming, uncertain execution, explicit reconciliation, idempotency, and caps.

No known unresolved primary-interaction or rendered-reflow blocker remains in the tested scope. The unperformed checks above remain limitations.

## Commands and actual results

Frontend dependencies were installed in `/tmp/sentra-tools` to respect the repository's protected `node_modules/` path. Python dependencies were installed in `/tmp/sentra-python`. These paths are worker setup only; normal contributor commands are in the README.

```sh
PATH=/tmp/sentra-tools/node_modules/.bin:$PATH npm run typecheck
PATH=/tmp/sentra-tools/node_modules/.bin:$PATH npm run build
npm test
/tmp/sentra-python/bin/python -m pytest tests/test_service.py -q -p no:cacheprovider
NODE_PATH=/tmp/sentra-tools/node_modules \
  PLAYWRIGHT_EXECUTABLE_PATH=/home/worker/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome \
  SENTRA_BROWSER_TRANSPORT=node npm run test:browser
```

| Check | Actual result |
| --- | --- |
| Strict TypeScript | Exit 0, `tsc --noEmit`. |
| Final production build | Exit 0, Vite 7.3.7, seven modules. After the last interface change: JS `index-RnLeOYTv.js` 76.56 kB; CSS `index-Bl7zwuZT.css` 48.19 kB; local font 48.26 kB; HTML 1.31 kB. Runtime share image/favicon/manifest/service worker are also included. |
| Core tests | Exit 0, **16/16**. EMA, RSI, UTC VWAP, MACD, missing-source weighting, signal matching, cash/fee conservation, position sizing, next-open backtest timing, stop precedence/gaps, fees/slippage, empty tests, CSV validation, escaped provider text. |
| Offline service tests | Exit 0, **13/13**. Authentication, missing sources/history, live opt-in, order caps/idempotency/uncertain status, finite validation, automation entry/exit/restart, reconciliation, notification configuration, scoring, short-token rejection. Fake exchange and random test tokens; no real orders. |
| Browser interactions | Exit 0, **19/19 scenarios**, Chromium 155.0.8059.12. Exact scenario names and seven zero-violation axe results are in `browser-results.json`. Includes real CSV file downloads/imports, signal persistence and cancellation, once-per-trigger paper automation, two-step order review, position close, risk errors, chart/table/keyboard controls, source search, empty results, alert inbox, reset confirmation, mocked private API flows, refresh draft preservation, metadata/font loading, and reflow. |
| Direct browser-tool review | The supplied browser opened `/preview/` over ordinary HTTP, exercised signal creation, paper trade/portfolio/risk/backtest flows and keyboard focus, and viewed desktop/mobile/intermediate screenshots. Final assets loaded with HTTP 200; recorded console contains zero errors/warnings. The notification service worker was activated at `/preview/`. See `native-browser-*.txt/json`. |
| Read-only external integration | The real Kraken adapter returned ETH/USDT at 2501.61 with 179 completed candles during the check. The machine-provided chain-1 RPC returned the last 12 eligible Ethereum blocks; the activity source scored 43. Social/news were explicitly unavailable without owner configuration. This was a transient observed result, not a fixture or current-price promise. No trade API credentials were used. |

The standalone Chromium process could not open sockets on this machine (`ERR_ACCESS_DENIED`). The automated suite therefore explicitly used its Node transport: a bounded foreground server supplied actual production bytes through Playwright routing. It did not substitute another app. Service workers were disabled for that routed suite. The separate supplied browser review used real HTTP and observed service-worker activation; actual OS notification delivery was not established.

The tool-managed preview configuration was absent, so a bounded foreground Python preview served the export for native browser inspection. It had a finite shutdown timer and was not installed as a service. Test code lives in `tests/`; no deliverable depends on `test/scratch/`, which is disposable.

## Rendered evidence

- `desktop-overview.png`: desktop overview, full page, 1440 px wide.
- `mobile-first-screen.png`: exact 390 × 844 first screen.
- `mobile-overview.png`: complete 390 px overview.
- `signal-dialog.png`: native-browser signal form with visible keyboard focus.
- `backtest-results.png`: functioning strategy lab with metrics, equity, and fills.
- `narrow-controls.png`: final native-browser 320 px overview with wrapped, reachable chart controls.
- `narrow-backtest.png`: final native-browser 320 px equity captions and contained trade table.
- `contrast-measurements.json`: measured rendered color pairs, including composited volume bars.

## Packaging and remaining limits

`package-check.json` records final file/export bytes, the local-asset integrity check, and the explicit path-budget checks. The repository ignore file includes `dist/` and explicitly includes required `artifacts/` evidence despite the workspace's default exclusion. Dependency/cache directories are excluded at every nesting level. No npm registry archive, dependency directory, submodule, private key, or database is delivered. `.git/`, `.github/`, `.env` files, and repository `node_modules/` were not modified. No Git metadata was written; the submission collector receives the source and export files.

Paid Twitter/Jev integrations, owner RSS content, authenticated exchange execution on each supported venue, and actual mobile/desktop notification delivery remain unverified without owner settings. Mobile alerts need the private service plus an owner-selected ntfy topic; a static export alone cannot run background live execution. Real provider aggregation polls every 60 seconds, subject to availability; it is not an exchange tick stream. The browser's paper automation pauses when hidden/editing or refresh is disabled. Live automation needs one running service worker process, starts disarmed, and uses software stops. One active browser tab is supported; there is no cross-tab ledger lock. No public deployment, live funds trade, native screen-reader session, Safari/Firefox pass, or physical-device pass is claimed.
