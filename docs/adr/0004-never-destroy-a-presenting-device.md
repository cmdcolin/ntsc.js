# 0004 — Never destroy a GPUDevice that has been presenting

**Status:** accepted, 2026-08-07. Supersedes
[0002](0002-webgpu-sessions-are-scarce.md).

## Context

[0002](0002-webgpu-sessions-are-scarce.md) established that a tab stops being
given animation frames after two or three WebGPU sessions, and modelled it as a
budget: devices are scarce, count them, spend them carefully. Every route
measured there fitted — page loads, hot updates, device-loss rebuilds — and the
app was built on it.

Then a session reported **five** devices in one tab, which the budget model
called impossible-in-practice, so the model got tested directly. It is wrong.
The count is not what a tab runs out of.

Four runs, Firefox Nightly / Linux, one tab per arm, rAF sampled over 1.5 s
after every step (`scripts/devicetear.mjs`):

**Creating devices costs nothing.** Four devices created and destroyed with no
canvas involved, then four created with a configured swapchain and destroyed,
then four created and _held open_:

```
plain    4x create + destroy, never presented     90 rAF/1.5s throughout
present  4x create + configure + destroy          90 rAF/1.5s throughout
keep     4x create + configure, all held open      90 rAF/1.5s throughout
```

**Presenting and then tearing down costs the tab.** Same document, no reload;
each round creates a device, configures a swapchain, presents real frames
through a render pass, and destroys the device:

```
cycle    round 1: presented  2 frames, then 103 rAF/1.5s
cycle    round 2: presented 76 frames, then   0 rAF/1.5s   *** rAF STOPPED ***
```

**And that is the whole difference.** Identical page, identical frames
presented, one arm destroying the device at the end of each round and one
keeping it:

```
destroy  round 1: presented 51 frames, then  90 rAF/1.5s
destroy  round 2: presented 57 frames, then   0 rAF/1.5s   *** rAF STOPPED ***
keep     round 1: presented 58 frames, then  86 rAF/1.5s
keep     round 2: presented 56 frames, then  90 rAF/1.5s
keep     round 3: presented 53 frames, then  87 rAF/1.5s
```

**Including across a reload, which is where the app was doing it to itself.**
The same minimal presenting page, reloaded four times in one tab, differing only
in whether a `pagehide` handler destroys the device on the way out — which is
what `useEngine` did, added on the reasoning that an abandoned device carries a
wedged GPU into the next page:

```
destroy   load 1:  80 rAF/1.5s
destroy   load 2:   0 rAF/1.5s   *** rAF STOPPED ***
destroy   load 3:   0 rAF/1.5s   *** still dead
destroy   load 4:   0 rAF/1.5s   *** still dead
abandon   load 1:  85 rAF/1.5s
abandon   load 2:  87 rAF/1.5s
abandon   load 3:  85 rAF/1.5s
abandon   load 4:  83 rAF/1.5s
nopresent load 1-4: 90 rAF/1.5s each
```

So "reloading lands in the same hole" was true and was partly self-inflicted.
The `pagehide` destroy — one line, written to make refreshes safer — is what
made a refresh cost the tab. `nopresent` is the control: a device that never
presented is free to destroy, so this is about the swapchain and not about
devices.

**And the app, end to end.** `scripts/rafceiling.mjs --page=app` reloads the
real app in one tab. Before this change it recorded `firstDeadSession: 2` (the
run in [0002](0002-webgpu-sessions-are-scarce.md)); after it:

```
app session 1: 72 rAF/1.5s  vis=visible      app session 5: 73 rAF/1.5s  vis=visible
app session 2: 72 rAF/1.5s  vis=visible      app session 6: 81 rAF/1.5s  vis=visible
app session 3: 71 rAF/1.5s  vis=visible      app session 7: 78 rAF/1.5s  vis=visible
app session 4: 81 rAF/1.5s  vis=visible      app session 8: 69 rAF/1.5s  vis=visible
                                             firstDeadSession: null
```

That arm is now a regression test for this decision rather than a demonstration
of the fault.

What is measured is the behaviour. **Why** destroying a presenting device does
this is inference: a configured swapchain is registered with the compositor and
the tab's refresh driver, and destroying the device pulls the surface out from
under a live registration, leaving the per-tab driver waiting on something that
will never present again. Consistent with all four runs, unconfirmed — it needs
Firefox's compositor side to say. The repro is ~40 lines and serves its own
page, so it can go upstream as-is.

## Decision

**The app never calls `device.destroy()`.**

- `releaseGpu(device)` in `gpu/context.ts` lets go of a device: it drops the
  stash entry and returns. `?gpudestroy=1` restores the real `destroy()` for
  re-measuring this against a new browser build, and is the only thing that can
  reach it.
- **A device outlives the engine on top of it.** The stash lives on
  `globalThis`, not module scope — a Vite hot update replaces modules, and a hot
  update is exactly when one engine is torn down and another built — and
  `initGpu` hands the held device to the next engine.
  `Engine.destroy({keepDevice: true})` is how a teardown says "this is not the
  device's fault"; the hot-update hook (`app.tsx`) and the remount cleanup
  (`useEngine`) both pass it. Measured: three hot updates, one device, picture
  live throughout.
- **A faulted device is let go, not destroyed.** A lost device is already gone;
  a hung one must not be handed to its replacement. Neither is destroyed, so the
  rebuild costs a device and never the tab.
