import type { OperatorFunction } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import { ARROW_SVG, DEFAULT_RENDER_CONFIG, drawTimeBands, laneY, timeX, type RenderConfig } from './visualizer.ts';

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

export type SpanKind = 'subscription' | 'window' | 'cancelled';

export interface Span {
  from: number;
  to: number;
  kind: SpanKind;
}

export interface SpecLane {
  label: string;
  detail: string;
  /** Raw marble string, drawn one character per frame above the lane ('' for none). */
  marbles: string;
  /** Solid marbles: source values, or the scheduler's actual output. */
  events: MarbleEvent[];
  /** Ring marbles: what the spec expects. Output lane only. */
  expected: MarbleEvent[];
  spans: Span[];
  /** 'always': inputs, known up front. 'playhead': outputs, shown when the playhead reaches them. */
  reveal: 'always' | 'playhead';
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

/** A marble test in the shape rxjs writes them: one hot source, one duration, one operator. */
export interface MarbleSpec {
  title: string;
  /** Marbles for `hot(...)`. Leading spaces are fine: run mode ignores whitespace. */
  source: string;
  /** Marbles for `expectSubscriptions(...).toBe(...)`. */
  subscriptions: string;
  /** Marbles for `time(...)`; the frame count up to `|` becomes `t`. */
  duration: string;
  /** Marbles for `expectObservable(...).toBe(...)`. */
  expected: string;
  operatorLabel: string;
  operator: (t: number) => OperatorFunction<string, string>;
}

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

const isSubscriptions = (x: unknown): x is RecordedSubscription[] =>
  Array.isArray(x) && x.every((s: unknown) => isRecord(s) && 'subscribedFrame' in s);

const toEvents = (messages: RecordedMessage[]): MarbleEvent[] =>
  messages.map(({ frame, notification }): MarbleEvent => {
    if (notification.kind === 'N') return { frame, kind: 'next', value: String(notification.value) };
    if (notification.kind === 'C') return { frame, kind: 'complete' };
    return { frame, kind: 'error' };
  });

/** Frames a run-mode marble string covers: one per character, whitespace ignored. */
export const marbleFrames = (marbles: string): number => marbles.replace(/\s/g, '').length;

/**
 * Windows of a debounceTime-style operator: each value opens a window of `t`
 * frames. A newer value inside the window cancels it; source completion closes
 * it early (debounceTime flushes the pending value on complete).
 */
export const debounceWindows = (events: MarbleEvent[], t: number): Span[] => {
  const nexts = events.filter((e) => e.kind === 'next');
  const completeAt = events.find((e) => e.kind === 'complete')?.frame;
  return nexts.map((ev, i): Span => {
    const end = completeAt === undefined ? ev.frame + t : Math.min(ev.frame + t, completeAt);
    const following = nexts[i + 1];
    if (following !== undefined && following.frame < end) {
      return { from: ev.frame, to: following.frame, kind: 'cancelled' };
    }
    return { from: ev.frame, to: end, kind: 'window' };
  });
};

/**
 * Runs the spec verbatim inside `TestScheduler.run()` with a capturing assert
 * callback instead of a test framework, and turns what the scheduler recorded
 * into lanes. Must happen inside `run()`: outside it the static parser uses a
 * frame factor of 10, so frames would come out as 10, 40, 50 ...
 */
export function runMarbleSpec(spec: MarbleSpec): SpecState {
  let actual: MarbleEvent[] = [];
  let expected: MarbleEvent[] = [];
  let source: MarbleEvent[] = [];
  const subscriptionSpans: Span[] = [];
  let t = 0;

  const scheduler = new TestScheduler((recordedActual: unknown, recordedExpected: unknown) => {
    if (isMessages(recordedActual) && isMessages(recordedExpected)) {
      actual = toEvents(recordedActual);
      expected = toEvents(recordedExpected);
    } else if (isSubscriptions(recordedActual)) {
      recordedActual.forEach((log) =>
        subscriptionSpans.push({ from: log.subscribedFrame, to: log.unsubscribedFrame, kind: 'subscription' }),
      );
    }
  });

  scheduler.run(({ hot, time, expectObservable, expectSubscriptions }) => {
    const e1 = hot(spec.source);
    t = time(spec.duration);
    source = toEvents(e1.messages);
    expectObservable(e1.pipe(spec.operator(t))).toBe(spec.expected);
    expectSubscriptions(e1.subscriptions).toBe(spec.subscriptions);
  });

  const lastFrame = Math.max(-1, ...[...source, ...actual, ...expected].map((e) => e.frame));
  const frames = Math.max(marbleFrames(spec.source), marbleFrames(spec.expected), lastFrame + 1);

  return {
    title: spec.title,
    frames,
    playhead: -1,
    lanes: [
      {
        label: 'e1',
        detail: `hot('${spec.source.trim()}')`,
        marbles: spec.source,
        events: source,
        expected: [],
        spans: subscriptionSpans,
        reveal: 'always',
      },
      {
        label: spec.operatorLabel,
        detail: `t = time('${spec.duration.trim()}') = ${t} frames`,
        marbles: '',
        events: [],
        expected: [],
        spans: debounceWindows(source, t),
        reveal: 'playhead',
      },
      {
        label: 'expected vs actual',
        detail: `'${spec.expected.trim()}'`,
        marbles: spec.expected,
        events: actual,
        expected,
        spans: [],
        reveal: 'playhead',
      },
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

// Vertical layout inside one lane, measured from the lane's top edge.
const CHARSTRIP_Y = 8;
const LABEL_Y = 30;
const DETAIL_Y = 52;
const BASELINE_Y = 76;
const SUBBAR_Y = 96;
const ARROW_SIZE = 18;

// Created once; ruler, bands and lanes are drawn from the state seen first.
let container: HTMLDivElement | null = null;

const frameLeft = (frame: number, config: RenderConfig): number => timeX(frame, config);
const frameCenter = (frame: number, config: RenderConfig): number => timeX(frame, config) + config.timeScale / 2;
/** A marble is centered inside its one-frame cell. */
const marbleLeft = (frame: number, config: RenderConfig): number =>
  timeX(frame, config) + (config.timeScale - config.nodeSize) / 2;
const baselineY = (lane: number, config: RenderConfig): number => laneY(lane, config) + BASELINE_Y;

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

function ensureSpecContainer(state: SpecState, config: SpecRenderConfig): HTMLDivElement {
  if (container) return container;

  const root = document.createElement('div');
  root.className = 'rx-visualizer rx-spec';
  root.style.setProperty('--rx-step', `${config.frameMs}ms`);

  const bodyTop = config.rulerHeight;
  const bodyHeight = state.lanes.length * config.laneHeight;
  const right = config.startXOffset + config.laneWidth;

  drawTimeBands(root, config, { top: bodyTop, height: bodyHeight });

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
    const top = laneY(k, config);
    add(root, 'rx-rowline', { left: 0, top, width: right });
    add(root, 'rx-lane-title', { top: top + LABEL_Y }, lane.label);
    add(root, 'rx-lane-detail', { left: 20, top: top + DETAIL_Y }, lane.detail);
    add(root, 'rx-lane-line', { left: config.startXOffset, top: baselineY(k, config) - 1, width: config.laneWidth });

    let frame = 0;
    for (const ch of lane.marbles) {
      if (/\s/.test(ch)) continue;
      add(root, 'rx-charstrip', { left: frameLeft(frame, config), top: top + CHARSTRIP_Y, width: config.timeScale }, ch);
      frame++;
    }
  });
  add(root, 'rx-rowline', { left: 0, top: bodyTop + bodyHeight, width: right });

  (document.getElementById('app') ?? document.body).appendChild(root);
  container = root;
  return root;
}

function renderMarble(
  root: HTMLElement,
  id: string,
  event: MarbleEvent,
  lane: number,
  config: SpecRenderConfig,
  variant: 'is-settled' | 'is-expected',
  visible: boolean,
): void {
  const base = baselineY(lane, config);
  if (event.kind === 'next') {
    const element = upsert(root, id, `rx-node ${variant}`);
    element.textContent = event.value ?? '';
    place(element, {
      left: marbleLeft(event.frame, config),
      top: base - config.nodeSize / 2,
      width: config.nodeSize,
      height: config.nodeSize,
    });
    element.hidden = !visible;
  } else if (event.kind === 'complete') {
    const element = upsert(root, id, `rx-complete ${variant}`);
    place(element, { left: frameCenter(event.frame, config) - 1.5, top: base - 18, height: 36 });
    element.hidden = !visible;
  } else {
    const element = upsert(root, id, `rx-error ${variant}`, '×');
    place(element, { left: frameCenter(event.frame, config) - 6, top: base - 10 });
    element.hidden = !visible;
  }
}

function renderSpan(root: HTMLElement, id: string, span: Span, lane: number, state: SpecState, config: SpecRenderConfig): void {
  const top = laneY(lane, config);
  const base = baselineY(lane, config);
  const x0 = frameCenter(span.from, config);
  const x1 = frameCenter(span.to, config);

  if (span.kind === 'subscription') {
    place(upsert(root, `${id}-bar`, 'rx-subbar'), { left: x0, top: top + SUBBAR_Y, width: x1 - x0 });
    place(upsert(root, `${id}-from`, 'rx-subglyph', '^'), { left: x0 - 4, top: top + SUBBAR_Y + 4 });
    place(upsert(root, `${id}-to`, 'rx-subglyph', '!'), { left: x1 - 3, top: top + SUBBAR_Y + 4 });
    return;
  }

  const started = span.from <= state.playhead;
  const ended = span.to <= state.playhead;
  // The bar grows one frame per tick until it reaches its end.
  const visibleTo = Math.min(span.to, Math.max(span.from, state.playhead));

  if (lane > 0) {
    const dropTop = baselineY(lane - 1, config) + config.nodeSize / 2;
    const drop = upsert(root, `${id}-drop`, 'rx-drop');
    place(drop, { left: x0, top: dropTop, height: base - dropTop });
    drop.hidden = !started;
  }

  const bar = upsert(root, `${id}-bar`, `rx-window${span.kind === 'cancelled' ? ' is-cancelled' : ''}`);
  place(bar, { left: x0, top: base - 2, width: frameCenter(visibleTo, config) - x0 });
  bar.hidden = !started;

  if (span.kind === 'window') {
    const arrow = upsert(root, `${id}-arrow`, 'rx-arrow is-small', ARROW_SVG);
    place(arrow, { left: x1 - ARROW_SIZE / 2, top: base + 8 });
    arrow.hidden = !ended;
  } else {
    const cross = upsert(root, `${id}-cross`, 'rx-cross', '×');
    place(cross, { left: x1 - 5, top: base - 10 });
    cross.hidden = !ended;
  }
}

function renderLane(root: HTMLElement, state: SpecState, lane: SpecLane, k: number, config: SpecRenderConfig): void {
  const shown = (frame: number): boolean => lane.reveal === 'always' || frame <= state.playhead;
  // Rings first so fills paint over them when expected and actual agree.
  lane.expected.forEach((event, i) => renderMarble(root, `rx-spec-l${k}-x${i}`, event, k, config, 'is-expected', true));
  lane.events.forEach((event, i) =>
    renderMarble(root, `rx-spec-l${k}-e${i}`, event, k, config, 'is-settled', shown(event.frame)),
  );
  lane.spans.forEach((span, i) => renderSpan(root, `rx-spec-l${k}-s${i}`, span, k, state, config));
}

function renderPlayhead(root: HTMLElement, state: SpecState, config: SpecRenderConfig): void {
  // The playhead sits at the right edge of the frame it has reached, so the
  // transition slides it across a frame while that frame's events appear.
  const x = frameLeft(state.playhead + 1, config);
  const bodyTop = config.rulerHeight;
  const bodyBottom = bodyTop + state.lanes.length * config.laneHeight;
  const right = config.startXOffset + config.laneWidth;

  place(upsert(root, 'rx-spec-future', 'rx-future'), { left: x, top: bodyTop, width: Math.max(0, right - x), height: bodyBottom - bodyTop });
  place(upsert(root, 'rx-spec-playhead', 'rx-playhead'), { left: x - 1, top: bodyTop - 8, height: bodyBottom - bodyTop + 8 });
  const label = upsert(root, 'rx-spec-playhead-label', 'rx-playhead-label');
  label.textContent = state.playhead < 0 ? 'start' : `frame ${state.playhead}`;
  place(label, { left: x - 34, top: bodyBottom + 6 });
}

export function renderSpecToDOM(state: SpecState, config: SpecRenderConfig = DEFAULT_SPEC_RENDER_CONFIG): void {
  const sized = withLaneWidth(state, config);
  const root = ensureSpecContainer(state, sized);
  state.lanes.forEach((lane, k) => renderLane(root, state, lane, k, sized));
  renderPlayhead(root, state, sized);
}
