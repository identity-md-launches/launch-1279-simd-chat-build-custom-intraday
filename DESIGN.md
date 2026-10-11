# Sentra design system

## Overview

Sentra is a personal crypto research and trading desk. The implemented direction is a restrained dark interface: graphite surfaces, a lime primary action, mint positive data, rose negative data, and compact numeric typography. There is no marketing hero. The overview opens with the product workspace, **Create signal**, four summary metrics, an interactive chart and sentiment index, followed by source observations, signals, and positions.

The shared shell, forms, buttons, panels, source rows, and tables support all seven views. The overview's chart/index arrangement is specific to that page; the strategy lab and settings use layouts suited to their tasks. Source of truth: `src/style.css`, `src/main.ts`, `src/chart.ts`, and `src/icons.ts`.

## Colors

Canonical values are hexadecimal. Primitive neutral/status values are declared in `:root`; semantic tokens name their use.

| Semantic token | Value | Use |
| --- | --- | --- |
| `--bg` | `#101214` | Workspace background and field interiors |
| `--sidebar` | `#131517` | Sidebar and table headers |
| `--surface` | `#171a1c` | Panels and metric cards |
| `--surface-hover`, `--control` | `#1d2124` | Neutral controls, hover surfaces, notes |
| `--border` | `#24292c` | Structural separators |
| `--control-border` | `#596369` | Input/control boundaries |
| `--text` | `#f0f3f2` | Primary text and headings |
| `--secondary` | `#ced4d7` | Feed copy, secondary text |
| `--muted` | `#9ca6ac` | Labels, captions, inactive navigation |
| `--accent`, `--focus` | `#c3ef73` | Primary actions, current navigation, focus outline |
| `--accent-soft` | `#252e1b` | Selected navigation background |
| `--positive`, `--positive-bg` | `#65d7aa`, `#192f28` | Positive values, rising candles, bullish badges |
| `--negative`, `--negative-bg` | `#ed858b`, `#352025` | Negative values, falling candles, errors |
| `--warning` | `#ddc27a` | Neutral sentiment, sample indicator, VWAP series |
| `--sentiment` | `#ac9be9` | Sentiment/RSI chart series and on-chain source identity |

`#182013` is the dark label on primary buttons. The orange Bitcoin, blue Ethereum, and purple Solana coin symbols are asset identifiers, not action colors. Chart grids use `#2b3033`; their separators are decorative. Volume bars composite the positive/negative colors over the chart surface at 0.65 opacity. Sentiment is dashed, VWAP solid, and series have named toggles; color is not the only identifier.

Measured rendered contrasts and the volume-bar correction are recorded in `artifacts/contrast-measurements.json` and `artifacts/validation.md`. The implementation has one deliberate dark theme; no light-mode variant is claimed.

## Typography

The local variable font is **Inter**, `src/assets/inter-latin.woff2`, normal style, weight range 100–900, loaded with `font-display: swap`. Fallbacks are system UI, Apple system, BlinkMacSystemFont, Segoe UI, and sans-serif. Implemented UI weights are 400, 450, 500, 550, 600, and 650; no italic face is requested.

The root is 16 px. The six-size scale is:

| Token | Size | Role |
| --- | --- | --- |
| `--text-xs` | 12 px | Captions, chart axes, dense table text, badges |
| `--text-sm` | 14 px | Body UI text, controls, feed titles |
| `--text-base` | 16 px | Panel headings, selected price readouts |
| `--text-lg` | 20 px | Dialog headings and compact metric values |
| `--text-xl` | 28 px | Page headings and desktop metrics |
| `--text-2xl` | 36 px | Wordmark and sentiment gauge readout |

UI body line-height is 1.5, page headings 1.2, panel headings 1.35, and longer helper text 1.65–1.75. Headings use balanced wrapping; paragraphs use pretty wrapping. Page headings have −0.7 px letter spacing; large metrics −0.8 px. Small text is not tracked or presented as uppercase eyebrow copy. Asset symbols and indicator abbreviations retain their standard capitalization.

Numbers use `font-variant-numeric: tabular-nums` globally. Long explanations cap their measure at about 65–75 characters. Dynamic feed, signal, and dialog content can break long words. At small widths editable controls use 16 px text to avoid iOS focus zoom. The compact chart asset select remains a non-text-entry control. The price chart recalculates its viewBox for its container; the equity chart uses a separate 12 px HTML caption so labels do not shrink with the plot. Font loading was verified in Chromium.

## Layout

Shared spacing follows 4, 8, 12, 16, 20, 24, and 32 px steps, with explicit compact chart exceptions. Corresponding `--space-*` tokens are declared in `:root`; the existing CSS also uses these values directly. Group spacing is larger than internal control spacing.

- Desktop sidebar: 212 px wide, fixed to the leading edge. The workspace uses a matching inset. The top bar is 73 px tall.
- Main area: 30 px padding, fluid width, maximum 1,720 px. Page headings pair title/description with a single emphasized action.
- Metrics: four equal minimum-zero columns with 16 px gaps. Desk content uses approximately 2.23:1 chart/index columns and a 20 px gap. Panels and grid children use `min-width: 0` where content needs to shrink.
- The strategy lab uses a 325 px parameter column and a flexible results column. Connections uses two equal panels. Settings has a 950 px reading width.
- Tables preserve their real column structure inside focusable horizontal scrollers. `.table-wrap` is positioned, so offscreen assistive labels remain inside the scroll region rather than widening the page. Long backtest logs also scroll vertically, with sticky headers. The chart toolbar wraps its two control groups when space is limited.

