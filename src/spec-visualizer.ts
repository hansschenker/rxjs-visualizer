import { tap, type Observable, type OperatorFunction } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import { ARROW_SVG, DEFAULT_RENDER_CONFIG, drawTimeBands, timeX, type RenderConfig } from './visualizer.ts';

// ==========================================
// 1. MODEL & MESSAGES (MVU State, frame-based)
// ==========================================
//
// One TestScheduler frame is one column. Inside `testScheduler.run()` a marble
// character is one frame and one frame is one millisecond, so the shared
// coordinate rule applies unchanged with stepMs = 1 and timeScale = px/frame.

export type MarbleKind = 'next' | 'complete' | 'error';

export interface MarbleEvent {
  frame: number;
  kind: MarbleKind;
  value?: string;
}

/** 'queued': an outer value waited for an earlier inner to finish (concatMap). */
export type SpanKind = 'subscription' | 'window' | 'cancelled' | 'queued';

export interface Span {
  from: number;
  to: number;
  kind: SpanKind;
  /** Frames of further values folded into this window after the one that opened it. */
  inputs?: number[];
}

export interface SpecLane {
  label: string;
  detail: string;
  /** Raw marble string, drawn one character per frame above the lane ('' for none). */
  marbles: string;
  /** Frame of the first character of `marbles`; inner observables start where they were subscribed. */
  marblesFrom?: number;
  /** Solid marbles: source values, or the scheduler's actual output. */
  events: MarbleEvent[];
  /** Ring marbles: what the spec expects. Output lane only. */
  expected: MarbleEvent[];
  spans: Span[];
  /** 'always': inputs, known up front. 'playhead': outputs, shown when the playhead reaches them. */
  reveal: 'always' | 'playhead';
  /** Lane height override. Lanes under 90 px use the compact layout. */
  height?: number;
  /** Nesting level, for indentation of the label. */
  depth?: number;
  /** Header rows have no baseline. */
  noBaseline?: boolean;
  /** Dotted line from another lane's value at `frame` down to this lane: "this value spawned me". */
  dropFrom?: { lane: number; frame: number };
  /** Small arrow under each revealed value, pointing at the output lane. */
  emitArrows?: boolean;
}

export interface SpecState {
  title: string;
  lanes: SpecLane[];
  /** Frames on the ruler, numbered 0 .. frames - 1. */
  frames: number;
  /** Last frame the playhead has reached; -1 before playback starts. */
  playhead: number;
}

export type SpecAction = { type: 'TICK' };

// ==========================================
// 2. UPDATE (State Transitions)
// ==========================================

export const hasFramesLeft = (state: SpecState): boolean => state.playhead < state.frames - 1;

export const updateSpec = (state: SpecState, action: SpecAction): SpecState => {
  switch (action.type) {
    case 'TICK':
      return hasFramesLeft(state) ? { ...state, playhead: state.playhead + 1 } : state;
    default:
      return state;
  }
};

// ==========================================
// 3. RUNNING A SPEC THROUGH THE REAL TestScheduler
// ==========================================

/** Values maps as rxjs specs write them: `{ x: 10, y: 30 }`. */
export type MarbleValues = Record<string, unknown>;

interface SpecBase {
  title: string;
  /** Marbles for `hot(...)`. Leading spaces are fine: run mode ignores whitespace. */
  source: string;
  sourceValues?: MarbleValues;
  /** Marbles for `expectSubscriptions(e1.subscriptions).toBe(...)`. */
  subscriptions: string;
  /** Marbles for `expectObservable(...).toBe(...)`. */
  expected: string;
  expectedValues?: MarbleValues;
  operatorLabel: string;
}

/** A time-based operator: one `time(...)` duration, e.g. debounceTime, auditTime. */
export interface TimeSpec extends SpecBase {
  kind: 'time';
  /** Marbles for `time(...)`; the frame count up to `|` becomes `t`. */
  duration: string;
  /** Which annotator draws the operator lane's windows. */
  windows: WindowKind;
  operator: (t: number) => OperatorFunction<unknown, unknown>;
}

export type WindowKind = 'debounce' | 'audit';

