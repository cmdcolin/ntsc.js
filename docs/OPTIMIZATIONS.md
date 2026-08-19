# Optimizations

Why the render path looks the way it does. [`ARCHITECTURE.md`](ARCHITECTURE.md)
draws the path itself, and [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) is the one-page
version of what a pass is.

One frame is 477,750 f32 samples (910 × 525) through up to twenty-five compute
dispatches, sixty times a second, and six of those passes are FIR filters 33 to
55 taps wide. That budget is the reason for everything below. On the dev box's
WX 3200 every built-in preset lands **3.3–5.4 ms** against a 3.3 ms always-on
floor, so the headroom exists — but it exists because the expensive things are
gated, tiled, tiered, or not dispatched at all.

The measurement protocol, the harnesses and the traps are in
[`DEVELOPMENT.md`](DEVELOPMENT.md) › Measuring performance. This page is what
the measurements decided.

Every millisecond quoted below was taken on the dev box — a WX 3200 under
Firefox Nightly / Linux — best-of over interleaved runs, in August 2026. They
are one machine on one day: read them for their ratios and their signs, not
their third digit, and re-derive rather than cite one before building on it.

## The rule: ablate before you optimize

Delete the thing and measure the frame without it. That number is the upper
bound on any optimization of it, and it is usually smaller than it looks.

The rule exists because three plausible optimizations were built here and
measured **exactly flat**:

- the filter bank moved from a storage buffer to a uniform, vec4-packed for the
  constant cache;
- a Chebyshev recurrence replacing the heterodyne phasor walk in `under_down`
  and `channel` (verified pixel-exact first);
- a one-shot bake of `crt_face`'s grain field.

All three were reverted. The FIR passes are not ALU-bound on this hardware, so
arithmetic saved inside them rides in idle slots. Nothing about that is knowable
from reading the shader, which is why it is
[ADR 0007](adr/0007-the-fir-passes-are-not-alu-bound.md) rather than a comment:
the record carries what the three arms did not preserve, and what to measure
before trying a fourth.

The same rule caught a startup one before it was written. The `Engine`
constructor makes a couple of dozen blocking `createComputePipeline` calls,
which looks like an obvious `createComputePipelineAsync` job. Timed in place
first, at 22 pipelines:

```
PLBUILD n=22 sync=9.0ms syncWarm=2.0ms asyncParallel=396.0ms
```

**9 ms is the entire upper bound**, and the refactor would have meant splitting
construction in two, because the constructor consumes the pipelines to build the
pass graph. The async arm being 44× slower is the more interesting half and has
its caveat in `DEVELOPMENT.md`; it did not need to be true for the answer to be
no.

Two harnesses back the rule up. `scripts/perf.mjs` is best-of wall clock over
batched `vf.step()` runs — read its per-batch list, because cost on this box
reads as **bimodal ~0.8 ms apart** and that is another GPU client, not the app
(a second stepped session costs +3.6 ms; one idle app tab left presenting costs
+0.17 ms). `scripts/pixdiff.mjs` is what makes an approximation honest: it
reports the tail of the error distribution as well as the peak, because a
thinned kernel fails as banding, which a peak-error number waves straight
through.

## Not dispatching is the largest optimization here

Every optional pass carries a `when()` predicate over the controls, and
`renderFrame` skips the whole compute pass — encoder, bind group and dispatch —
when it returns false. An idle feature costs nothing rather than costing a
uniform multiply by zero.

What that is worth, measured against the parent revision with two dev servers
alternating: the chroma keyer, the video synth and the blanking strobe together
land **4.52 ms on both sides at stock** — no separable difference at all. The
true-waveform B chain (`encodeYuvB → encodeChromaB → encodeCompositeB → mixB`)
totals ~0.9 ms engaged and dispatches nothing idle. The intercarrier-buzz
readback is gated on the buzz being audible, so a listener who never touches it
pays neither the copy nor the map.