Implemented breakpoints:

| Width | Behavior |
| --- | --- |
| ≥1,600 px | Larger chart/index proportions and additional breathing room; type scale stays 16 px based. |
| ≤1,250 px | Sidebar becomes 190 px; main padding 24 px; optional session text hides. |
| ≤1,060 px | Sidebar collapses to a 76 px icon rail with persistent accessible names. |
| ≤850 px | Metrics become two columns; feed and signals move below the chart/index; strategy lab and connections stack; duplicate chart-header price hides. |
| ≤650 px | Sidebar becomes an explicit mobile navigation dialog; product wordmark is visible in the top bar. Main padding is 16 px, top bar 60 px. Charts and content stack. Primary action remains before the metrics. |
| ≤360 px | Main padding becomes 12 px; detailed two-column forms and result metrics stack. Optional labels simplify while the main controls remain. |

The overview was checked at 320, 390, 768, 1,024, 1,440, and 1,920 CSS pixels. All seven views were checked for page-level overflow at 320, 390, and 768 px. Native browser zoom and physical-device behavior remain unverified, as detailed in validation.

## Elevation & depth

Cards are flat surfaces with 1 px structural borders, rather than decorative shadows. Elevation is reserved for the chart tooltip, toast, and native modal. The modal uses a `0 24px 100px #0009` shadow and a dark, 3 px blurred backdrop. Toasts use `0 12px 45px #0008`. The fixed sidebar is at stacking level 30, the mobile scrim at 25, and toasts at 100; native dialogs use the browser top layer.

There is no page-load animation. Under `prefers-reduced-motion: no-preference`, button/navigation colors transition over 120 ms and buttons scale to 0.96 on press. Reduced-motion users receive immediate state changes. Chart updates do not animate. Text and status cues remain visible independently of motion.

## Shapes

Panels and metric cards use the 10 px `--radius` token. Buttons are 7 px, fields and segmented control containers 6 px, badges 4 px, and desktop dialogs 14 px (12 px mobile). Asset markers and profile initials are circular. Borders indicate structure or an actual control boundary; the primary action is filled lime. Source rows use compact 7 px icon containers.

## Components

| Pattern / source | Use and behavior |
| --- | --- |
| `navLink()` / `.nav-link` in `src/main.ts` | Real hash links, named even when the visual label hides. Current page uses `aria-current`, a tinted surface, and a leading marker. Mobile navigation makes the background inert, wraps keyboard focus, closes on Escape, and closes when resizing back to desktop. |
| `heading()` | One page `h1`, plain supporting line, and a responsive action area. Avoid inserting a hero above the workspace. |
| `button()` / `.button` | Neutral default, `.primary` for the main action, `.compact` for dense areas, `.danger` for explicit consequential confirmation. Action helpers use `type="button"`; form submit controls are explicit. Disabled/busy states are native. |
| `input()` / `.field` | Persistent labels, semantic native input types, validation limits, and visible control borders. `.form-grid` groups related fields; `.check-field` gives checkboxes a shared label target. Errors use adjacent alert regions. |
| `.panel`, `.panel-heading`, `.metric-card` | Shared grouping and reading edges. Metrics have stable numeric styling and contextual source labels. |
| `chartPanel()` + `renderChart()` in `src/chart.ts` | Native SVG candles and overlays, named pressed-state toggles, pointer/keyboard inspection, visible tooltip, and an accessible candle data table. RSI/MACD appear as subordinate plots. |
| `signalCard()` | Asset, named rule, threshold explanation, textual monitoring status, and edit/pause controls. Paper execution is explicitly labeled. |
| `feedPanel()` | Source filtering/search, full-text detail dialog, score label, and a recoverable no-results state. Provider text is escaped before rendering. |
| `openModal()` | Native `<dialog>`, labeled title, explicit keyboard cycling, Escape close, and focus return. Long forms scroll within viewport bounds. Order review is distinct from order submission. |
| `toast()` / `notify()` | Persistent dismissible polite status messages and an alert inbox. Important errors/actions do not disappear on a timer. |
| `.table-wrap` | Focusable, named region with contained horizontal overflow; real native table headings. Backtest logs have a visible empty state. |

Form drafts and calculated risk results survive automatic refresh. Sample versus live and fresh versus stale data are explicit. Missing live sources produce an unavailable state; sample observations are not silently relabeled live. Sample-price and live-price paper ledgers are isolated.

## Do's and don'ts

- Start new views with `heading()`, the existing panel/field patterns, and one primary action. Add a route in `Page`, `pageNames`, `navIcons`, and `pageContent()`.
- Reuse semantic color roles. Use lime for emphasis/focus, mint/rose for data direction, and words or signs alongside status color.
- Keep the six-size scale, tabular numbers, 12 px minimum labels, and 16 px mobile text-entry controls.
- Keep live data provenance and execution account visible. Do not replace missing provider observations with synthetic values.
- Use the zero-minimum grid patterns and positioned table scroller. Do not widen the whole page to accommodate a table.
- Preserve native controls, focus outlines, modal focus return, and reduced-motion behavior. Do not implement a clickable visual element without a keyboard path.
- Test a new view at 320 and 390 px with real-length content, then update the validation record and rebuild `dist/`.
