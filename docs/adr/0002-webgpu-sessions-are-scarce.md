# 0002 — Treat per-tab WebGPU sessions as a scarce budget

**Status:** accepted, 2026-08-07.

## Context

**A tab is worth about two WebGPU sessions.** The third `GPUDevice` created in
one tab loads fine, reports no error, renders nothing, and
`requestAnimationFrame` is never called for that tab again. Sometimes it is the
second. The tab still reports `visible`, the browser stays responsive, and
reloading lands in the same hole — only a new tab clears it.

Measured on Firefox Nightly 151 / Linux, `scripts/rafceiling.mjs`:

```
app     session 1:  72 rAF/1.5s  vis=visible
app     session 2:   0 rAF/1.5s  vis=visible   *** rAF STOPPED ***
app     session 3:   0 rAF/1.5s  vis=visible   *** rAF STOPPED ***
```

The control is what makes this a finding rather than a shrug. A static page
whose entire content is a `requestAnimationFrame` counter, reloaded in the same
tab of the same browser at the same cadence, took **21 reloads without dropping
a frame**. So this is not "reloading quickly is bad", not tab throttling, and
not a harness losing its window. Only the tab that has held a `GPUDevice` a few
times dies.

Two more properties, both of which kill an obvious workaround:

- **It is a count, not a rate.** 30 s between loads fails at the same session as
  7 s. Debouncing or spacing device creation buys nothing.
- **The route does not matter.** 28 vite hot updates in one page and 28 full
  reloads of one page both do it, at the same place. So disabling HMR in favour
  of full refreshes — the intuitive fix — was measured and is worthless.

This is the freeze the app has been chasing: it is the `frame 0` / `STEP-DEAD` /
`clock +0ms` signature in the recorder, and it explains the recordings exactly.
Of five real sessions in the trace ring, the two that ended in `coldStall` are
the two that restarted the engine 15 and 16 times; the three that did not are
the three that started it once.

A page cannot legally stop its own tab's rendering step, so this is a browser
bug and there is no app-side cure. `jbrowse-components` has independently met
the same shape in the WebGL2 path — _"Firefox caps active WebGL contexts around
16 and Chrome around 8"_, tracked at module scope in
`packages/render-core/src/hal/webgl2Hal.ts` — which is some comfort that per-tab
graphics resources being capped, and the cap being worth counting, is not a
local delusion.

## Decision

Treat the count as a budget the app spends and can therefore report on.

- `TAB_GPU_CEILING` and `gpuSessions()` in `gpu/context.ts`. The count lives in
  `sessionStorage` — per tab, surviving this tab's reloads, not shared with
  another tab — because that is exactly the lifetime of the thing being counted.
  It is incremented at the single `requestDevice()` call site, so it cannot
  drift from what it counts, and a console warning goes out on the way _past_
  the ceiling rather than after the picture has already stopped.
- The loop reports **which** freeze it is. `RenderLoop.onFrozen` carries
  `FrozenKind`: `stalled` (rAF was arriving and stopped — may clear, a reload is
  reasonable) or `cold` (never one animation frame since load — the fault
  belongs to the tab, a reload cannot clear it). The loop always knew this via
  `everRaf`; it just had no way to say it.
- Both surfaces that can still be seen say the right thing. The tab title —
  browser chrome, drawn by the parent process, so it survives a document that is
  not being painted — reads `⛔ new tab needed` rather than `⏸ frozen`, and the
  on-canvas notice offers "open this URL in a new tab" instead of "close the tab
  and open it again".
- **No `<StrictMode>`** (`src/main.tsx`, which carries the reason). It
  double-invokes effects in development, so it would cost two devices per page
  load and spend the whole budget on the first one.

## Consequences

- **Do not add StrictMode without moving device creation out of the mount effect
  first.** The comment in `main.tsx` is load-bearing, not decoration.
- **Every new `Engine.create` call site spends real budget.** There are two
  today — boot and rebuild. A third should have to argue for itself.
- The rebuild limit in [0001](0001-hang-rebuilds-not-ends.md) now sits against a
  measured ceiling and is arguably too high. Left alone for now because a
  rebuild still restores the picture even on a tab whose rAF is dead — the
  fallback pump carries it — but the interaction is real and was not known when
  the number was chosen.
- The app degrades rather than dying, and that is deliberate: the fallback pump
  bridges the dead rendering step so the picture keeps moving at ~10 fps instead
  of going black, and `coldStall` tells the truth about why. What this decision
  buys is not a fix — it is the difference between advice that works and advice
  that cannot.
- **The obvious optimisation is available and not taken.** A module-level device
  behind a promise that serialises concurrent asks — as
  `packages/render-core/src/gpuDevice.ts` in `jbrowse-components` does — would
  hold the count at one for the life of the tab regardless of how many engines
  come and go. It is the right shape and a large refactor: the engine owns its
  device today, and a rebuild's whole purpose is replacing it. Worth doing if
  this bites harder, and worth knowing the option exists before inventing a
  worse one.

## Reproducing it

```
pnpm dev
node scripts/rafceiling.mjs --page=app        # dies at session 2 or 3
node scripts/rafceiling.mjs --page=control    # 21 reloads, never drops one
```

The script serves its own control page, so it needs nothing from this repo but a
dev server to point the app arm at — written that way so it can be handed
upstream as-is. Worth re-running against release Firefox and against Chrome: if
the ceiling is Nightly-only, most of this matters much less to anyone but the
dev box.
