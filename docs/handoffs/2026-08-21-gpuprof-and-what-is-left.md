# The headless profiler, and the frame time it has not yet taken

**2026-08-21.** Starting question: evaluate the shaders and suggest directions.
Colin's answer to the first draft reset the brief — realism is not the point,
speed and cool effects are — so the day went into an instrument and what it
found. Two passes landed (`5ffcb98`, `4c4ac8b`); `docs/OPTIMIZATIONS.md` › _What
per-pass timestamps found_ has the tables and the Firefox confirmations. This
document is what a third pass should know before it starts.

## What exists now

`pnpm gpuprof` (`scripts/gpuprof/`) runs the compute graph under Deno's wgpu —
the implementation under Firefox Nightly's WebGPU — on the WX 3200, with
timestamp queries around every pass. `--preset=`, `--set=k=v`, `--ablate=`,
`--dump=<path>` and `pnpm gpuprof:cmp <a> <b>` are the whole interface;
`DEVELOPMENT.md` › _Measuring performance_ says what it is and is not. It reuses
the engine's own packing (`core/gpu/uniforms.ts`, `filterbank.ts`, both lifted
out of `Engine` for it) and binds by the names each shader declares
(`core/gpu/reflect.ts`), so a binding the shader names that `graph.ts` does not
supply throws at construction. `graph.ts` is a mirror of `pipeline.ts`, not the
thing itself: a pass added to the engine has to be added there too, and the
failure when it is not is a wrong or missing row, not an error.

Stock on the dev box: 2.29 → 1.59 ms of GPU time over the day; in Firefox 4.17 →
2.50 ms/frame. Every authored preset was profiled once (`gpuprof --preset=` in a
loop; the script is gone, it was ten lines) and the hot passes on the expensive
looks were taken in order.

## How to run an arm, and the traps in it

The protocol that worked: `git archive main` into a scratch directory, copy the
current `main.ts`/`cmp.ts` over its `scripts/gpuprof/` so both trees dump the
same way, then for stock and for the look — old dump, new dump, cmp, old timing,
new timing — **sequentially**. Three things cost an afternoon each between them:

- **Two profiler runs at once contend on the card** and both sums come out
  wrong. The one time they were launched in parallel the patched tree read 0.07
  ms slower on a change that was 0.15 ms faster. Chain them; never put two in
  one tool call.
- **A dump is compared against a baseline from the same frame count**, since the
  noise seeds are keyed on the frame. The compare script overwrote its baseline
  on every run, so a diff image built from the previous run's files compared two
  different looks. Name the files per arm.
- **When the texture formats differ between trees, the dump code must know.** An
  `rgba16float` arm decoded the old tree's 8-bit texture as half floats and
  reported a 136-level mean error on the _decoded_ row. The face row was right.
  Read all three rows and ask which one can legitimately differ.

Smaller ones: `tapeScrub` is derived from `tapeTransport`, not a control; the
sandbox refuses a shell `for` loop and a `cd` in one command, so put sweeps in a
script file; and a dev server left on `:5301` from a removed worktree will serve
its deleted tree until killed by port (`fuser -k 5301/tcp`).

## What is left, in the order I would take it

**`enhancer` (0.5 ms on four presets) and `buzz_tap` (0.3 ms on three).** One
lane per line, a 910-sample serial chain each, nine waves on a forty-SIMD card.
Spreading them one lane per workgroup so the scheduler could interleave 525 of
them was **twice as slow** — launch overhead dominated and the wave64 lockstep
had been issuing the loads efficiently. Untried: reading the line as `vec4f`
(four samples a load, the recurrence stays scalar) by binding the same buffer a
second time as `array<vec4f>`; and for `buzz_tap`, a per-line workgroup
reduction, which changes the summation order and so is not bit-exact — it would
also be the moment to fix the variance cancellation noted in the first
evaluation (`sq/n − mean²` in f32 over 910 samples of ~100 IRE puts a phantom
0.1–0.7 IRE of "deviation" on flat white lines; accumulate about a shifted
origin).

**`timebase` at stock is an identity copy** (0.09 ms): `lineParams.x` is zero
when no time-base control is up, and `catmull` at t = 0 returns p1 exactly.
Skipping it needs `channel` to write `compA` directly, but `channel` reads
`compA` with a halo and an in-place write races. The cheap version is a
`copyBufferToBuffer` in place of the dispatch behind a predicate on the line
state; the real version is a ping-pong across every downstream binding.

**The threshold-table mystery in `channel`.** Tabling the FM fold's per-source
threshold noise in workgroup memory cost 0.2 ms at stock, where the fold never
runs — loop or straight-line staging alike — while a padding array of the same
size cost nothing. So it is not occupancy; the compiler does something with that
table's presence. `RADV_DEBUG=shaders` on the Deno run, or naga's SPIR-V out of
`naga` on the prelude-prepended source, would say what. The table itself is
worth 0.14 ms on `fmFold` if the cause is found.

**`crt_face` on the heavy looks** is now 0.6–0.75 ms. What is left there:
convergence runs three spot integrals (0.5 ms with a 16-tap spot — skip the two
extra integrals where the landing error is under a quarter pixel, which is most
of the screen, and it stops being exact), and the 16-tap spot tier above
`crtSpot` 2 has never been measured for error the way bloom's was.

**`decode` with persistence** is 0.34 against 0.25 without: the lateral bleed
reads five neighbours' held light, two `u32` each. Untried.

**The B chain** still costs ~0.55 ms engaged (`encodeChromaB` 0.13,
`encodeCompositeB` 0.14, `mixB` 0.29). `mixB`'s dirty path is a catmull resample
plus the keyer; nothing obvious, not profiled in parts.

**Dub generations** were not re-profiled. `DEVELOPMENT.md` records `channel` +
`underDown` at ~1.4 ms per generation; `channel` has since changed, so
`--set=dubGens=4,colorUnderMix=1` is the first thing to run.

**The present pass and the canvas** are outside the profiler entirely. The batch
harness's canvas was 440 × 573; a full-screen canvas pays `present`'s
Catmull-Rom and grille per pixel, and nothing here has measured that.

Considered and declined, so the next person does not re-derive it: fusing
`chromaExtract` into `channel` (it would double the FIR work and the
`ycDelay`/`dropoutComp` reads reach outside any tile), and `rgba16float` for the
gamma'd screen (half-rate filtering gave most of the win back; the sRGB view is
the answer).

## The one change that is not exact

The gun's cutoff and gamma now apply where `decode` writes `outTex`,
sRGB-encoded while active, and `crt_face` samples through an `rgba8unorm-srgb`
view (`createView({ format, usage: TEXTURE_BINDING })` — the usage narrowing is
what lets wgpu accept an sRGB view on a storage texture). Gamma looks changed at
hard edges, where a tap between two pixels interpolates light rather than drive,
and SVM keys on light. I looked at the amplified diffs on `lightThatStays`,
`misconverged` and `nightMonitor` and could not tell the arms apart at 1×; the
numbers are in the commit
(`apply the gun's cutoff and gamma where decode writes the screen`). If a gamma
preset looks wrong to an eye that authored it, that commit is the one to revert,
and it stands alone.
