# Freezes on Firefox/Linux, and a worker that is parked

**2026-08-05.** Starting question: the app freezes on Firefox and needs the tab
closed — not just reloaded — to recover. Is that a Firefox bug or ours?

Answer: both, separably. Four app-side causes were found and fixed. A fifth line
of work — moving the render loop into a worker — was built, tested, and then
**not wired in**, because the fix that came before it removed most of its
justification. That last part is the reason this document exists.

## What was actually wrong

Four things, in rough order of how much they mattered.

**The app was running on the wrong GPU.** `requestAdapter()` was called with no
options, which on a hybrid laptop gets the integrated chip wired to the panel.
On the dev box (Precision 7540: Intel UHD 630 + Radeon Pro WX 3200) that cost 3x
the frame time — 9.34 ms vs 3.38 ms per frame at `dubGens:1`, and 16.37 ms vs
5.28 ms at `dubGens:4`. The second of those blows a 60 Hz budget outright. Fixed
in 95f2a85 by asking for `high-performance`; b6e3ee5 added `?gpu=low-power` to
opt back out for battery, or to bisect a driver-shaped fault.

**rAF is not backpressure.** It paces submission to the _display_, not to the
device. A frame costing more GPU time than a refresh interval means every
callback adds more work than the GPU retires, and the queue grows without bound
— measured, 120 frames submit in 27 ms of JS and take 1121 ms of GPU to drain.
The growth is slow and quiet, which is exactly why it reads as "it freezes after
a while" rather than as a frame-rate problem. Fixed in 8eb9fa0 with a bounded
backlog (`MAX_QUEUED_FRAMES`) — and re-fixed afterwards, because that bound was
a frame count and a frame count cannot be sized here. See the postscript.

**The hang watchdog was lying.** It raced `onSubmittedWorkDone()` against a
timeout and called a miss a dead GPU. But Firefox resolves that promise from a
main-thread timer, so a blocked main thread makes a healthy device look wedged:
spinning the main thread for 6 s with _nothing submitted and the GPU idle_ left
the promise unresolved for 6001 ms. Two of those and the loop tore itself down
behind a fatal "the GPU stopped responding". Same commit; a strike is now only
scored if the timer that fired it was roughly punctual.

**Video staging was eating the main thread.** `drawImage` into a 2D canvas then
copy, all synchronous: 27 ms median (43 ms p90) at 1440x1080 for slot A, 14 ms
(23 ms p90) at 754x480 for slot B. That fires once per _video_ frame, so at 24
fps it is most of a second of main thread per second. `createImageBitmap` does
the decode and scale off-thread, leaving 7 ms and 2 ms. Fixed in 990b3d5.

The in-code estimate that path carried
(`~5 ms, the single largest per-frame cost`) was right about the ranking and
3–5x optimistic about the size.

Note how the last two interact: a main thread pinned by staging _also_ stalls
the completion callbacks the render loop reads GPU liveness from. Video playback
was very likely the trigger for the bogus "GPU stopped responding".

## What is parked, and why

Three commits build a worker-owned engine: `c67fc3e` (env seam), `a12c55e`
(worker + protocol), `2eef17e` (page-side proxy). Plus `c657b95`, the
`Sources`/`VideoPump` split, which earns its place independently — it is the
seam the staging fix is built on.

**Nothing in the app imports `workerclient.ts` or `engine.worker.ts`.** They do
not appear in the production bundle. Only `scripts/workercheck.mjs` drives them.

They work. A spike ran the real signal path in a worker and, under a main-thread
load of 20 ms every 50 ms, held 60 fps with no frame gap over 33 ms — against
42.6 fps, a p99 gap of 90 ms and stalls past 100 ms for the same engine on the
main thread.

**But that load was chosen to represent the video staging cost, which was then
fixed.** The synthetic load blocks 40% of every second outright. After 990b3d5
the app's real profile with a clip playing is median 4 ms timer lateness, p95
~28 ms, and blocks over 50 ms down from 2.6% to 0.3% of samples. Those are not
the same units and should not be turned into a ratio, but the direction is not
in doubt: the worker was measured against a main thread far busier than the one
it would now be protecting. Its remaining benefit is unmeasured and much smaller
than the spike implied.