/** A higher-order operator: one cold inner observable, re-subscribed per outer value. */
export interface HigherOrderSpec extends SpecBase {
  kind: 'higherOrder';
  inner: {
    /** Marbles for `cold(...)`, relative to its subscription. */
    marbles: string;
    values?: MarbleValues;
    /** Marbles for `expectSubscriptions(inner.subscriptions).toBe([...])`, one per subscription. */
    subscriptions?: string[];
  };
  /** The spec's project function: what it does with the inner for one outer value. */
  project: (value: unknown, inner: Observable<unknown>) => Observable<unknown>;
  /** The flattening operator the spec applies to that project function: mergeMap, switchMap, ... */
  flatten: (project: (value: unknown) => Observable<unknown>) => OperatorFunction<unknown, unknown>;
}

export type MarbleSpec = TimeSpec | HigherOrderSpec;

// Structural views of what TestScheduler hands to its assert callback.
interface RecordedMessage {
  frame: number;
  notification: { kind: 'N' | 'E' | 'C'; value?: unknown; error?: unknown };
}

interface RecordedSubscription {
  subscribedFrame: number;
  unsubscribedFrame: number;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

const isMessages = (x: unknown): x is RecordedMessage[] =>
  Array.isArray(x) && x.every((m: unknown) => isRecord(m) && 'notification' in m);

const toEvents = (messages: RecordedMessage[]): MarbleEvent[] =>
  messages.map(({ frame, notification }): MarbleEvent => {
    if (notification.kind === 'N') return { frame, kind: 'next', value: String(notification.value) };
    if (notification.kind === 'C') return { frame, kind: 'complete' };
    return { frame, kind: 'error' };
  });

/** Frames a run-mode marble string covers: one per character, whitespace ignored. */
export const marbleFrames = (marbles: string): number => marbles.replace(/\s/g, '').length;

const describeValues = (values: MarbleValues | undefined): string =>
  values === undefined
    ? ''
    : ' · ' +
      Object.entries(values)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');

// Within one frame the TestScheduler delivers hot-observable messages before
// operator timers scheduled during the run, so a value that lands on the exact
// frame a window ends is seen by the operator *before* the window fires.

/**
 * Windows of debounceTime: each value opens a window of `t` frames. A newer
 * value on or before the window's last frame cancels it; source completion
 * closes it early (debounceTime flushes the pending value on complete).
 */
export const debounceWindows = (events: MarbleEvent[], t: number): Span[] => {
  const nexts = events.filter((e) => e.kind === 'next');
  const completeAt = events.find((e) => e.kind === 'complete')?.frame;
  return nexts.map((ev, i): Span => {
    const end = completeAt === undefined ? ev.frame + t : Math.min(ev.frame + t, completeAt);
    const following = nexts[i + 1];
    if (following !== undefined && following.frame <= end) {
      return { from: ev.frame, to: following.frame, kind: 'cancelled' };
    }
    return { from: ev.frame, to: end, kind: 'window' };
  });
};

/**
 * Windows of auditTime: a value opens a window of `t` frames if none is open;
 * values arriving while it is open (its last frame included) are folded in as
 * `inputs`, and the window emits the latest of them when it ends. Windows are
 * never cut short, not even by source completion.
 */
export const auditWindows = (events: MarbleEvent[], t: number): Span[] => {
  const spans: Span[] = [];
  for (const ev of events) {
    if (ev.kind !== 'next') continue;
    const open = spans[spans.length - 1];
    if (open !== undefined && ev.frame <= open.to) {
      open.inputs = [...(open.inputs ?? []), ev.frame];
    } else {
      spans.push({ from: ev.frame, to: ev.frame + t, kind: 'window', inputs: [] });
    }
  }
  return spans;
};

const windowsFor = (kind: WindowKind): ((events: MarbleEvent[], t: number) => Span[]) =>
  kind === 'audit' ? auditWindows : debounceWindows;

interface Capture {
  actual: MarbleEvent[];
  expected: MarbleEvent[];
}

/** A TestScheduler whose assert callback records instead of asserting. */
function capturingScheduler(): { scheduler: TestScheduler; capture: Capture } {
  const capture: Capture = { actual: [], expected: [] };
  const scheduler = new TestScheduler((actual: unknown, expected: unknown) => {
    // Subscription assertions arrive here too; those are read from the observables directly.
    if (isMessages(actual) && isMessages(expected)) {
      capture.actual = toEvents(actual);
      capture.expected = toEvents(expected);
    }
  });
  return { scheduler, capture };
}

const frameCount = (spec: MarbleSpec, eventLists: MarbleEvent[][]): number => {
  const lastFrame = Math.max(-1, ...eventLists.flat().map((e) => e.frame));
  return Math.max(marbleFrames(spec.source), marbleFrames(spec.expected), lastFrame + 1);
};

const subscriptionSpans = (logs: RecordedSubscription[], frames: number): Span[] =>
  logs.map((log) => ({
    from: log.subscribedFrame,
    to: Number.isFinite(log.unsubscribedFrame) ? log.unsubscribedFrame : frames - 1,
    kind: 'subscription',
  }));

const sourceLane = (spec: MarbleSpec, events: MarbleEvent[], logs: RecordedSubscription[], frames: number): SpecLane => ({
  label: 'e1',
  detail: `hot('${spec.source.trim()}')${describeValues(spec.sourceValues)}`,
  marbles: spec.source,
  events,
  expected: [],
  spans: subscriptionSpans(logs, frames),
  reveal: 'always',
});

const outputLane = (spec: MarbleSpec, capture: Capture): SpecLane => ({
  label: 'expected vs actual',
  detail: `'${spec.expected.trim()}'${describeValues(spec.expectedValues)}`,
  marbles: spec.expected,
  events: capture.actual,
  expected: capture.expected,
  spans: [],
  reveal: 'playhead',
});

/**
 * Runs the spec verbatim inside `TestScheduler.run()` with a capturing assert
 * callback instead of a test framework, and turns what the scheduler recorded
 * into lanes. Must happen inside `run()`: outside it the static parser uses a
 * frame factor of 10, so frames would come out as 10, 40, 50 ...
 */
export function runMarbleSpec(spec: MarbleSpec): SpecState {
  return spec.kind === 'time' ? runTimeSpec(spec) : runHigherOrderSpec(spec);
}

function runTimeSpec(spec: TimeSpec): SpecState {
  const { scheduler, capture } = capturingScheduler();
  const seen: { source?: MarbleEvent[]; sourceLogs?: RecordedSubscription[]; t?: number } = {};

  scheduler.run(({ hot, time, expectObservable, expectSubscriptions }) => {
    const e1 = hot(spec.source, spec.sourceValues);
    const t = time(spec.duration);
    seen.source = toEvents(e1.messages);
    seen.sourceLogs = e1.subscriptions;
    seen.t = t;
    expectObservable(e1.pipe(spec.operator(t))).toBe(spec.expected, spec.expectedValues);
    expectSubscriptions(e1.subscriptions).toBe(spec.subscriptions);
  });

  const source = seen.source ?? [];
  const t = seen.t ?? 0;
  const frames = frameCount(spec, [source, capture.actual, capture.expected]);

  return {
    title: spec.title,
    frames,
    playhead: -1,
    lanes: [
      sourceLane(spec, source, seen.sourceLogs ?? [], frames),
      {
        label: spec.operatorLabel,
        detail: `t = time('${spec.duration.trim()}') = ${t} frames`,
        marbles: '',
        events: [],
        expected: [],
        spans: windowsFor(spec.windows)(source, t),
        reveal: 'playhead',
      },
      outputLane(spec, capture),
    ],
  };
}

function runHigherOrderSpec(spec: HigherOrderSpec): SpecState {
  const { scheduler, capture } = capturingScheduler();
  const seen: { source?: MarbleEvent[]; sourceLogs?: RecordedSubscription[]; innerLogs?: RecordedSubscription[] } = {};
  // One entry per call of the spec's project function, in subscription order.
  const innerRuns: { outerValue: string; events: MarbleEvent[] }[] = [];

  scheduler.run(({ hot, cold, expectObservable, expectSubscriptions }) => {
    const e1 = hot(spec.source, spec.sourceValues);
    const inner = cold(spec.inner.marbles, spec.inner.values);
    seen.source = toEvents(e1.messages);
    seen.sourceLogs = e1.subscriptions;
    seen.innerLogs = inner.subscriptions;

    // Wrap the spec's project function so each projected inner records what it
    // emitted and when, stamped with the scheduler's own virtual clock.
    const tracked = (value: unknown): Observable<unknown> => {
      const run: { outerValue: string; events: MarbleEvent[] } = { outerValue: String(value), events: [] };
      innerRuns.push(run);
      return spec.project(value, inner).pipe(
        tap({
          next: (emitted) => run.events.push({ frame: scheduler.frame, kind: 'next', value: String(emitted) }),
          complete: () => run.events.push({ frame: scheduler.frame, kind: 'complete' }),
          error: () => run.events.push({ frame: scheduler.frame, kind: 'error' }),
        }),
      );
    };

    expectObservable(e1.pipe(spec.flatten(tracked))).toBe(spec.expected, spec.expectedValues);
    if (spec.inner.subscriptions) expectSubscriptions(inner.subscriptions).toBe(spec.inner.subscriptions);
    expectSubscriptions(e1.subscriptions).toBe(spec.subscriptions);
  });

  const source = seen.source ?? [];
  const innerLogs = seen.innerLogs ?? [];
  const frames = frameCount(spec, [source, capture.actual, capture.expected, ...innerRuns.map((run) => run.events)]);

  // One compact row per inner subscription: its lifetime from the scheduler's
  // subscription log, its values from the tap above. When every outer value
  // spawned exactly one inner (mergeMap, switchMap, concatMap), the j-th outer
  // value is the one that spawned the j-th inner; if it was subscribed later
  // than it arrived, the value waited in a queue and the row shows that.
  const outerValues = source.filter((e) => e.kind === 'next');
  const oneInnerPerValue = outerValues.length === innerLogs.length;
  const innerLanes = innerLogs.map((log, j): SpecLane => {
    const run = innerRuns[j];
    const outerFrame = oneInnerPerValue ? outerValues[j].frame : log.subscribedFrame;
    const queued = outerFrame < log.subscribedFrame;
    return {
      label: `inner ${j + 1}`,
      detail:
        run === undefined
          ? ''
          : `for ${run.outerValue}${queued ? ` · queued ${outerFrame}→${log.subscribedFrame}` : ''}`,
      marbles: spec.inner.marbles,
      marblesFrom: log.subscribedFrame,
      events: run?.events ?? [],
      expected: [],
      spans: [
        ...(queued ? [{ from: outerFrame, to: log.subscribedFrame, kind: 'queued' as const }] : []),
        ...subscriptionSpans([log], frames),
      ],
      reveal: 'playhead',
      height: 72,
      depth: 1,
      dropFrom: { lane: 0, frame: outerFrame },
      emitArrows: true,
    };
  });

  return {
    title: spec.title,
    frames,
    playhead: -1,
    lanes: [
      sourceLane(spec, source, seen.sourceLogs ?? [], frames),
      {
        label: spec.operatorLabel,
        detail: `inner = cold('${spec.inner.marbles.trim()}')${describeValues(spec.inner.values)}`,
        marbles: '',
        events: [],
        expected: [],
        spans: [],
        reveal: 'always',
        height: 56,
        noBaseline: true,
      },
      ...innerLanes,
      outputLane(spec, capture),
    ],
  };
}

// ==========================================
// 4. VIEW (frame ruler, lanes, playhead)
// ==========================================

export interface SpecRenderConfig extends RenderConfig {
  /** Height of the frame ruler above the first lane. Keep equal to startYOffset. */
  rulerHeight: number;
  /** Wall-clock duration of one frame during playback; drives the playhead transition. */
  frameMs: number;
}

export const DEFAULT_SPEC_RENDER_CONFIG: SpecRenderConfig = {
  ...DEFAULT_RENDER_CONFIG,
  stepMs: 1, // one step is one frame
  timeScale: 30, // px per frame
  nodeSize: 26, // fits inside a 30 px frame, so adjacent frames never overlap
  laneHeight: 110,
  startYOffset: 38,
  rulerHeight: 38,
  laneWidth: 0, // derived from the spec's frame count at setup
  frameMs: 400,
};

const ARROW_SIZE = 18;

/** Vertical layout of one lane in page coordinates. */
interface LaneGeometry {
  top: number;
  height: number;
  /** Y of the raw marble string. */
  strip: number;
  label: number;
  detail: number;
  /** Y of the lane's baseline; marbles are centered on it. */
  base: number;
  /** Y of the subscription bar. */
  subbar: number;
  /** X of the label column, indented by depth. */
  indent: number;
}

const FULL_OFFSETS = { strip: 8, label: 30, detail: 52, base: 76, subbar: 96 };
const COMPACT_OFFSETS = { strip: 2, label: 16, detail: 34, base: 40, subbar: 54 };

function laneGeometry(state: SpecState, config: SpecRenderConfig): LaneGeometry[] {
  let y = config.rulerHeight;
  return state.lanes.map((lane): LaneGeometry => {
    const height = lane.height ?? config.laneHeight;
    const o = height < 90 ? COMPACT_OFFSETS : FULL_OFFSETS;
    const geometry: LaneGeometry = {
      top: y,
      height,
      strip: y + o.strip,
      label: y + o.label,
      detail: y + o.detail,
      base: y + o.base,
      subbar: y + o.subbar,
      indent: 20 + (lane.depth ?? 0) * 16,
    };
    y += height;
    return geometry;
  });
}

const bodyBottomOf = (geometry: LaneGeometry[], config: SpecRenderConfig): number => {
  const last = geometry[geometry.length - 1];
  return last === undefined ? config.rulerHeight : last.top + last.height;
};

// Created once; ruler, bands and lanes are drawn from the state seen first.
let container: HTMLDivElement | null = null;

const frameLeft = (frame: number, config: RenderConfig): number => timeX(frame, config);
const frameCenter = (frame: number, config: RenderConfig): number => timeX(frame, config) + config.timeScale / 2;
/** A marble is centered inside its one-frame cell. */
const marbleLeft = (frame: number, config: RenderConfig): number =>
  timeX(frame, config) + (config.timeScale - config.nodeSize) / 2;

interface Box {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

function place(element: HTMLElement, box: Box): void {
  if (box.left !== undefined) element.style.left = `${box.left}px`;
  if (box.top !== undefined) element.style.top = `${box.top}px`;
  if (box.width !== undefined) element.style.width = `${box.width}px`;
  if (box.height !== undefined) element.style.height = `${box.height}px`;
}

function add(root: HTMLElement, className: string, box: Box, text?: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  place(element, box);
  root.appendChild(element);
  return element;
}

function upsert(root: HTMLElement, id: string, className: string, html?: string): HTMLElement {
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement('div');
    element.id = id;
    element.className = className;
    if (html !== undefined) element.innerHTML = html;
    root.appendChild(element);
  }
  return element;
}

const withLaneWidth = (state: SpecState, config: SpecRenderConfig): SpecRenderConfig => ({
  ...config,
  laneWidth: state.frames * config.timeScale,
});

function ensureSpecContainer(state: SpecState, config: SpecRenderConfig, geometry: LaneGeometry[]): HTMLDivElement {
  if (container) return container;

  const root = document.createElement('div');
  root.className = 'rx-visualizer rx-spec';
  root.style.setProperty('--rx-step', `${config.frameMs}ms`);

  const bodyTop = config.rulerHeight;
  const bodyBottom = bodyBottomOf(geometry, config);
  const right = config.startXOffset + config.laneWidth;

  drawTimeBands(root, config, { top: bodyTop, height: bodyBottom - bodyTop });

  // Ruler: frame numbers at each frame's left edge, every 5th brighter.
  add(root, 'rx-ruler-unit', { left: 20, top: 12 }, 'frame · ms');
  for (let f = 0; f <= state.frames; f++) {
    add(root, 'rx-ruler-tick', { left: frameLeft(f, config), top: config.rulerHeight - 8, height: 8 });
    if (f < state.frames) {
      add(root, `rx-ruler-num${f % 5 === 0 ? ' is-major' : ''}`, { left: frameLeft(f, config) + 4, top: 12 }, String(f));
    }
  }

  // Lanes: separator, title, detail, baseline and the raw marble string.
  state.lanes.forEach((lane, k) => {
    const g = geometry[k];
    add(root, 'rx-rowline', { left: 0, top: g.top, width: right });
    add(root, 'rx-lane-title', { left: g.indent, top: g.label }, lane.label);
    add(root, 'rx-lane-detail', { left: g.indent, top: g.detail }, lane.detail);
    if (!lane.noBaseline) {
      add(root, 'rx-lane-line', { left: config.startXOffset, top: g.base - 1, width: config.laneWidth });
    }

    let frame = lane.marblesFrom ?? 0;
    for (const ch of lane.marbles) {
      if (/\s/.test(ch)) continue;
      add(root, 'rx-charstrip', { left: frameLeft(frame, config), top: g.strip, width: config.timeScale }, ch);
      frame++;
    }
  });
  add(root, 'rx-rowline', { left: 0, top: bodyBottom, width: right });

  (document.getElementById('app') ?? document.body).appendChild(root);
  container = root;
  return root;
}

function renderMarble(
  root: HTMLElement,
  id: string,
  event: MarbleEvent,
  g: LaneGeometry,
  config: SpecRenderConfig,
  variant: 'is-settled' | 'is-expected',
  visible: boolean,
): void {
  if (event.kind === 'next') {
    const element = upsert(root, id, `rx-node ${variant}`);
    element.textContent = event.value ?? '';
    place(element, {
      left: marbleLeft(event.frame, config),
      top: g.base - config.nodeSize / 2,
      width: config.nodeSize,
      height: config.nodeSize,
    });
    element.hidden = !visible;
  } else if (event.kind === 'complete') {
    const element = upsert(root, id, `rx-complete ${variant}`);
    place(element, { left: frameCenter(event.frame, config) - 1.5, top: g.base - 18, height: 36 });
    element.hidden = !visible;
  } else {
    const element = upsert(root, id, `rx-error ${variant}`, '×');
    place(element, { left: frameCenter(event.frame, config) - 6, top: g.base - 10 });
    element.hidden = !visible;
  }
}

function renderSpan(
  root: HTMLElement,
  id: string,
  span: Span,
  laneIndex: number,
  geometry: LaneGeometry[],
  state: SpecState,
  config: SpecRenderConfig,
): void {
  const g = geometry[laneIndex];
  const x0 = frameCenter(span.from, config);
  const x1 = frameCenter(span.to, config);

  if (span.kind === 'subscription') {
    place(upsert(root, `${id}-bar`, 'rx-subbar'), { left: x0, top: g.subbar, width: x1 - x0 });
    place(upsert(root, `${id}-from`, 'rx-subglyph', '^'), { left: x0 - 4, top: g.subbar + 4 });
    place(upsert(root, `${id}-to`, 'rx-subglyph', '!'), { left: x1 - 3, top: g.subbar + 4 });
    return;
  }

  const started = span.from <= state.playhead;
  const ended = span.to <= state.playhead;
  // The bar grows one frame per tick until it reaches its end.
  const visibleTo = Math.min(span.to, Math.max(span.from, state.playhead));

  if (span.kind === 'queued') {
    // A value waiting for its turn: a dotted stretch on the baseline from the
    // frame it arrived to the frame its inner was subscribed.
    const wait = upsert(root, `${id}-bar`, 'rx-window is-queued');
    place(wait, { left: x0, top: g.base - 1, width: frameCenter(visibleTo, config) - x0 });
    wait.hidden = !started;
    return;
  }

  const above = geometry[laneIndex - 1];
  if (above !== undefined) {
    // Drop lines from the lane above: the value that opened the window, then
    // every value folded into it while it was open.
    const dropTop = above.base + config.nodeSize / 2;
    const drop = upsert(root, `${id}-drop`, 'rx-drop');
    place(drop, { left: x0, top: dropTop, height: g.base - dropTop });
    drop.hidden = !started;
    (span.inputs ?? []).forEach((frame, j) => {
      const input = upsert(root, `${id}-in${j}`, 'rx-drop');
      place(input, { left: frameCenter(frame, config), top: dropTop, height: g.base - dropTop });
      input.hidden = frame > state.playhead;
    });
  }

  const bar = upsert(root, `${id}-bar`, `rx-window${span.kind === 'cancelled' ? ' is-cancelled' : ''}`);
  place(bar, { left: x0, top: g.base - 2, width: frameCenter(visibleTo, config) - x0 });
  bar.hidden = !started;

  if (span.kind === 'window') {
    const arrow = upsert(root, `${id}-arrow`, 'rx-arrow is-small', ARROW_SVG);
    place(arrow, { left: x1 - ARROW_SIZE / 2, top: g.base + 8 });
    arrow.hidden = !ended;
  } else {
    const cross = upsert(root, `${id}-cross`, 'rx-cross', '×');
    place(cross, { left: x1 - 5, top: g.base - 10 });
    cross.hidden = !ended;
  }
}

function renderLane(
  root: HTMLElement,
  state: SpecState,
  lane: SpecLane,
  k: number,
  geometry: LaneGeometry[],
  config: SpecRenderConfig,
): void {
  const g = geometry[k];
  const reached = (frame: number): boolean => frame <= state.playhead;
  const shown = (frame: number): boolean => lane.reveal === 'always' || reached(frame);

  // Rings first so fills paint over them when expected and actual agree.
  lane.expected.forEach((event, i) => renderMarble(root, `rx-spec-l${k}-x${i}`, event, g, config, 'is-expected', true));
  lane.events.forEach((event, i) => renderMarble(root, `rx-spec-l${k}-e${i}`, event, g, config, 'is-settled', shown(event.frame)));
  lane.spans.forEach((span, i) => renderSpan(root, `rx-spec-l${k}-s${i}`, span, k, geometry, state, config));

  if (lane.dropFrom) {
    const from = geometry[lane.dropFrom.lane];
    const dropTop = from.base + config.nodeSize / 2;
    const drop = upsert(root, `rx-spec-l${k}-spawn`, 'rx-drop');
    place(drop, { left: frameCenter(lane.dropFrom.frame, config), top: dropTop, height: g.base - dropTop });
    drop.hidden = !reached(lane.dropFrom.frame);
  }

  if (lane.emitArrows) {
    lane.events.forEach((event, i) => {
      if (event.kind !== 'next') return;
      const arrow = upsert(root, `rx-spec-l${k}-a${i}`, 'rx-arrow is-small', ARROW_SVG);
      place(arrow, { left: frameCenter(event.frame, config) - ARROW_SIZE / 2, top: g.base + config.nodeSize / 2 + 1 });
      arrow.hidden = !reached(event.frame);
    });
  }
}

function renderPlayhead(root: HTMLElement, state: SpecState, geometry: LaneGeometry[], config: SpecRenderConfig): void {
  // The playhead sits at the right edge of the frame it has reached, so the
  // transition slides it across a frame while that frame's events appear.
  const x = frameLeft(state.playhead + 1, config);
  const bodyTop = config.rulerHeight;
  const bodyBottom = bodyBottomOf(geometry, config);
  const right = config.startXOffset + config.laneWidth;

  place(upsert(root, 'rx-spec-future', 'rx-future'), {
    left: x,
    top: bodyTop,
    width: Math.max(0, right - x),
    height: bodyBottom - bodyTop,
  });
  place(upsert(root, 'rx-spec-playhead', 'rx-playhead'), { left: x - 1, top: bodyTop - 8, height: bodyBottom - bodyTop + 8 });
  // The label names what the playhead is: the TestScheduler's virtual clock.
  const label = upsert(root, 'rx-spec-playhead-label', 'rx-playhead-label');
  label.textContent = state.playhead < 0 ? 'Scheduler · start' : `Scheduler · frame ${state.playhead}`;
  place(label, { left: x, top: bodyBottom + 6 });
}

export function renderSpecToDOM(state: SpecState, config: SpecRenderConfig = DEFAULT_SPEC_RENDER_CONFIG): void {
  const sized = withLaneWidth(state, config);
  const geometry = laneGeometry(state, sized);
  const root = ensureSpecContainer(state, sized, geometry);
  state.lanes.forEach((lane, k) => renderLane(root, state, lane, k, geometry, sized));
  renderPlayhead(root, state, geometry, sized);
}
