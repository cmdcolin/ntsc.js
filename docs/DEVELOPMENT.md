# Development

```
pnpm install
pnpm dev        # vite dev server on :5199
pnpm build      # tsc -b + vite build
pnpm lint --fix # oxlint
pnpm test       # vitest
```

**`pnpm test` excludes `.claude/`, and that is load-bearing rather than tidy.**
Work here happens in `git worktree` copies under `.claude/worktrees/`, which are
full checkouts with their own `src/` — and vitest's default `include` is a glob
over the whole tree, so a run from the primary checkout used to collect every
worktree's suite along with its own: **374 test files and 6746 tests against
this checkout's 71 and 1385**, twelve seconds against two and a half. The cost
that matters is not the time, though: a half-finished branch somebody else is
working on could fail _your_ run, in files you have never opened, at paths that
look like yours because every worktree has the same layout. The exclude is in
`vite.config.ts` and is spread over `configDefaults.exclude` — replacing that
array rather than extending it silently un-excludes `node_modules`.

Most of this file is a runbook for the browser harnesses in `scripts/`, and most
of it is here because something cost a day to work out. If you are about to
drive a browser at this app, read
[what every browser harness has learned the hard way](#what-every-browser-harness-here-has-learned-the-hard-way)
first — it is the highest-value section, and every bullet in it is a real
afternoon. If you are about to measure a performance change, read
[Measuring performance](#measuring-performance) before believing a number.

`pnpm test` runs the FIR design unit tests (DC gain, passband/stopband response,
linear-phase symmetry, filter-bank packing), statically validates every WGSL
shader through naga, and holds both hand-drawn views of the pass list to the
arrays in `pipeline.ts` — `docs/graphviz/pipeline.dot` for which passes exist
and which are gated (from each node's `passes="…"` attribute and its dashed
border), and the "Pass order" block in `ARCHITECTURE.md` for the order and the
brackets too. A pass added, reordered or ungated without updating them fails the
suite. CI gates deploy on `pnpm lint` + `pnpm test`.

`pnpm run docs` regenerates every diagram in `docs/graphviz/*.dot` into light
and dark SVGs under `docs/img/` (needs Graphviz `dot` on PATH). The `.dot`
sources hold `@TOKEN@` colour placeholders rather than hex, so one graph
definition produces both themes — edit the palette in `scripts/diagrams.mjs`,
never the SVGs. `pnpm run docs:check` fails if a committed SVG no longer matches
its `.dot` — it compares bytes, so it is a local check, not a CI gate (a
different Graphviz build emits different SVG).

## Verification harness

```
pnpm harnesses 5199                    # every browser check, one line each
pnpm harnesses 5199 --skip poolcheck   # …without the live one
```

**Thirteen harnesses, six to nine minutes** — 5m49s and 8m10s on two runs of the
same commit — which is the number that decides whether anyone actually runs it,
so it is worth a range rather than a figure. The spread is other work on the
box: the GPU-heavy arms are what stretch (`faultcheck` 19s to 54s between those
two runs, `rendercheck` 19s to 53s), while the ones that mostly click and wait
barely move. `cuecheck` is the longest single entry either way, launching a
fresh browser per arm on purpose.

Start here, because **none of the harnesses below runs in CI**. The workflow
does lint, format, the compiler gate, typecheck, the unit suite and the build;
every browser check needs Firefox Nightly with WebGPU, which the runner has not
got. So a harness can stop working and nothing says so, which is not
hypothetical: `poolcheck` — the only coverage of the two live archives — spent
an unknown number of commits failing all twenty-six of its checks, and
`composecheck` spent them reading the chain map's zoom slider and reporting a
CSS layer as broken that was fine. Both were found by accident. The sweep is
what makes that a line in a list instead.

The first full run after fixing those two came back **13/13 green**, which is
the useful thing to know about it: those two were the only dead ones, so this is
a gate to keep rather than a pile of work to do.

It runs each check against one dev server and reports its exit code, in three
outcomes rather than two — `ok`, `FAIL`, and `STALL` for a run whose window
stopped being drawn (see the rAF note below). A stall is not a failure and not a
pass: it measured nothing, so put the window in front and run it again.

What it leaves out is deliberate and the file says why: the device-torture
harnesses (they break a GPU device on purpose), the generators (they write files
rather than judge), the two checks that need no server and already run in CI,
and the measurements, which report numbers rather than a verdict. `poolcheck`
runs last and is marked, because it is the one entry that can fail for a reason
that is nobody's bug.

```
node scripts/shot.mjs http://localhost:5199/ out.png [waitMs]
```

Drives a headed Firefox Nightly, steps frames deterministically, probes pixels,
and saves a screenshot. Headless Chrome can't present WebGPU swap chains here,
which is why it's Firefox.

```
node scripts/sourcecheck.mjs [http://localhost:5199/]
```

Drives the two source pickers and the teletype dialog, which is the half of the
app no other harness can reach: everything else goes in through the query
string, and a link lands in `restoreSession` rather than on the route a hand
takes (`useEngine`'s `commitA`/`commitB`). Nine load paths, no unit test that
can touch them — the hook is a bag of browser objects — and a mistake in any of
them shows up as a deck sitting on the right mode with the wrong picture.

Which is what it checks. "The canvas is not black" would pass that: peak channel
saturates at ~242 on every source this app draws. So each step takes a coarse
tile signature and the run fails if the picture did not move. Against a build
broken on purpose that reads 0.00 where a healthy one reads 2.58 at its tightest
— the header records how the two arms were separated, and why the default
`?srcb=none&set=bGain:1` is load-bearing rather than cosmetic.

### What every browser harness here has learned the hard way

Every script below shares one browser story, and each of these cost real time to
find:

- **Never `page.setViewport` after load under Firefox BiDi.** It swaps the
  realm, and every later `evaluate` sees `window.vf` as undefined — which reads
  exactly like the app failing to boot. Set the viewport before `goto`, and know
  that even that is not guaranteed: `scripts/pixdiff.mjs` lost `vf` to a
  _pre-`goto`_ `setViewport`, and puppeteer's `defaultViewport` is the same call
  under another name. Worse, **`waitForFunction` does not protect you** — it
  polls in its own realm, so it sees `vf`, passes, and hands you a page whose
  `evaluate` still cannot. A harness that does not need a specific size should
  ask for no size at all and report the canvas it actually got.
- **One Firefox does not survive a long WebGPU batch.** After a dozen or so
  sessions it detaches the frame and every later page dies with "Target closed",
  so a batch recycles browsers and treats any failure as the browser being
  spent. Note the axis: that is a count of _sessions_, not elapsed time. It was
  once restated as a twelve-minute limit and stood in the handoff as a browser
  property until two runs held a session past twenty minutes.
- **One _tab_ used to survive two or three loads, and the app was doing it to
  itself.** The symptom: a load that gets a working `GPUDevice`, renders, and is
  never given another animation frame, on a tab that still reports `visible` —
  and reloading lands in the same hole. It was modelled as a per-tab session
  budget, which fitted every route measured (loads, hot updates, rebuilds)
  because each of them destroyed a device. It is not a count. **Destroying a
  `GPUDevice` that has been presenting ends the tab's rendering step**, and the
  next document inherits it; creating devices and holding several open cost
  nothing. `scripts/devicetear.mjs` has the discriminating arms and
  `docs/adr/0004` the numbers. The app no longer calls `device.destroy()`, and
  `scripts/rafceiling.mjs --page=app` now takes 8 loads in one tab without
  dropping a frame — treat it as the regression test. This is the freeze the
  2026-08-05 handoff was written about; see its last postscript.
- **"Target closed" is three different failures wearing one error.** The frame
  detached, the browser crashed, or something outside killed the browser — and
  from Node they are indistinguishable, so ask rather than guess. A crash leaves
  `<profile>/minidumps/*.extra` naming the reason
  (`MozCrashReason = Cannot remove a vacant resource` is a wgpu one, seen here)
  and a non-zero exit; an outside kill shows up as `signal: 'SIGKILL'`, which no
  process can send itself. Salvage the minidump _before_ `browser.close()`,
  which deletes the profile it lives in.
- **This box is shared, and neighbours reap browsers.** Five other Firefox
  Nightly instances launched inside one three-minute run, and that run ended
  with its browser SIGKILLed. Any harness that cleans up with `pkill firefox`
  takes yours with it. Before believing a long run's death, check the signal and
  check `journalctl` for launches you did not make.
- **An occluded window throttles rAF to about 1Hz.** Frames are stepped
  (`window.vf.step()`) rather than waited for; a clip, which samples the canvas
  as it paints, has to own the only window on screen.

  The harnesses that _cannot_ step — the interaction ones, which wait on wall
  clock time — carry `watchFrames` from `scripts/frames.mjs` instead, and it is
  worth knowing what it does and does not detect. **A visibility event is not
  the signal.** A window merely covered by another goes on reporting
  `visibilityState: 'visible'`, so `visibilitychange` catches a minimise or a
  tab switch and misses the common case; counting rAF delivery catches all of
  it, because ~1 Hz against an expected 60 is unmistakable. And **`pagehide` is
  deliberately not listened for**: it fires on a navigation the harness asked
  for, so a watchdog on it would kill `poolcheck` at the reload it does on
  purpose.

  A stall exits `STALL_EXIT` (75), which `sweep.mjs` reports as its own outcome
  next to pass and fail. That distinction is the point: **a window that was
  clicked away measured nothing**, and calling it a failure sends the next
  person hunting a bug in a feature that never ran.

- **`setTimeout` is clamped in a backgrounded tab too**, so stepping from an
  in-page loop does not escape the trap above — it hits the same wall by the
  other door. An in-page sampler of either kind returns three frames for two
  seconds of wall clock, which reads as the thing you are measuring not
  happening rather than as the harness not sampling. Drive the loop from
  **Node** instead (one `page.evaluate` per frame, `await` the sleep outside the
  page) whenever a measurement is against the wall clock rather than against a
  frame count. `bringToFront()` alone is not enough.
- **Serve from a `git worktree add --detach` copy** (or a production build) when
  anything else might be editing the tree. An HMR reload mid-run resets the
  engine under the frame counter, and a shot then captures someone else's
  half-finished change. Getting one serving takes two workarounds: symlink
  `node_modules` in and run `node_modules/.bin/vite` directly, because
  `pnpm dev` sees the symlink as a modules dir to purge and aborts with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; and point `cacheDir` somewhere
  of its own from a small wrapper config, or the worktree and the main checkout
  share one `node_modules/.vite` through that symlink and re-optimize each
  other's deps out from under a running server. Set the port there too — the
  default 5199 is usually already someone's.
- **A `file://` image taints the canvas it is drawn on**, so frames are passed
  into the page as `data:` URIs.
- **Puppeteer writes its throwaway Firefox profile into `$TMPDIR`**, ~85 MB a
  run, and never cleans up after a killed one. On a box where `/tmp` is a tmpfs
  that has filled, the launch dies in `createProfile` with
  `Unknown system error -122` — that is `EDQUOT`, and it names no path, so it
  reads as a puppeteer bug rather than a full disk. Nearby writes go quiet
  first: redirected output lands as an empty file and the command still reports
  success. Point `TMPDIR=` somewhere on disk, and sweep old
  `/tmp/puppeteer_dev_chrome_profile-*` (they are Firefox profiles despite the
  name).
- **`?set=` silently drops any key the schema doesn't know**, so a typo costs a
  full render and comes back looking merely uninteresting rather than wrong. The
  screening harness reports what didn't land; check that line before believing a
  dull tile.
- **Don't forward every page console message.** React's dev build logs a line
  per component per render, and shipping all of them back over BiDi is enough to
  stall a harness mid-run — it hangs on an `evaluate` that never returns, which
  reads as the app deadlocking rather than the transport drowning. Filter to
  warnings, errors, and the lines the harness is actually looking for.
- **A fixed `wait()` is right for what has already happened by the next line,
  and wrong for anything on the browser's own clock.** Clicks, React renders and
  chips stepping are the first kind, which is why most sleeps in these scripts
  are fine and short. The second kind is anything waiting on a decoder, a
  `play()` promise, a live archive, or a rendered frame — and it is worth
  calling out that **rAF-clocked app state is in that set**, because an occluded
  window throttles frames (above) and so a morph, a hold bar or a lock age can
  simply not have moved yet. `traycheck.mjs` had one of each: the music arm
  slept 1500ms for a track named only once `el.play()` resolved, and the capture
  arm slept 350ms into a morph that a stalled rAF chain had not started, so
  `matchPreset` still answered with the _previous_ preset and rows were captured
  under the wrong name. Both read as broken features.

  `scripts/until.mjs` is the answer and `until.test.mjs` covers it without a
  browser. Two properties are load-bearing. It **hands the last reading back
  rather than throwing**, where `waitForFunction` rejects — so a genuine failure
  is one failed check with the value in it, not a `TimeoutError` that abandons
  the twenty assertions after it. And **`appUp(page, ms)` polls through
  `page.evaluate`**, which is the realm the harness will actually use: the first
  trap in this list is `waitForFunction` passing on a realm whose `evaluate`
  still cannot see `window.vf`. Give it the budget the sleep it replaces had,
  and a slow boot is no worse off than before.

  Boot was the widespread instance — thirteen harnesses slept 3.5–6s and then
  used `window.vf`, three of them through `window.vf?.step()`, which turns a
  boot that had not finished into a canvas that was never rendered and a check
  that reports the _pixels_ as wrong.

  The exceptions are worth knowing: `deviceloss`, `devicetear`, `gpusleep`,
  `rafceiling` and `soak` keep their sleeps, because there the waiting _is_ the
  measurement — a device that never comes back is the answer, not a timeout. And
  `iaroll`'s `setTimeout` inside a `seeked` listener is already the right shape:
  an event or a give-up, whichever lands first.

- **`element.click()` reaches a button a hand cannot.** It does no hit-testing,
  so a control scrolled or clipped out of its container — `overflow: hidden` on
  a card, say — goes on passing every check that presses it. If a layout can put
  a control out of reach, one assertion has to _measure_ rather than click; the
  tray harness checks every control on a row card is inside the card, which is
  how a chip that pushed the ✕ off the end would now be caught.
- **A click that finds nothing must fail where it happened.** These scripts find
  buttons by their text, so a chip that is missing — off a shortlist, behind a
  fold, renamed — makes the click a silent no-op and the _next_ few assertions
  fail instead, in features nothing has touched. Check the hit at the press.
- **The panel mounts one stage at a time, and none of them is open on arrival.**
  A deck's picker, its caption, its ★, and every control row with a slider or a
  `⋮` menu exist only while their stage is open — so a harness that goes
  straight to `document.querySelector` after boot finds nothing, or worse finds
  something else. It cost two harnesses, both silently: `poolcheck` read `null`
  for the picker and failed all twenty-six checks at once, and `composecheck`
  fell through to the chain map's own zoom slider — a plain `input[type=range]`
  that composes nothing — and reported the CSS layer as having lost when it had
  never been consulted. The app was correct in both cases.

  Open it first, the way `sourcecheck.ensureDeck` does: the boxes are
  `<g role=button>`, so dispatch the click on the element rather than aiming at
  a coordinate and the diagram's layout stops mattering. They **toggle**, so ask
  whether what you want is already there before clicking, or you will shut it.
  And prefer opening by _what a stage contains_ over opening by name where the
  check allows it — stages get renamed, and a harness that fails on a rename
  fails somewhere unrelated to the rename.

## Measuring performance

```
pnpm gpuprof                                   # stock: GPU time per pass, headless
pnpm gpuprof --preset=<name> --set=k=v,k=v     # a look
pnpm gpuprof --ablate=<pass>                   # the ablation upper bound
pnpm gpuprof --dump=<path> ; pnpm gpuprof:cmp <a> <b>   # is an arm pixel-exact?
node scripts/perf.mjs <url> <label> [batches] [framesPerBatch]
node scripts/perf.mjs <url> <label> --ablate   # per-pass cost attribution
```

**Per-pass GPU time first, headless.** `scripts/gpuprof` stands the compute
graph up under Deno, whose WebGPU is wgpu — the implementation under Firefox
Nightly's — on the same card, and times every pass with timestamp queries. No
window, no rAF, nothing to steal the screen, and the number is the GPU's own
counter around each pass rather than wall time around a frame, so it resolves a
tenth of a millisecond the batch harness cannot. It is not the `?prof` profiler
that was retired: that one read CPU-side clocks and charged the queue's backlog
to whichever pass ran first, where these are begin/end counters the GPU writes
inside each pass. Two things to know. wgpu hands the counters back as raw ticks
(40 ns on the WX 3200), so the run calibrates the tick from the GPU clock's own
frame period against wall time and prints it on its second line; `--tick=` pins
it. And it is a model of the engine's graph rather than the engine:
`pipeline.ts` stays the authority, `gpuprof/graph.ts` mirrors it by the binding
names each shader declares (`core/gpu/reflect.ts`), and a binding left
unsupplied throws at construction. Four stock-frame wins came out of its first
afternoon (`OPTIMIZATIONS.md` › _What per-pass timestamps found_), one of them
on a change the batch harness had measured as flat. Live frame rate is still
what the user sees, so confirm a win in Firefox with `perf.mjs` once — and only
once, it takes the screen.

Best-of wall-clock over batched `vf.step()` runs — the methodology that replaced
the `?prof` timestamp profiler, which mis-attributed queue backlog to whichever
pass ran first. Interleave base and patched runs in one sitting and compare the
best, not the median: contention and thermals only ever add time, so the noise
is one-sided.

**The ~0.8 ms bimodality is another GPU client, and best-of is what survives
it.** Cost here reads as two stable modes that land on whole batches, which
looks like something in the app and is not. It was chased through the clocks and
the adapter first, and both are innocent: sampling `pp_dpm_sclk`/`pp_dpm_mclk`
per batch, the WX 3200 pins at its top DPM level (1295 MHz, 27 W) from the first
batch and holds it — 20 batches in one session spread 0.10 ms, six separate
sessions spread 0.08 ms. What reproduces the modes is a **neighbour**: a second
stepped session costs **+3.6 ms**, and one idle app tab left presenting costs
**+0.17 ms**. Note the shape — contention flips whole batches while leaving
`best` alone (`[5.10, 7.38, 8.64, 8.66]` against a solo 5.02), which is exactly
why the median lies and why `perf.mjs` prints every batch. Before trusting any
number, read the per-batch list and check nothing else holds a WebGPU tab open;
this box runs several agents and several dev servers. Two spellings of the same
shader will "differ" by 0.8 ms all day if you let them.

**`--ablate` ranks passes. It does not size them, and its deltas read like the
most precise number on screen.** `crt_face`'s scatter gather was recorded from
one at 0.9 ms and is 0.30; the same pass has come back anywhere from 0.16 to
1.01 ms across identical runs on a quiet box. Contention is only half of why.
The other half is that a delta is a subtraction against a baseline that drifts
within the session, so `min(full) - min(ablated)` loaded all of the baseline's
noise into every row — across three identical runs the _ablated_ numbers held to
~0.03 ms while the deltas swung 0.16–0.42 for one pass, because only `fullBest`
was moving. It now subtracts per round and takes the median, which fixes the
drift term and not the rest: `channel` went from 1.52/1.78/1.74 to 1.77/1.76 run
over run, while small passes still range and get marked SHAKY. A pass cheaper
than the noise can come out negative, which is the honest answer rather than a
bug.

**To size a change, A/B two builds** — one dev server per arm off its own
worktree, whole frames, best-of, interleaved. That held to 0.001 ms over three
rounds on a change (`crt_face`'s bloom tiering, 0.083 ms) that the ablate delta
could not resolve at all.

**Batch throughput is not live frame rate.** The batch number is the GPU
saturated; what a user sees is the rAF loop, which is paced by the display and
carries costs the batch never meets — video decode and upload land there, and on
the dev box (a 47.89 Hz panel on the Intel side of a hybrid pair, with the
signal path on the discrete card) every present crosses PCIe. Two playing clips
cost more live frame rate than the heaviest preset does. Measure live rate with
rAF running via `vf.frameNo()` deltas over multi-second windows, with video
sources attached, before believing a batch number — and note the app's own fps
readout reports loop cadence, which vsync steps down in jumps (48 → 24 on the
dev panel), not a gradual slide.

Where the frame time goes, measured 2026-08-08 (all 66 presets land 3.3–5.4 ms
on the dev box's WX 3200, against a 3.3 ms always-on floor):

- **Dub generations × colour-under** is the big multiplier: `channel` +
  `underDown` cost ~1.4 ms per generation (worn tape runs 3.3 → 6.5 ms from one
  generation to four).
- **The CRT beam spot's** wide tiers (~1.8 ms) on the presets that push
  `crtSpot` past a pixel; at the 0.6 px default the tap table is small and the
  pass costs ~0.2 ms.
- **`crt_face`'s bloom + halation gather** is ~0.30 ms of a 4.90 ms frame (6%),
  measured by deleting both loops outright. Its cost is **linear in tap count at
  ~0.0094 ms/tap and does not care about radius** — dropping eight taps saves
  0.083 ms whether they sit on the 3.5 px bloom disk or the 15 px halo one,
  measured as separate arms and indistinguishable. So there is no locality win
  hiding in this gather and no superlinearity to exploit: tap count is the only
  lever, which is why both spreads now tier it (bloom on strength, the spot on
  radius) rather than restructuring the sampling.
- **`tapePlay` with many heads** (~2 ms on eight-head lap).
- **Per-source feed snow** ~0.9 ms per engaged feed.
- The true-waveform B chain
  (`encodeYuvB → encodeChromaB → encodeCompositeB → mixB`) totals ~0.9 ms
  engaged and dispatches nothing idle.

The keyer, the synth and the strobe (e273959) were measured after the fact, at
920x800 on the same box, best-of interleaved runs. All three are behind uniform
branches, and the branches hold:

- **Idle cost is nil.** The whole feature set against its own parent revision
  (9e0da4c, two dev servers off two worktrees, alternated) lands 4.52 ms both
  sides at stock — no separable difference.
- **The chroma keyer** costs ~0.07 ms engaged (`greenScreen` 4.53 against 4.47
  with `bKey:0`), the `atan2` + `length` per active sample and the extra `mix_b`
  binding together. `keyIntoTheLoop` is the dearest of the six at 4.78 ms, and
  that is its mixer loop, not the key.
- **`synthOver`** costs ~0.01 ms — a full `videoSynth` per pixel, and it does
  not register. **The strobe is free**: a uniform multiply in `decode`, ON and
  OFF both 4.55 ms.
- The six presets that shipped with them run 2.82–4.78 ms (`contourLines` and
  `punchIn` at the bottom are source-A-only, so they never pay for the B chain).

### Proving an approximation is free

```
node scripts/pixdiff.mjs <urlA> <urlB> [frames]
```

Any change that approximates something — fewer taps, a cheaper kernel, a lower
precision path — needs a number for what it costs the picture, not an opinion.
`pixdiff.mjs` runs two dev servers off two worktrees and reports mean and max
channel error plus the tail of the distribution; the tail is the point, because
a thinned kernel fails as banding, which is a few units of error over a wide
area and a peak-error number alone waves it through.

**Establish the floor first** — point both URLs at the same server and confirm
`max 0`. It does reach exactly 0, so a nonzero floor means the protocol drifted
and any A/B beside it is worthless. Two things drift it, and both produce a
stable, convincing, wrong number:

- **Feedback state.** With the loop live each session accumulates a different
  frame count before `loop.stop()`, and a look with memory never forgets the
  difference. On `lightThatStays` (`phosphor: 0.999`) the floor is mean 0.7/255
  with peaks of 212. Add `?set=phosphor:0,phosphorBleed:0` to isolate the pass.
- **Field parity.** The engine is bistable on it, decided by that same coin-flip
  frame count. The tell is a floor that is either exactly 0 or exactly mean
  ~0.6/255 with `max 108` at one fixed pixel, never anything between. The script
  cancels it by grabbing two consecutive frames per arm and taking the better
  alignment.

Two ALU micro-optimizations were implemented, measured dead flat, and reverted
([ADR 0007](adr/0007-the-fir-passes-are-not-alu-bound.md)) — the FIR passes are
not ALU-bound on this hardware, so arithmetic saved there rides idle slots: the
filter bank as a uniform buffer (vec4-packed for the constant cache) and a
Chebyshev recurrence replacing the heterodyne phasor walk in
`under_down`/`channel` (verified pixel-exact first). A one-shot bake of
`crt_face`'s grain field met the same fate earlier. Measure an ablation upper
bound before building any optimization here.

### Building the pipelines is not the startup cost, and async is worse

The `Engine` constructor creates 22 compute pipelines with
`createComputePipeline` — 22 blocking calls, on the main thread, paid again on
every device rebuild. It looks like the obvious thing to hand to
`createComputePipelineAsync` and a `Promise.all`, especially since
`Engine.create` is already async.

Measured on Firefox Nightly before writing any of it, by timing the block in
place and then rebuilding the same 22 from the same sources two more ways in one
page load:

```
PLBUILD n=22 sync=9.0ms syncWarm=2.0ms asyncParallel=396.0ms
```

**9 ms is the entire upper bound**, so the refactor — which means splitting
construction in two, because the constructor consumes the pipelines to build the
pass graph — could not have been worth it whatever the async path did. It is the
ablation the section above asks for, and it took one browser run.

The async number is the more interesting half and wants its caveat stated. 396
ms is not 44× the _work_: that arm ran after boot, against a live render loop,
and 396/22 ≈ 18 ms a pipeline is suspiciously close to one frame — so most of it
is each promise settling a turn of the event loop later while the loop holds the
thread. At startup there is no loop yet, so it would not be that bad. But
`syncWarm` ran under the identical conditions and took 2 ms, so whatever the
async path is waiting for, the synchronous one is not waiting for it. There is
no version of this that wins 9 ms.

Worth re-running if a future browser build changes how
`createComputePipelineAsync` schedules; the scaffold is four lines of
`performance.now()` around the block.

### Chrome

WebGPU in Chrome on Linux needs flags:

```
google-chrome --enable-unsafe-webgpu --enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE
```

On the dev box the engine runs clean under those flags — zero validation errors,
full-speed loop — but the WebGPU canvas never composites: the page shows a black
picture while `frameNo()` advances. Validate functionally instead: read a
texture back over `copyTextureToBuffer` (the app's textures don't carry
`COPY_SRC`, so patch `GPUDevice.prototype.createTexture` at page init to add
it), and treat "spurious texture-allocation error" reports from ANGLE as the
driver artifact `CLAUDE.md` describes. Chrome is also the only browser with
`importExternalTexture`, so the zero-copy video path only runs there —
`?vidbitmap` forces the bitmap path when the two need comparing in one browser.

## MIDI without a controller

```
node scripts/midicheck.mjs [url]
```

Installs a fake Web MIDI device in the page, then drives every kind of binding
from it: a knob on the motion amount, a knob on a preset weight, and a knob on
an ordinary control (which must still take over softly, and show its pickup
mark). Prints one line per assertion and exits non-zero on the first failure.

Point it at a production build if anything else is editing the tree — an HMR
reload mid-run remounts the app and takes the bindings with it:

```
npx vite build --outDir /tmp/mc && npx vite preview --outDir /tmp/mc --port 5233
node scripts/midicheck.mjs http://localhost:5233/
```

The fake device is installed with `page.evaluate` after load, never
`evaluateOnNewDocument`: under Firefox BiDi a preload script runs in a sandbox
realm, and the app then trips over Xray vision reading `.length` off a message
built on the other side of it.

## The strip tray, end to end

```
node scripts/traycheck.mjs [port]
```

Captures three rows off three boards, steps a hold and an arrival chip, plays,
drags a row across the list, and reads the stored rundown back. The walk itself
is unit-tested (`ui/strip.test.ts`) and so is the driver against a fake sink
(`ui/stripRun.test.ts`); this covers the wiring between them, which is where it
can break with every unit test passing.

**One trap it documents rather than works around.** The engine's frame counter
and the strip's own tick are both rAF-driven, and a browser throttles rAF for an
occluded window — which under puppeteer is nearly always. So the hold bar sits
at zero however long the harness waits, and that is the window manager rather
than the app. The check steps the engine by hand (as `shot.mjs` does) and then
forces a React re-read with a click, which is what makes the number meaningful.

Worth knowing about the feature and not only about the harness: when a tab stops
getting frames, the picture and the rundown freeze _together_ and resume
together. That is the right behaviour, and it falls out of clocking the walk on
frames rather than on the wall — a wall-clock strip would come back having
silently skipped four rows nobody saw.

## Does the tray move under the pointer?

```
node scripts/traylayout.mjs [port]
```

The other half of the tray, and a different question from `traycheck.mjs`: not
"does the chip work" but "does using it move anything". A row card is
shrink-to-fit, so every label in it decides layout, and the tray is one
horizontal row of cards — a chip that grows as it steps grows its card and
slides every card to its right, out from under the hand that is still on it.
This seeds a fixture rundown through `localStorage`, steps each of the three
rings all the way round, opens the rename field, and toggles ▶/■, comparing
every control's rectangle against where it started. `docs/EDITOR.md` › _Nothing
in the tray moves because its own text changed_ has the five it found.

**Two things about the fixture, both of which cost a wrong answer once.** Row 0
carries the _default_ drift, not none: `cycleHold` preserves drift, so a row at
drift 0 never draws the `≈` that the widest label in the ring has, and the chip
measured as fixed on the two thirds of the ring its reserve was already wide
enough for. And the reserves are checked against the card's ceiling in the same
run — widening a chip is exactly the move that once pushed the ✕ out past
`overflow: hidden`, where it was invisible and unclickable.

Nothing here waits on a rendered frame, so the rAF trap above does not apply:
every reading is a synchronous layout after a click React has already handled.

## Preroll: is the cut cheaper?

```
node scripts/prerollcheck.mjs [port]
```

Times the same cut twice on the same clip — once cold, once with the clip
prerolled — and checks the promoted one took the parked element rather than
making a new one. Measured 9ms warm against 58ms cold.

**The cold arm has to be genuinely cold**, and it is most of what the file is
careful about: a browser that has already fetched a url serves the second load
out of its HTTP cache, which would make both arms fast and the check
meaningless. Each arm uses its own cache-busting query, so the two are the same
bytes and different cache entries. Anyone re-tuning this should keep that — the
failure it prevents is a check that passes for the wrong reason.

It drives `videoSlot.ts` against a stub slot rather than a real deck, because
what is under test is the two-element swap and a real deck would be timing the
panel too. The path from a rundown to that call is unit-tested either side
(`strip.test.ts` for what a row loads ahead, `stripRun.test.ts` for the ask
reaching the browser).

## The transition shelf

```
node scripts/faultcheck.mjs [port]
```

Runs every entry on the shelf frame by frame under a take, and asserts the four
things the engine claims about one: it breaks the picture, it cuts once inside
its own span, it hands the resting board back untouched, and it **resolves**.

**A fault has exactly one observable, and it is the picture.** The whole design
turns on the board never being touched — applied and undone inside each frame,
so React never sees it and a preset saved mid-transition is the look rather than
the fault — which means "did it run" cannot be read off `getControls()`. So this
samples the canvas, and two traps come with that:

- **Every reading is stated over a measured floor, not against zero**, and the
  floor is the same gap with no fault in it. It reads ~0 today; it read 15-17
  when each entry took its own take, because `rest` was then captured thirty
  frames into a cleared signal path whose phosphor was still filling, so the
  picture brightened on its own and every entry reported the same number
  whatever its fault had done. A harness that asserts against zero is one that
  reports its own warmup.
- **`getImageData` blocks on the GPU**, so it rather than `step()` is what the
  run costs. It samples a 64x48 downscale every third frame; at full resolution
  every frame it was 4.8MB a time and blew the protocol timeout.

It found two dead recipes on its first run, which is the reason it exists: a
transition can be perfectly plumbed, land its cut on the right frame, hand the
board back correctly, and move the picture by 0.4/255. See EDITOR.md › _Landed,
and what it cost_.

## The offline render, and the file it writes

```
node scripts/reccheck.mjs [port]     # the encoder and the muxer
node scripts/clockcheck.mjs [port]   # time counted in frames
node scripts/rendercheck.mjs [port]  # a whole take, twice
```

Three harnesses over the export half of [`EDITOR.md`](EDITOR.md), in the order
the pieces landed. All three want `ffprobe` and `ffmpeg` on the path; the first
and third write an MP4 to a temp dir and read it back with them, because a claim
about a file is worth what a decoder says about it and nothing more.

**`rendercheck.mjs` is the one to run after touching anything in the signal
path.** Its headline check is that two renders of one take come back with the
same SHA-256 — with 25ms of real time injected at every yield of the second, and
the live render loop running in between to dirty the tape ring, the phosphor and
the PLL that the second take then starts from. Nothing else here is as
sensitive: one unseeded `Math.random` in a per-frame modulator, or one buffer
left out of the reset, and it fails. It is the guard
[`adr/0006`](adr/0006-a-take-is-a-seed-and-its-picks.md) names.

**It renders a clip too, and that arm is the newest thing in it.** The harness
spent months explaining that a take over a `<video>` could not be reproducible,
because the pump pulled at wall rate; frame-exact pull removed the reason, and
the last arm loads `public/test.mp4` through the app's own `?vurl` and renders
it twice to the same bytes. Two things about how it is written are worth
copying. It asks the pump whether the deck actually had a decoder on it, because
two renders of a _frozen_ deck are also identical — "the same twice" cannot tell
a working pull from a fallback that never moved. And it runs last, so a failure
in an earlier arm is the render and a failure only in that one is the video
path.

One thing it still deliberately does not claim, and it is a property of the
world rather than a gap: **byte-identity is within one browser build.** The
H.264 encoder is Firefox's, and nothing here asserts across versions of it.

### Frame-exact pull, and the four harnesses that decided it

```
node scripts/pullstep.mjs            # what a stepped <video> costs — a measurement
node scripts/codeccheck.mjs          # what the decoder path costs — a measurement
node scripts/demuxcheck.mjs [file…]  # the sample table, against ffprobe
node scripts/pullcheck.mjs           # the right frames, off the real puller
```

The first two are measurements and are not in `sweep.mjs`; the last two are
checks and are. Read them in that order, because each answers the question the
one before it raised.

**`pullstep` closed the obvious route.** Seeking a `<video>` once per rendered
frame is what everyone reaches for, and the reason it fails is not obvious from
outside: a forward seek of _one frame_ restarts the decode from the previous
keyframe exactly as a seek across the whole clip does. Its `jump` arm is the
control that says so — if stepping were cheaper than jumping, the decoder would
be continuing in place, and it is not.

**`codeccheck` opened the other one**, and re-measures the Firefox constraint
`EDITOR.md` asks to have re-checked rather than trusted. Run it against a new
Nightly before believing anything in that section.

**`demuxcheck` is the outside check on `ui/mp4demux.ts`.** Hand-built fixtures
can be self-consistently wrong; ffprobe cannot be wrong in the same direction.
It is what found that both clips in `public/` carry edit lists, which turned a
"decline these" design into an "apply these" one.

**`pullcheck` is the one that matters**, because the failure mode of a puller is
returning _some_ frame, promptly, forever — and no timing column shows it. Each
fixture frame carries its own index as ten binary cells in the picture, so the
harness reads back which frame it actually got. It has a two-thirds-B-frame arm
as the control on presentation order, and asserts the fixture really has them,
since a control that quietly stopped controlling is worse than none.

Both of the last two want `ffmpeg` and `ffprobe`. `pullcheck` builds its own
fixtures and serves them alongside the app's vite, so it takes no port.

**A backgrounded window makes it slow rather than wrong**, and slow enough to
look broken: `renderTake` yields with `setTimeout(0)`, which a browser clamps to
about a second once the window is not in front, so a 120-frame render takes ten
seconds instead of two and puppeteer's default 30s protocol timeout fires as a
bare `ProtocolError` naming nothing. Hence the 240s `protocolTimeout` in that
file — the run survives being tabbed away from.

## Surviving a lost GPU device

```
node scripts/deviceloss.mjs http://localhost:5199/ [restore|giveup|retry] [outDir]
```

Sleep/wake and driver resets fire `device.lost`, and the session is meant to
rebuild itself rather than land on `FatalScreen` (see **The React layer** in
`ARCHITECTURE.md`). That path can't be unit-tested — it needs a real `GPUDevice`
to lose — so this drives it in the browser, injecting the loss through the
engine's own `onDeviceLost`, which is what the browser calls on a real one. The
device is still alive when the harness calls it, so the replacement really does
have to come up under a predecessor being torn down.

- `restore` — a configured session (a look, a still on A, a still on B, a
  routing in the bay) loses its device twice, then a clip does. Checks the
  controls, the debug tap, B's enable flag and **A's texture dimensions** come
  back — that last one is what catches a still silently reverting to bars, since
  A's texture is sized to its source.
- `giveup` — four losses in a row must stop rebuilding and say so, rather than
  looping behind a picture that dies every second.
- `retry` — stubs `requestAdapter` to fail twice and then work, which is the
  shape of a wake-up where the GPU stack is still coming back; and the case
  where it never returns, which has to end on the fatal screen rather than a
  banner.

The rebuild lands in about 100 ms on the dev box, which is faster than a
puppeteer round trip — so the banner check fires the loss and watches for it
inside a single `page.evaluate`. Sampling it from Node misses it every time and
reads as "the banner never rendered".

## Does it still freeze?

```
npx vite build --outDir /var/tmp/soak-build
npx vite preview --outDir /var/tmp/soak-build --port 5382
node scripts/soak.mjs http://localhost:5382/ [minutes] [out.json]
```

The freeze this project chased is slow and quiet by construction — a queue
growing a few ms a frame, a main thread stalling the completion callbacks the
loop reads liveness from — so it does not show in a six-second shot. It shows
after a while with a video playing, which is why the answer needs a soak rather
than a look. It runs a **production build** (the dev build's per-render logging
is its own failure mode over BiDi at this length, and a build is what a user
runs) on a bundled clip with a deliberately expensive look.

Samples every five seconds, and the readings are chosen so that different
failures cannot look alike:

- `droppedToGate` — rAF callbacks the backpressure gate declined. On a device
  keeping up this is **0**; anything else is the gate acting, and the gate
  acting on a healthy device is the bug fixed in `f4e7db9`.
- `videoSeconds` — accumulated _positive_ `currentTime` deltas, never
  end-minus-start. A looping clip measured over roughly one loop period reads as
  frozen, and three A/B runs were once discarded believing exactly that.
- `lateness` — `setInterval` drift, the same main-thread-blocked proxy the
  handoff used, so a run is comparable against its numbers.
- `everStalled` / `everGaveUp` / `everFatal` / `loopStopped` — the loop's own
  verdicts, which are what the stage banner and `FatalScreen` show.

**Read `onscreenFraction` first.** An occluded window throttles rAF to about 1
Hz, so a run that lost the foreground says nothing about rAF, and the harness
reports that rather than calling it a stall. Below ~0.9, re-run with the window
in front.

A page that stops answering `evaluate` is itself a result: that is what "needs
the tab closed" looks like from Node, and it is recorded as `died` rather than
crashing the run.

## Screening candidate looks

```
node scripts/contact.mjs candidates.mjs [outDir] [url] [--missing|--only=a,b]
```

Renders a batch of `?set=` patches through one browser, scores each (spread,
brightness, saturation, per-frame motion, and whether the loop has collapsed by
frame 800), and writes a contact sheet — `index.html` with a link per tile back
to the live patch, plus paged PNGs. Authoring a preset is a search rather than a
derivation, and this is what makes the search cheap enough to actually run: a
round of twenty guesses costs one command instead of twenty.

Results accumulate in `results.json`, so `--only=spiral core` re-renders one
retuned candidate and the sheet keeps everyone else. The candidates module
default-exports
`{ src, srcb, frames, settle, late, items: [{ name, blurb, set, mod }] }`;
anything at the top level is a default each item may override. `mod` takes the
same `target:source:rateHz:depth` string the app's `?mod=` reads — a shipped
preset may name routings as well as controls, and screening it without them
judges a different look than the one the chip loads.

**It cannot screen an effect that runs on the wall clock.** The harness steps
frames, and `signal/strobe.ts` and `signal/stab.ts` deliberately read
`performance.now()` instead of a frame count, so which point of the cycle a grab
lands on is down to how long the stepping took. `strobedTube` grabbed black on
both checkpoints — a gate open for 30 ms of a 3.5 Hz cycle is dark ~90% of the
time — and read `flat, dark` while working perfectly. The tell that it IS
working is `motion`, which was 58 against a typical 0.4. To actually judge one,
let the rAF loop run and sample the canvas over a few seconds of real time
instead: that recovers the flash rate and the lit fraction, and shows the peak
reaches the same luma as the unstrobed picture. Take the screenshot in the same
rAF callback that detects the lit frame — a `screenshot()` issued after the
check resolves lands tens of milliseconds later, which is well into the decay,
and hands back a dark frame that looks like a finding.

Budget real time: a candidate is a thousand stepped frames of a patch built to
be expensive, so even on an idle machine it runs to minutes, and a full round is
an hour or more. `results.json` is what makes that survivable — a batch that
dies partway through resumes with `--missing` rather than starting over.

## Documentation screenshots

Every figure in [`GETTING-STARTED.md`](GETTING-STARTED.md) and
[`USER-GUIDE.md`](USER-GUIDE.md), plus the two shots behind the README's
signal-path figure, is captured from the running app, so they can't quietly
drift from the UI:

```
pnpm docshots                    # all of them, into docs/img/
pnpm docshots chain look-loop    # just these
pnpm docshots --force            # rewrite even unchanged shots
```

It runs against `localhost:5199` and starts a dev server itself if nothing is
serving there, so a regen is one command from a cold checkout.

Shots are declared in
[`../scripts/docshot-specs.mjs`](../scripts/docshot-specs.mjs) — a URL, the
actions that put the app in the state being documented, and the red callouts
drawn over the result. Callouts and crops resolve against live elements at
capture time, so nothing is a hand-measured pixel offset. Captures run at 2x, as
JPEG — or as PNG when a shot is UI rather than picture, where the text is worth
the bytes (`signal-path`). The runner refuses to save a dead-black frame or one
with the stage's error banner up, and leaves a shot alone when its pixels didn't
change.

The README's signal-path figure is composed rather than captured: `chain` (the
window, map boxed in red) with `signal-path` (the same map, cropped and
readable) inset over the picture, and a wedge drawn between the two so they read
as one thing at two scales. [`../scripts/callout.mjs`](../scripts/callout.mjs)
is the whole recipe — one ImageMagick pipeline — and `pnpm docshots` runs it
after retaking either source so the figure can't outlive them:

```
pnpm callout                     # recompose docs/img/signal-path-callout.jpg
```

It finds the red box by its color rather than by a measured rect, so the inset
and the wedge follow the box wherever the panel moves it.

**The bar for adding a figure is high, and it used to be lower.** There were
twelve UI shots, each a full window with a red box round a 300px strip (the
`boxed` helper), and stacked down a page they were 15,000 pixels of screenshot
saying what the prose already said. Three remain, and each carries something a
sentence cannot: `overview` names five regions at once, `chain` shows a map you
would not guess the shape of, and `slider-help` is the guide's own argument for
why there is no per-control reference in it. A new figure has to clear that bar,
and a tight crop of the panel region is the shape to reach for rather than
another boxed window.

A spec with `video` records the canvas to mp4 instead, with a poster still
beside it. Clips are too big to commit, so they go to a gitignored `clips/` and
are hosted on S3:

```
pnpm docshots --upload clip-feedback   # aws --profile colin
```

Each run also writes `docs/img/shots.json` — the app's own address bar at the
moment of each capture, as a URL against the hosted build. That is what puts the
"open this in the app" link under every figure on the docs site, and it is read
back from the live session rather than rebuilt from the spec, so it holds even
for a shot whose look the app rolled itself.

The `look-*` gallery shots are one named mechanism each, started from the preset
that names it and pushed well past where that preset stops — past the point the
picture survives it. A tile that reads as a photo with an effect on it
undersells the thing; what a tile has to have is structure the chain made, not a
subject that came through. The three failure modes are full white, full black
and undifferentiated hash, and every patch here sits one control away from all
three, so a change wants looking at rather than assuming. (The `loop` patch
reached each of them while it was being tuned.)

A look pushed further by hand in the app can be captured back out of it:

```
pnpm docshots --freeze look-loop   # capture, then record the look it landed on
```

`--freeze` writes what the address bar said into `scripts/docshot-frozen.json`,
and that entry then wins over the spec's own params. Delete it to go back to the
spec.

Needs Firefox Nightly, ImageMagick, ffmpeg (clips) and pngquant (optional).

## Docs site

`pnpm guide` (also run by `pnpm build`) renders the reader-facing markdown into
`dist/guide/`, which Pages serves at `/ntsc.js/guide/`. Markdown stays the
source of truth and stays readable on GitHub; the builder only adds the nav, the
live links, and styling. To add a page, add it to `PAGES` in
[`../scripts/build-guide.mjs`](../scripts/build-guide.mjs).

Everything else the site chrome shows is **derived from the markdown, never
authored twice** — so a heading, a page or a first paragraph is edited in one
place and the site follows:

- the **"on this page" nav**, from the h2/h3 outline the heading rule collects
  into `env.headings`. Pages with fewer than five sections don't get one.
- the **previous/next pager**, from the order of `PAGES`.
- the **meta description and `og:` tags**, from each page's first paragraph, cut
  at a sentence.

The site has one theme and it is dark, so the builder also collapses each
diagram's `<picture>` down to the dark SVG. Left alone, `prefers-color-scheme`
would hand a light-mode visitor pale pastel diagrams on a near-black page.

Two things the CSS can't reach are done by a small inline script: opening the
section nav only at the width where it is a sidebar rather than a disclosure,
and marking the section being read. Both are enhancements — with the script gone
the nav is a closed `<details>` and everything still works.

### Checking the layout

`pnpm guide:check` builds the site, then loads every page at 1352px and at 390px
and fails on anything wider than the viewport that isn't a deliberate scroll
container ([`../scripts/guidecheck.mjs`](../scripts/guidecheck.mjs)). It leaves
screenshots in `/tmp/guidecheck` — the fastest way to see all twelve renders at
once.

The phone arm is the one that earns its keep. The desktop layout has slack in
it; 390px does not, and both faults the redesign fixed were invisible on a
laptop: a nav row that wrapped three deep and stuck there, and a two-column
table crushed to two words a line.

## YouTube source (dev server only)

The **YouTube…** source fetches `/yt?url=…`, a Vite middleware
([`vite-plugin-ytdlp.ts`](../vite-plugin-ytdlp.ts)) that shells out to `yt-dlp`
and serves the clip back as an mp4. It's `apply: 'serve'`, so it exists under
`pnpm dev` only — the deployed build has no server to shell out from, and the
option does nothing there.

Setup is just the binaries on `PATH`:

```
yt-dlp --version    # pipx install yt-dlp, or your package manager
ffmpeg -version     # only needed when no single-file mp4 exists at 720p
```

Clips are capped at 720p (the chain downscales to 480 lines anyway) and cached
in `$TMPDIR/ntsc.js-yt` keyed by URL, so a reload replays instantly. The first
load takes as long as the download; failures come back as the yt-dlp error.

## The public archives (the one live dependency)

Two sources are fetched from somebody else's server at pick time: **Random
Commons** searches `commons.wikimedia.org/w/api.php` and **Random archive.org**
searches `archive.org/advancedsearch.php`, both anonymously — no proxy and no
dev middleware, so unlike YouTube above these work in the deployed build.
**Browse…** is the same two APIs asked a different question: ranked rather than
random, so an arbitrary phrase is worth typing.

The layering is worth knowing before changing any of it:

- `src/sources/pool.ts` — what the two have in common. `PoolPick` is the one
  type both roll, and the two real differences ride on it as fields (`owned` for
  the archive.org blob, `kind` for Commons stills). `OnProgress` reaches
  archive.org only: a Commons transcode streams into the element, so there is no
  wait to report on. archive.ts also holds what it has downloaded, in two tiers
  over the network — 96 MB in memory, least-recently-played out, over 256 MB in
  a Cache API store, least-recently-downloaded out. Measured per read: memory
  0ms, disk 1ms to match then ~2.8ms/MB to materialise (27ms at 3 MB, 176ms at
  64), network 3-20s. Keyed by the file url and not the identifier, since a roll
  and a shelf entry read one item under different byte caps and can land on
  different renditions of it. The tiers hold Blobs rather than object urls
  precisely so that `releasePick` revoking one costs them nothing.

  Nothing there is load-bearing: no `caches`, a private window, a full quota or
  a corrupt entry all fall through to the tier below and end at a download. The
  disk budget is deliberately a slice rather than the lot, because the origin
  quota was measured at 1.6 GB here and is shared with the file stash, which
  copies the user's own clip into OPFS — their footage outranks a
  re-downloadable advert, so `toDisk` applies the same headroom test `fits`
  does. Bump `DISK_CACHE` when what is stored changes shape.

- `src/sources/commons.ts`, `archive.ts` — one flat list of tested query pools
  each, plus the readers that vet a response. Neither knows the other exists.
- `src/sources/pools.ts` — the front door. Everything above the sources imports
  from here and never from the two modules under it, which is what keeps the
  engine to one roll, one resolve and one state slot per deck.
- `src/ui/clipLibrary.ts` — the shelf, which holds a kept roll as a title beside
  your own files. There is no separate favourites store; a kept roll is the easy
  case of a clip, with no handle, no grant and no re-link.

`commons.test.ts` and `archive.test.ts` pin the readers against response shapes
that were real once, which is exactly what they cannot keep being — so the live
contract has its own harness:

```
node scripts/poolcheck.mjs http://localhost:5199
```

Seventeen checks over one browser session and a handful of live requests: a
random source rolls and captions what it rolled, the ★ puts it on the clip shelf
as a title, the shelf plays it back, the browser answers with thumbnails from
both archives, and — the one thing no screenshot shows — a roll that lands after
the user has moved that deck on is dropped rather than pushed onto whatever they
went to. It exits non-zero with a line per failure, so it can be run as a gate.

Run it when touching either source module, or when a pick starts coming back
empty. Four things it watches are outside this project entirely and invisible to
the test suite: Commons changing its mind about `descriptionurl` or
`gsrsort=random`, its transcode ladder being rebuilt, archive.org's
`sort[]=random` ceasing to be stably seeded (which is what `PAGE_SPAN` exists
for), and `archive.org/services/img/` going away — that last one is what lets
the browser show a clip without downloading it, and its loss would turn the grid
into a page of empty boxes with nothing else complaining.

**Why archive.org picks are downloaded whole rather than streamed.** Measured
2026-08-08/09, curl and then Firefox Nightly against the real upload path.
`/metadata/` and `advancedsearch.php` both send
`access-control-allow-origin: *`, but `/download/` and `/serve/` 302 to a
`dn######.us.archive.org` storage node that sends no `access-control-*` header
at all — so with `crossOrigin='anonymous'`, which `ui/videoSlot.ts` sets
unconditionally, the element does not merely taint, it **refuses to load**
(`MEDIA_ERR_SRC_NOT_SUPPORTED`). `/cors/<id>/<file>` is the route that works:
200, ACAO echoing the Origin, no redirect off-host, no size cap.

The catch is that **`/cors/` ignores `Range`** — it answers `bytes=0-1000` with
200 and the whole file, and sends no `accept-ranges`. So `video.seekable` only
ever covers what has downloaded, Firefox caps readahead at ~64 s, and a far seek
is **silently clamped**: no error, no `seeking` event, playback just carries on.
On a 628 s clip, `seekable [[0, 4.3]]` and `currentTime = 502.4` read back as
`4.3`; a Commons transcode under the same test gives `seekable [[0, 596.5]]` and
lands exactly. That breaks cue in/out loops (`gpu/videopump.ts`) and scrub
(`ui/useEngine.ts`), not playback — which is why it is easy to miss. Fetching to
a Blob and handing over an object URL fixes it: same-origin, so fully seekable
_and_ untainted (`seekable [[0, 628]]`, a 502.4 s seek landing in 50 ms). The
cost is the whole file up front at ~5 MB/s, which is what the size cap is for.

Two more archive.org failures that look like nothing:

- **Theora is gone from browsers, and it is usually the smallest file in the
  ladder**, so any "prefer small" rule reaches straight for it. Firefox Nightly
  `canPlayType('video/ogg')` is now `''`, and the element does not error — it
  fires `loadeddata` and reports `videoWidth`/`videoHeight` of **0**.
- **`archive.org/metadata/<id>` intermittently takes 33 s** and then returns no
  `files` at all (2 of 3 Prelinger reads hit one). Without a per-request
  deadline these stack and a roll looks like a hang.

**Picking a rendition:** `h.264 IA` (the newer `.ia.mp4`) is the derivative most
items carry and is usually the small one — 3 MB against an 89 MB master of the
same commercial. Filtering on `h.264` alone, the obvious guess, matched 1 item
in 5; adding `h.264 IA` took the same pools to 3–4 in 5. Every numeric field
arrives as a _string_ and `length` is sometimes a timestamp (`"1:04:12"`), so
`Number()` gives NaN.

**Pool yields, both sources, measured by rolling the live APIs.** archive.org,
usable items per random sample at a 24 MB cap: `vhsopenings` 7/11,
`vhscommercials` 7/11, `classic_tv_commercials` 9/13 — all 15–30 s idents, logos
and ads. `prelinger` needs a 64 MB cap to reach its h.264 reels (48–57 MB) and
still lands only ~3/11. Empty or useless: `vhskids`, `vhsmovies`, `machinima`,
`computerchronicles` (whole tapes and 28-minute episodes), `educationalfilms`
(2/11 at _any_ cap), and free-text `collection:vhsvault` searches for
mall/muzak/test-pattern/infomercial.

Commons, counting pages whose `videoinfo.derivatives` hold a `transcodekey`:
`deepcat:"Time-lapse videos"`, `"Videos of fountains"`, `"Videos of clouds"`,
`"Videos of fire"` and `"Videos of trains"` all 12/12, `"Videos of animals"`
11/12, `"Underwater videos"` 9/12. **`"Videos of cities at night"`,
`"Videos of waves"` and `"Videos of aurorae"` return zero pages** — don't add
them back; their absence is why the video channels carry none of the neon the
photo channels lean on. Video pools being this much thinner than photo pools is
the whole argument for archive.org as the video source. The Commons API 429s
after roughly ten quick probes, so space out any further survey.

Two fields the browser leans on are optional, and neither failing would look
like a failure. Commons returns a clip's `duration` alongside the thumbnail for
free; archive.org's search returns `runtime` on roughly one item in three, and
the grid says `clip` rather than a length for the rest. What that search will
_not_ honestly tell you is how big a pick is: `item_size` counts every file in
the item and was measured between 1.0x and 2176x the rendition a roll would
actually download, so the size comes from the metadata read at pick time instead
— see the note over `browseArchive`.

## URL parameters

A link specifies a look — **copy link** in the app writes one.

| Param                | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| `?preset=`           | load a built-in preset by name                        |
| `?set=key:value,…`   | override individual controls                          |
| `?mod=t:src:hz:d,…`  | modulation routings (target, source, rate, depth)     |
| `?iurl=` / `?iurlb=` | image source A / B                                    |
| `?vurl=`             | video source                                          |
| `?src=` / `?srcb=`   | source kind for A / B (a `wiki-*` channel rolls)      |
| `?dbg=1..6`          | signal taps (composite, luma, chroma, burst, scope)   |
| `?surprise`          | roll a random preset stack on load                    |
| `?gpu=low-power`     | run on the integrated GPU instead of the discrete one |
| `?vidbitmap`         | force the bitmap video path where zero-copy exists    |

Example: `?iurl=/sample.jpg&preset=dirty%20mix`

`?gpu=low-power` is the exception to "a link specifies a look" — it changes
nothing about the picture, only which chip draws it. The app asks for the
discrete GPU because the integrated one a hybrid laptop hands out by default
measured 3x the frame time (9.34 vs 3.38 ms on the dev box). Two reasons to
override it: Firefox keeps a GPU awake for as long as a device is open on it, so
the discrete card never autosuspends while the app is up and a battery session
pays for that; and when something looks driver-shaped, "does it still happen on
the other GPU" wants answering without a rebuild.

## Further reading

- [`handoffs/`](handoffs/) — why a past piece of work landed the way it did, and
  what was deliberately left undone
- [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) — the code: one array and a chain of GPU
  shaders
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — pass graph, buffer layouts, adding a
  control end to end
- [`OPTIMIZATIONS.md`](OPTIMIZATIONS.md) — what the measurements below decided:
  the gating, tiling, tiering and packing the frame budget is made of
- [`FEATURES.md`](FEATURES.md) — the map of what it can break, stage by stage.
  Hand-written apart from the feedback-loop block, which `scripts/docgen.mjs`
  fills from `LOOP_STAGES`, so the tour and the chain map cannot disagree
- [`EFFECTS.md`](EFFECTS.md) — every control, **generated** by
  `scripts/docgen.mjs`. Edit `src/ui/controls.ts`, not the page, then run
  `pnpm docgen`. `pnpm build` runs `--check` and fails on a stale copy, so CI
  catches a forgotten regeneration; a pre-commit hook cannot, because
  lint-staged only stages the files its own patterns matched
- [`EDITOR.md`](EDITOR.md) — the strip, glitch transitions, and the export an
  editor can conform: design for work not yet built
- [`adr/`](adr/) — the decisions where the obvious thing is wrong for a
  non-obvious reason
