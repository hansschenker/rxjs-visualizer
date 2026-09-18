import { tap, type MonoTypeOperatorFunction, type Observable, type OperatorFunction, type Subject } from 'rxjs';

// ==========================================
// 1. MODEL & MESSAGES (MVU State)
// ==========================================

/** One value observed on a dependent lane, in the order it was emitted. */
export interface Emission {
  laneIndex: number;
  value: unknown;
}

/**
 * Everything that happened because of one source emission.
 *
 * Dependent emissions are recorded synchronously while the source value
 * propagates, then revealed one at a time by REVEAL actions. The reveal
 * cursor is what drives the arrow animation and the value transformations.
 */
export interface Column {
  index: number;
  /** Milliseconds since the visualizer started; drives the X position. */
  time: number;
  sourceLane: number;
  sourceValue: unknown;
  emissions: Emission[];
  /** How many entries of `emissions` are shown with their real value. */
  revealed: number;
}

export interface VisualizerState {
  lanes: string[];
  columns: Column[];
  startTime: number;
}

export type Action =
  | { type: 'SOURCE_EMIT'; laneName: string; column: number; value: unknown; timestamp: number }
  | { type: 'EMIT'; laneName: string; value: unknown }
  | { type: 'REVEAL'; column: number };

export type SourceEmitAction = Extract<Action, { type: 'SOURCE_EMIT' }>;

export const isSourceEmit = (action: Action): action is SourceEmitAction => action.type === 'SOURCE_EMIT';

// ==========================================
// 2. UPDATE (State Transitions)
// ==========================================

export const update = (state: VisualizerState, action: Action): VisualizerState => {
  switch (action.type) {
    case 'SOURCE_EMIT': {
      const column: Column = {
        index: action.column,
        time: action.timestamp - state.startTime,
        sourceLane: state.lanes.indexOf(action.laneName),
        sourceValue: action.value,
        emissions: [],
        revealed: 0,
      };
      return { ...state, columns: [...state.columns, column] };
    }
    case 'EMIT': {
      // Dependent emissions are attributed to the most recent source emission.
      // This relies on propagation being synchronous (map, combineLatest, ...).
      const current = state.columns.at(-1);
      if (!current) return state;
      const emission: Emission = { laneIndex: state.lanes.indexOf(action.laneName), value: action.value };
      const updated: Column = { ...current, emissions: [...current.emissions, emission] };
      return { ...state, columns: [...state.columns.slice(0, -1), updated] };
    }
    case 'REVEAL':
      return {
        ...state,
        columns: state.columns.map((column) =>
          column.index === action.column && column.revealed < column.emissions.length
            ? { ...column, revealed: column.revealed + 1 }
            : column,
        ),
      };
    default:
      return state;
  }
};

/** True while `columnIndex` exists and still has emissions the arrow has not reached. */
export const hasPendingReveals = (state: VisualizerState, columnIndex: number): boolean => {
  const column = state.columns.find((c) => c.index === columnIndex);
  return column !== undefined && column.revealed < column.emissions.length;
};

// ==========================================
// 3. TRACKING OPERATORS
// ==========================================

/** Marks the lane whose emissions open a new column. Use once, on the source stream. */
export function trackSource<T>(laneName: string, dispatcher: Subject<Action>): MonoTypeOperatorFunction<T> {
  let column = 0;
  return tap((value: T) => {
    dispatcher.next({ type: 'SOURCE_EMIT', laneName, column: column++, value, timestamp: Date.now() });
  });
}

/** Wraps an operator so every value it produces is reported to `laneName`. */
export function visualizedMVU<T, R>(
  laneName: string,
  dispatcher: Subject<Action>,
  operator: OperatorFunction<T, R>,
): OperatorFunction<T, R> {
  return (source$: Observable<T>) =>
    source$.pipe(
      operator,
      tap((value: R) => {
        dispatcher.next({ type: 'EMIT', laneName, value });
      }),
    );
}

// ==========================================
// 4. VIEW (Animated DOM Renderer)
// ==========================================

export interface RenderConfig {
  /** Pixels per millisecond along the X axis. */
  timeScale: number;
  laneHeight: number;
  startXOffset: number;
  startYOffset: number;
  nodeSize: number;
  /** Extra X offset for a 2nd, 3rd, ... emission of the same lane inside one column. */
  siblingOffset: number;
  /** Duration of one arrow step. Must match the cadence of REVEAL actions. */
  stepMs: number;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  timeScale: 0.5,
  laneHeight: 120,
  startXOffset: 250,
  startYOffset: 50,
  nodeSize: 32,
  siblingOffset: 40,
  stepMs: 400,
};