Gating inside a shader gets the same treatment when a pass is already running.
`crt_face`'s bloom and halation used to share one gate and one loop body, so
either control being up ran both radii — a look with bloom up and halation down
paid a sixteen-tap gather over a 15-pixel disk for a result immediately
multiplied by zero. Splitting them into a loop each, gated separately, is worth
0.12 ms of a 4.87 ms frame.

The cost of this design is that a gate can be forgotten. `feedgates.spec.ts`
exists because a per-source fault whose gate does not know about it dispatches
no pass, so its slider does nothing until some unrelated fault on the same input
comes up — a failure that looks like a shader bug and is a table entry.

## The raster is the data structure

The signal is one flat `array<f32>`, allocated once, never read back to the CPU.
Sample `s` of line `row` is index `row * 910 + s`, and that is the whole address
scheme: no textures, no strides, no per-row objects.

Sampling at exactly 4 × F_SC is what makes the rest cheap. The subcarrier lands
on a four-phase lattice — (0,1) (1,0) (0,−1) (−1,0) — so `carrier(n, frame)` is
`n & 3` and two selects, with no trig and no accumulated phase error. 910
samples per line is 227.5 cycles, which gives the 180° line alternation for
free, and 525 lines gives the frame alternation, both out of `n mod 4` rather
than out of bookkeeping.

The decoder's demodulator takes that further. At every tap, exactly one of the U
and V multiplies is against a zero, so `demodAt` throws half the arithmetic away
before doing it: taps sum into **four buckets by `k mod 4`**, and the lattice is
applied once at the end as a rotation of those buckets onto (U, V) instead of
per tap. The loop is unrolled by four into a `vec4f` accumulator; the odd tail
uses `select` rather than a dynamic vector index, which would spill the
accumulator to scratch for the sake of up to three iterations.

## Workgroup memory does four different jobs here

Nine shaders stage something in `var<workgroup>` before they barrier, and it is
worth knowing which of four things each one is doing, because the reason decides
what may change.

**Halo tiling, so a FIR reads storage once per sample rather than once per
tap.** Six passes filter the waveform (`encode_composite`, `encode_chroma_b`,
`chroma_extract`, `under_down`, `channel`, `decode`), and each stages its own
64-sample span plus a **32-sample halo per side**, barriers once, and filters
out of shared memory. The kernels in the bank run 33 to 55 taps, comfortably
inside the 65 a 32-sample halo allows.

The 64-thread width was measured rather than assumed. Staging costs
`(TILE_WG + 64) / TILE_WG` loads per output, so wider workgroups re-stage less —
but 64 and 128 land within noise of each other and **256 is ~8% slower**. The
halo traffic is not the bottleneck, so the width stays where scheduling
granularity likes it.

**This is where the row-uniform invariant comes from.** `decode` stages a
contiguous span of one raster row, so a horizontal offset applies to the whole
workgroup or it reads outside the halo. Per-pixel horizontal scaling — H size,
linearity, pincushion — needs the staging restructured first, and no amount of
care in the shader gets around it.

**Sharing a deviate that is expensive to draw.** Snow is one Gaussian deviate
per sample, and the 1-2-1 band-limit over it reads each neighbour's deviate —
every thread's neighbour is some other thread's centre, so generating per-thread
draws each deviate three times. `gauss()` is Box-Muller, two hashes plus a log
and a cos, which makes that the most expensive redundancy in the pass. `channel`
and `feed` both stage `TILE_WG + 2` of them instead. The quadrature arm for
`channel`'s Rician envelope detector is staged only while `rfSnow` is on.

**Hoisting a per-workgroup constant out of a per-sample loop.** `fb_composite`'s
resonance is a network — one set of component values, not a different one per
sample — so its 33 taps and its normalizer are functions of two controls alone.
Building them inside the tap loop cost 33 `cos` and 33 `exp` at every one of the
raster's 477,750 samples to arrive at the same 34 numbers each time. One thread
designs the filter and everyone else reads plain coefficients: **66
transcendentals per workgroup rather than per sample**, worth 3.22 → 3.06
ms/frame. The summation order is untouched, so this is not an approximation —
`pixdiff` reads max 0 over 200 frames of a live sub-unity loop, which is the
strictest check available on that pass because a one-bit error would compound
every lap.

