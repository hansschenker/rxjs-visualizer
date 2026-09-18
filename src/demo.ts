import {
  Subject,
  combineLatest,
  concat,
  concatMap,
  filter,
  from,
  ignoreElements,
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
  isColumnDone,
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

export interface DiamondDemoOptions {
  /**
   * How the sink combines the two branches.
   * - 'zip' pairs each source value's left and right results, so every
   *   column is a clean top-to-bottom flow.
   * - 'combineLatest' re-emits whenever either branch changes and exposes
   *   the diamond glitch: for source value 2 the sink emits 14 before 24.
   */
  sink: 'zip' | 'combineLatest';
  /** One source value, one arrow step, and one reveal all take this long. */
  stepMs?: number;
  /** Emitted in order; each one waits for the previous one to reach the sink. */
  values?: number[];
  /** Horizontal distance of one step, whatever the speed. */
  pxPerStep?: number;
}

const LANES = {
  source: '1. Source',
  left: '2. Left (x * 2)',
  right: '3. Right (x * 10)',
  sink: '4. Sink (L + R)',
} as const;

/** Mounts the visualizer into `#app` and runs the diamond pipeline through it. */
export function startDiamondDemo({ sink, stepMs = 800, values = [1, 2], pxPerStep = 200 }: DiamondDemoOptions): void {
  const dispatcher$ = new Subject<Action>();

  const initialState: VisualizerState = {
    lanes: Object.values(LANES),
    columns: [],
    startTime: Date.now(),
  };

  // 1. Store: `scan` is the store. `startWith` paints the empty lanes before the first emission.
  const state$ = dispatcher$.pipe(scan(update, initialState), startWith(initialState), shareReplay(1));

  // 2. View
  const renderConfig = { ...DEFAULT_RENDER_CONFIG, stepMs, timeScale: pxPerStep / stepMs };
  state$.subscribe((state) => renderVisualizerToDOM(state, renderConfig));

  // 3. Effect: each source emission starts a clock that reveals its column one
  //    emission per step, which is what moves the arrow. It stops itself once
  //    nothing is left to reveal.
  dispatcher$
    .pipe(
      filter(isSourceEmit),
      mergeMap(({ column }) =>
        interval(stepMs).pipe(
          withLatestFrom(state$),
          takeWhile(([, state]) => hasPendingReveals(state, column)),
          map((): Action => ({ type: 'REVEAL', column })),
        ),
      ),
    )
    .subscribe((action) => dispatcher$.next(action));

  // 4. Pipeline. The source is paced by the visualizer itself: each value is
  //    emitted one step after the previous value's column is fully revealed,
  //    i.e. after it has arrived at the sink lane. `share()` keeps one source
  //    subscription and one source-lane emission per value even though both
  //    branches subscribe to it.
  const columnDone$ = (column: number) =>
    state$.pipe(
      filter((state) => isColumnDone(state, column)),
      take(1),
      ignoreElements(),
    );

  const source$ = from(values).pipe(
    concatMap((value, column) =>
      concat(
        timer(stepMs).pipe(map(() => value)),
        columnDone$(column),
      ),
    ),
  );

  const trackedSource$ = source$.pipe(trackSource(LANES.source, dispatcher$), share());

  const left$ = trackedSource$.pipe(visualizedMVU(LANES.left, dispatcher$, map((x) => x * 2)));

  const right$ = trackedSource$.pipe(visualizedMVU(LANES.right, dispatcher$, map((x) => x * 10)));

  const combined$ = sink === 'combineLatest' ? combineLatest([left$, right$]) : zip([left$, right$]);

  const sink$ = combined$.pipe(visualizedMVU(LANES.sink, dispatcher$, map(([l, r]) => l + r)));

  // Subscribing activates the streams; the first source value arrives one step later.
  sink$.subscribe((finalValue) => {
    console.log(`Sink evaluated to: ${finalValue}`);
  });
}
