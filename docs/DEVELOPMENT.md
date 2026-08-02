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
arrays in `pipeline.ts` — `docs/pipeline.dot` for which passes exist and which
are gated (from each node's `passes="…"` attribute and its dashed border), and
the "Pass order" block in `ARCHITECTURE.md` for the order and the brackets too.
A pass added, reordered or ungated without updating them fails the suite. CI
gates deploy on `pnpm lint` + `pnpm test`.

`pnpm run docs` regenerates every diagram in `docs/*.dot` into light and dark
SVGs (needs Graphviz `dot` on PATH). The `.dot` sources hold `@TOKEN@` colour
placeholders rather than hex, so one graph definition produces both themes —
edit the palette in `scripts/diagrams.mjs`, never the SVGs.
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
actions that put the app in the state being documented, optional red callouts,
and what to crop to. Crops and callouts resolve against live elements at capture
time, so nothing is a hand-measured pixel offset. Captures run at 2x; UI crops
land as pngquant'd PNGs and picture-heavy frames as JPEG. The runner refuses to
save a dead-black frame or one with the stage's error banner up, and leaves a
shot alone when its pixels didn't change.

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

The gallery shots do exactly that: they load `?surprise`, which rolls a random
preset stack the way the button does. A roll worth keeping gets pinned:

```
pnpm docshots --freeze look-roll-3   # capture, then record the look it landed on
```

`--freeze` writes the resulting params into `scripts/docshot-frozen.json`, and
that shot stops rolling — same picture every regen. Delete its entry to let it
roll again.

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
| `?iurl=` / `?iurlb=` | image source A / B                           |
| `?vurl=`             | video source                                 |
| `?src=` / `?srcb=`   | source kind for A / B                        |
| `?dbg=1..5`          | scope views (composite, luma, chroma, burst) |
| `?surprise`          | roll a random preset stack on load           |
| `?prof`              | per-pass GPU timings                         |

Example: `?iurl=/sample.jpg&preset=dirty%20mix`

## Further reading

- [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) — the signal path, pass by pass
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — pass graph, buffer layouts, adding a
  control end to end
- [`EFFECTS.md`](EFFECTS.md) — every effect and the fault it models