Hoisting into workgroup memory sets one trap, and it is a correctness trap
rather than a performance one: **the predicate sits ahead of the bounds
return**, since every invocation in the workgroup has to reach the barrier and
910 samples do not divide by 64.

`crt_face`'s disk taps are the same move made at compile time: golden-angle
direction × radius plus the beam gaussian weight, tabulated as constants.
Computing them in the tap loop cost a `cos`/`sin`/`sqrt`/`exp` apiece — about 64
transcendentals per pixel, and the single most expensive thing in that pass.

**Sharing an overlapping history window.** `line_analyze`'s chroma AGC lag walks
an RC window up to 97 lines deep, and consecutive rows walk almost the same one
— so measuring per consumer re-gated the same burst up to 97 times over. A
workgroup of 64 rows needs 64 + span measurements between them, which is two or
three gates per thread instead of ninety-seven, and the staged count follows the
span rather than the ceiling. The RC weights stage the same way for the same
reason: they are a function of `k` and the time constant, identical for every
row in the frame. The gate and the summation order are unchanged, so `pixdiff`
reads max 0 here too.

`line_analyze` is also the one place here where the win is **latency on an idle
GPU** rather than throughput: 525 threads in 9 workgroups is a narrow dispatch,
so the redundancy was never competing for occupancy.

The random fields underneath all of this are hashed from the global sample index
rather than carried as state, which is what lets overlapping halos, Y/C-delayed
reads and the staged tile all agree on the same deviate for the same sample
without communicating.

## Filters are designed on the CPU, and rebuilt as rarely as possible

`signal/filters.ts` designs every kernel in the path from real frequency specs —
windowed-sinc, Blackman, unity DC gain — and uploads them as taps in one buffer
with a fixed 64-tap stride per section. Nothing in the signal path is an ad-hoc
blur, which is what makes the physical-units convention hold end to end.

Designing a bank costs a CPU pass over five kernels, so `filtersDirty` decides
when. Only five control keys touch it (`encChromaMHz`, `demodMHz`, `chromaTail`,
`lumaMHz`, `lumaPeak`), and each of the three systems that can move a control
per frame has a rule about them:

- **Modulation** may route to them, because a deliberate patch that rebuilds the
  bank every frame is a legitimate thing to ask for. Hanging it off an authored
  preset is not, and `presets.test.ts` forbids that — an authored look would
  otherwise ship sixty bank rebuilds a second to everyone who loaded it.
- **Morph** steps them in `COARSE_STEPS` (32) notches rather than sweeping them,
  since a morph moves all five at once and would otherwise be the cheapest way
  to buy those sixty rebuilds.
- **The stab gate** marks dirty on the two edges of a cycle and on **no frame in
  between**. Every frame inside one half holds the same values, so the bank
  designed on the way in is still right. Marking each frame instead is a FIR
  redesign at the frame rate; at 2 Hz the edges cost four rebuilds a second.

## Uniforms are generated, packed once, and copied on the GPU timeline

`PARAM_DEFS` in `src/core/gpu/prelude.ts` is the single source of truth for the
`Params` struct, and **field order there is the GPU memory layout**. It
generates the WGSL struct and a typed `Record` that `packParams` consumes, so a
field added without being supplied in `uniformValues()` is a TypeScript error
rather than a uniform that silently reads zero.

Packing writes into one reused `ArrayBuffer` scratch and issues one
`writeBuffer` per frame.

Dub generations are where that pays off. Each extra generation is an independent
playback pass needing its own gen seed and its own time-base walk, and the frame
stages all of them up front into `genParamsBuf`, then moves them into the live
buffer between generations with `copyBufferToBuffer` — on the GPU timeline,
inside the same command encoder, rather than re-encoding or waiting. Only one
`u32` differs between slots, patched at `GEN_OFFSET`. The frame's own params sit
in slot 0 and get copied back before the receiver runs, because the loop
otherwise leaves every pass below reading `gen = gens - 1`.

