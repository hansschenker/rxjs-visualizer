import { auditTime, concatMap, debounceTime, map, mergeMap, switchMap, type Observable } from 'rxjs';
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
    kind: 'time',
    title: 'debounceTime: should debounce values by 2 time units',
    source: '  -a--bc--d---|',
    subscriptions: '  ^-----------!',
    duration: '  --|',
    expected: '---a---c--d-|',
    operatorLabel: 'debounceTime(t)',
    operator: (t: number) => debounceTime(t),
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
    kind: 'time',
    title: 'auditTime: should emit the last value in each time window',
    source: '  -a-x-y----b---x-cx---|',
    subscriptions: '  ^--------------------!',
    duration: '   -----|               ',
    expected: '------y--------x-----(x|)',
    operatorLabel: 'auditTime(t)',
    operator: (t: number) => auditTime(t),
    windows: 'audit',
  },

  /**
   *   it('should map-and-flatten each item to an Observable', () => {
   *     testScheduler.run(({ cold, hot, expectObservable, expectSubscriptions }) => {
   *       const values = { x: 10, y: 30, z: 50 };
   *       const x = cold('    x-x-x|             ', values);
   *       //                        y-y-y|
   *       //                           z-z-z|
   *       const xsubs = [
   *         '               --^----!             ',
   *         '               --------^----!       ',
   *         '               -----------^----!    ',
   *       ];
   *       const e1 = hot('  --1-----3--5--------|');
   *       const e1subs = '  ^-------------------!';
   *       const expected = '--x-x-x-y-yzyz-z----|';
   *
   *       const result = e1.pipe(mergeMap((value) => x.pipe(map((i) => i * +value))));
   *
   *       expectObservable(result).toBe(expected, values);
   *       expectSubscriptions(x.subscriptions).toBe(xsubs);
   *       expectSubscriptions(e1.subscriptions).toBe(e1subs);
   *     });
   *   });
   *
   * The project function is split from the flattening operator so the
   * visualizer can tap each projected inner. `Number(i) * Number(value)` is
   * the typed spelling of the spec's `i * +value`.
   */
  mergeMap: {
    kind: 'higherOrder',
    title: 'mergeMap: should map-and-flatten each item to an Observable',
    source: '  --1-----3--5--------|',
    subscriptions: '  ^-------------------!',
    expected: '--x-x-x-y-yzyz-z----|',
    expectedValues: { x: 10, y: 30, z: 50 },
    operatorLabel: 'mergeMap(value => x.pipe(map(i => i * +value)))',
    inner: {
      marbles: '    x-x-x|             ',
      values: { x: 10, y: 30, z: 50 },
      subscriptions: [
        '               --^----!             ',
        '               --------^----!       ',
        '               -----------^----!    ',
      ],
    },
    project: (value: unknown, x: Observable<unknown>) => x.pipe(map((i) => Number(i) * Number(value))),
    flatten: (project) => mergeMap(project),
  },

  /**
   *   it('should map-and-flatten each item to an Observable', () => {
   *     testScheduler.run(({ hot, cold, expectObservable, expectSubscriptions }) => {
   *       const e1 = hot('   --1-----3--5-------|');
   *       const e1subs = '   ^------------------!';
   *       const e2 = cold('    x-x-x|            ', { x: 10 });
   *       //                         x-x-x|
   *       //                            x-x-x|
   *       const expected = ' --x-x-x-y-yz-z-z---|';
   *       const values = { x: 10, y: 30, z: 50 };
   *
   *       const result = e1.pipe(switchMap((x) => e2.pipe(map((i) => i * +x))));
   *
   *       expectObservable(result).toBe(expected, values);
   *       expectSubscriptions(e1.subscriptions).toBe(e1subs);
   *     });
   *   });
   *
   * The second inner (for 3) is unsubscribed at frame 11, when 5 arrives,
   * before its own completion: its lane ends with `!` and no complete bar.
   */
  switchMap: {
    kind: 'higherOrder',
    title: 'switchMap: should map-and-flatten each item to an Observable',
    source: '   --1-----3--5-------|',
    subscriptions: '   ^------------------!',
    expected: ' --x-x-x-y-yz-z-z---|',
    expectedValues: { x: 10, y: 30, z: 50 },
    operatorLabel: 'switchMap(x => e2.pipe(map(i => i * +x)))',
    inner: {
      marbles: '    x-x-x|            ',
      values: { x: 10 },
    },
    project: (value: unknown, e2: Observable<unknown>) => e2.pipe(map((i) => Number(i) * Number(value))),
    flatten: (project) => switchMap(project),
  },

  /**
   *   it('should map-and-flatten each item to an Observable', () => {
   *     testScheduler.run(({ hot, cold, expectObservable, expectSubscriptions }) => {
   *       const e1 = hot('   --1-----3--5-------|');
   *       const e1subs = '   ^------------------!';
   *       const e2 = cold('  x-x-x|              ', { x: 10 });
   *       const expected = ' --x-x-x-y-y-yz-z-z-|';
   *       const values = { x: 10, y: 30, z: 50 };
   *
   *       const result = e1.pipe(concatMap((x) => e2.pipe(map((i) => i * parseInt(x)))));
   *
   *       expectObservable(result).toBe(expected, values);
   *       expectSubscriptions(e1.subscriptions).toBe(e1subs);
   *     });
   *   });
   *
   * The third outer value (5) arrives at frame 11 while the second inner is
   * still running; concatMap queues it and subscribes its inner at 13.
   */
  concatMap: {
    kind: 'higherOrder',
    title: 'concatMap: should map-and-flatten each item to an Observable',
    source: '   --1-----3--5-------|',
    subscriptions: '   ^------------------!',
    expected: ' --x-x-x-y-y-yz-z-z-|',
    expectedValues: { x: 10, y: 30, z: 50 },
    operatorLabel: 'concatMap(x => e2.pipe(map(i => i * parseInt(x))))',
    inner: {
      marbles: '  x-x-x|              ',
      values: { x: 10 },
    },
    project: (value: unknown, e2: Observable<unknown>) =>
      e2.pipe(map((i) => Number(i) * parseInt(String(value), 10))),
    flatten: (project) => concatMap(project),
  },
} satisfies Record<string, MarbleSpec>;

export type SpecName = keyof typeof specs;

export const defaultSpecName: SpecName = 'debounceTime';

export const specNames = Object.keys(specs) as SpecName[];

export const isSpecName = (name: string): name is SpecName => Object.hasOwn(specs, name);
