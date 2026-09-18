# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An RxJS operator visualizer: pure TypeScript + Vite, no UI framework. It animates emissions flowing through an RxJS pipeline as dots on horizontal "lanes" (one per operator), with X = time of the source emission and Y = lane.

Three pages share one coordinate system. `index.html` is the main demo: a diamond pipeline (source, two `map` branches, a `zip` sink) where every column is a clean top-to-bottom flow, in real time. `glitch.html` runs the same pipeline with a `combineLatest` sink to expose the diamond-dependency glitch (an intermediate sink value); it is postponed work in progress, so keep glitch-specific features there, never on the main page. `spec.html` renders an rxjs marble test (currently debounceTime) by running it through the real `TestScheduler` in the browser: one frame is one column, expected values are rings, actual values are fills, and a playhead walks virtual time. The design note behind the spec page is `docs/spec-proposal.html` (standalone HTML, also served by the dev server at `/docs/spec-proposal.html`).

## Commands

```bash
npm run dev       # Vite dev server: http://localhost:5173/ , /glitch.html , /spec.html
npm run build     # tsc (typecheck only, noEmit) && vite build -> dist/
npm run preview   # serve dist/
npm test          # vitest run (all tests, once)
npx tsc           # typecheck alone; this is the gate that fails builds
npx vitest run src/visualizer.test.ts   # one file; drop `run` for watch mode
```

Tests are Vitest 5 with no config file: default node environment, default `*.test.ts` discovery. The reducers, tracking operators, and the spec runner (which drives the real `TestScheduler`) are pure and covered; the DOM renderers are not.

`vitepress` is listed in `dependencies` but there is no `.vitepress/` directory or docs site. Treat it as an unused leftover, not as a signal that a docs site exists.

## Architecture

`src/visualizer.ts` is the pure, testable module for the real-time pages (model, reducer, tracking operators, DOM renderer) and also exports the shared coordinate helpers `timeX`, `laneY`, `pxPerStep`, `drawTimeBands` and `ARROW_SVG`. `src/demo.ts` exports `startDiamondDemo(options)`, which wires the store, the reveal effect, and the diamond pipeline; the options carry the sink strategy (`'zip'` or `'combineLatest'`) and the tuning values `stepMs`, `values`, `pxPerStep`. `src/spec-visualizer.ts` is the frame-based counterpart for marble specs (model, reducer, `runMarbleSpec`, `debounceWindows`, renderer); `src/spec-demo.ts` wires its playback; `src/specs.ts` holds the spec data. `src/main.ts`, `src/glitch.ts` and `src/spec.ts` are one-line page entries. `vite.config.ts` lists every HTML page as a build input (`build.rolldownOptions.input`); a new page needs an entry there or `vite build` will not emit it. Appearance lives in `src/style.css` as `.rx-*` classes; the renderers set only positions inline.

The app is an Elm-style Model-View-Update loop driven by RxJS itself:

1. **Model** — `VisualizerState` holds `lanes: string[]` (ordered labels) and `columns: Column[]`. A **column** is everything caused by one source emission: its `time` (ms since start, drives X), `sourceValue`, the ordered list of dependent `emissions` (`{ laneIndex, value }`), and a `revealed` cursor into that list.
2. **Actions** — `SOURCE_EMIT` opens a new column. `EMIT` appends to the *latest* column, which relies on downstream propagation being synchronous (true for `map`, `combineLatest`; not for `delay`, `debounceTime`). `REVEAL` advances the cursor by one, capped at the emission count.
3. **Tracking operators** — `trackSource(laneName, dispatcher)` goes once on the source stream and dispatches `SOURCE_EMIT`. `visualizedMVU(laneName, dispatcher, operator)` wraps any `OperatorFunction`, pipes it, then `tap`s an `EMIT` with the result.
4. **Store** — `dispatcher$.pipe(scan(update, initialState), startWith(initialState), shareReplay(1))`. `scan` *is* the store; `startWith` paints the empty lanes before the first emission.
5. **Reveal effect** — for every `SOURCE_EMIT`, `demo.ts` starts `interval(stepMs)` that dispatches `REVEAL` for that column and stops itself via `takeWhile(hasPendingReveals)`.
6. **Source pacing** — the demo source is `from(SOURCE_VALUES)` with `concatMap`: each value waits one step, is emitted, then the inner observable holds (via `state$` + `isColumnDone`) until that value's column is fully revealed, i.e. until the arrow has reached the sink. Only then does the next value start its step. Result: one event per step, and columns never overlap. A source value that produces no downstream emission would stall the source forever.
7. **View** — `renderVisualizerToDOM` upserts absolutely positioned elements keyed by id, so re-rendering the whole state every action is cheap. Per column: the source node appears settled at once; every other lane gets a dashed **pending** node showing the untransformed source value; each `REVEAL` turns the next emission's node red with its real value (and a lane that emits twice in one column gets a second node shifted right by `siblingOffset`); a yellow **arrow** element moves to the lane of the next emission to reveal, with a CSS transition of `--rx-step` so it arrives exactly when the value flips, and fades once the column is done.