The per-source feeds reuse the same trick sideways. `packFeed` spreads the
program-bus pack and overrides only the fields a feed names, so each source's
deck-and-cable faults are a second `Params` buffer bound to the same shader
rather than a second set of fields — the mechanism is written once in
`feed.wgsl` and costs no `PARAM_DEFS` growth. The trap that creates is in
`ARCHITECTURE.md`, and it is worth reading before adding a fault: every field a
feed does **not** override still holds the program bus's value.

## State that lives in buffers between frames

Anything the signal path has to remember stays on the GPU.

**`timingBuf`** carries the sync flywheel's persistent scalars just above the
per-line offsets — vertical phase, PLL state, AGC gain, two second-order gain
servos with their velocities, and the separator's lock age. They are named
constants in the prelude rather than literal indices at the eight sites that
touch them, because the raster is a constant here and a literal index is the one
thing in this buffer that would not move if `LINES` did.

**`persistBufs`** ping-pong on frame parity. `decode`'s lateral scatter reads
neighbouring pixels, so a single buffer would hand it values the same dispatch
is part way through overwriting.

**The tape loop** is the one that needed arithmetic care. It stores composite as
f16 pairs packed into `u32`, which puts a frame of tape at 933 KiB and a
two-second 120-frame loop at 109 MiB — inside the 128 MiB a storage binding is
guaranteed. f16 resolves about 0.05 IRE, three orders finer than the medium's
own noise floor, so nothing about the storage shows up in the picture and every
artifact is one the transport actually causes. The ring holds 57 million
samples, well past the 2²⁴ where an f32 stops counting integers one at a time,
so position arithmetic is `u32` throughout and the delay arrives split into
whole frames plus a remainder. `tape_rec` writes two samples per thread because
a packed word is written whole; 910 is even, so a line never straddles a word
and no two threads contend for one.

## Tiering, because tap count is the only lever

`crt_face`'s bloom and halation gather is ~0.30 ms of a 4.90 ms frame, 6%,
measured by deleting both loops outright. Cost is **linear in tap count at
~0.0094 ms/tap and does not care about radius** — dropping eight taps saves
0.083 ms whether they sit on the 3.5-pixel bloom disk or the 15-pixel halo one,
measured as separate arms and indistinguishable.

So there is no locality win hiding in this gather and no superlinearity to
exploit. Both spreads tier the tap count instead of restructuring the sampling,
and each tiers on whatever decides visibility for it:

- **The beam spot tiers on radius.** A sub-pixel gaussian reaching the glass
  through the bilinear sampler is fully captured by a few taps, and the 0.6 px
  default was paying for sixteen. Wide settings cost ~1.8 ms; the default costs
  ~0.2 ms.
- **Bloom tiers on strength**, because its disk is a fixed 3.5 px and what
  decides whether sixteen taps are visible is how hard the result gets
  multiplied in. Against a pinned frame, 8 taps differ from 16 by at most 3/255
  at the 0.2 default and 8/255 at 0.6, with under 0.03% of pixels off by more
  than 4 — and by 18/255 at 1.0 and 65/255 at 3.0, where it does show. Nearly
  every preset sits at 0.6 or below; the two that lean on bloom keep the full
  disk. Worth 0.083 ms.

Both thresholds are hard steps, so sweeping the control through one pops the
result by that difference. That is the bargain, stated where the step is.

## The one serial pass

`sync.wgsl` is `workgroup_size(1,1,1)`: a single thread running two
525-iteration loops, the PLL flywheel and the HV sag. It has to be serial — each
line's value depends on the previous line's — and `sync_measure` already scanned
the waveform in parallel, so this thread only runs the recurrences over those
measurements.

It is latency on one thread rather than GPU throughput, and it measures fine at
60 fps, but it is the one pass in the app that cannot scale. A third per-line
recurrence should be a parallel prefix scan rather than another loop here.

## The one readback, and it never waits

`buzz_tap` leaves 525 measurement pairs on the GPU per frame and the sound
detector needs them on the CPU. That is the app's only steady-state GPU→CPU
readback, and the reason it can exist without costing the render loop anything
is that it never blocks.

