import { Subject, map, scan, shareReplay, startWith, takeWhile, timer, withLatestFrom } from 'rxjs';
import {
  DEFAULT_SPEC_RENDER_CONFIG,
  hasFramesLeft,
  renderSpecToDOM,
  runMarbleSpec,
  updateSpec,
  type MarbleSpec,
  type SpecAction,
} from './spec-visualizer.ts';

export interface SpecDemoOptions {
  /** Wall-clock milliseconds per virtual frame during playback. */
  frameMs?: number;
}

/**
 * Runs `spec` through the real TestScheduler, mounts the result into `#app`
 * and plays it back one frame per `frameMs`.
 */
export function startSpecDemo(spec: MarbleSpec, { frameMs = 400 }: SpecDemoOptions = {}): void {
  const initialState = runMarbleSpec(spec);
  const dispatcher$ = new Subject<SpecAction>();

  // 1. Store
  const state$ = dispatcher$.pipe(scan(updateSpec, initialState), startWith(initialState), shareReplay(1));

  // 2. View
  const renderConfig = { ...DEFAULT_SPEC_RENDER_CONFIG, frameMs };
  state$.subscribe((state) => renderSpecToDOM(state, renderConfig));

  const title = document.getElementById('spec-title');
  if (title) title.textContent = spec.title;

  // 3. Playback: advance the playhead one frame per tick until the last frame.
  timer(frameMs, frameMs)
    .pipe(
      withLatestFrom(state$),
      takeWhile(([, state]) => hasFramesLeft(state)),
      map((): SpecAction => ({ type: 'TICK' })),
    )
    .subscribe((action) => dispatcher$.next(action));
}
