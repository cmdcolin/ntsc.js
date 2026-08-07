# 0001 — A GPU hang rebuilds the device instead of ending the session

**Status:** accepted, 2026-08-07.

## Context

The render loop can tell that submitted work has stopped completing — it races
`onSubmittedWorkDone()` against a deadline and scores strikes — but it cannot
tell _why_. Two causes reach the same symptom and want opposite handling:

- The GPU process is wedged. It is shared across tabs and outlives this page, so
  a fresh device lands on the same broken one and the session really is over.
- The device is merely stale — a driver reset, a compositor taking it back,
  anything that leaves a `GPUDevice` that no longer works. A replacement works
  fine.

The original `onHang` assumed the first and went straight to a fatal "close this
browser tab" screen. That reasoning was never tested, and it is unfalsifiable
from where it sits: having refused to try a replacement, the code could never
discover that a replacement would have worked.

The distinguishing evidence is available, just not at the moment of the fault.
It is whether a device ever completed _any_ work: a replacement born onto a
wedged process never does, while a device that ran for minutes and then stopped
obviously did.

## Decision

A hang takes the same path a device loss does — destroy, build a fresh device,
hand back the controls, the sources and the audio graph.

The fatal screen is reached only after `RebuildPolicy` has spent its
replacements on devices that **never completed any work**
(`RenderLoop.confirmedWork`). A device that worked and then stopped is a one-off
however many times it recurs, because each rebuild demonstrably fixed it; only a
run of never-alive devices is evidence the fault is behind them.

Hangs and losses hold separate counts, so neither spends the other's budget.

Because a false positive now costs one rebuild rather than the session, the
device is also probed on every lifecycle transition (`kick`) rather than only on
the watchdog's beat.

## Consequences

- A rebuild costs everything VRAM was holding — phosphor trails, the frame
  store, the tape loop all start over. A long feedback build-up does not survive
  one. That is the price of not ending the session, and it is the right trade
  only because the alternative was ending it.
- **Do not put the elapsed-time window back in charge of the hang path.** It was
  tried: `RebuildPolicy`'s 60 s window is sized for device losses, which arrive
  on a suspend/resume cadence. Hangs arrive on whatever cadence the _user's_
  behaviour produces, and four of them inside a minute would have ended a
  session with "three fresh devices did the same" when all three worked.
- **Do not raise the replacement limit.** It now sits against a measured ceiling
  — see [0002](0002-webgpu-sessions-are-scarce.md). Every replacement spends
  from a budget of about two per tab, so a session that rebuilds its way through
  a real fault can arrive at a tab whose animation frames are gone. If anything
  the number wants revisiting downward.
- Verified in a browser, not by reading the diff: wedging `onSubmittedWorkDone`
  with a never-settling promise makes `HEAD` reach the fatal screen and the
  patched build recover with frames advancing. With the wedge on
  `GPUQueue.prototype`, so every replacement is born hung, it walks `(1/3)`,
  `(2/3)`, `(3/3)` and _then_ goes fatal — bounded, not a rebuild loop.

## Notes

The mechanism this was originally built for — a discrete card runtime-suspending
underneath a hidden tab's live device — was subsequently tested and **does not
happen** (`scripts/gpusleep.mjs`; the card is pinned awake for as long as a
device is open on it). The decision stands on its own: stopping a hang from
ending the session is correct whatever the hang turns out to be. The full
working-out, including the disproof, is in
`docs/handoffs/2026-08-05-freezes-and-the-worker.md`.
