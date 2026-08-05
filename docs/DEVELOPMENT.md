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
arrays in `pipeline.ts` — `docs/graphviz/pipeline.dot` for which passes exist and which
are gated (from each node's `passes="…"` attribute and its dashed border), and
the "Pass order" block in `ARCHITECTURE.md` for the order and the brackets too.
A pass added, reordered or ungated without updating them fails the suite. CI
gates deploy on `pnpm lint` + `pnpm test`.

`pnpm run docs` regenerates every diagram in `docs/graphviz/*.dot` into light
and dark SVGs under `docs/img/` (needs Graphviz `dot` on PATH). The `.dot`
sources hold `@TOKEN@` colour placeholders rather than hex, so one graph
definition produces both themes — edit the palette in `scripts/diagrams.mjs`,
never the SVGs.
`pnpm run docs:check` fails if a committed SVG no longer matches its `.dot` — it
compares bytes, so it is a local check, not a CI gate (a different Graphviz
build emits different SVG).

## Verification harness

```
node scripts/shot.mjs http://localhost:5199/ out.png [waitMs]
```

Drives a headed Firefox Nightly, steps frames deterministically, probes pixels,
and saves a screenshot. Headless Chrome can't present WebGPU swap chains here,
which is why it's Firefox.

### What every browser harness here has learned the hard way

Every script below shares one browser story, and each of these cost real time
to find:

- **Never `page.setViewport` after load under Firefox BiDi.** It swaps the realm,
  and every later `evaluate` sees `window.vf` as undefined — which reads exactly
  like the app failing to boot. Set the viewport before `goto`.
- **One Firefox does not survive a long WebGPU batch.** After a dozen or so
  sessions it detaches the frame and every later page dies with "Target closed",
  so a batch recycles browsers and treats any failure as the browser being spent.
- **An occluded window throttles rAF to about 1Hz.** Frames are stepped
  (`window.vf.step()`) rather than waited for; a clip, which samples the canvas
  as it paints, has to own the only window on screen.
- **Serve from a `git worktree add --detach` copy** (or a production build) when
  anything else might be editing the tree. An HMR reload mid-run resets the
  engine under the frame counter, and a shot then captures someone else's
  half-finished change.
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
- **Don't forward every page console message.** React's dev build logs a line per
  component per render, and shipping all of them back over BiDi is enough to stall
  a harness mid-run — it hangs on an `evaluate` that never returns, which reads as
  the app deadlocking rather than the transport drowning. Filter to warnings,
  errors, and the lines the harness is actually looking for.

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

- `restore` — a configured session (a look, a still on A, a still on B, a routing
  in the bay) loses its device twice, then a clip does. Checks the controls, the
  debug tap, B's enable flag and **A's texture dimensions** come back — that last
  one is what catches a still silently reverting to bars, since A's texture is
  sized to its source.
- `giveup` — four losses in a row must stop rebuilding and say so, rather than
  looping behind a picture that dies every second.
- `retry` — stubs `requestAdapter` to fail twice and then work, which is the
  shape of a wake-up where the GPU stack is still coming back; and the case where
  it never returns, which has to end on the fatal screen rather than a banner.

The rebuild lands in about 100 ms on the dev box, which is faster than a
puppeteer round trip — so the banner check fires the loss and watches for it
inside a single `page.evaluate`. Sampling it from Node misses it every time and
reads as "the banner never rendered".

## The engine in a worker

```
npx vite --port 5361 --strictPort
node scripts/workercheck.mjs [url]
```

`src/gpu/engine.worker.ts` runs the whole signal path in a worker, presenting to
an `OffscreenCanvas` and driven by the worker's own `requestAnimationFrame`.
That is worth having because the loop stops queueing behind React, video
staging and layout: measured on Firefox Nightly under a main-thread load of
20 ms every 50 ms, a worker-owned loop held 60 fps with no frame gap over 33 ms,
against 42.6 fps, a p99 gap of 90 ms and stalls past 100 ms for the same engine
on the main thread.

The page keeps what a worker cannot have — the `<video>` elements (`VideoPump`),
the `AudioContext`, the DOM — and sends bitmaps and scalars over
`workerproto.ts`. Anything carrying pixels is *transferred*, never cloned; the
harness asserts that by checking the sent bitmaps are neutered afterwards.

- **This one needs the dev server**, not a production build: it loads the worker
  from source (`/src/gpu/engine.worker.ts`) so that testing it costs no second
  html entry point. Serve from a `git worktree add --detach` copy if anything
  else might be editing the tree.
- **Reading a worker-owned canvas back from the page lags what the worker has
  already presented.** The same frame read twice in a row gave `0,0,0` and then
  the real pixel — stepping the engine is not enough, the compositor has to have
  picked the frame up. The harness polls until the picture is what it should be
  rather than sampling once, and hands back the last thing it saw on a timeout so
  a real failure still fails.

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
default-exports `{ src, srcb, frames, settle, late, items: [{ name, blurb, set
}] }`; anything at the top level is a default each item may override.

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

## URL parameters

A link specifies a look — **copy link** in the app writes one.

| Param                | Meaning                                      |
| -------------------- | -------------------------------------------- |
| `?preset=`           | load a built-in preset by name               |
| `?set=key:value,…`   | override individual controls                 |
| `?mod=t:src:hz:d,…`  | modulation routings (target, source, rate, depth) |
| `?iurl=` / `?iurlb=` | image source A / B                           |
| `?vurl=`             | video source                                 |
| `?src=` / `?srcb=`   | source kind for A / B                        |
| `?dbg=1..5`          | scope views (composite, luma, chroma, burst) |
| `?surprise`          | roll a random preset stack on load           |
| `?gpu=low-power`     | run on the integrated GPU instead of the discrete one |

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

- [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) — the signal path, pass by pass
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — pass graph, buffer layouts, adding a
  control end to end
- [`EFFECTS.md`](EFFECTS.md) — every effect and the fault it models
