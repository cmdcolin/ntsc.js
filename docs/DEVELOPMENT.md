# Development

```
pnpm install
pnpm dev        # vite dev server on :5199
pnpm build      # tsc -b + vite build
pnpm lint --fix # oxlint
pnpm test       # vitest
```

`pnpm test` runs the FIR design unit tests (DC gain, passband/stopband response,
linear-phase symmetry, filter-bank packing). CI gates deploy on `pnpm lint` +
`pnpm test`.

`pnpm run docs` regenerates the pipeline diagrams (needs Graphviz `dot` on
PATH).

## Verification harness

```
node scripts/shot.mjs http://localhost:5199/ out.png [waitMs]
```

Drives a headed Firefox Nightly, steps frames deterministically, probes pixels,
and saves a screenshot. Headless Chrome can't present WebGPU swap chains here,
which is why it's Firefox.

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
in `$TMPDIR/ntscythe-yt` keyed by URL, so a reload replays instantly. The first
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
| `?prof`              | per-pass GPU timings                         |

Example: `?iurl=/sample.jpg&preset=dirty%20mix`

## Further reading

- [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) — the signal path, pass by pass
- [`../agent-docs/ARCHITECTURE.md`](../agent-docs/ARCHITECTURE.md) — pass graph,
  buffer layouts, adding a control end to end
- [`../EFFECTS.md`](../EFFECTS.md) — every effect and the fault it models