const ARROW_SIZE = 24;
const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">' +
  '<path d="M12 2v17M5 12l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

// Created once; lanes are drawn from the state seen on the first render.
let container: HTMLDivElement | null = null;

const laneY = (laneIndex: number, config: RenderConfig): number => config.startYOffset + laneIndex * config.laneHeight;

const nodeId = (column: number, lane: number, sibling: number): string => `rx-node-c${column}-l${lane}-n${sibling}`;

function ensureContainer(state: VisualizerState, config: RenderConfig): HTMLDivElement {
  if (container) return container;

  const root = document.createElement('div');
  root.className = 'rx-visualizer';
  root.style.setProperty('--rx-step', `${config.stepMs}ms`);

  state.lanes.forEach((laneName, laneIndex) => {
    const yPos = laneY(laneIndex, config);

    const title = document.createElement('div');
    title.className = 'rx-lane-title';
    title.style.top = `${yPos - 10}px`;
    title.textContent = laneName;

    const line = document.createElement('div');
    line.className = 'rx-lane-line';
    line.style.left = `${config.startXOffset}px`;
    line.style.top = `${yPos + config.nodeSize / 2 - 1}px`;
    line.style.width = '3000px';

    root.append(title, line);
  });

  (document.getElementById('app') ?? document.body).appendChild(root);
  container = root;
  return root;
}

function upsertNode(root: HTMLElement, id: string, x: number, y: number, text: string, settled: boolean): void {
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement('div');
    element.id = id;
    element.className = 'rx-node';
    root.appendChild(element);
  }
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.textContent = text;
  element.classList.toggle('is-settled', settled);
  element.classList.toggle('is-pending', !settled);
}

function upsertArrow(
  root: HTMLElement,
  id: string,
  x: number,
  startY: number,
  targetY: number | null,
  done: boolean,
): void {
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement('div');
    element.id = id;
    element.className = 'rx-arrow';
    element.innerHTML = ARROW_SVG;
    element.style.left = `${x}px`;
    element.style.top = `${startY}px`;
    root.appendChild(element);
    // Flush styles so the very first move below runs as a transition.
    void element.offsetHeight;
  }
  if (targetY !== null) element.style.top = `${targetY}px`;
  element.classList.toggle('is-done', done);
}

function renderColumn(root: HTMLElement, state: VisualizerState, column: Column, config: RenderConfig): void {
  const x = config.startXOffset + column.time * config.timeScale;
  const sourceLabel = String(column.sourceValue);

  // A. The source value itself is settled the moment it appears.
  upsertNode(root, nodeId(column.index, column.sourceLane, 0), x, laneY(column.sourceLane, config), sourceLabel, true);

  // B. Revealed emissions show their real value. A lane that emitted more than
  //    once in this column (the diamond glitch) gets extra nodes shifted right.
  const revealedPerLane = new Map<number, number>();
  column.emissions.slice(0, column.revealed).forEach((emission) => {
    const sibling = revealedPerLane.get(emission.laneIndex) ?? 0;
    revealedPerLane.set(emission.laneIndex, sibling + 1);
    upsertNode(
      root,
      nodeId(column.index, emission.laneIndex, sibling),
      x + sibling * config.siblingOffset,
      laneY(emission.laneIndex, config),
      String(emission.value),
      true,
    );
  });

  // C. Every other dependent lane shows a pending placeholder carrying the
  //    untransformed source value until the arrow reaches it.
  state.lanes.forEach((_, laneIndex) => {
    if (laneIndex === column.sourceLane || revealedPerLane.has(laneIndex)) return;
    upsertNode(root, nodeId(column.index, laneIndex, 0), x, laneY(laneIndex, config), sourceLabel, false);
  });

  // D. The arrow heads for the lane of the next emission to reveal and fades
  //    out once the column is fully revealed.
  const next = column.emissions[column.revealed];
  const targetLane = next ? next.laneIndex : column.emissions.at(-1)?.laneIndex;
  const done = column.emissions.length > 0 && column.revealed >= column.emissions.length;
  upsertArrow(
    root,
    `rx-arrow-c${column.index}`,
    x + config.nodeSize / 2 - ARROW_SIZE / 2,
    laneY(column.sourceLane, config) + config.nodeSize,
    targetLane === undefined ? null : laneY(targetLane, config) - ARROW_SIZE - 4,
    done,
  );
}

export function renderVisualizerToDOM(state: VisualizerState, config: RenderConfig = DEFAULT_RENDER_CONFIG): void {
  const root = ensureContainer(state, config);
  state.columns.forEach((column) => renderColumn(root, state, column, config));
}
