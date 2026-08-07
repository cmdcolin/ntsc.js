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
  different thing — a browser is spent after _a dozen or so WebGPU sessions_
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

  **That crash is upstream, and not ours to fix.** The string is a `wgpu-core`
  storage panic —
  [gfx-rs/wgpu#5372](https://github.com/gfx-rs/wgpu/issues/5372), an epoch
  mismatch on an id being freed from the registry twice, filed against bevy with
  crashes 5–30 s into a run. Our minidump says `UptimeTS 13.7`, inside that
  window. A page cannot panic Rust in the browser except by reaching a browser
  bug, so the app-side question is only which pattern reaches it — and three
  candidates are now ruled out on this box, none of which reproduced it: 12 tab
  teardowns in one browser, 12 renavigations of one tab, and 200 rounds of
  canvas resize with swapchain reconfigure and source B toggling. All clean, no
  minidumps, no page errors. If it recurs the harness now keeps the `.extra` and
  the `.dmp`; until then it is one occurrence with a fingerprint and no recipe.
  (Those 12 sessions in one browser are also worth noting against the "spent
  after a dozen or so" rule in `DEVELOPMENT.md` — right at its boundary, and
  entirely healthy.)

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
  every such death under "the browser's problem, not ours" — the honesty fix for
  one false verdict overshot into the opposite one. It now asks the process for
  an exit code and salvages `<profile>/minidumps/*.extra` before puppeteer
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

Read that verdict narrowly. It says the _main-thread_ freeze this section was
written to trigger on did not recur — and freezes have since been recorded that
the soak cannot see, because they land before the first frame and so never move
any of the counters it samples. See the last postscript; the conclusion for the
worker is unchanged, but the reasoning behind it is now different and stronger.

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
- **~~Firefox pins a GPU awake while a device is open on it.~~** The discrete
  card never suspended across a 60 s idle test despite a 5 s autosuspend delay.
  **Overturned by the last postscript — what pins the card is _submission_, not
  an open device, and that 60 s test held the tab in the foreground.** A hidden
  tab submits nothing and the card suspends underneath a live `GPUDevice`. Still
  bad for battery while the app is on screen, so `?gpu=low-power` keeps its
  other reason.

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

> **This dismissal was too broad, and the last postscript overturns half of
> it.** Every measurement behind it was taken with the tab _visible and
> rendering_, which is exactly the condition that pins the card awake — so
> "never during a session" was really "never while we were looking". A
> **hidden** tab submits nothing, the card's 5 s autosuspend expires underneath
> a device that is still open, and coming back is a resume _inside_ a live
> session. Read the paragraph above as being about the foreground case only.

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

## Postscript: the watchdog deferred to focus, and devtools takes focus

**2026-08-06.** A reported freeze surviving reloads produced this trace, from a
session that was still running when it was read:

```
62|resize|1499x960
70|lifecycle|pageshow (persisted=false)
79|start|
1529|lifecycle|blur
2080|beat|visible unfocused windowed STEP-DEAD ok frame 0 raf 0/beat probe 0/beat step 0/beat clock +0ms
```

Every reading is zero, and they are zero by four independent routes: no render
rAF, no probe rAF, no ResizeObserver delivery, and `document.timeline` not
advanced by a single millisecond in two seconds — at `frame 0`, so the document
was never given one frame from load. That is the tab's rendering step dead on
arrival, which is the fault this instrumentation was built to name: it belongs
to the tab rather than the document, so a reload lands in the same hole.

**The watchdog did not say so, and the reason is the fifth word of the beat.**
`blur` at 1529 ms, the first beat 551 ms later, and the stall branch gated on
`isFocused()` — so it took no verdict at all. No `stall`, no `coldStall`, no
`recordFramelessStart()`, which is the counter that lets the _next_ load open
with "the fault has outlived a document, so reloading cannot clear it". The
recording survived and the diagnosis did not.

The gate had a reason — rAF throttling in a background window is expected and
must not read as a stall — but `document.hasFocus()` is false whenever devtools
has focus, so it also switched the watchdog off for exactly as long as anyone
was reading the console. **The act of looking disabled the thing being looked
at**, which is the same shape as the single-slot recorder overwriting the trace
of the session it was opened to investigate.

Fixed by making focus decide less. The loop already has two witnesses that are
not rAF and not focus-dependent, added in `0cd7042` for a neighbouring question;
a throttled driver still runs the rendering step and still advances the
timeline, only less often, so one tick of either says it is alive and zero on
both says it has stopped. The stall branch now runs when focused **or** when
both witnesses read dead. A `null` from either is no reading rather than a dead
driver, so a worker and the pre-witness test harness are unaffected — which is
also why the existing "does not declare a stall against an unfocused window"
test still passes untouched.

`renderloop.test.ts` grew a `driver: 'absent' | 'live' | 'stopped'` harness
option to model the witnesses at all: it stubs `ResizeObserver`,
`document.timeline` and a probe element whose width setter arms a delivery, and
runs the rendering step off a 16 ms fake timer, so stopping that one timer stops
both witnesses the way a stopped driver does. Mutation-checked against the old
gate — the new test goes red, the old one stays green.

Two things this does not do. It does not make the freeze recoverable: the
fallback pump cannot bridge a dead rendering step, and the on-canvas frozen
notice cannot be painted by a browser that is not painting. What gets through is
the tab title (`⏸ frozen — `, already handled in `useEngine.ts` for exactly this
reason) and the console. And it does not explain what stopped the driver;
`STEP-DEAD` with `clock +0ms` on a visible tab is the browser's rendering step,
not the signal path, and the likeliest suspect on this box remains the wgpu
crash documented above.

## Postscript: answered off disk, and a crash pile that was ours

**2026-08-06, later.** A freeze reported with no reproduction attached — "it
freezes, refreshing does not help, no idea whether it is us or Nightly". Nothing
was caught live. Both halves of the answer came off disk afterwards, which is
the part worth writing down: this is now the cheapest route to a verdict, and it
needs no one to be sitting in front of the machine when it happens.

### The raised ceilings are not it

Earlier the same day three commits widened what the controls can reach —
`b828bb1` (89 sliders past their tuned travel), `bc17319` (impulse events 8 →
24, playback heads 4 → 8, phosphor retention 0.995 → 0.9995) and `4904171` (five
presets living out there). The obvious suspicion is that the new range costs
more GPU than a refresh interval and walks the session into exactly the queue
growth the second fix at the top of this document is about. It does not.
Measured at `b6437ae`, batched `vf.step()` + drain on the AMD path, from a
`git worktree --detach` copy so a neighbour's HMR could not spoil it:

| look                           | ms/frame @1040x900 | @1560x1200 |
| ------------------------------ | ------------------ | ---------- |
| landing (bare load)            | 3.33               | 3.33       |
| each "Past the redline" preset | 5.00–5.77          | 5.68       |
| stacked worst case             | 9.13               | 11.52      |

The worst case is `dubGens:4` + `impulseRate:24` + `tapeHeads:8` + `crtSpot:12`

- `phosphor:0.99` + the composite feedback loop, all at once — deliberately
  worse than anything a preset does, and further out than any look the
  21.6-minute soak above ever ran. Every row clears a 16.7 ms budget. The
  `?prof`-era worry that the expensive looks are the ones that wedge a session
  is now measured and wrong on this box.

The stronger reason it could not have been the signal path is in the recordings
below: **the freeze lands at `frame 0`**, before a single frame has been
submitted.

### The trace was in the profile the whole time

`trace.ts` writes to `localStorage`, and `localStorage` is a file. So a freeze
nobody caught can still be read back, from a shell, days later:

```
~/.mozilla/firefox/<profile>/storage/default/http+++localhost+<PORT>/ls/data.sqlite
```

table `data`, key `ntsc.trace`. Three things make it harder than it sounds, all
of them one-time costs now that they are written down:

- **It is Snappy-compressed** (`compression_type = 1`), as a raw stream: a
  varint uncompressed-length header, then the standard literal/copy tag bytes.
  `JSON.parse` fails on it, zlib does not apply, and this box has no python
  snappy module. About 45 lines of hand-rolled literal/copy decoding is enough,
  and is the only part of this that needs writing.
- **Which port matters**, and nobody remembers which dev server a given session
  ran on. Sweep every `localhost+*` origin for a key matching `ntsc%` instead of
  guessing; the hit also dates itself by the file's mtime.
- **It is the real profile, not a puppeteer one.** Everything a harness does
  lands in `/tmp/puppeteer_dev_firefox_profile-*` and is deleted with the
  browser. Interactive freezes are the only ones that survive, which is exactly
  the right filter.

### What the five kept sessions say

The session the previous postscript quotes — `2026-08-06 02:32:39`, dead from
load, `frame 0` — is one of the five still in the ring. The next one is the
interesting one, because it is the same fault with the focus-gate fix in place:

```
163|start|
2171|beat|visible unfocused windowed STEP-DEAD ok frame 0 raf 0/beat probe 0/beat step 0/beat clock +0ms
5069|lifecycle|visibility -> hidden
936250|lifecycle|visibility -> visible
936939|beat|visible unfocused windowed STEP-DEAD ok frame 0 raf 0/beat probe 0/beat step 0/beat clock +0ms
936942|stall|frame 0 probe 0/beat step 0/beat clock +0ms
936943|coldStall|1 frameless session in a row
938942|beat|visible unfocused windowed STEP-DEAD STALLED frame 19 raf 0/beat probe 0/beat step 0/beat clock +0ms
941030|lifecycle|visibility -> hidden
941036|resume|frame 40
942941|beat|hidden unfocused windowed step ok frame 43 raf 3/beat probe 3/beat step 1/beat clock +942915ms
```

**That stall is declared on a tab that is visible and _unfocused_**, which is
precisely what the old gate could not do and what `driverDead` was added for —
both non-rAF witnesses reading zero, so focus had nothing left to defer to. The
fix is not just unit-tested, it is confirmed on a real recording, in the very
next session after the one that motivated it. And what follows it answers the
"two things this does not do" paragraph above more optimistically than it was
written: the fallback pump ran frames 0 → 19 → 40 into the dead step, and rAF
came back. `coldStall` said reloading would not clear it, and it was right —
nothing about a reload was what cleared it.

So the current best statement of the fault, and the recovery advice that follows
from it:

- `raf 0` with `step > 0` — only animation-frame callbacks are being dropped.
  The fallback bridges it; the picture comes back on its own.
- `raf 0` with `STEP-DEAD` and `clock +0ms` on a **visible** tab at `frame 0` —
  the tab's rendering step was dead before the document ran a line. It belongs
  to the tab rather than the document, so a reload lands in the same hole. Give
  the fallback its five seconds; failing that, a new tab, not a refresh.
- `STEP-DEAD` while `hidden` — normal. Not a fault, and not worth a line of
  investigation.

One reading trap, because it cost time here: long runs of `start|` /
`stop|frame 0` pairs — about thirty across two of the five sessions — are **vite
HMR**, not engine thrash. Another agent editing `src/` in this shared worktree
reloads the page and tears the engine down, and the mount-once effect in
`useEngine` cannot produce that pattern by itself.

### The crash pile is our own harnesses

`~/.mozilla/firefox/Crash Reports/pending/*.extra` is JSON, and looked at first
glance like the whole answer: thirteen crashes carrying ntsc.js URLs. **Check
`ProfileDirectory` before reading any of them.** Every one came from
`/tmp/puppeteer_dev_firefox_profile-*`. None is interactive browsing, so none of
it is the reported freeze.

Twelve of the thirteen are a harness bug of ours, and the fingerprint is
unmistakable once the right keys are read (`IPCMessageName`, `IPCMessageSize`):
`MOZ_CRASH(IPC message size is too large)`, `PWindowGlobal::Msg_RawMessage`,
**414,259,912 bytes — the identical size in all twelve**. A byte count that
never varies is a deterministic payload, not a leak: it is a `page.evaluate`
returning a full-canvas readback, which WebDriver BiDi serializes element by
element at roughly seventy bytes per byte. Note where this comes from — one
full-canvas `getImageData` really is far cheaper than the per-pixel reads it
replaced, but only _in the page_; taking the win and then handing the buffer
back across the wire moves the whole cost somewhere nothing was measuring.
**Reduce in the page and return the reduction.** Every committed harness already
does (`panelshots.mjs` and `pixelcheck.mjs` both read the whole canvas and
return a handful of numbers), so the offender was an ad-hoc script that is no
longer on disk — which is the argument for the rule living here rather than in
whichever throwaway learns it next. The twelve arrived eighteen seconds apart in
a single browser's uptime, which is a harness looping, and would have read as
"the app crashes every eighteen seconds and a reload walks straight back into
it" to anyone who did not check the profile directory.

The thirteenth is the genuine one: `Cannot remove a vacant resource`, parent
process, `UptimeTS` 21.8 s, 2026-08-06 04:22 — the wgpu-core registry panic
already catalogued above, still upstream, still without a recipe. It is a
_further_ occurrence, not one of the pair already recorded: its
`SecondsSinceLastCrash` of 40552 points back about eleven hours, to the
2026-08-05 pair, so the count is three. The `UptimeTS` also holds: 13.7 s and
21.8 s, both inside the 5–30 s window gfx-rs/wgpu#5372 reports. Aperiodic,
workload-shaped, and reliably early in a session.

### What this leaves

- **The worker stays parked, and the argument is now stronger than the soak's.**
  A fault that lands at `frame 0`, with `document.timeline` not advancing, is
  not one a busier or quieter main thread changes. Moving the engine off the
  main thread cannot help a tab that is not being painted, and per "If it is
  picked back up" it would actively mis-report this case, since a worker cannot
  see visibility for itself.
- **The one gap worth closing is the channel, not the loop.** `Stage.tsx` paints
  "the browser stopped painting this tab", which a browser that is not painting
  cannot show. That leaves the tab title, and `useEngine.ts` writes the same
  `⏸ frozen — ` for a stall the fallback will bridge and for the cold
  never-ticked case where the loop already knows a reload is useless. The loop
  has the distinction (`everRaf`, and the `coldStall` it records); `onFrozen`
  does not carry it. Threading it through would put the one actionable verdict
  on the one surface still working.
- **The measurement above is a baseline, not a clearance.** It says the widened
  travel does not blow a frame budget on _this_ GPU at _these_ canvas sizes. The
  `present` pass is the one that scales with the canvas, and 4K is still
  extrapolated rather than measured.

## Postscript: the card sleeps when you tab away, and the hang now rebuilds

**2026-08-07.** The postscript above named the tab's rendering step and left the
frequent case unexplained. The user supplied the missing half from their own use
— _"tabbing away can affect it"_, _"maybe it is the low power mode"_ — and those
are one mechanism, with the evidence sitting in `/sys` the whole time:

```
/sys/class/drm/card2/device/power: control=auto autosuspend_delay_ms=5000 runtime_status=suspended
```

`card2` is the Radeon the app renders on since `95f2a85` asked for
`high-performance`. It has a **five-second** runtime-PM autosuspend delay, and
the kernel log shows it resuming about **a hundred times in two hours**,
occasionally every nine seconds. So:

**Tab away → rAF stops → nothing is submitted → 5 s later the card suspends
underneath a live `GPUDevice` → tab back → the card re-initialises and the
device on the far side of that is stale.** Firefox does not always fire
`device.lost` for it, so the app saw only its own symptom: submitted work that
never completes.

This is why the "red herring" dismissal above needed the correction now attached
to it. Every measurement behind it held the tab in the foreground, which pins
the card awake — the cycling was never absent, it was absent _while anyone was
looking_. The soak has the same blind spot by construction: it accumulates
visible minutes and refuses a verdict on a run that spent itself hidden, so the
one state that provokes this is the one state it discards.

Confirmed as a known class of fault rather than something exotic — the kernel
carries
[drm/amdgpu: don't runtime suspend if there are displays attached](https://lkml.iu.edu/hypermail/linux/kernel/2205.0/04263.html)
for a neighbouring symptom, and wgpu has a long tail of devices left unusable
after a PM resume ([gfx-rs/wgpu#983](https://github.com/gfx-rs/wgpu/issues/983),
[wgpu-rs#392](https://github.com/gfx-rs/wgpu-rs/issues/392)). There is no
Firefox-side fix to wait for, so the app has to survive it.

### What changed

**A hang now escalates to a rebuild instead of to a fatal screen.** The old
`onHang` reasoning — a wedged GPU process outlives the page, so a fresh device
lands on the same one — describes one cause of a hang and, on Linux, not the
common one. A power-cycled card is not wedged; its device is merely stale, and a
replacement works. The two are indistinguishable at the moment of the fault, so
`useEngine` now decides by trying: a hang takes the same path a loss does, and
only a hang that survives `RebuildPolicy`'s three fresh devices gets the "close
this browser tab" screen. That screen is now earned rather than assumed.

**What "survives" means is not the window, and that took a second pass.** The
first version of this shared one `RebuildPolicy` between the two faults, so a
hang spent the same budget a loss does: three inside `REBUILD_WINDOW_MS`,
counted fault to fault, with nothing resetting it on a rebuild that worked. That
is the wrong clock for this fault. The window was sized for losses, which arrive
on a suspend/resume cadence; hangs now arrive on a _tab-switching_ cadence,
because what provokes one is a five-second autosuspend. **Four alt-tabs inside a
minute would have ended the session** with "three fresh devices did the same" —
when all three worked, for thirty seconds each. `rebuildPolicy.ts` warns about
exactly this in its own comment ("a laptop that sleeps four times across a
day-long session ... telling that user the session is over on the fourth would
be wrong"); sharing the counter reproduced it on a one-minute clock instead of a
day.

A hang has better evidence available than elapsed time, so it uses that instead.
`RenderLoop.confirmedWork` latches whether the device _ever_ completed submitted
work, and the two cases separate cleanly on it:

| the device that hung         | reading | what it was                               | verdict                 |
| ---------------------------- | ------- | ----------------------------------------- | ----------------------- |
| completed work, then stopped | `true`  | a card that suspended under a live device | one-off, always rebuild |
| never completed anything     | `false` | born onto a wedged GPU process            | counts toward giving up |

So the bounded escalation the `GPUQueue.prototype` wedge verifies is unchanged —
no replacement there ever completes anything, so it still walks `(1/3)`,
`(2/3)`, `(3/3)` — while a card that sleeps forty times a day is rebuilt forty
times, which is the right answer and the one the shared counter could not give.
The two faults also now hold separate counts, so neither spends the other's
budget.

**The device is probed on every lifecycle transition, not only on the watchdog's
beat.** `RenderLoop.kick()` already ran on tab-shown, focus and fullscreen exit
— precisely the transitions that can have happened across a power cycle — and
now arms the hang probe too, saving up to `WATCHDOG_MS` of frozen picture before
detection even starts. `probing` keeps a burst of kicks to one probe. What makes
this safe is the change above: a false positive costs one rebuild, not the
session.

Verified end to end rather than by reading the diff. A page-side wedge —
`onSubmittedWorkDone` replaced with a promise that never settles, which is what
the far side of a resume looks like — driven against two servers, one at `HEAD`
and one patched:

| build   | outcome                                                       |
| ------- | ------------------------------------------------------------- |
| HEAD    | `FATAL SCREEN` — "Close this browser tab"                     |
| patched | `RECOVERED` — device replaced, loop running, frames advancing |

and with the wedge installed on `GPUQueue.prototype` instead, so every
replacement is born hung, the patched build walks `(1/3)`, `(2/3)`, `(3/3)` and
_then_ shows the fatal screen — the escalation is bounded, not a rebuild loop.

Three unit tests carry the parts that browser run cannot re-check cheaply, and
all three were mutation-checked rather than assumed (see the trap above about
tests that cannot fail): the probe on `kick`, `confirmedWork` latching on a
completion and _not_ on a probe that expired, and a policy that rebuilds
indefinitely through vouched-for faults while still giving up on the others. The
first draft of the third caught something on the way: `reset()` clearing `count`
is redundant to the verdict, because `lastAt = -Infinity` already forces the
fresh branch — the test only bites on it once it also reads `attempt`.

### What this does not do

- **It does not stop the card sleeping.** Recovery costs whatever VRAM was
  holding — phosphor trails, the frame store, the tape loop all start over — so
  a long feedback build-up still does not survive a tab-away. Prevention would
  mean either `?gpu=low-power` (the Intel chip drives the panel and never
  suspends; ~3x the frame cost, which the budget above has room for) or
  `echo on | sudo tee /sys/class/drm/card2/device/power/control` at the system
  level, at the cost of battery. (Not `echo on > …` — the redirect is opened by
  the shell as you, before `sudo` applies to anything.)
- **It does not help the dead rendering step.** That fault lands at `frame 0`
  with nothing submitted, so there is no hang to detect and no device to
  replace. It is still a new tab, and the channel gap in the previous
  postscript's "what this leaves" is still open.
- **The soak still cannot see any of this.** A run that reproduces it has to
  hide the tab for longer than the autosuspend delay and then come back, and
  `--cycle` was built to model ordinary use rather than to sit past a 5 s
  threshold. Worth pointing at the mechanism now that there is one.
