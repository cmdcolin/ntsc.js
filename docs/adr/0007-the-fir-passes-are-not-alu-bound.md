# 0007 — The FIR passes are not ALU-bound, so ablate before optimizing

**Status:** accepted, 2026-08-17.

## Context

Six passes in the signal path are FIR filters 33 to 55 taps wide, and reading
one is an invitation to make its arithmetic cheaper. The inner loop is a
multiply-accumulate over a kernel, sometimes with a phasor walked alongside it —
every instinct a graphics programmer has says the wins are in there.

They are not, on this hardware. Three attempts, all built, all measured, all
reverted for **no separable difference**:

- the filter bank moved from a storage buffer to a uniform, vec4-packed for the
  constant cache;
- a Chebyshev recurrence replacing the heterodyne phasor walk in `under_down`
  and `channel`, verified pixel-exact before it was timed;
- a one-shot bake of `crt_face`'s grain field.

**What survives is the verdict and not the arms.** All three were measured in
worktrees that never landed, so there are no per-arm numbers in this repo to
reproduce — which is a defect in the record, and the reason to re-derive an
ablation upper bound rather than cite this paragraph as a measurement.

What _is_ numbered points the same way, because three optimizations to these
same passes landed on 2026-08-08 and **none of them made arithmetic cheaper**
(dev box's WX 3200, Firefox Nightly / Linux, best-of interleaved per
[`../DEVELOPMENT.md`](../DEVELOPMENT.md) › _Measuring performance_):

- **`crt_face`'s gather costs 0.0094 ms/tap and does not care about radius.**
  Dropping eight taps saved 0.083 ms whether they sat on the 3.5-pixel bloom
  disk or the 15-pixel halo one — measured as separate arms and
  indistinguishable. So that pass is bound by how many samples it fetches, with
  no locality term and no superlinearity.
- **`fb_composite` won 3.22 → 3.06 ms/frame by not evaluating 33 `cos` and 33
  `exp` per sample**, hoisting them to one thread per workgroup. Removing
  transcendental work outright paid; making the surrounding arithmetic cheaper
  had not.
- **FIR tile width: 64 and 128 are within noise, 256 is ~8% slower.** So the
  halo traffic is not the bottleneck either.

The reading that fits all of it is that these passes have idle issue slots.
Arithmetic saved inside the tap loop rides in them and never reaches the frame
time; work removed from the loop entirely — a fetch, a transcendental, a
dispatch — does.

The same shape caught a fourth attempt before it was written, which is the one
with numbers preserved. The `Engine` constructor's blocking
`createComputePipeline` calls look like an obvious `createComputePipelineAsync`
job; timed in place first, at 22 pipelines:

```
PLBUILD n=22 sync=9.0ms syncWarm=2.0ms asyncParallel=396.0ms
```

9 ms is the entire upper bound, so the refactor could not have been worth it
whatever the async path did — and the async path was 44× worse anyway. One
browser run, no code written.

## Decision

**Measure an ablation upper bound before building an optimization here.** Delete
the work, run the frame without it, and read the delta: that number is the
ceiling on any optimization of it, and it is routinely smaller than the code
suggests.

**Treat arithmetic inside the FIR tap loops as free until an ablation says
otherwise.** The levers that have actually paid are all of the form _do less_,
not _do it cheaper_: don't dispatch the pass (`when()` predicates), don't fetch
the sample (tap-count tiering), don't recompute what is constant across a
workgroup or across the build (hoisting, tabulating).

## Consequences

- **An arithmetic micro-optimization in these passes needs its ablation first,
  and the ablation is usually the whole project.** Three of them have been
  written and thrown away here. A fourth that arrives without an upper bound in
  front of it is the same afternoon again.
- **This is scoped to this hardware, and says so.** A different GPU — or a
  browser that schedules these dispatches differently — could invert it. What
  generalizes is "ablate first", never "arithmetic does not matter"; the two
  read alike and only one of them survives a hardware change.
- **It does not extend to transcendentals per sample.** A `cos` per tap per
  sample is not arithmetic riding an idle slot, it is work, and removing it is
  what `fb_composite` and `crt_face`'s disk tables both did. The distinction is
  the useful half of this record: ask whether the change deletes work or merely
  restates it.
- **The measurement protocol is load-bearing.** Cost on the dev box reads as
  bimodal ~0.8 ms apart in whole batches, which is another GPU client and not
  the app — a second stepped session costs +3.6 ms, one idle app tab left
  presenting +0.17 ms. Two spellings of the same shader will "differ" by 0.8 ms
  all day if the median is read instead of the best-of, which is how an earlier
  set of ablate deltas came out 8× too large.
- **A future re-test should record its arms**, unlike the three above. That is
  the one thing this record cannot supply, and the reason it argues from the
  optimizations that worked rather than from the ones that did not.

The techniques this rule produced, and what each of them measured, are in
[`../OPTIMIZATIONS.md`](../OPTIMIZATIONS.md).

## Addendum, 2026-08-21 — the arms can be recorded now, and one of them moved

`scripts/gpuprof` times every pass on the GPU's own counter, headless, under
Deno's wgpu on the same card (`DEVELOPMENT.md` › _Measuring performance_). It
resolves a tenth of a millisecond per pass, where the batch harness measured
whole frames through a bimodal ~0.8 ms of neighbour noise. Re-measured with it,
the third arm above was never flat:

```
crt_face, stock, WX 3200            grain hashed per frame   grain baked once
  pass GPU time                            0.568 ms             0.453 ms
  CRT face vs previous shader                  —                 max 0/255
```

The verdict holds where it was drawn. The two FIR arms were arithmetic inside
tap loops that have idle issue slots; `crt_face` is a per-pixel pass with no
such slack, and sixteen hashes a pixel were its cost. "Ablate first" is
unchanged — what changed is that the ablation is now a two-second command with a
per-pass answer, and it should be the first thing run, not the last.

One more number from the same afternoon belongs here because it is the rule in
the other direction. `sync.wgsl`'s single lane was staged into workgroup memory
on the theory that its 525-line walk was paying a global load per line: 0.174 →
0.166 ms, and a prefetch did nothing more. The pass is bound by one lane's issue
latency on a dependent recurrence, and memory was never it.