The awkward part: **the only way to measure it is to finish the wiring**, since
app-on-worker cannot be compared to app-on-main until the app can run on the
worker. Chicken and egg, and the remaining increment (`useEngine`, a 900-line
hook that assumes a synchronous engine) is the riskiest one.

### The trigger for picking it back up

Run the app with a video or webcam source for a while. **If it still freezes,
finish the wiring** — that is evidence the main thread is still the problem. If
it does not, the four fixes above were the answer and this stays parked.

That is `scripts/soak.mjs` now, rather than a thing someone does by eye.

**Answered as far as this box allows, and the answer so far is no freeze.** Over
**21.6 minutes** of a clip playing on a deliberately expensive look
(`fbMix:0.45,cfbMix:0.3,phosphor:0.6,crtGlow:0.7,dubGens:3`), across **259**
five-second windows with the tab actually on screen: **zero** windows where the
frame counter failed to advance, zero throttle episodes, zero stalls, zero
device losses, video rolling at 0.96x wall, and the slowest single window still
14.8 fps. Main-thread lateness sat at a median of 0–1 ms with blocks over 50 ms
at 0.02% of samples, against the 0.3% the staging fix left behind.

Two things stop that being conclusive, and both are the environment rather than
the app:

- An earlier run ended with a **detached frame at about twelve minutes**, which
  this document first recorded as a Firefox/BiDi limit. **It is not one.** That
  was a single observation whose `soak.json` was not kept, so the only surviving
  record of it is a sentence in `137ed96`. The lore it leaned on counts a
  different thing — a browser is spent after *a dozen or so WebGPU sessions*
  (`DEVELOPMENT.md`), a session count, and a soak opens exactly one. And the run
  reported above refutes it: 259 adjacent five-second windows with the tab
  visible are 259 disjoint intervals, so that session held continuous WebGPU for
  **at least 21.6 minutes**, nearly twice the supposed limit. A deliberate
  re-test on a quiet box agrees: **20.3 minutes wall, 17.5 of them rendering**
  at ~45 fps on the expensive look, still healthy and still answering when it
  was stopped by hand. Two observations past twelve, none at it.

  There is a likelier mechanism, with evidence. Firefox Nightly's WebGPU crashes
  the browser process on this box — a minidump left in a puppeteer profile on
  2026-08-05 carries `MozCrashReason = Cannot remove a vacant resource`, a wgpu
  resource-registry assertion, with `SecondsSinceLastCrash = 342`: twice inside
  six minutes. From Node a crashed browser and a dropped frame are the same
  "Target closed". Aperiodic and workload-shaped fits one run dying at twelve
  and the next passing twenty-two; a fixed period does not.

  And there is a third reading, found by instrumenting for the second. A cycling
  run ended with its browser **SIGKILLed** — a signal no process sends itself —
  while `journalctl` showed **five Firefox Nightly instances launched by
  something else inside those three minutes**. This box is shared with other
  agents driving browsers, and any harness that reaps with `pkill firefox` reaps
  this one too. So "the browser stopped answering" has covered, at various
  times: a detached frame, a wgpu crash, and a neighbour's cleanup. None of the
  three is the app, and only one of them is even Firefox's fault.

  That distinction matters more than the number. A wgpu crash carrying this
  app's workload **is** a user-visible freeze, and the harness used to file
  every such death under "the browser's problem, not ours" — the honesty fix
  for one false verdict overshot into the opposite one. It now asks the process
  for an exit code and salvages `<profile>/minidumps/*.extra` before puppeteer
  deletes the profile, counts a crash as a freeze, and records `diedAt` so a
  second observation can be compared with the first instead of confirming it.

- This machine is shared with other agents driving headed browsers, so the soak
  window kept losing the foreground, and a hidden tab stops rAF _by design_. The
  harness accumulates visible minutes rather than wall clock for that reason,
  and refuses to give a clean verdict on a run that spent much of itself hidden.
  It also **raises its own window**: puppeteer's opens behind whatever is
  already there, a fully covered window reads as `hidden` here, and a run
  started that way sat at frame 61 for its whole first ten seconds — measuring
  nothing, quietly, which is the same failure as the rest of this section.