`mapAsync` resolves a frame or two after submit, so a buffer copied into cannot
be mapped, read and reused within one frame — hence a pool of three. **When
every staging buffer is still in flight the frame is skipped**, which is the
whole trick: the audio side is a ring with a rate servo and glides over a
missing frame, whereas a stall here would show up in the picture. The flush runs
after the submit that carries the copy and is never awaited, and the drive is
re-read on arrival rather than captured at copy time, so letting go of the
slider stops the sound next frame instead of playing out what was in flight.

A frame or two of latency is deliberate. Buzz is a rasp; nobody can hear 30 ms
of sync error on one, and paying for tighter would mean blocking.

## Getting pictures in

Input staging is the one place where the cost lands on the rAF loop rather than
on the GPU, and two playing clips cost more live frame rate than the heaviest
preset does.

**Off-thread decode and scale.** `createImageBitmap` takes the crop rectangle
and the target size together, so the decode, the resize and B's centred 4:3 crop
all leave the main thread in one call. Source pictures are capped at a 1536 px
long edge with aspect preserved. `resizeQuality` is deliberately `'low'` — it
matches what `drawImage` always did, and the chain resamples to a 754-wide
raster and then damages it thoroughly, so nothing downstream could tell a better
filter apart.

**Don't decode a frame that isn't there.** The pump dedups on `currentTime`, so
a 30 fps clip under a faster loop is decoded once per source frame rather than
once per render.

**Zero copy where the browser allows it.** Where the device has
`importExternalTexture` (Chrome, feature-detected), `blit_ext.wgsl` samples a
slot's fresh video frame straight off the browser's decoder into the slot
texture, replacing the bitmap path's per-frame CPU decode/resize/upload. The
import happens inside the frame that submits it, because an external texture
expires with the task that imported it — the pump only parks the elements.
Firefox has no such API and stays on the bitmap path unchanged.

## Pacing is a separate problem from throughput

The batch number is the GPU saturated. What a user sees is the rAF loop, paced
by the display, and the display steps it in jumps rather than sliding — 48 → 24
on the dev panel.

`frameLock` trades rate the display was stepping anyway for a cadence that holds
still: it renders every Nth refresh and **submits nothing in between**. A held
re-present was tried and is worse — it made Firefox's scheduler slow rAF
delivery itself.

The `auto` position (`gpu/framelock.ts`) decides from the loop's own cadence,
and its constants encode platform lessons that deserve tests rather than
rediscovery. rAF delivers catch-up callbacks milliseconds apart after a stall,
so any floor trusting the fastest interval reads every normal frame after one as
a miss; a percentile floor fails the other way, reading a window where most
frames miss as steady-slow. What survived is judging each window on **the spread
of its own intervals**: p75 against p25 × 1.5. A loop keeping any rate shows p75
≈ p25, and a loop wavering between vsync steps shows p75 near double p25,
because a skipped vsync doubles the interval. The spread is the stutter the eye
objects to, and it needs no absolute refresh estimate, so 48, 60 and 144 Hz
panels all work. A window that is slow but **steady** deliberately does not
engage — the lock has nothing to trade there. Divisor changes get a grace
window, because Firefox re-paces rAF between vsync and a ~60 Hz software tick
depending on whether refreshes present, and the handover would otherwise score
phantom misses against the mode that just started. Failed probes back off to a
minute.

## React never renders a frame

React only ever configures the engine. The render loop lives in `useEngine` and
writes to the canvas directly, so live per-frame state reaches the overlays as
**mutable refs read during render** rather than as sixty state updates a second.

- **A morph notifies React a tenth as often as it moves.** `GLIDE_NOTIFY`
  batches to every sixth frame. Notifying per frame is a full panel render per
  frame — 19 ms with every row mounted — the morph paying for its own stutter.
  The landing frame always notifies regardless, and it assigns the destination
  rather than evaluating the path at `t = 1`, because `from + (to − from) * 1`
  is not bit-identical to `to` and `matchPreset` compares exactly.
- **Two panel contexts, split by clock.** `ControlsContext` changes on every
  pointer move of a drag; `ModSlotsContext` changes only when someone patches
  the bay. One shared context would rebuild every consumer of both on each drag
  frame.
