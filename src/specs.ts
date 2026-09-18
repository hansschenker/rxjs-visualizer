import { debounceTime } from 'rxjs';
import type { MarbleSpec } from './spec-visualizer.ts';

/**
 * rxjs 7, spec/operators/debounceTime-spec.ts:
 *
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
export const debounceTimeSpec: MarbleSpec = {
  title: 'debounceTime: should debounce values by 2 time units',
  source: '  -a--bc--d---|',
  subscriptions: '  ^-----------!',
  duration: '  --|',
  expected: '---a---c--d-|',
  operatorLabel: 'debounceTime(t)',
  operator: (t) => debounceTime(t),
};
