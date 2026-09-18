import { auditTime, debounceTime } from 'rxjs';
import type { MarbleSpec } from './spec-visualizer.ts';

/**
 * Marble tests copied from rxjs 7, `spec/operators/*-spec.ts`, one object per
 * `it(...)`. The strings are verbatim; run mode ignores the alignment spaces.
 */
export const specs = {
  /**
   *   it('should debounce values by 2 time units', () => {
   *     testScheduler.run(({ hot, time, expectObservable, expectSubscriptions }) => {
   *       const e1 = hot('  -a--bc--d---|');
   *       const e1subs = '  ^-----------!';
   *       const expected = '---a---c--d-|';
   *       const t = time('  --|');
   *       expectObservable(e1.pipe(debounceTime(t))).toBe(expected);
   *       expectSubscriptions(e1.subscriptions).toBe(e1subs);
   *     });
   *   });
   */
  debounceTime: {
    title: 'debounceTime: should debounce values by 2 time units',
    source: '  -a--bc--d---|',
    subscriptions: '  ^-----------!',
    duration: '  --|',
    expected: '---a---c--d-|',
    operatorLabel: 'debounceTime(t)',
    operator: (t) => debounceTime(t),
    windows: 'debounce',
  },

  /**
   *   it('should emit the last value in each time window', () => {
   *     testScheduler.run(({ hot, time, expectObservable, expectSubscriptions }) => {
   *       const e1 = hot('  -a-x-y----b---x-cx---|');
   *       const e1subs = '  ^--------------------!';
   *       const t = time('   -----|               ');
   *       //                          -----|
   *       //                                -----|
   *       const expected = '------y--------x-----(x|)';
   *       const result = e1.pipe(auditTime(t));
   *       expectObservable(result).toBe(expected);
   *       expectSubscriptions(e1.subscriptions).toBe(e1subs);
   *     });
   *   });
   *
   * The last window ends on the frame the source completes; auditTime emits
   * the pending value first and then completes, hence the `(x|)` group.
   */
  auditTime: {
    title: 'auditTime: should emit the last value in each time window',
    source: '  -a-x-y----b---x-cx---|',
    subscriptions: '  ^--------------------!',
    duration: '   -----|               ',
    expected: '------y--------x-----(x|)',
    operatorLabel: 'auditTime(t)',
    operator: (t) => auditTime(t),
    windows: 'audit',
  },
} satisfies Record<string, MarbleSpec>;

export type SpecName = keyof typeof specs;

export const defaultSpecName: SpecName = 'debounceTime';

export const specNames = Object.keys(specs) as SpecName[];

export const isSpecName = (name: string): name is SpecName => Object.hasOwn(specs, name);
