# Operator roadmap: 50 rxjs operators from their original specs

Working document. Check items off at the end of each session; the order is the plan, not a contract.

## How a session is sized

Measured on 2026-09-18:

| Unit of work | Time | What it includes |
|---|---|---|
| Spec on an existing shape | ~20 min | fetch the `it(...)` verbatim from rxjs 7.x, probe frames in Node, registry entry with the original quoted, scheduler-verified tests, visual check in the browser, commit |
| New capability (spec shape or lane type) | 60–90 min | model + runner + renderer + tests + CLAUDE.md, proven on one spec |

A 1–2 h session is therefore **one capability + 3–4 specs**, or **5–7 specs** when no capability is needed. Capability sessions are the ones that can overrun; spec-only sessions are the buffer.

## Per-spec checklist (definition of done)

1. Fetch the exact `it(...)` block from `spec/operators/<op>-spec.ts` on the rxjs 7.x branch. Never type marbles from memory.
2. Probe it through `TestScheduler` in Node: actual frames, subscription logs, inner emissions.
3. Add the registry entry in `src/specs.ts` with the original test quoted above it.
4. Add scheduler-verified tests in `src/spec-visualizer.test.ts` (frames, spans, output).
5. `npm run build`, `npm test`, open `spec.html?spec=<name>` in the visible tab, console clean.
6. Commit with a Conventional Commits message.

## Capabilities in the order they unlock operators

| # | Capability | Unlocks | Est. |
|---|---|---|---|
| C1 | `kind: 'plain'`: one hot source, no duration, no inner | filtering and transformation families | 15 min |
| C2 | Spec fetcher script: prints a registry stub from a named `it(...)` on GitHub | every later spec, saves ~10 min each | 45 min |
| C3 | Multi-source: N sources (hot or cold), one lane each with its own subscription bar | notifier operators, combination family | 60–90 min |
| C4 | Error `#`: red cross on source, inner and output lanes | error-handling family | 20 min |
| C5 | Resubscription: several subscription logs on one cold source, one row per attempt | retry, repeat | 45 min |
| C6 | Source of observables: `hot('-x-y|', { x: cold(..), y: cold(..) })`, inner lanes from each cold's log | mergeAll, switchAll, concatAll | 45 min |
| C7 | Dropped-value marker + value-based inner attribution | exhaustMap | 30 min |
| C8 | Multiple subscribers: several output lanes, each with its own subscription marbles | share, shareReplay | 60–90 min |
| C9 | Output of observables: output lane spawning sub-lanes | groupBy (window* later) | 60 min |
| C10 | Recursion: inner-of-inner attribution, row cap | expand | 45 min |
| C11 | Overview page grouped by family, still link-driven | navigation once the catalog is large | 30–45 min |
| — | `10ms` time-progression syntax with axis breaks | only if a chosen spec needs it; prefer specs that don't | 60 min |

## The 50 operators, by family

Done: debounceTime, auditTime, mergeMap, switchMap, concatMap (5).

- **Time-based (7):** debounceTime ✓, auditTime ✓, throttleTime, sampleTime, delay, timeout, bufferTime
- **Higher-order (8):** mergeMap ✓, switchMap ✓, concatMap ✓, exhaustMap, mergeAll, switchAll, concatAll, expand
- **Combination (7):** combineLatestWith, zipWith, mergeWith, concatWith, withLatestFrom, raceWith, forkJoin (spec lives in `spec/observables/`)
- **Filtering (12):** filter, take, takeLast, takeUntil, takeWhile, skip, skipUntil, skipWhile, first, last, distinctUntilChanged, distinct
- **Transformation (7):** map, scan, reduce, pairwise, bufferCount, buffer, toArray
- **Error handling and utility (7):** catchError, retry, repeat, finalize, tap, defaultIfEmpty, throwIfEmpty
- **Multicasting (2):** share, shareReplay

Reserve list if one of the above turns out to need `10ms` syntax or an awkward spec: groupBy, sample, throttle, debounce, startWith, endWith, elementAt, find, single, count.

## Session plan

Each session: 1–2 hours. Numbers in parentheses are running totals of operators done.

| Session | Capability | Specs | Total |
|---|---|---|---|
| S1 ✓ (2026-09-18) | spec page, time shape, higher-order shape, inner lanes, queued spans | debounceTime, auditTime, mergeMap, switchMap, concatMap | 5 |
| S2 | C1 plain shape, C2 spec fetcher | map, filter, take, scan | 9 |
| S3 | — | throttleTime, sampleTime, delay, timeout, bufferTime (array values) | 14 |
| S4 | C3 multi-source | takeUntil, skipUntil, buffer | 17 |
| S5 | pairing annotator for zip / combineLatest (optional) | combineLatestWith, zipWith, mergeWith, concatWith | 21 |
| S6 | C11 overview page | withLatestFrom, raceWith, forkJoin | 24 |
| S7 | — | takeLast, takeWhile, skip, skipWhile, first, last, distinctUntilChanged | 31 |
| S8 | C4 errors | reduce, pairwise, bufferCount, toArray, catchError | 36 |
| S9 | C5 resubscription | retry, repeat, finalize, tap, defaultIfEmpty, throwIfEmpty | 42 |
| S10 | C6 source of observables, C7 dropped marker | mergeAll, switchAll, concatAll, exhaustMap | 46 |
| S11 | C8 multicast | share, shareReplay, distinct | 49 |
| S12 | C10 recursion; polish: scrubber, hover readout, README, Apache-2.0 attribution notice | expand | 50 |

Twelve sessions. If a capability session overruns, push its specs into the next spec-only session rather than cutting the capability short.

## Progress

- [x] S1 — debounceTime, auditTime, mergeMap, switchMap, concatMap
- [ ] S2
- [ ] S3
- [ ] S4
- [ ] S5
- [ ] S6
- [ ] S7
- [ ] S8
- [ ] S9
- [ ] S10
- [ ] S11
- [ ] S12

## Deferred until the fifty are done

Decided 2026-09-18: special behaviors come after S12, not in between.

- The diamond glitch page (`glitch.html`) and any glitch-related annotation.
- Custom, non-spec pipelines on the visualizer.
- `10ms` time-progression syntax, unless one of the fifty turns out to need it.

## Standing rules

- The real `TestScheduler` produces every marble and lifetime; annotators only explain, never invent.
- Specs are copied verbatim from rxjs 7.x and quoted in `src/specs.ts`; rxjs is Apache-2.0, keep the attribution.
- One `spec.html`, specs chosen by link (`?spec=<name>`); no page per operator.
- Coordinate rule stays: origin top-left, 1 frame = 30 px, marble 26 px, no hidden offsets.
