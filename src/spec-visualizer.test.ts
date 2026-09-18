import { describe, expect, it } from 'vitest';
import {
  debounceWindows,
  hasFramesLeft,
  marbleFrames,
  runMarbleSpec,
  updateSpec,
  type MarbleEvent,
  type SpecState,
} from './spec-visualizer.ts';
import { debounceTimeSpec } from './specs.ts';

const next = (frame: number, value: string): MarbleEvent => ({ frame, kind: 'next', value });
const complete = (frame: number): MarbleEvent => ({ frame, kind: 'complete' });

describe('runMarbleSpec (through the real TestScheduler)', () => {
  const state = runMarbleSpec(debounceTimeSpec);
  const [source, operator, output] = state.lanes;

  it('covers every character of the longest marble string', () => {
    expect(state.frames).toBe(13);
    expect(state.playhead).toBe(-1);
  });

  it('records the hot source at one frame per character', () => {
    expect(source.events).toEqual([next(1, 'a'), next(4, 'b'), next(5, 'c'), next(8, 'd'), complete(12)]);
    expect(source.spans).toEqual([{ from: 0, to: 12, kind: 'subscription' }]);
    expect(source.reveal).toBe('always');
  });

  it('derives debounce windows, with b cancelled by c', () => {
    expect(operator.detail).toBe("t = time('--|') = 2 frames");
    expect(operator.spans).toEqual([
      { from: 1, to: 3, kind: 'window' },
      { from: 4, to: 5, kind: 'cancelled' },
      { from: 5, to: 7, kind: 'window' },
      { from: 8, to: 10, kind: 'window' },
    ]);
  });

  it('captures the operator output as actual and the marble string as expected', () => {
    const wanted = [next(3, 'a'), next(7, 'c'), next(10, 'd'), complete(12)];
    expect(output.events).toEqual(wanted);
    expect(output.expected).toEqual(wanted);
    expect(output.reveal).toBe('playhead');
  });
});

describe('updateSpec', () => {
  const base: SpecState = { title: 't', lanes: [], frames: 3, playhead: -1 };

  it('TICK advances the playhead one frame at a time and stops at the last frame', () => {
    const ticks = [0, 1, 2, 3, 4].map((n) =>
      Array.from({ length: n }, () => ({ type: 'TICK' as const })).reduce(updateSpec, base),
    );
    expect(ticks.map((s) => s.playhead)).toEqual([-1, 0, 1, 2, 2]);
  });

  it('hasFramesLeft is false once the last frame is reached', () => {
    expect(hasFramesLeft(base)).toBe(true);
    expect(hasFramesLeft({ ...base, playhead: 1 })).toBe(true);
    expect(hasFramesLeft({ ...base, playhead: 2 })).toBe(false);
  });
});

describe('debounceWindows', () => {
  it('closes a window early when the source completes inside it', () => {
    expect(debounceWindows([next(1, 'a'), complete(2)], 2)).toEqual([{ from: 1, to: 2, kind: 'window' }]);
  });

  it('cancels a window when a newer value arrives before it ends', () => {
    expect(debounceWindows([next(0, 'a'), next(1, 'b')], 3)).toEqual([
      { from: 0, to: 1, kind: 'cancelled' },
      { from: 1, to: 4, kind: 'window' },
    ]);
  });
});

describe('marbleFrames', () => {
  it('counts one frame per character and ignores whitespace', () => {
    expect(marbleFrames('  -a--bc--d---|')).toBe(13);
    expect(marbleFrames('--|')).toBe(3);
  });
});
