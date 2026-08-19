# 0006 — A take is a seed plus its resolved picks, and never `Math.random`

**Status:** accepted, 2026-08-11.

## Context

The premise of the offline render ([`../EDITOR.md`](../EDITOR.md) ›
_Fixed-framerate export_) is that you perform a piece at whatever rate the GPU
gives you and re-render it at quality afterwards. That only means anything if
the second render is the first one again.

Two things stood in the way, and only the first was on anybody's list.

**The strip rolls on purpose.** A rundown's rows can name a pool rather than a
file (`wiki-random`, `ia-random`) and can shake the live look, so a take is
unreproducible by construction unless the draws come from somewhere a record can
point at. Record four good minutes with unseeded rolls and there is no way back
to them.

**And the signal path rolls too**, which was not on the list. `MixState` and
`TapeState` each own a `Wow` — the capstan's quasi-periodic wander, which draws
three times a frame — and both reached for `Math.random` from inside the frame.
`LineState` draws once a line and `ModState`'s random walk and sample-hold once
a frame each; both took a `rand` already, and the engine was passing neither. So
a `vhs` board could not have re-rendered identically however clean frame zero
was, and the 3% spread the old harness measured between two takes was never only
the feedback buffers it was attributed to.

A seed alone is also not enough, and `src/sources/pool.ts` says why: **a url is
a rendering.** Commons rolls with `gsrsort=random`, so which candidates come
back is the server's choice; archive.org's within-page ordering is upstream's;
and the url that worked today 404s when a transcode ladder is rebuilt. A seed
reproduces this app's _decisions_ — which pool, which page, which of the
candidates — and only a recorded `PoolRef` (origin, title, kind) reproduces the
_file_.

## Decision

**Everything that rolls takes a trailing `rand` argument defaulting to
`Math.random`.** The generator lives in `src/core/rng.ts` (`rngFor`,
mulberry32) and the convention is one line: a caller that has a seed passes it, and a caller
that does not keeps the behaviour it had. `mutate`, `randomPresetMix`,
`ModState`, `LineState`, `MixState`, `TapeState`, `Wow`, `StickSlip` and both
pool rolls follow it.

**The engine holds the dice for a take.** `Engine.startTake({fps, seed})` points
every per-frame modulator at `rngFor(seed)` for the length of the take;
`endTake()` puts them back on `Math.random`. Live is deliberately unseeded — a
session nobody is recording should not walk one fixed sequence from page load.

**A take records the seed _and_ the resolved picks**, never either alone, and
the picks are stored as identity (`PoolRef`) rather than as urls. The seed half
is built — the rundown carries one, `seedFor` derives a per-row generator from
it, and `renderTake` hands it to the engine. The picks half has nothing to
record yet, because nothing rolls during a render until the strip's offline walk
lands; this record is here first so that walk is built against the rule rather
than discovering it.

## Consequences

- **`Math.random` is forbidden anywhere a rendered frame can reach it.** That is
  the whole point of this record: every one of these call sites reads as
  needless ceremony in isolation, and each one deleted costs a take that cannot
  be re-rendered — silently, and only discovered by someone trying to get back
  to four minutes they liked. `scripts/rendercheck.mjs` is the guard: it asserts
  two renders of one take are the same file byte for byte, so removing a `rand`
  breaks a check rather than a promise.
- **A trailing defaulted argument, not a global generator.** A module-level
  seeded RNG would make every roll in the app one sequence, so the order the UI
  happened to ask questions in would change the answers.
- **The same seed does not hand back the same file**, and both pool call sites
  say so. What is reproducible is which pool, which page, and which of the
  candidates came back; the file itself is reproducible only from the recorded
  `PoolRef`. Anyone tempted to drop the picks and keep the seed should read this
  paragraph twice.
- **Reproducibility stops at the video decoder.** `VideoPump` pulls frames at
  wall rate, so a take over a clip is not yet reproducible whatever the dice
  did. Frame-exact pull is `EDITOR.md`'s remaining build-order item, and until
  it lands the guarantee is honest only for generated and still sources — which
  is why `rendercheck.mjs` renders bars.
- **This was cheap because the seam was already there**, for a reason that had
  nothing to do with the strip: `vote/candidates.ts` needed it first, since a
  dataset's whole claim is that a recorded seed re-renders the look it labelled.
  That is the same sentence as this record with a different noun, which is why
  `rngFor` now lives at the root and both callers share it.