- **One gesture is one notify.** Drags on the direct-manipulation miniatures
  write through `writeControls`, so a gesture moving four controls notifies
  once.
- **Nothing in a miniature runs per frame.** No rAF, no transitions that recalc
  style each tick. The panel shares a main thread with a 60 fps canvas, and a
  decorative pulse measured 7 ms of style recalc per 3 s for information a
  static border carries. Measure this with `page.metrics()` deltas
  (`RecalcStyleDuration`, `ScriptDuration`), not fps — the loop is vsync-capped,
  so fps stays at 60 until the budget is already gone.
- **React Compiler is on**, so don't hand-write `useMemo`/`useCallback`. The
  ref-during-render pattern is exactly what the compiler refuses, which costs
  that component its memoization — so every bail-out is recorded in `KNOWN` in
  `scripts/compilercheck.mjs` with whose fault it is, and `pnpm compiler` fails
  on any that is not on the list.

### The main thread is the one feeding the GPU

Re-rendering is not the only thing that competes with the render loop. Anything
per-frame on this thread does, including work that never touches React, so the
per-frame path avoids allocating and the drag paths coalesce their writes:

- **`glide` writes into `controls` in place** rather than returning a look. It
  runs every frame, and a fresh two-hundred-key object per frame is pure churn —
  the engine's controls are where the values have to end up anyway.
- **`emit()` walks its listener set live** rather than over a defensive copy.
  Three of these fire on the frame path, where a copy per notify is an
  allocation per frame. Unsubscribing during a notify is safe regardless: `Set`
  iteration skips an entry deleted before it is reached.
- **Storage and history writes are debounced out of the drag.** A slider drag
  emits a move per pointer event, so the URL mirror coalesces to one
  `replaceState` once the value settles (the browser rate-limits the history API
  anyway), and the modulation bay defers its `localStorage` write — a
  synchronous one per frame of a drag is paid on the thread feeding the GPU.

## Devices are created freely and never destroyed

The expensive resource is not the `GPUDevice`. Four created and four held open,
all presenting, cost a tab nothing — while **one `device.destroy()` on a device
that has been presenting ends the tab's rendering step**, and the next document
loaded in that tab inherits the damage.

So the app abandons devices instead of destroying them, and hands the live one
to the next engine. HMR is the cheap path: a hot update recreates the engine,
but the engine hands its device on alive and the successor adopts it from a
stash that lives on `globalThis` — precisely so that editing `gpu/context.ts`
itself does not throw it away with the module. An editing session costs one
device however many saves it takes.

The runs, the three arms, and everything this forbids are in
[ADR 0004](adr/0004-never-destroy-a-presenting-device.md). Read it before
touching anything that creates, releases or tears down a device.

## What is left

The backlog lives in [`IDEAS.md`](IDEAS.md) rather than here, and two of its
entries are shaped by this page. **Interlace** is the raster restructure, with
its own section there — including what field-rate timing would do to
`dropoutComp`'s 1H delay, which is not obvious from the timing alone.
**Intra-line geometry** — `hSize`, `hLin`, pincushion, and the stair-stepping of
a `round()`ed bend — sits under the deflection follow-ons, blocked on decode's
staging for the reason above.

What this page owns is the other direction: what has already been measured and
is **not** worth revisiting without new hardware or a new browser build — the
three ALU micro-optimizations at the top, 256-wide FIR workgroups, and
asynchronous pipeline creation.

One constraint rather than an idea, since nothing is asking for it yet: a third
per-line recurrence wants a parallel prefix scan, not a third loop in the one
serial pass.

## Further reading

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the pass graph, the three domains,
  buffer layouts, adding a control end to end
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — the harnesses, the traps they have hit,
  and the performance-measurement protocol these numbers come from
- [ADR 0007](adr/0007-the-fir-passes-are-not-alu-bound.md) — why the rule at the
  top of this page is a rule, and [`adr/`](adr/) for the rest of the decisions
  where the obvious thing is wrong for a non-obvious reason