### Spec page (`spec.html`)

Same coordinate rule, different unit: `stepMs: 1` (one TestScheduler frame) and `timeScale: 30` (px per frame), marble 26 px so adjacent frames never overlap. `runMarbleSpec(spec)` constructs `new TestScheduler(capture)` and runs the spec verbatim inside `run()`: `hot()` supplies the source events, the capture callback receives the actual and expected messages from `expectObservable(...).toBe(...)` and the subscription log from `expectSubscriptions`. State is lanes of `{ frame, kind, value }` events plus spans (subscription, window, cancelled window) and a `playhead`; the only action is `TICK`. Lanes marked `reveal: 'playhead'` show their events when the playhead reaches them; the rest are inputs shown up front. `debounceWindows` is the first operator annotator; time-based operators share its shape (a duration that starts at an input frame).

- **Parse and run inside `run()`.** Outside it the static `TestScheduler.parseMarbles` uses a frame factor of 10 and reports frames 10, 40, 50 instead of 1, 4, 5.
- The `10ms` / `1s` time-progression syntax is not handled yet; at 30 px per ms it needs an axis-break convention first.

Consequences worth knowing before changing it:

- The arrow follows the *real* emission order, not a fixed top-to-bottom sweep. With `zip` those coincide. On the glitch page the second column runs Left, Sink (14), Right, Sink (24), so the arrow visibly jumps back up and the sink gets two nodes. That is intentional.
- `stepMs` sets four things at once: the delay before each source value, the reveal cadence, the arrow transition time (passed to the renderer and written to the `--rx-step` CSS variable), and the width of one shaded time band. Keep them coupled. `pxPerStep / stepMs` is the X scale, so changing speed does not change layout.
- Dependent nodes are drawn in their *source's* column (X = source emission time) even though they are revealed later, so the bands between two source values stay empty. That is by design: the column shows what one source value caused; the arrow shows the order.
- **Coordinate system is the web page's**: origin top-left, X right, Y down, no hidden offsets. Time 0 is the left edge of the timeline (`startXOffset`); `timeX(t) = startXOffset + t * timeScale`. Lane k's top is `startYOffset + k * laneHeight`. A node's top-left corner is placed at `(timeX(time), laneY(lane))` exactly like a DOM element, so the lane line runs through the node's vertical center. Keep it that way; do not reintroduce centering offsets.
- **Time bands** are drawn once at setup across `laneWidth`, alternating `.is-even` / `.is-odd`. Band k covers `[k·step, (k+1)·step)` and is labeled with its start time at its left edge, so an event firing on a tick starts at the left edge of the band carrying that tick's label.
- X is wall-clock time. In a background or throttled tab, browser timer throttling stretches the gap between columns; the pipeline still behaves correctly.
- The source must be `share()`d after `trackSource`, otherwise each downstream branch subscribes separately and the source lane records every value twice.
- Lane lookup is by exact string via `indexOf`. A label typo yields `laneIndex = -1` and a node drawn above the first lane.
- Lane backgrounds are drawn once from the state seen on the first render; adding lanes later will not draw new lane lines.
- The container mounts into `#app` from `index.html` (falls back to `body`).
- `src/counter.ts` is an unused Vite template leftover.

## TypeScript gotchas (tsconfig)

- `verbatimModuleSyntax` is on. Type-only rxjs exports (`OperatorFunction`, `MonoTypeOperatorFunction`, `Observable` when used only as a type, etc.) **must** be imported with `import type` or an inline `type` modifier. Otherwise `tsc` fails with TS1484 and, worse, the Vite dev server ships the import to the browser, which throws `does not provide an export named '...'`.
- `erasableSyntaxOnly` is on: no `enum`, `namespace`, or constructor parameter properties.
- `noUnusedLocals` / `noUnusedParameters` are errors, not warnings.
- `strict` is **not** enabled. Enabling it is a deliberate change, not a drive-by.
