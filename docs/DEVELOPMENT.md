# Development

```
pnpm install
pnpm dev        # vite dev server on :5199
pnpm build      # tsc -b + vite build
pnpm lint --fix # oxlint
pnpm test       # vitest
```

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
node scripts/shot.mjs http://localhost:5199/ out.png [waitMs]
```

Drives a headed Firefox Nightly, steps frames deterministically, probes pixels,
and saves a screenshot. Headless Chrome can't present WebGPU swap chains here,
which is why it's Firefox.

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

## Measuring performance

```
node scripts/perf.mjs <url> <label> [batches] [framesPerBatch]
node scripts/perf.mjs <url> <label> --ablate   # per-pass cost attribution
```

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

Two ALU micro-optimizations were implemented, measured dead flat, and reverted —
the FIR passes are not ALU-bound on this hardware, so arithmetic saved there
rides idle slots: the filter bank as a uniform buffer (vec4-packed for the
constant cache) and a Chebyshev recurrence replacing the heterodyne phasor walk
in `under_down`/`channel` (verified pixel-exact first). A one-shot bake of
`crt_face`'s grain field met the same fate earlier. Measure an ablation upper
bound before building any optimization here.

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

Every figure in [`USER-GUIDE.md`](USER-GUIDE.md) is captured from the running
app, so the guide can't quietly drift from the UI:

```
pnpm docshots                 # all of them, into docs/img/
pnpm docshots presets filter  # just these
pnpm docshots --force         # rewrite even unchanged shots
```

It runs against `localhost:5199` and starts a dev server itself if nothing is
serving there, so a regen is one command from a cold checkout.

Shots are declared in
[`../scripts/docshot-specs.mjs`](../scripts/docshot-specs.mjs) — a URL, the
actions that put the app in the state being documented, and the red callouts
drawn over the result. Callouts and crops resolve against live elements at
capture time, so nothing is a hand-measured pixel offset. A UI figure is the
whole window with a red box round the part being described (the `boxed` helper),
not a crop of that part: a cropped panel section loses where it sits and what it
is doing to the picture. Captures run at 2x, as JPEG. The runner refuses to save
a dead-black frame or one with the stage's error banner up, and leaves a shot
alone when its pixels didn't change.

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
that names it and pushed past where that preset stops. Pushing further is mostly
how you lose them — a subcarrier detuned far enough decodes to grey, a feedback
loop left running long enough eats the picture — so each one sits just short of
its own cliff, and a change wants looking at rather than assuming.

A look pushed further by hand in the app can be captured back out of it:

```
pnpm docshots --freeze look-tunnel   # capture, then record the look it landed on
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

The site has one theme and it is dark, so the builder also collapses each
diagram's `<picture>` down to the dark SVG. Left alone, `prefers-color-scheme`
would hand a light-mode visitor pale pastel diagrams on a near-black page.

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
  wait to report on. archive.ts also holds what it has
  downloaded, in two tiers over the network — 96 MB in memory,
  least-recently-played out, over 256 MB in a Cache API store,
  least-recently-downloaded out. Measured per read: memory 0ms, disk 1ms to
  match then ~2.8ms/MB to materialise (27ms at 3 MB, 176ms at 64), network
  3-20s. Keyed by the file url and not the identifier, since a roll and a shelf
  entry read one item under different byte caps and can land on different
  renditions of it. The tiers hold Blobs rather than object urls precisely so
  that `releasePick` revoking one costs them nothing.

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

Two fields the browser leans on are optional, and neither failing would look
like a failure. Commons returns a clip's `duration` alongside the thumbnail for
free; archive.org's search returns `runtime` on roughly one item in three, and
the grid says `clip` rather than a length for the rest. What that search will
*not* honestly tell you is how big a pick is: `item_size` counts every file in
the item and was measured between 1.0x and 2176x the rendition a roll would
actually download, so the size comes from the metadata read at pick time
instead — see the note over `browseArchive`.

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
- [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) — the signal path, pass by pass
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — pass graph, buffer layouts, adding a
  control end to end
- [`EFFECTS.md`](EFFECTS.md) — every effect and the fault it models