**So: no freeze in 21.6 measured minutes, and the parked work stays parked.** A
single uninterrupted run on a quiet machine would settle it properly; if that
run is also clean, the four fixes were the answer and the worker can be deleted
rather than merely parked.

### If it is picked back up

- **Nothing tells the worker whether the page is on screen, and it cannot find
  out.** `env.ts` answers "visible and focused" wherever there is no document,
  and the reasoning behind that (an absent page must not read as a hidden one)
  is right for the _loop_ and wrong for the _watchdog_. **Measured on Nightly:
  worker rAF stops dead in a hidden tab — 0 callbacks in 3 s, against 180 in the
  same worker while the tab was front.** So the watchdog would see `rafTicks`
  flat with `isVisible()` insisting the context is live, which is precisely its
  definition of a stall. It would bridge with the setTimeout pump into a surface
  nothing composites, spend the 5 s budget, reconfigure the swapchain, and latch
  `frozen` — meaning switching tabs raises "the browser stopped painting this
  tab" over a page that is merely in the background. `workerproto.ts` needs a
  visibility message; the page is the only side that knows.
- **The black-box recorder goes dark.** `sessionStore()` is null in a worker, so
  `trace.flush()` serializes the ring and drops it on the floor. The recorder
  that found most of what is written above stops recording at exactly the point
  the engine moves to a thread that is harder to observe. It needs a `trace`
  message the page can persist on the worker's behalf.
- The remaining work is `useEngine` wiring behind `?worker=1`. Keep it opt-in.
  `perf.mjs --ablate` reaches into `vf.prePasses`, `deviceloss.mjs` into
  `vf.sources` and `vf.audioState` — direct object-graph access no message proxy
  can reproduce. Those harnesses need the main-thread path to keep working,
  which is the real argument against ever flipping the default.
- Audio-into-picture is **not** implemented on the worker path. The
  `AudioContext` stays on the page (the meter reads it live every frame), and
  the per-frame analysis buffer would need a protocol message the engine can
  consume.
- A canvas can be `transferControlToOffscreen()`d exactly once, so a lost device
  is answered by rebuilding _inside_ the worker on the canvas it already holds
  (`rebuild` in `workerproto.ts`), not by standing up a fresh worker. This has
  to stay compatible with the main-thread rebuild in `c02ae33`.

## Firefox facts that constrain the design

Verified against Nightly on this box, not taken from documentation — the general
advice on several of these is wrong _here_.

