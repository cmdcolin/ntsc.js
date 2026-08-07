# 0003 — Delete the worker-hosted engine

**Status:** accepted, 2026-08-07.

## Context

Three commits (`c67fc3e`, `a12c55e`, `2eef17e`) built a second engine that runs
the whole signal path inside a worker, presenting to an `OffscreenCanvas` and
driven by the worker's own `requestAnimationFrame`. It worked. It was never
wired in: nothing in `src/` imported it, it did not appear in the production
bundle, and only `scripts/workercheck.mjs` ever drove it.

It was built to solve a specific problem — the render loop competing with React,
video staging and layout for the thread that delivers frames. Its measurement
was real but is no longer about anything:

- The spike held 60 fps under a synthetic main-thread load of 20 ms every 50 ms,
  against 42.6 fps for the same engine on the main thread. **That load was
  chosen to represent the video staging cost, which was then fixed** (`990b3d5`
  moved the decode and scale off-thread via `createImageBitmap`). The app's real
  profile afterwards is a median 4 ms of timer lateness with blocks over 50 ms
  at 0.3% of samples — the worker was measured against a main thread far busier
  than the one it would now be protecting.
- A 21.6-minute soak on a deliberately expensive look found zero stalls, zero
  frozen windows and zero device losses. The main thread is not the problem.
- **And the freeze is now explained, by a mechanism a worker cannot touch.** A
  tab is worth about two WebGPU sessions before the browser stops delivering
  animation frames to it ([0002](0002-webgpu-sessions-are-scarce.md)). Moving
  the loop to another thread does not change how many devices a tab has created.
  Worse, per the handoff's own "if it is picked back up" list, a worker cannot
  read `visibilityState` for itself, so it would have _mis-reported_ this exact
  fault — raising "the browser stopped painting this tab" over a page that was
  merely in the background.

Against that, the standing costs were real: a 137-line interface whose main job
was keeping two implementations from drifting, a message protocol, an
`OffscreenCanvas` rebuild path that had to stay compatible with the main-thread
one, an unimplemented audio path, a black-box recorder that goes dark in a
worker, and two harnesses (`perf.mjs --ablate`, `deviceloss.mjs`) that reach
into the object graph in ways no message proxy can reproduce — which was already
the argument against ever making it the default.

## Decision

Delete it: `engine.worker.ts`, `workerproto.ts`, `workerclient.ts`,
`workerclient.test.ts`, `scripts/workercheck.mjs`. 1403 lines.

Keep the two seams it left behind, because both earn their place without it, and
say so in their own headers rather than leaving them justified by a ghost:

- **`env.ts`** — asking what the JS context has rather than assuming. It is why
  `renderloop.ts` is unit-testable at all (the tests stub a document too thin
  for half of it), and a `try`-less `localStorage` read is a crash in a privacy
  mode. Its dead injection seam (`setPageSearch`, which existed so a worker
  could be told the page's query string) went with the worker — it had zero
  callers.
- **`videopump.ts` / `sources.ts`** — the split is what `990b3d5` was built on.
- **`engineapi.ts`** — now an interface with one implementation, which
  TypeScript enforces through `implements`. Kept for its other job: five hooks
  needing three or four methods each should not have to name a 1400-line class.

## Consequences

- **The main-thread engine is now the only engine, and that is a constraint to
  design into.** Anything that wants the loop off the main thread has to make
  the case again from scratch, against a profile where the main thread is
  measurably not the bottleneck.
- The recorder, the harnesses and the device-loss rebuild all get to assume a
  page. That is a simplification, not a limitation to apologise for.
- If this is ever wrong, the code is three `git show`s away and the handoff
  keeps the full "if it is picked back up" list — the visibility gap, the trace
  gap, the audio gap, and the `transferControlToOffscreen`-once constraint.
  Rebuilding from that list is cheaper than maintaining an unused second engine
  against a moving one.
- Nothing about the freeze changes. Deleting this does not fix anything and was
  never going to; it removes an answer to a question that turned out to have a
  different one.