- **The counts are kept, what they gate changed, and so did what they are
  counted over.** `gpuReleases()` is devices destroyed — the number that
  predicts a tab with no rendering step left — and it is per **tab**, in
  `sessionStorage`, because that damage crosses a reload. `gpuBuilds()` is
  devices created by this **document**, held on `globalThis` beside the stash so
  a hot update does not reset it and a real load does. `outOfGpuBudget()`
  refuses a new device when `gpuReleases() > 0` (measured, one is enough) or
  when builds reach `DOC_GPU_BUILD_LIMIT` (8 — a runaway backstop against an
  engine rebuilding in a loop, because creating devices is cheap).
  `gpuSessions()`, the tab's lifetime creation total, is kept for the trace and
  gates nothing. (The build ceiling is gone — see the amendment below.)

  Per document is the correction, and it is this ADR applied to its own
  bookkeeping. The counts were written under
  [0002](0002-webgpu-sessions-are-scarce.md), where the scarce thing was the
  tab, so both were tab-scoped and a reload spent from the same pot. Under the
  mechanism actually measured, a device dies with the document that made it: an
  abandoned one is reclaimed when the realm goes, which is what a refresh is. So
  counting creations per tab counted **refreshes** — the `--page=app` run above,
  eight healthy loads, would have read as eight devices spent, tripped the stage
  notice at load three, and been refused outright at load nine. The one arm of
  this ADR that proves reloading is safe is the arm the old scoping punished.

- **Two surfaces still say it out loud**, because a console warning arrives
  where nobody is looking. A dismissable stage notice while the tab still paints
  (`gpuAtRisk()`: any destroyed device, or more than two built by this page — a
  refresh builds one, so refreshing never raises it), and the decline screen,
  whose only action is an anchor to `location.href` in a new tab — the address
  bar carries the live look, so nothing is lost by moving. The screen also
  carries an override, because the ceiling is one browser on one OS.
- **A frozen tab no longer buys devices.** `RenderLoop` records but does not
  score hang strikes while the fallback has given up: nothing is being
  submitted, no frame is reaching the screen, and the rebuild a hang triggers
  has to let go of a presenting device to get a new one.

## Consequences

- **Abandoning a device leaks it.** Its pipelines, bind groups and shader
  modules live until the document goes; the engine's own buffers and textures
  are still destroyed individually first, so the large VRAM is returned either
  way. This is the deliberate trade: a leaked device is undone by closing the
  page, a tab with no rendering step is undone by nothing.

  **The leak is bounded by the document, and a refresh is the bound.** Worth
  stating because the counts made it look otherwise: a reload tears down the
  realm, and every device it held goes with it. Six refreshes leave one device
  alive, not six. What accumulates across a tab's reloads is nothing but the
  `sessionStorage` tally — and the destroyed-device damage, which is not a
  resource at all.

- **Do not "clean up" a device on unload.** That is this ADR in one sentence,
  and it is the change most likely to be re-introduced by someone tidying up,
  because releasing a resource on `pagehide` is normally correct. The comment in
  `useEngine`'s `pagehide` handler carries the measurement for exactly that
  reader.
- **`?gpudestroy=1` is the A/B, and it is destructive.** It will end the tab. It
  exists so the finding can be re-tested on a new Firefox rather than trusted
  forever.
- **Still no `<StrictMode>`** ([0002](0002-webgpu-sessions-are-scarce.md) and
  `src/main.tsx`). The reason is weaker than it was — letting go of a device is
  cheap now — but a mount/unmount/mount cycle around a WebGPU canvas is the
  shape that used to freeze tabs, and nothing about StrictMode makes the extra
  device or the extra swapchain configure free.
- **Harnesses that spend devices on purpose need `?gpubudget=ignore`.**
  `rafceiling.mjs` and `deviceloss.mjs` carry it.
- **This is a browser bug and the app is now working around it.** If Firefox
  fixes it, everything here stays correct and merely stops mattering; the honest
  test of that is `scripts/devicetear.mjs`, whose `destroy` arm should start
  surviving.

## Amendment, 2026-08-08 — the build ceiling is gone

`DOC_GPU_BUILD_LIMIT` is removed. `outOfGpuBudget()` now asks one question:
has this tab destroyed a presenting device. Nothing else refuses a session.

The ceiling was the last thing in here still shaped by
[0002](0002-webgpu-sessions-are-scarce.md) — a count of creations, kept as a
runaway backstop after the model that motivated it had been disproved. Two
things were wrong with it.

**A fast rebuild loop was already bounded, and not by this.** `RebuildPolicy`
gives up after three faults inside a minute, per fault kind, on a screen that
explains itself. Anything that reached eight builds had to get there slowly.

**And what reaches it slowly is the case the policy deliberately forgives.**
`RebuildPolicy` resets when a replacement held — a laptop whose discrete card
suspends under a hidden tab produces one loss per alt-tab, each rebuilt
successfully, and the policy is written not to punish that. Every one of those
still spent a build. So the ceiling ended a long healthy session on the ninth
alt-tab, with a screen arguing it was "past what one was measured to survive" —
against the measurement at the top of this file, where four devices created and
held, all presenting, cost a tab nothing.

What repeated creation does still cost is the leak, and that is bounded by the
document and was accepted here deliberately. It keeps the stage notice
(`gpuAtRisk()`, unchanged at more than two builds), whose wording now says what
is true of that case — the device keeps going away, each replacement empties
VRAM, the session carries on — and offers the new-tab link only on the arm that
has measured cause to.

Consequence: with the app never destroying devices, the surviving gate cannot
fire in an ordinary session. It exists for the tab that ran `?gpudestroy=1` and
then reloaded, which is exactly the hole this ADR documents.

## Reproducing it

```
node scripts/devicetear.mjs                 # all four arms, ~3 min, own page
node scripts/devicetear.mjs --arm=reload    # the one that explains refreshing
```

Each arm gets a fresh browser: the `destroy` arms leave a tab that cannot paint,
and one of them took the whole browser process with it.