- **`copyExternalImageToTexture` accepts only** `ImageBitmap`,
  `HTMLImageElement`, `HTMLCanvasElement`, `OffscreenCanvas`. A video element is
  rejected outright, `importExternalTexture` is `undefined`
  ([bug 1827116](https://bugzilla.mozilla.org/show_bug.cgi?id=1827116)), and a
  WebCodecs `VideoFrame` is rejected too. So ImageBitmap is the _only_ route off
  the 2D canvas, and the usual "prefer external textures" advice does not apply.
- **Firefox polls wgpu from a 100 ms timer**
  ([bug 1870699](https://bugzilla.mozilla.org/show_bug.cgi?id=1870699)).
  `onSubmittedWorkDone()` on an _idle_ queue measured a flat 99–101 ms, eight
  times running. It cannot time a single frame, and any backpressure scheme has
  to clear that floor or it throttles a healthy session.
- **That polling is main-thread-gated** (see the watchdog above).
- **A worker has `requestAnimationFrame`.** WebGPU, `OffscreenCanvas` and rAF
  all work there, which is what makes the parked design viable at all.
  Re-measured on Nightly against a transferred `OffscreenCanvas`: present, and
  delivering **60 callbacks/s** while the tab is on screen. Worth re-checking
  rather than trusting the write-ups — MDN's compat data and the third-party
  summaries of it still say `DedicatedWorkerGlobalScope.requestAnimationFrame`
  is Chromium-only, and on Nightly that is simply not true.
- **...but it stops entirely when the tab is hidden**, where main-thread rAF
  merely throttles: 0 worker callbacks in 3 s against 1 on the page's own loop.
  A worker cannot see that for itself, which is the gap listed above. (A window
  fully covered by another window reports `visibilityState: 'hidden'` here too,
  so "occluded" and "hidden" are not separable on this setup — which is also why
  the worker's benefit in an occluded-but-visible window could not be measured.)
- **Firefox pins a GPU awake while a device is open on it.** The discrete card
  never suspended across a 60 s idle test despite a 5 s autosuspend delay. Good
  for stability, bad for battery — hence `?gpu=low-power`.

**Red herring worth not re-chasing:** the kernel log shows the amdgpu card fully
re-initialising ~2400 times in 14 days (re-measured: 2717 in 20 days, so the
rate holds). It is not the freeze — but check the reasoning, because half of it
has gone stale. "The AMD card sat at 0.00% while the app ran" was true when the
app ran on the **Intel** chip, and 95f2a85 in this same document moved it to
`high-performance`, which on this box _is_ the amdgpu card: measured during a
soak, card2 (`0x1002`) busy and card1 idle. The app now renders on the card that
re-initialises 2400 times a fortnight.

What still carries the dismissal is the other leg, and it is the stronger one.
The re-init sequence (`PCIE GART` / `UVD` / `VCE`) is a runtime-PM resume, and
it stops dead for the whole length of a session: zero of them in the kernel log
across a 20-minute soak, and none at all for the 90 minutes the card had been
held awake before it. The cycling happens **between** sessions, never during
one, so it cannot be what wedges a session that is already running.

## Measurement traps this cost real time to find

Several of these invalidated a result before being caught. Full versions live in
`DEVELOPMENT.md`; these are the ones specific to this work.

- **Video benchmarks: accumulate liveness, do not diff endpoints.**
  `clip-hero.mp4` is 9.03 s; a 9.1 s measurement window gave
  `end - start = 0.05 s` and read as a frozen video. Three A/B runs were
  discarded believing that. Sum _positive_ `currentTime` deltas instead.
- **Video decode keeps running in an occluded window** — unlike rAF, which
  throttles to ~1 Hz. An earlier note claiming otherwise was wrong.
- **Video elements are created detached** (`videoSlot.ts`), so
  `document.querySelector('video')` finds nothing. Reach them via
  `window.vf.pump.info()`.
- **Reading a worker-owned canvas back from the page lags what the worker has
  presented.** The same frame read twice gave `0,0,0` then the real pixel.
  Stepping the engine is not enough; the compositor has to have picked it up.
- **A crashed browser and a dropped frame are the same error from Node** —
  "Target closed" for both. The shape of the error cannot tell them apart and
  neither can the app's trace, since a process that died never flushed one. Ask
  the process for an exit code and read `<profile>/minidumps/*.extra`, and do it
  before `browser.close()`, which deletes the profile the evidence is in. A
  guess made here once hardened into a browser limit that does not exist.
- **One WebGPU session per browser.** Three devices in one browser killed
  Firefox outright, with no crash report. `workercheck.mjs` gives each phase its
  own browser and retries once on a spent one. (A headed window being tabbed
  away from mid-run is at least as plausible a cause as anything in the code; no
  root cause was confirmed.)
- **A test that cannot fail is worthless.** Two written this day passed
  vacuously before being mutation-checked — one asserted on `hangs()` when
  `HANG_STRIKES` is 2 so a single strike could never trip it, and one claimed a
  clip streamed when it had actually passed on a single frame from a paused
  element at `t=0.00`. Mutate the code and watch the test go red.

## Where things are

| area                          | file                                         |
| ----------------------------- | -------------------------------------------- |
| adapter choice, `?gpu=`       | `src/gpu/context.ts`                         |
| backpressure, hang honesty    | `src/gpu/renderloop.ts`                      |
| worker/main environment split | `src/gpu/env.ts`                             |
| video element → bitmap        | `src/gpu/videopump.ts`                       |
| bitmap → texture              | `src/gpu/sources.ts`                         |
| parked: worker engine         | `src/gpu/engine.worker.ts`, `workerproto.ts` |
| parked: page-side proxy       | `src/gpu/workerclient.ts`                    |
| parked: its harness           | `scripts/workercheck.mjs`                    |

## Postscript: the backpressure gate was counting the wrong thing

**2026-08-05, same day.** A review of the above found the second fix — the
bounded backlog — throttling healthy sessions. It is worth writing down because
the reasoning that produced it was sound and still wrong, and because the dev
box is constitutionally unable to show it.

`MAX_QUEUED_FRAMES = 12` bounded _submitted minus confirmed_, sized against
Firefox's 100 ms poll as "about six frames' worth at 60 Hz, so twelve leaves 2x
headroom". What that missed is that `confirmed` can only ever advance to a mark
one whole poll period stale: a probe armed at T reports on work submitted before
T, but not until T+100 ms, and another poll's worth of frames is submitted in
between. The steady-state peak is therefore **2n, not n**, where n is frames per
poll period. At 60 Hz that is 12 against a cap of 12 — the headroom was zero.

Measured, against a device with _no_ GPU cost at all, so the only thing between
a submission and its confirmation is the poll:

| refresh | poll   | frames rendered |
| ------- | ------ | --------------- |
| 60 Hz   | 100 ms | 120 of 120      |
| 60 Hz   | 120 ms | 101 of 120      |
| 75 Hz   | 100 ms | 121 of 151      |
| 120 Hz  | 100 ms | 121 of 241      |
| 144 Hz  | 100 ms | 121 of 289      |

Every dropped frame announced as "the signal path is costing more than a refresh
interval". The gate was capping throughput at one cap-full per poll — about 120
fps, whatever the hardware could actually do.

**Why this box cannot show it.** Instrumented live, the dev laptop sits at ~40
fps with the poll returning in **30 ms**, not the 99–101 ms recorded above —
that figure was an _idle_ queue on the Intel path, and a busy queue on the
discrete card answers far quicker. So n=1.4, peak backlog 3, cap 12. The 2n
model checks out (peak 3 against 2n=2.8) and the fault is nowhere near reachable
here. It needs a fast display or a slow poll, and this machine has neither.

Replaced with a _wait_: `MAX_QUEUE_WAIT_MS`, how long submitted work may sit
unconfirmed. On a device that is keeping up the probe settles at the poll floor
however many frames went into it, so the refresh rate drops out of the question
entirely and the only thing that carries it past the threshold is the queue
genuinely taking longer to drain. It also deleted the `submitted`/`confirmed`
high-water-mark bookkeeping.

Two things it needs that a count did not:

- **A generation guard on the probe.** One is now kept outstanding at all times,
  so a probe living across a stop/start would re-arm on top of the new one —
  doubling the probes in flight on every restart, each settling one clobbering
  the arm time the gate reads.
- **The same honesty the hang watchdog has.** Firefox resolves
  `onSubmittedWorkDone` from a main-thread timer, so a blocked main thread
  leaves the probe outstanding on a perfectly idle GPU. The gate only counts a
  slow probe against the device if frames were actually submitted into it —
  nothing submitted means nothing to be behind on. That is `HANG_LATE_FACTOR`'s
  argument, applied to the second consumer of the same lying signal.

**The lesson worth keeping:** every unit test passed, because the harness
resolved completion _instantly_. The one property the constant was chosen
against — the poll latency it had to clear — was the one property the tests did
not model. A test that confirms the GPU on the same tick can say nothing about a
gate whose whole job is tolerating a 100 ms confirmation delay.
`renderloop.test.ts` now takes a `pollMs`, and the table above is in it.

Two smaller things the same review turned up, both in `videopump.ts`:

- A decode that _rejected_ left `lastTime` advanced, and `due()` only re-fires
  once currentTime moves past it — which a playing clip does on its own and a
  paused element never does. One rejected decode on a still-framed source (an
  element mid-seek when it was attached, a blocked autoplay) parked that slot on
  whatever texture it already had for the rest of the session.
- `retarget` left `inFlight` for the outgoing decode's handler to clear, so a
  stale decode cleared a flag the _incoming_ one had set and the next pump
  started a second decode of a source already being decoded. Retiring a
  generation now resets the slot completely, and neither handler touches a slot
  whose generation has moved on.

`videopump.ts` had no unit tests at all before this; it has ten now.
