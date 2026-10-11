# Sentra implementation and validation

Worker review, 11 October 2026. **Complete for the stated scope**, with the external-service and device limitations below. This report records checks performed by the worker; it is not an independent certification.

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
