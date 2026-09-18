import { describe, expect, it } from 'vitest';
import { Subject, map, of } from 'rxjs';
import {
  DEFAULT_RENDER_CONFIG,
  hasPendingReveals,
  pxPerStep,
  timeX,
  trackSource,
  update,
  visualizedMVU,
  type Action,
  type VisualizerState,
} from './visualizer.ts';

const lanes = ['source', 'left', 'right', 'sink'];
const initial: VisualizerState = { lanes, columns: [], startTime: 1000 };

const sourceEmit = (column: number, value: unknown, timestamp: number): Action => ({
  type: 'SOURCE_EMIT',
  laneName: 'source',
  column,
  value,
  timestamp,
});
const emit = (laneName: string, value: unknown): Action => ({ type: 'EMIT', laneName, value });
const reveal = (column: number): Action => ({ type: 'REVEAL', column });
const run = (actions: Action[], from: VisualizerState = initial): VisualizerState => actions.reduce(update, from);

describe('update', () => {
  it('SOURCE_EMIT opens a column at the elapsed time with no emissions', () => {
    const state = run([sourceEmit(0, 1, 1400)]);
    expect(state.columns).toEqual([
      { index: 0, time: 400, sourceLane: 0, sourceValue: 1, emissions: [], revealed: 0 },
    ]);
  });

  it('EMIT appends to the latest column and resolves the lane index', () => {
    const state = run([
      sourceEmit(0, 1, 1400),
      emit('left', 2),
      sourceEmit(1, 2, 1800),
      emit('left', 4),
      emit('sink', 14),
    ]);
    expect(state.columns[0].emissions).toEqual([{ laneIndex: 1, value: 2 }]);
    expect(state.columns[1].emissions).toEqual([
      { laneIndex: 1, value: 4 },
      { laneIndex: 3, value: 14 },
    ]);
  });

  it('EMIT before any SOURCE_EMIT is ignored', () => {
    expect(run([emit('left', 2)])).toBe(initial);
  });

  it('REVEAL advances one emission at a time and stops at the end', () => {
    const base = run([sourceEmit(0, 1, 1400), emit('left', 2), emit('right', 10)]);
    expect(update(base, reveal(0)).columns[0].revealed).toBe(1);
    expect(run([reveal(0), reveal(0), reveal(0)], base).columns[0].revealed).toBe(2);
  });

  it('REVEAL for an unknown column leaves the state untouched', () => {
    const base = run([sourceEmit(0, 1, 1400), emit('left', 2)]);
    expect(update(base, reveal(7))).toEqual(base);
  });

  it('does not mutate the previous state', () => {
    const base = run([sourceEmit(0, 1, 1400)]);
    const next = update(base, emit('left', 2));
    expect(base.columns[0].emissions).toEqual([]);
    expect(next).not.toBe(base);
  });
});

describe('hasPendingReveals', () => {
  it('is true only while a known column still has unrevealed emissions', () => {
    const base = run([sourceEmit(0, 1, 1400), emit('left', 2)]);
    expect(hasPendingReveals(base, 0)).toBe(true);
    expect(hasPendingReveals(update(base, reveal(0)), 0)).toBe(false);
    expect(hasPendingReveals(base, 1)).toBe(false);
  });
});

describe('time axis', () => {
  const config = { ...DEFAULT_RENDER_CONFIG, startXOffset: 250, stepMs: 800, timeScale: 200 / 800 };

  it('one band is one step wide', () => {
    expect(pxPerStep(config)).toBe(200);
  });

  it('maps time linearly from the left edge of the timeline (page coordinates)', () => {
    // Band k spans [250 + 200k, 250 + 200(k + 1)); a tick event starts at its left edge.
    expect(timeX(0, config)).toBe(250);
    expect(timeX(800, config)).toBe(450);
    expect(timeX(1600, config)).toBe(650);
  });
});

describe('tracking operators', () => {
  it('trackSource numbers columns per emission and stamps a timestamp', () => {
    const dispatcher = new Subject<Action>();
    const actions: Action[] = [];
    dispatcher.subscribe((action) => actions.push(action));

    of(1, 2).pipe(trackSource('source', dispatcher)).subscribe();

    expect(actions).toHaveLength(2);
    actions.forEach((action, i) => {
      expect(action.type).toBe('SOURCE_EMIT');
      if (action.type !== 'SOURCE_EMIT') return;
      expect(action.column).toBe(i);
      expect(action.value).toBe(i + 1);
      expect(typeof action.timestamp).toBe('number');
    });
  });

  it('visualizedMVU applies the wrapped operator and reports its results', () => {
    const dispatcher = new Subject<Action>();
    const actions: Action[] = [];
    dispatcher.subscribe((action) => actions.push(action));
    const results: number[] = [];

    of(1, 2)
      .pipe(visualizedMVU('left', dispatcher, map((x: number) => x * 2)))
      .subscribe((value) => results.push(value));

    expect(results).toEqual([2, 4]);
    expect(actions).toEqual([
      { type: 'EMIT', laneName: 'left', value: 2 },
      { type: 'EMIT', laneName: 'left', value: 4 },
    ]);
  });
});
