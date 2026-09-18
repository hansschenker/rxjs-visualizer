import './style.css';
import {
  Subject,
  combineLatest,
  filter,
  interval,
  map,
  mergeMap,
  scan,
  share,
  shareReplay,
  startWith,
  take,
  takeWhile,
  timer,
  withLatestFrom,
  zip,
} from 'rxjs';
import {
  DEFAULT_RENDER_CONFIG,
  hasPendingReveals,
  isSourceEmit,
  renderVisualizerToDOM,
  trackSource,
  update,
  visualizedMVU,
  type Action,
  type VisualizerState,
} from './visualizer.ts';

// ==========================================
// DEMO: a diamond pipeline (source -> left/right -> sink)
// ==========================================

/** One source value, one arrow step, and one reveal all take this long. */
const STEP_MS = 800;
const SOURCE_VALUES = 2;
/** Horizontal distance between two source values, whatever the speed. */
const PX_PER_STEP = 200;
/**
 * false: the sink uses `zip`, which pairs each source value's left and right
 *        results, so every column is a clean top-to-bottom flow.
 * true:  the sink uses `combineLatest`, which exposes the diamond glitch
 *        (for source value 2 the sink emits 14 before 24).
 * Left off until the coordinate system is settled.
 */
const SHOW_GLITCH = false;

const LANES = {
  source: `1. Source (every ${STEP_MS}ms)`,
  left: '2. Left (x * 2)',
  right: '3. Right (x * 10)',
  sink: '4. Sink (L + R)',
} as const;

const dispatcher$ = new Subject<Action>();

const initialState: VisualizerState = {
  lanes: Object.values(LANES),
  columns: [],
  startTime: Date.now(),
};

// 1. Store: `scan` is the store. `startWith` paints the empty lanes before the first emission.
const state$ = dispatcher$.pipe(scan(update, initialState), startWith(initialState), shareReplay(1));

// 2. View
const renderConfig = { ...DEFAULT_RENDER_CONFIG, stepMs: STEP_MS, timeScale: PX_PER_STEP / STEP_MS };
state$.subscribe((state) => renderVisualizerToDOM(state, renderConfig));

// 3. Effect: each source emission starts a clock that reveals its column one
//    emission per STEP_MS, which is what moves the arrow. It stops itself once
//    nothing is left to reveal.
dispatcher$
  .pipe(
    filter(isSourceEmit),
    mergeMap(({ column }) =>
      interval(STEP_MS).pipe(
        withLatestFrom(state$),
        takeWhile(([, state]) => hasPendingReveals(state, column)),
        map((): Action => ({ type: 'REVEAL', column })),
      ),
    ),
  )
  .subscribe((action) => dispatcher$.next(action));

// 4. Pipeline. `share()` keeps one timer and one source-lane emission per value
//    even though both branches subscribe to the source.
const source$ = timer(STEP_MS, STEP_MS).pipe(
  take(SOURCE_VALUES),
  map((i) => i + 1),
);

const trackedSource$ = source$.pipe(trackSource(LANES.source, dispatcher$), share());

const left$ = trackedSource$.pipe(visualizedMVU(LANES.left, dispatcher$, map((x) => x * 2)));

const right$ = trackedSource$.pipe(visualizedMVU(LANES.right, dispatcher$, map((x) => x * 10)));

const combined$ = SHOW_GLITCH ? combineLatest([left$, right$]) : zip([left$, right$]);

const sink$ = combined$.pipe(visualizedMVU(LANES.sink, dispatcher$, map(([l, r]) => l + r)));

// Subscribing activates the streams; the first source value arrives STEP_MS later.
sink$.subscribe((finalValue) => {
  console.log(`Sink evaluated to: ${finalValue}`);
});
