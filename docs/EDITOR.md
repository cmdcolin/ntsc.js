# The editor — a rundown, and an export an NLE will conform

Playing one source at a time is the whole app today. The ask behind this
document is music videos: a series of clips, set up in advance, played back to
back. It is the design, written before the code, because one decision in it
(seeding, below) is cheap now and expensive to retrofit.

It has two halves and a boundary, drawn twice.

- **The strip** is the live half — an ordered list of cued states you can also
  fire by hand, and a shelf of transitions to get between them. It is a rundown,
  not an NLE timeline, for reasons argued below.
- **Fixed-framerate export** is the offline half — rendering a take where frame
  N is a pure function of N, so an editor can conform the result. Most of its
  precondition is already paid for reasons that had nothing to do with export.
- **The boundary** is drawn twice, and both are argued before anything else
  because they are what shape the rest: none of this becomes a plugin for
  somebody else's timeline, and none of it becomes a page of its own either.

The two halves are one project rather than two: the live walk and the offline
walk are the same walk on different clocks, and the live one is a hard
prerequisite, since a constant-framerate render of a rolling strip means nothing
until the rolls are reproducible.

Related material deliberately left in [`IDEAS.md`](IDEAS.md): **Clip cues**
(follow-ons to a shipped feature that the strip builds on), **Patching into
other apps** (live routing to Max/TouchDesigner, a different question), and
**Capture / deinterlace** (a composite grabber on the way _in_, not out).

## What this is not: an NLE plugin

The recurring version of this is "the shaders are the value, so put them in
something that has a timeline" — After Effects, Premiere, Resolve. Investigated
and declined. The findings are in order of how fast each one kills it, and the
last is the one that would still stand if the first two were solved.

**There is no "the shaders" to port.** The WGSL is about a third of the
simulator. Against twenty-four shaders sit `src/signal/`'s per-frame CPU state
(`LineState`, `MixState`, `TapeState`, `RfState`, `SynthState`, `AudioState`,
and the FIR bank, redesigned CPU-side whenever one of the filter five moves) and
`src/gpu/`'s pass graph, uniform packing and buffer management. `PARAM_DEFS` is
228 fields, `DEFAULT_CONTROLS` 234 keys, and several buffers are _state_ rather
than scratch — `timingBuf[525..532]`, `persistBufs`, `tapeBuf`, `storePrev`.
Lifting the shaders alone lifts nothing that runs.

- **No plugin API speaks WebGPU.** OFX 1.5's GPU rendering suite is CUDA, OpenCL
  and Metal; there is no Vulkan and no WebGPU, and Adobe's SDK is the same
  family. wgpu/naga does mean the WGSL survives a _native_ port unchanged — one
  source over Vulkan, Metal and DX12, and the one genuinely reusable asset here
  — but inside a CUDA or Metal host it makes you a wgpu island paying a
  full-frame upload and readback every frame, in both directions.
- **The host's frame model fights the feedback loops.** OFX has
  `kOfxImageEffectPropSequentialRender` for temporal dependence and hosts do
  honour it for renders, but the tape ring, the phosphor persistence, the PLL's
  lock age, the AGC and the two servos all make frame N a function of every
  frame before it. Scrubbing is then wrong, playing from the middle is wrong,
  and a viewer still means nothing until it has been rendered from the top. The
  three feedback loops [`COMPARISON.md`](COMPARISON.md) names as what
  distinguishes this project are exactly the parts that cannot survive being a
  plugin.
- **The slot is taken, by a tool built for it.**
  [`COMPARISON.md`](COMPARISON.md) already routes "put this look on a clip in
  your edit" to **ntsc-rs** — same premise, in Rust, CPU-side and SIMD, already
  shipping After Effects, Premiere and OpenFX builds, and not locked to the NTSC
  raster. Going there means competing on raster independence, resolution and
  host integration, which are its three strengths and this architecture's three
  weakest points, while giving up the live instrument that is the whole reason
  for building it this way. Worth noting too that Resolve's free tier does not
  load third-party OFX, so the "more accessible" host is Studio or an Adobe
  subscription.

So the honest version of "put it in an editor" is not a plugin. It is a
**deterministic render of frame N handed over as a file** — the export half
below, whose virtual clock is the precondition every other version of this
shares, including the plugin that isn't being built. A native standalone on wgpu
stays on the table as a _shell_ decision (file writing, ProRes, a pinned
runtime, all argued under _What a desktop shell actually buys_) and never as an
integration strategy.

## What this is not either: a second page

The other version of "put it somewhere else" is closer to home and more
tempting, because it is true as far as it goes: the live app is already dense, a
rundown is a lot of new surface, and this repo has a second entry point already.
Still no. One document, and three of the reasons are load-bearing rather than
preferences.

**The strip writes; it does not view.** Every row it fires goes through funnels
the live app owns — `writeControls` / `startGlide` for the look, `selectSource`
/ `loadClip` / `showRef` for the source, `setVideoRegion` for the cue. A second
page needs a second engine, and around it a second copy of `useEngine`'s two
thousand lines of source loading, plus the bay, the tempo and the MIDI wiring.
That is a fork of the app wearing a second URL, and two copies of one contract
drift — which is the argument `slotView.ts` already makes about a much smaller
duplication.

**`vote.html` is the counter-example, and it states the test.** The second entry
in `vite.config.ts` exists on an explicit condition — "nothing in it should cost
the app a byte — a visitor to index.html never downloads it" — and the vote page
meets it: it shares `Engine` and `presets`, builds its two engines on one
device, and needs no part of the panel. The strip fails that test from both
ends. It wants nearly all of the panel, and a visitor to the strip page would
download the app entire.

**The offline half is pinned here regardless.** An offline render must adopt the
live device rather than create one
([adr/0004](adr/0004-never-destroy-a-presenting-device.md)), and a second tab
cannot adopt the first tab's. So the export has no second-page option even in
principle, and putting the strip where the export could not follow would split
one walk across two documents — see _One walk, two clocks_, which is the thing
the whole design is arranged around.

What the worry is actually about is screen space, and the app already answers
that. `usePopout` opens a same-origin window and portals the panel into it: same
React tree, same engine store, same MIDI, no message plumbing, because the JS
heap is shared. A strip that wants its own screen gets one from a mechanism that
exists, and the arrangement it enables is the right one here — picture on the
projector, rundown on the laptop. The strip is a better popout candidate than
the panel is.

So the live/edit tension is a **mode, not a page**: tray shut, the app is what
it is today to the byte. That is the property worth holding, and it is cheaper
to hold than a second entry point would be.

## The strip

**The shape is a rundown, not an NLE timeline.** Tracks, a playhead and trim
handles are built for material that gets rendered once and never touched again.
What this wants is the shape VJ tools use — an ordered list of cued states, each
of which can also fire on its own — because the same list then serves setting a
piece up _and_ playing it live, which are the same activity here at different
speeds.

### A row is a thing that already exists

`ui/urlParams.ts` calls itself "the share-link contract: everything a session
can be configured with from the query string". It round-trips the source
(`?src`, `?vurl`, `?iurl`, `?yt`), the look (`?preset`, `?set`), the modulation
bay (`?mod`) and the cue points (`?cuea`, `?cueb`, via `formatCue`/`parseCue`).
`scripts/clips.mjs` already drives whole shots off nothing else — "fully
declarative: the URL alone specifies the source image(s), preset, and param
overrides, so nothing here uploads files or clicks the UI."

So the row model is mostly done, and a row is that snapshot plus two fields: how
long it holds, and how it arrives. Everything the strip needs to serialise,
share and re-render is already serialisable, and it stays that way only if new
row state is added to `urlParams` rather than beside it.

### Three kinds of row, one shape

The strip must not be limited to naming files, because a strip of fixed clips at
fixed bar counts is a storyboard — you get the same video every time, and this
app is built around not knowing exactly what you are going to get.

- **A clip.** This source, these in/out points. `ui/cue.ts` is already exactly
  this pair.
- **A roll.** A pool rather than a file, resolved _when the row fires_.
  `POOL_MODES` (`wiki-random`, `ia-random`) is already this: "a channel is a
  search rather than a file, picking one rolls something out of it". You know
  the shape of what is coming and not which one.
- **A mutate.** Same source, jittered look, through the existing
  `MUTATE_AMOUNTS` in `ui/mutate.ts`; `presets.ts` has `rollControls` and
  `randomPresetMix` for the look side of the same idea.

One shape, three fillings — so the player walks one list and the strip renders
one kind of row.

### Loose holds by default

A row's hold is **"≈N bars" with a drift amount**, not a quantiser. Exact
beat-lock stays available per row, for the cut that has to land on a hit, but it
is opt-in.

This is a taste call and worth naming as one: defaults are where taste lives,
and the default here is serendipity. A strip whose rows roll and whose holds
drift is a _pattern_ rather than an edit — play it twice, get two different
videos — which is the behaviour worth having on a tool whose sources include two
random-access archives. The exact-lock option costs almost nothing once loose
holds exist, so nothing is lost by making the accident the default.

`ui/useTempo.ts` already supplies the beat, from MIDI clock when there is one
and a tapped `DEFAULT_BPM` underneath when there is not, so bar-relative holds
work on a machine with no gear attached.

### The row, as a type

```ts
interface Row {
  id: string
  // What this row *is* — the three fillings above, one shape.
  fill:
    | { kind: 'clip'; src: RowSource; cue: Cue | null }
    | { kind: 'roll'; pool: PoolMode }
    | { kind: 'mutate'; amount: MutateAmount }
  // How long it holds. `bars: null` is "wait for a hand".
  hold: { bars: number | null; drift: number }
  // How it arrives, off the shelf below.
  arrive: { transition: TransitionName; seconds: MorphSeconds }
  // The look, as a query string: `writeProfileParams`' output, verbatim.
  look: string
}
```

`look` as a query string is _A row is a thing that already exists_ made
concrete, and `writeProfileParams` rather than `writeSessionParams` is the
deliberate half: a row is read back weeks later, which is exactly the case that
function was split out for — resolved controls, with no `preset=` underneath to
re-supply a knob the hand had already put back. It costs a parse per row fire,
which is nothing beside a source swap, and it buys three things at once. A row
is shareable on its own. `scripts/clips.mjs` can drive one with no new contract.
And `urlParams.test.ts` is already the row codec's test.

The strip itself is not a query string — twenty rows is well past what an
address bar carries — so a rundown is JSON in `storage.ts` beside the shelf,
holding rows whose looks are strings. **A row is a link; a rundown is a file.**

`RowSource` is the one genuinely new union, and it stays small because it can
only name things that survive being written down: a shelf id (`lib:<id>`), a
`PoolRef`, a url, a YouTube url, or a generated mode. Not a `File` — the same
rule `urlParams` gives for `?src=file`, for the same reason, and `fileStash` is
already where the local answer to it lives.

### Interaction: follow the drags this app already has

**Pointer events, not HTML5 drag-and-drop.** There is no `dataTransfer`,
`onDrop` or `draggable` anywhere in `src/` — the single `draggable` hit is a
comment in `PipFrame.tsx`. Every drag here is `setPointerCapture`: `PipFrame`,
`TBar`, `TrackingPad`, `WipeFrame`, `MagnifierFrame`, `LookBar`,
`PresetsSection`, `Transport`. Matching that is not only consistency — HTML5 DnD
has no touch support and a drag image that fights styling.

The bin dragged _from_ is built: `ui/clipLibrary.ts` (the shelf, which already
holds both files on disk and kept pool rolls) and `MediaBrowserDialog`.

**Right-click opens the per-row menu, and is never the only way to reach
anything.** `ui/Popover.tsx` already has `MenuItem` on the native popover API,
so the menu is layout over existing parts; what does not exist yet is the
trigger — the only `onContextMenu` in the app is a `preventDefault` in
`TeletypePaint.tsx`. Right-click is unreachable on touch and this app otherwise
routes verbs through the command palette, so the field touched most (the hold)
belongs **visible on the row**, with the menu carrying the rest.

#### Nothing in the tray moves because its own text changed

A row card is shrink-to-fit, so **every label in it is load-bearing on layout**,
and the tray is one horizontal row of them — which means a card that grows
slides every card to its right along the strip. The controls that change their
own text are exactly the controls a hand clicks repeatedly, so the failure is
specific: step the hold chip and the ✎, the ⧉ and the ✕ beside it walk out from
under the pointer that is still resting on the chip. This is the same rule a
slider's readout already follows (`Slider.module.css`'s `.reading` — "a box that
does not depend on the number"), one layer out.

`scripts/traylayout.mjs` measures it, and measured all five of these before they
were fixed:

| what changed              | what moved                                                                     |
| ------------------------- | ------------------------------------------------------------------------------ |
| hold chip, one step       | 6.6px — the card and every card right of it                                    |
| arrival chip, one step    | 6.6px, the same way                                                            |
| transition chip, one step | 1.1px — the `min-width: 1.4em` floor was under the widest glyph                |
| the rename ✎              | 21.8px — an `<input>` in the flow carries twenty characters of intrinsic width |
| ▶ play → ■ stop           | 4.3px — the five bar controls after it, including **+ row**                    |

Four things worth keeping, because none of them is guessable from the fix:

- **The reserve is a property of the _ring_, not of the value in it.**
  `HOLD_LABEL_CHARS` and `MORPH_LABEL_CHARS` are derived from the rings
  themselves, so a longer hold added to `HOLD_BARS` widens the chip rather than
  quietly restarting the shift on the one row that reaches it.
- **A `<button>` is `border-box` in every UA stylesheet**, so a width in `ch`
  reserves room for the text _and_ the padding it sits in, and comes up two
  characters short. That is the whole of why the first reserve looked like it
  simply did not work. `--chip-pad` exists so the two cannot drift.
- **A glyph ring gets a fixed width, not a floor.** The transition chip's ring
  is drawn from whatever font has those characters, so no `ch` count describes
  it — at a fixed width the layout stops asking how wide the glyph is at all.
- **The rename field is laid over the face, not swapped for it.** Out of flow it
  contributes no width, which is what the stylesheet had claimed all along and
  could not deliver from inside the flow.

And the cost, which is real: the feet are six controls, three of them now held
at a fixed width, and together they come to more than the card's floor — so the
cards come out very nearly equal. The variety they used to have was not the
names, it was the hold chip being three characters wider on some rows than
others. That is the shift, not the feature. Cards that say something by their
width want the _hold_ to set it, which is _Seeing the shape_ below.

### Performance: the boundary is the only cost

Steady-state playback does not care how long the strip is. `VideoPump.due()`
gates on `el.currentTime !== slot.lastTime` and yields one `createImageBitmap`
per newly decoded source frame (or hands the element over directly in `direct`
mode), so one clip and forty clips cost the same per frame. All of the cost is
at the cut: `stopSlot`, a new element, the network, the first frame.

So the performance work is exactly one thing — **preroll depth 1**. A slot holds
the live element and the next one, already loaded and seeked to its in-point,
and swaps at the boundary. `VideoPump.retarget()` already handles a mid-run swap
correctly: it bumps `gen` so the outgoing decode cannot write into the new slot,
clears `inFlight`, and sets `lastTime = -1` so the next frame is requested even
though the element may sit paused at an unchanged `currentTime`.

Two constraints on that:

- **Depth 1, not the whole list.** Each prerolled element is a live decoder, and
  an archive.org pick is a `blob:` holding the entire file (`sources/pool.ts`
  says why it downloads whole). A deep preroll is a memory bug waiting to
  happen.
- **It lives inside a slot, not on deck B.** B is the mix source and a take will
  want it. `videoSlot.ts` currently assumes one element per slot; that
  assumption is the change.

Free consequence worth taking: two elements is what an audio crossfade needs.
The hard cut in a looping clip's audio is filed in [`IDEAS.md`](IDEAS.md) ›
_Clip cues_ as "a real limit rather than a choice", because a `<video>` has one
read head — a preroll element is the second one.

**That turned out to be right about the mechanism and wrong about the field.** A
loop's second head shipped as its own element rather than as a use of the
preroll, and IDEAS.md › _Landed: the second read head_ says why: a preroll is
speculative and can cost a whole download, while a head is the same url as the
clip on air, so the ceiling this section argues for is not one the two share.

#### Landed

`videoSlot.ts` holds two elements, `strip.ts` looks one row ahead, and the two
meet at `playUrl` — which every clip load in the app already came through, so
the picker, a pool pick, a link's `?vurl` and a strip row all spend a preroll
without knowing it exists. `scripts/prerollcheck.mjs` measures the cut at **9ms
warm against 58ms cold**, on a small file over localhost, which is the least
favourable case there is: over a network the gap is the network.

Four things worth knowing about how it landed.

- **Depth 1 is structural, not a rule to remember.** There is one `next` field
  per slot and `prerollUrl` clears it, so a second preroll retires the first. A
  queue would have needed a policy; a field cannot hold two.
- **The lookahead is a fact about the rundown, not about the frame.** It is
  emitted by `land` rather than `fireEffects`, so firing row 3 by hand out of a
  bank of scenes still loads what row 4 would want — running on is what a walk
  does next either way. It comes last in the step, after the row's own effects,
  so the deck is pointed at what is on air before anything starts fetching what
  follows.
- **A row that cannot name its clip in advance simply produces no effect**, and
  the three cases are all fine: a pool is a search rather than a file, a still
  needs no element, and a look-only row leaves the deck where it is — which is
  the case with no boundary cost to save in the first place. `prerollFor`
  resolves the two that can be named: an explicit `?vurl`, and a bundled clip
  id, which is a url on the slot's side of the boundary.
- **`stopSlot` deliberately leaves a parked element alone.** The load paths stop
  the slot and _then_ call `playUrl`, so a `stopSlot` that retired the next
  element would destroy it a line before the cut it was loaded for. What bounds
  it is the one-field rule above rather than that call.

Both things filed as waiting on this have landed: **transitions between rows**
is written up below, and **the second read head** the crossfade was filed under
is IDEAS.md › _Landed: the second read head_ — which took the mechanism from
here and not the field, for the reason above.

What that leaves is smaller than the entry it closes, and IDEAS.md says so:
removing the seek removed the _dropout_, and the join is now a hard splice
between two elements at zero gap — a click of about one frame, where a fade
across the join is the standard fix. It was worth nothing against a half-second
hole, and it is what remains.

### Seeding: the decision that is expensive later

**Every roll goes through a seeded RNG, and a take records the seed plus the
resolved picks.** This is the one thing in here that must be right from the
first commit.

If rows roll, a take is unreproducible by construction — and the whole point of
the fixed-framerate export below is to re-render a take at quality after
performing it. Record four good minutes with unseeded rolls and there is no way
back to them. Storing the resolved picks means storing **identity, not urls**,
for the reason `sources/pool.ts` already gives: a url is a rendering, and the
one that worked today 404s when a transcode ladder is rebuilt. `PoolRef` — its
origin, title and kind — is the thing to keep.

This is also the natural carrier for the automation recording described under
_Fixed-framerate export_ — control writes with frame stamps, replayed offline. A
seed plus a resolved pick list plus stamped control writes _is_ a take.

**What the rule actually costs, checked against the code:** much less than the
warning implies, because the seam is nearly all built and was built for other
reasons. `mutate()` takes a `rand` and always has. `randomPresetMix` takes one
too, and the note above it says why — the vote page could not have existed
otherwise, since "a label is worthless if the thing labelled cannot be rendered
again" is the same sentence as this section with a different noun. `modstate`,
`noise` and `linestate` each take one. And `vote/candidates.ts` already had the
generator — mulberry32, `rngFor` — and already threaded a seed end to end, side
assignment included.

That did not weaken the rule, it sharpened it: everything expensive about
seeding had already been paid for, which is why the plumbing landed first.

**Landed.** `src/rng.ts` holds `Rand`, `rngFor` (lifted out of
`vote/candidates.ts`, which still uses it), `randomIndex` (moved off `pool.ts`)
and `pickOne` (lifted out of `commons.ts`, where it was private). Both pool
rolls take a trailing `rand`, through the one `rollPool` funnel, so a row that
names a pool resolves it from the take's generator rather than from
`Math.random`.

**And the signal path rolls too**, which this section did not say and _Take
state_ found: `MixState` and `TapeState` reached for `Math.random` from inside
the frame, through the `Wow` each owns, so a vhs board re-rendered differently
every time however clean frame zero was. Both take a trailing `rand` now, on the
same convention, and the engine hands all of them — those two, `LineState`, and
the bay's random walk and sample-hold — one generator seeded per take.

What that does **not** buy, and the code says so at both call sites: **the same
seed does not hand back the same file.** Commons rolls with `gsrsort=random`, so
which twelve candidates come back is the server's choice; archive.org's
within-page ordering is upstream's too. A seed reproduces this app's _decisions_
— which pool, which page, which of the candidates — and the recorded `PoolRef`
reproduces the _file_. Which is why the rule is a seed **plus** the resolved
picks, and never either one alone.

This rule is [adr/0006](adr/0006-a-take-is-a-seed-and-its-picks.md), because it
is the one a later reader would otherwise be within their rights to simplify
into `Math.random()`.

### One walk, two clocks

Playing the strip is: walk the rows, apply each through the existing
`writeControls` / `startGlide` funnel, preroll the next row's source. That walk
is the same live and offline; only what advances it differs.

- **Live** — wall clock, preroll depth 1, manual override (jump to any row,
  hold, retrigger).
- **Offline** — the virtual clock from _Fixed-framerate export_ below, where
  frame N is a function of N.

Which is why the live path is worth building first: it is a hard prerequisite
for the offline one, since a CFR render of a rolling strip means nothing until
the rolls are reproducible.

**Landed, and it is nine lines** — `offlineWalk` in `ui/stripRun.ts`, beside the
`runStep` it calls. Everything that made it nine lines was built before it:
`advance` already took a `Clock` and never cared where the frame came from,
`runStep` already turned a step into calls, and _Take state_ made frame zero the
same frame zero every time. So the difference between a performance and a render
really is only _what advances the frame_ — rAF reading the engine's counter, or
`renderTake`'s own loop through a new `onFrame` hook. `scripts/rendercheck.mjs`
renders a three-row rundown twice and gets one file, with a bare render of the
same take as the control arm.

Three things worth knowing about the shape it landed in.

- **The offline walk keeps its own place, and the live one is stopped.** A
  render is not a performance: pressing ⎙ stops the tray's walk and starts a
  fresh one at the top, so a take begun mid-set does not inherit where the set
  had got to and finishing one does not move it. What the two share is the sink
  — a rendered take asks the browser for exactly what a performed one does,
  which is the whole of "one walk".
- **`onFrame` fires before the step, not after.** A row applied after the engine
  stepped would be a cut landing one frame late, every time and in the same
  direction, which is precisely the error no assertion about frame rate would
  catch.
- **The render does not wait for a source to load**, and that is the honest
  limit of this piece. `applySession` fires its loads and returns; a row naming
  a clip therefore arrives when it arrives, exactly as it does live. For a
  rundown of look changes, shakes and generated sources — which is what the
  common case looks like, per _A row is a thing that already exists_ — the take
  is reproducible today. For one naming clips it is not, and it cannot be until
  frame-exact video pull lands, because a `<video>` pulled at wall rate is not
  reproducible however patiently the walk waits for it. That is why the awaiting
  sink `stripRun.ts`'s header describes is still described rather than built:
  the seam is worth nothing until the thing on the other side of it is frame
  exact.

### The modules, and what does not need a browser

The walk is where an editor gets its bugs, and a browser is an expensive place
to find them. So the split is the one `cue.ts`, `deck.ts` and `modSlots.ts`
already model — the arithmetic is pure and tested under vitest, and React only
carries out what it says.

- `ui/strip.ts` — **landed.** The row type, the codec, and
  `advance(strip, walk, clock) → { walk, effects } | null`. One pure function:
  given a rundown, where the walk is and what frame it is, what changes. Effects
  are a small union, never engine calls.
- `ui/stripRun.ts` — **landed.** The interpreter: one effect against a
  `StripSink`. Plain functions, no React, so a fake sink tests the whole walk
  end to end and the offline render reuses it rather than reimplementing it.
- `ui/useStrip.ts` — **landed.** The driver, in two halves: `makeStripRunner()`,
  a plain object holding the rundown, the walk and the subscriptions, and the
  thin hook over it. Only the hook needs a browser, and it holds the only
  effects in the feature.
- `ui/StripContext.ts` — the contexts, split on the rule below.
- `ui/transitions.ts` — the shelf as a table (below). Pure.
- `ui/StripTray.tsx`, `ui/StripRow.tsx` — the surface, on the pointer drags
  _Interaction_ names. The shell in `app.module.css` currently sets `.stage` and
  `.panel` side by side as one flex row; the tray puts the stage in a column
  with the tray under it, and the panel is untouched. Not a section _in_ the
  panel: a rundown does not fit 332px, and the tray is where a hand works during
  a take rather than where a circuit is dialed in.
- `rng.ts` — the seeded generator and the two pickers over it, landed already
  (see _Seeding_). The strip's own seed is the only new caller.

**The walk advances on the engine's frame counter, not on a wall clock.**
`advance` takes a frame and a tempo, so "≈4 bars" is arithmetic over
`frameNo()`. That makes the live driver a poll on the tick that already reads
the playheads at 10 Hz, and the offline driver a call per rendered frame with
nothing else changed. It is _One walk, two clocks_ built rather than promised,
and it is why `advance` should be a function of a frame in the first commit
instead of a `setTimeout` that gets replaced later.

### The React shape, and the rule it follows

This is the part most likely to be added to for years, so it is worth settling
before a component exists. The app has already paid for the lesson twice, and
both receipts are in the tree.

**One context per clock.** `ControlsContext.ts` carries the measurement: a
`controls` object on the API changed identity on every write, so every consumer
re-rendered no matter what the compiler had memoized — 19 ms of React per slider
write with all the rows mounted, which is past a frame and dropped one off the
WebGPU loop per pointer move. The fix was to split what _moves_ (a subscribe/get
`ControlStore`, read through `useSyncExternalStore`) from what is _stable_
(`ControlsApi`, whose every member keeps its identity across a write).
`ModSlotsContext.ts` is the same rule from the other side: it stays one plain
context, with no store, precisely because a bay changes when a hand patches it
rather than at frame rate — and it is a separate context from the controls
because "the two move on completely different clocks".

The strip has three clocks, so it gets three homes and not one big
`StripContext`:

- **The rundown** — rows, holds, arrivals. Moves when a hand edits it. Ordinary
  state behind an API context of stable verbs (`addRow`, `moveRow`, `setHold`,
  `fireRow`, `start`, `stop`).
- **Which row is up** — moves at row boundaries, seconds apart. Ordinary state.
  Cheap, and every row card wants it.
- **How far through the hold** — moves every frame. A subscribe/get store, read
  by the one element that draws the progress. This is not a new invention:
  `morph.ts`'s `MorphStore` is exactly this shape, for exactly this reason, and
  `LookBar.tsx` is the widget that subscribes to it. `holdProgress` in
  `strip.ts` is already the pure function behind it.

**The compiler decides where the walk lives, and it is not `useState`.** The
obvious spelling of the driver keeps the walk in state and mirrors it into a ref
for the rAF closure to read. Writing a ref during render is one of exactly two
patterns that make React Compiler give up on a hook _silently_, and quieting the
resulting dependency warning with `eslint-disable` is worse — it skips
optimisation for the whole hook. Both were tried here and `pnpm compiler` caught
both, which is what that gate is for. So the runner is a plain object outside
React, handed to `useState` once and read through `useSyncExternalStore`: the
same answer `ControlStore` and `MorphStore` already reached. The side benefit is
the one that matters longer — a driver that is not a hook is a driver a test can
drive, and the walk's own logic is covered without a DOM.

**The driver is the only effect.** `useStrip` synchronises with things outside
React — the engine's frame counter, and the async work a roll starts — which is
what an effect is for. Nothing else in the feature is. In particular, three
things that will look like effects and must not become them: the hold's progress
is _derived_ from the walk and the frame, not state kept in step with them; a
row card's "am I live" is a comparison during render, not state; and persisting
the strip belongs in the verb that changed it, the way `useTempo` already writes
its tempo in `write()` rather than in an effect watching it. An effect that
mirrors state into other state is the failure mode this app has been careful to
avoid, and a feature this size is where it would creep in.

**Effects as data is what keeps the additions cheap.** Everything on the roadmap
— preroll, the fault shelf, takes, per-row MIDI, the offline render — lands as a
variant on `Effect` and an arm in `stripRun`'s switch, with `advance` deciding
when. The offline renderer is then a second caller of the same two functions
with a different `Clock` and a different sink, rather than a parallel
implementation that drifts. That is the whole reason `advance` returns a list
instead of calling the engine, and it is worth defending when the first "it
would be simpler to just call it here" arrives.

The corollary is worth saying out loud, because it will read as a missing
feature: **the walk has no seek.** Row N depends on every row before it — a
mutate jitters what is live, a roll draws from a stream of numbers with a
position in it — so a rundown plays from the top or not at all. That is the
property the signal path has had all along, and it is most of why this cannot be
a plugin (_What this is not_). It is also why _Deliberately not this_ can rule
out a scrubbable playhead at no cost: there was never one to lose.

### Transitions: a fault that resolves, not a drawn wipe

A row's second field is how it arrives, and the parts for the boring version are
already there — `ui/morph.ts` gives a `morphTo` over `MORPH_SECONDS`
(0/1/4/8/30), `presets.ts` has `blendPresets`, `TBar.tsx` is the A/B throw. But
a look-morph is not a transition. It walks the resting board from one place to
another and the picture stays legible the whole way; nothing about it says a cut
happened.

The idea worth building is the iMovie shelf of named transitions, done the way
this project does everything else: **a transition is a fault that happens to
resolve.** You do not draw a wipe over the cut — you break something, cut while
it is broken, and let it heal onto the new clip. That is a transition an NLE
cannot ship, because its transitions are composited over two finished pictures
and these are a receiver genuinely losing and regaining its grip.

Three things follow, and they are what make this a design rather than a preset
list.

- **A transition is two curves and a cut point, where a morph is one walk.** The
  fault ramps _up_ on the outgoing clip and _down_ on the incoming one, and the
  source swap lands at the peak — the frame where the picture is least legible
  is the frame that hides the edit. So the shape needs a duration (borrow
  `MORPH_SECONDS`) _and_ a cut fraction, usually but not always 0.5. The
  modulation bay's `trig` one-shot is the nearest existing envelope and the
  wrong one: it is instant-attack by design, and a transition needs the attack.
- **The domain you break decides what the transition reads as** — the same
  three-way split [`ARCHITECTURE.md`](ARCHITECTURE.md) draws. One transition per
  domain is a genuinely varied shelf rather than one effect at five intensities:
  _signal_ (`trackAmt`/`trackPos` sweeps a tracking band down the frame, the
  clip changes underneath it, the band retreats), _sync_ (`hHold`/`vHold` pushed
  past the receiver's capture range so the picture rolls, the cut lands
  mid-roll, and `autoLock` re-hunts onto the new source), _deflection_ (`vSize`
  and `hvSagUs` collapse the raster toward a line and reopen — the CRT
  power-cycle, and the one everybody recognises). Add the tape ones for free:
  `shuttleX` bars sweeping with the new clip between them, or `dubGens` ramped
  1→4→1 so the incoming clip arrives already worn and cleans up.
- **The mix path changes what a transition even is**, and this is the part with
  no equivalent anywhere else. `bGenlock` is documented in `controls.ts` as "0
  dirty sum .. 1 clean genlocked crossfade". Genlocked, a transition is a real
  dissolve and the fault is decoration on top of it. On the dirty sum both
  composites are on the wire at once and the receiver has to pick — so the
  transition _is_ the two signals fighting for lock, and which one wins mid-cut
  is emergent rather than authored. A "dissolve" that is actually two decks
  arguing is the single most on-premise thing in this document.

Cheap to start: a transition is a named recipe over controls that already exist,
so the first shelf is a table plus the envelope and the cut point — no new
uniforms, no new pass, no shader work at all. It composes with morph rather than
replacing it (the look glides while the fault does the cutting), and every entry
is reachable from the strip, from the T-bar and from a MIDI pad, because all
three already write through the same `writeControls` funnel.

Two known-hard parts, so nobody starts with them: a transition needs both clips
live at once, which is the preroll above and the reason it is filed after it;
and a fault big enough to hide a cut is a fault big enough to be unpleasant at
the wrong duration, so the shelf needs taste-setting defaults far more than it
needs range.

#### Landed, and what it cost

`signal/fault.ts` is the envelope, `ui/transitions.ts` is the shelf, and
`Engine.startFault` is the one verb between them. Five entries — `track`,
`roll`, `collapse`, `shuttle`, `dub` — under the T-bar in the deck, and each is
an action a MIDI pad can be bound to. It was as cheap as this section promised:
no new uniforms, no new pass, no shader work at all.

Two of the five predictions in it were wrong, and both in the same direction.

- **"A table of named recipes over existing controls" undersold the table.** Two
  of the five recipes as written here did nothing. `hHold`/`vHold` past the
  capture range rolls a picture only if there is something to roll _to_ — an
  oscillator free-running at exactly 60 sits still however completely it wins,
  so `vFreqHz` is the key that makes the mechanism bite and it is not named
  above. And `dubGens` ramped 1→4→1 compounds damage rather than inventing it:
  four passes over a clean board is four times nothing. Both measured at
  0.4-0.6/255 from rest by `scripts/faultcheck.mjs` — transitions that
  transitioned nothing — and both were fixed by naming the rest of the mechanism
  rather than by turning anything up.
- **Duration is per entry, not a rate control.** This section says "borrow
  `MORPH_SECONDS`", and the deck's own take rate was the obvious hand to put it
  in. Both are wrong for the same reason the taste note above is right: a raster
  takes about a second to collapse and reopen, three generations of dub need two
  and a half to read as wear rather than as a glitch, and a rolling picture
  stops being a transition after one. A single thumbwheel over all five is a
  knob whose good setting changes with the button next to it. It also makes a
  bound pad fire exactly what the button fires, with no deck-local state a pad
  cannot see.

And one thing it was right about without saying why. **The picture resolves
after the board does.** The fault is handed back inside the frame it ran — the
resting board is untouched, which is the invariant the whole design rests on —
but the phosphor is still holding the band, the delay loop has recorded the
broken frames, and the PLL is still walking its lock back. So a transition ends
as a receiver recovering rather than as an effect switching off, which is the
half of "a fault that resolves" that no recipe writes down and no NLE can
composite.

#### Landed: between rows

A row carries `arrive.transition` now — the field this section's `Row` type
predicted — and the whole of the difference is **when the row's step lands**. A
plain row does it when the row fires; a transition row hands the engine a fault
whose `onCut` does it, so the source swaps on the frame the picture is least
legible and the fault heals onto the new clip.

`scripts/faultcheck.mjs` measures exactly that:
`fired@0 cut@30 session@30 preroll@30`, which is a one-second `collapse` cutting
at 0.5 with the row's whole step arriving thirty frames after the row did.

- **One `onCut`, two cuts.** Off the deck a transition throws the T-bar; off a
  row it runs the row's step. Same fault, same plan, same `faultPlan` — which
  takes its `onCut` from the caller precisely so the shelf never had to learn
  what a rundown is.
- **The two arrivals are separate chips because they are separate things.** The
  look glides over `seconds` while the fault does the cutting, which is the
  pairing this section asks for, so neither is a mode of the other. `null` is
  the plain cut and the head of the ring: it is the ordinary arrival, and the
  one a hand steps back to when a fault is too much for the moment.
- **The chip draws a glyph, and had to.** The shelf's words are a deck button's
  width; a row card is 190px holding six controls, and "collapse" pushed the ✕
  out past the card's `overflow: hidden`, where it was invisible, unclickable,
  and the only way to remove a row. Measured at 203px of feet in a 190px card,
  on a perfectly ordinary row. So each shelf entry carries a one-character
  `glyph` for the card and keeps its `label` for the deck, which is the
  arrangement the `.kind` chip beside it already uses — one character, words in
  the title. One character _each_ is the other half: a chip that resized as the
  ring stepped moved the ✎ and the ⧉ under the pointer that was stepping it,
  which is the rule the card's own rename field already states.

  **One character each was not enough**, and finding out why is _Nothing in the
  tray moves_ above. These glyphs come from whatever font has them, so they are
  one character and six different widths; the `min-width: 1.4em` this shipped
  with sat under the widest of them and left a 1.1px step, which is the same
  shift as the 6.6px one next to it and only quieter. The chip holds a fixed
  width now, so the layout never asks how wide the glyph is.

  Worth keeping, because it is about the harness and not the feature: naming the
  controls `data-act` made `traycheck.mjs` robust to layout edits and, in the
  same stroke, blind to this. `element.click()` does no hit-testing, so it
  reaches a button a hand cannot. The tray harness now _measures_ one thing
  rather than clicking it — that every control on a card is inside the card.

- **Preroll is what makes it land.** The row before loaded the clip and parked
  it, so the cut promotes an element rather than starting a load — the swap is a
  swap, which is what "a transition needs both clips live at once" meant.

**The fault defers the whole step, and the first cut of this shipped deferring
only the session.** That reads like a detail and was three bugs, all from the
same inversion: a row's other effects went on firing at the moment the row did,
while the session they are supposed to depart _from_ waited for the cut.

- **A roll row stopped reproducing.** `applySession` re-rolls a `?src=…-random`
  itself, so the late session kicked off an _unseeded_ roll that took a fresher
  `beginLoad` token than the seeded one fired half a second earlier — and the
  later token wins. The take's own generator was drawn from and then overruled,
  which is precisely what [adr/0006](adr/0006-a-take-is-a-seed-and-its-picks.md)
  says must not happen. Nothing looked wrong in the effect list, because the
  list order was right and only the clock was not.
- **A shake row lost its shake**, overwritten by the session it was a departure
  from.
- **And every transition cut paid the cold price**, on exactly the rows preroll
  was built for. A slot parks one element and `prerollUrl` clears it, so a
  transition row's lookahead retired its _own_ parked clip a moment before the
  cut that was going to promote it — `playUrl` then found no match and loaded
  from scratch. Worse than losing the 9ms-against-58ms: in an all-transition
  rundown every parked element was a whole file downloaded, decoded and dropped
  unspent.

So the rule is one sentence — **a transition row does at the cut exactly what a
plain row does when it fires** — and the type carries it: the `fault` effect
holds the step (`atCut`), the sink's `fault` verb takes a callback rather than a
session, and `useEngine.faultTo` is the shelf lookup and nothing else.

**And a pending cut goes stale.** The other half of "the step lands half a
second later" is that half a second is long enough for the answer to change: a
hand firing a row mid-transition watched it arrive and then be replaced by the
row it had just cut away from, and pressing stop stopped the walk and the music
and then changed the source anyway. So the runner numbers its steps and the cut
checks its number before running — on the sink, so the offline walk inherits it
rather than needing its own copy. **The fault itself is not cancelled**, and
that distinction is the whole of it: a fault is a picture effect and should heal
rather than vanish (the board is handed back by the frame that ran, so stopping
one mid-flight is a jump), while the cut is a decision, and only decisions go
out of date. The two things worth keeping from how it was found: the assertion
that should have caught it pinned `['fault', 'roll']`, which was the right
_order_ in a list whose order had stopped meaning time; and the browser harness
re-implemented `faultTo` inside itself rather than calling it, so it measured
the engine's timing correctly and the app's wiring not at all.

And one thing worth keeping that is about the harness rather than the feature.
The card's chips and verbs were reached _positionally_ by `traycheck.mjs`, so
adding one chip silently shifted three unrelated buttons — a run that deleted a
row where it meant to rename one and reported it as five failures in features
nothing had touched. They carry `data-act` names now. A harness that indexes a
layout will fail the day the layout is edited, and it will not fail where the
edit was.

#### The envelope belongs in the engine, not in React

A transition is two curves and a cut point, and the obvious way to draw curves
is a rAF loop in the panel writing `preview()` sixty times a second. Don't. That
is React work at frame rate on the one path that must not have any, and the same
loop is wrong offline, where there is no rAF and a frame is not a millisecond.

The engine has this shape twice already. `setStab` is a plan handed over once
and "applied and undone inside a single frame"; the modulation bay is the same
contract at eight slots. A fault is a third instance, beside `startGlide`:

```ts
startFault(plan: {
  peak: Partial<Controls>  // the fault at full depth
  frames: number           // its span
  cut: number              // where the source swap lands, 0..1
  onCut: () => void        // fired once, on the peak frame
}): void
```

Evaluated where the bay is evaluated — additively over the resting controls,
inside the frame, never touching what React renders from. Three things then come
free. It is frame-clocked, so it is already right under the virtual clock. It
composes with `startGlide` instead of fighting it, which is the pairing
_Transitions_ asks for: the look walks while the fault cuts. And it is one
object an automation recorder can stamp, when that arrives.

The cut is a callback rather than something the panel polls for because the swap
has to land on the peak frame and nothing in React runs that often — the same
argument `setVideoRegion` already carries for living on the engine rather than
in the panel.

### The first slice, and where the cut runs

Everything above is the strip finished. What is worth building first is smaller,
and the line to cut along is the preroll.

**In, and landed:** the row type and its codec, `advance` and its tests, the
tray with rows that hold and fire, drag-to-reorder, the hold chip visible on the
row, roll and shake rows, the seeded RNG from the first commit, and arrival by
look-morph — `morphTo` needed nothing new. One rundown in `storage.ts`, not a
library of them.

Three things went in that this list did not ask for, and each earned it by being
what the thing was unusable without. **Names on rows**, because a rundown of
look changes over one clip is four cards all reading "look only" — accurate and
useless, and the common case. **Undo on the rundown**, its own walk over
`history.ts` rather than a share of the look's, because a mis-clicked ✕ on a row
you spent five minutes dialling in was otherwise gone for good. **Duplicate**,
which is the cheapest thing an editor gives you and was three lines.

**Out, and in this order afterwards** — the first three are in, in that order:
~~preroll depth 1~~, where `videoSlot.ts`'s one-element-per-slot assumption was
the change; ~~then transitions between rows~~, which needed it, because a fault
that hides a cut needs both clips live; ~~then the second read head~~ the audio
crossfade was filed under, which took the second element's mechanism and a field
of its own (IDEAS.md › _Landed: the second read head_) and leaves the de-click
envelope behind it; then takes, which want the export to exist before they are
worth recording.

The transition shelf is deliberately not in either list, because it does not
belong to the strip. A and B are both live today, so the first faults run off
the T-bar and a MIDI pad with no rundown anywhere near them — build order,
step 3. By the time the strip can preroll, the shelf is a table it picks from.

### What a first user will reach for and not find

Worth writing down against the shipped thing rather than the planned one,
because two of these are bigger than anything left on the build order and
neither was obvious from the design.

- ~~**The music.**~~ **Landed, in the smallest form that is worth anything: one
  transport.** ▶ takes the picked track from the top and the walk with it, stop
  stops both, and a rundown that runs off its end stops the music too — the rule
  is one sentence, _the track runs while the walk runs_. Firing a row by hand
  deliberately does not touch it: that is a hand reaching into a take, not the
  take restarting. `useAudio` gained two verbs over the element it already owns
  (`track.restart` / `track.pause`); the tray names what is loaded and opens the
  same picker the Sound stage does, since a rundown is where you decide you want
  a track and that picker is four sections down behind a fold.

  **This is a start, not a lock,** and the difference is worth stating because
  it is what someone will hit next. The walk still advances on the engine's
  frame counter, so the two are together at frame zero and a tempo that is wrong
  drifts against the music over minutes — fine for a three-minute piece with the
  BPM tapped in, not fine for a set. Cutting to the track's own clock is the
  bigger version: it wants the walk's `Clock.frame` derived from `currentTime`
  rather than from `frameNo()`, which `strip.ts` is already indifferent to, plus
  an answer for what a rundown does when the song ends. Worth noting the whole
  thing was missing from the build order — that order was written about export
  and transitions, which are what a _finished_ piece needs rather than what
  making one needs.

- **A file at the end.** Build order step 1 (`VideoEncoder` CFR) is still the
  answer, and it is now the only thing between a rundown that plays and a
  rundown somebody else can watch. `useCapture` still records wall-clock VFR.
- **Seeing the shape.** Every card is the same width, so a strip cannot be read
  for its rhythm — sixteen bars and one look the same size. Cards sized by hold
  would say more than any chip does. Cheap, and deliberately not done yet:
  proportional widths and a horizontal scroll fight, and that wants a decision
  about what the tray is when the piece is four minutes long.

  This is now _exactly_ true rather than nearly so, and the reason is worth
  having: the widths the cards used to differ by were the hold chip's own label
  length, which is to say they were the shift _Nothing in the tray moves_ above
  removed. Nothing was lost — a card three characters wider because it says
  `≈16 bars` instead of `hold` was never the rhythm being asked for here. What
  this wants is a width the hold _sets_, which is a different mechanism and
  compatible with the reserves: an explicit card width leaves the chips inside
  it to fit, rather than the chips deciding it from underneath.

None of these change the design above; they are what an hour of using it says
about the order to build the rest in.

What that leaves is an editor whose rows land on hard cuts, and that is the
honest first version. A rundown that plays is worth having on its own, and the
thing that makes the cuts good is a known, ordered piece of work rather than a
redesign.

### Deliberately not this

- **Tracks, a scrubbable playhead, trim handles.** A large amount of UI for a
  storyboard, and the argument in [`IDEAS.md`](IDEAS.md) › _Clip cues_ applies —
  the panel is built around what a hand moves during a take.
- **ffmpeg.wasm anywhere in the live path.** It is a transcoder, not a player.
  Concatenating clips with it means re-encoding ahead of time (stream-copy needs
  every clip to match codec, resolution and timebase), losing live cut points,
  and stacking codec damage _upstream_ of the signal path — backwards for a
  project whose premise is modelling the mechanism. `scripts/clips.mjs` already
  shells out to native ffmpeg offline, which is where it belongs.

## Fixed-framerate export

Rendering a clip where frame N is a pure function of N, at a constant frame
rate, decoupled from whatever the GPU managed in real time. It is what separates
"screen recording of a toy" from "an export an editor will conform".

The expensive precondition is already paid, for reasons that had nothing to do
with export. **The signal path is a fixed-timestep 60 Hz simulation:**

- Artifacts clock off the frame counter, not the wall clock —
  `impulseStorm(this.frame / 60)`, and the comment above it says it outright
  ("deterministic in the frame count, so harness runs stay reproducible"). Same
  for `tapeFrame`, `scPhase`, `shuttlePhase`, `impulseTrainPos`.
- The modulation bay is `const DT = 1 / 60` (`signal/modstate.ts`) advanced once
  per rendered frame. LFOs, random walk, Lorenz, envelope decay — all of it.
- `Engine.step()` already exists and deliberately forces a full sim step past
  `timeScale` and the frame lock. `scripts/shot.mjs` already drives 120 frames
  through it with rAF out of the picture, because occluded windows throttle rAF.

So "render frame N" is nearly a pure function already. Four things are not.

- **The video source — this is the actual project, and the only large item.**
  `VideoPump.due()` gates on `el.currentTime !== slot.lastTime`, and a `<video>`
  advances at wall rate. An offline loop faster than real time therefore renders
  the same input frame hundreds of times; one slower than real time skips. Needs
  frame-exact pull, and the async decode has to be _awaited_ before the render
  call rather than polled the way `pump()` does. Two routes:
  - _Cheap:_ `el.currentTime = n / fps`, await `seeked`, decode. The cost model
    is already measured — `scripts/loopseek.mjs` and the `WrapHealth` comment in
    `videopump.ts` put it at ~17 ms plus ~0.3 ms per frame walked forward from
    the previous keyframe. A 60 s render at 60 fps is 3600 seeks, which is fine
    offline, except that **two of the four shipped clips already stall on this**
    — a badly-keyframed source is pathological, not merely slow.
  - _Proper:_ WebCodecs `VideoDecoder` plus a demuxer (mp4box.js), pulling
    frames in decode order by index. No seeking, no `createImageBitmap` race.
    **But see the Firefox constraint below — it does not land cleanly here.**

  **Measured, and the cheap route is dead.** `scripts/pullstep.mjs` asked the
  one question the cost model above does not answer: a render's seek is
  _forward, by one frame, from where the decoder already is_, and if a decoder
  continues in place then the keyframe spacing stops mattering entirely. It does
  not. A one-frame forward seek costs what a seek across the whole clip costs —
  38 ms against a random seek's 35 ms on a 3s GOP, 183-607 ms on a
  single-keyframe clip — against a 2-3 ms decode floor measured on the same
  fixture with the seek path left alone. So `loopseek.mjs`'s table applies 3600
  times in a 60-second take rather than once a lap: one second of 60 fps take
  costs 2.3 s of pull on the good clip and 6-11 s on `public/test.mp4`'s
  structure.

  Two further readings from the same run. Stepping 1:1 through a sparse clip is
  _worse_ than seeking randomly through it (607 ms against 268 ms), because each
  step is one frame further from the single keyframe — the cost climbs as the
  take goes on. And **`seeked` is not a promise that the picture moved**: on the
  all-intra arm, where seeks complete in ~7 ms, `createImageBitmap` handed back
  the pre-seek frame about half the time, so the route needs rVFC to confirm the
  frame as well as `seeked` to confirm the seek — and would still be paying the
  costs above.

  **So the proper route it is, and both halves have landed.** `ui/mp4demux.ts`
  is the demuxer — not mp4box.js, for the argument `mp4.ts` already makes in the
  other direction, and it is checked against ffprobe on real files by
  `scripts/demuxcheck.mjs` rather than only against itself. `ui/framePull.ts` is
  the walk over `VideoDecoder`: ask for a clip time, get the frame a viewer
  would see there, at **0.85 ms a frame and flat in the keyframe spacing**,
  because nothing seeks. That is 45x the seek route on a well-keyframed clip and
  50x on a sparse one.

  Three things worth having here rather than only in those files.

  - **Edit lists had to be honoured, not declined.** The demuxer was going to
    report one and let the caller refuse, on the reasoning that honouring one
    half way is worse than not at all. Both clips in `public/` have one — every
    byte offset and sync flag agreed with ffprobe and every timestamp was out by
    a constant. Declining would have declined this repo's own footage. The two
    shapes ffmpeg writes are applied; only the ones needing a piecewise time map
    are refused.
  - **`ctts` is the thing that is invisible when wrong.** Decode order is not
    presentation order on any clip with B-frames, which is most real footage and
    none of what `mp4.ts` writes — so a puller indexing by `dts` is correct on
    every fixture this repo can generate for itself and scrambles the first clip
    anybody imports. `pullcheck.mjs` carries an arm that is two thirds B-frames,
    and asserts the fixture really has them.
  - **A frame's identity has to be checkable.** The failure mode of a puller is
    returning _some_ frame, promptly, forever, and no timing column shows it. So
    each fixture frame carries its own index as ten binary cells in the picture
    and the harness reads it back off the decoded frame. Three bugs came out of
    that which nothing else would have found — a cache evicting the frame being
    waited for, a cache emptied by handing a frame out, and a feed loop awaiting
    a microtask where a decoder's output is a task.

  **And the wiring has landed too.** `VideoPump` has a take mode — frames from
  the puller, and a playhead that is arithmetic on the frame counter rather than
  something read back off a `<video>` — `startTake` is the switch that turns it
  on, and `renderTake` awaits it before each step.

  **That `await` is half of the awaiting sink
  [`stripRun.ts`](../src/ui/stripRun.ts)'s header describes, and it is worth
  saying which half.** What a render now waits for is its own decoder opening,
  so a deck with a clip already on it is frame exact from the take's first
  frame. What it still does not wait for is a **row's load**: `applySession`
  fires the fetch and returns, so a row naming a clip arrives when it arrives
  and is frame exact only once its element is on the deck. The remaining half is
  buildable for the first time — the thing on the other side of it is frame
  exact now, which is the condition that header names — and it is a smaller job
  than it was, because the waiting machinery exists and only the row's own load
  sits outside it.

  `scripts/rendercheck.mjs` has lost the exclusion it carried since it was
  written. **Two renders of a take with a clip in it are the same file, byte for
  byte** — real time injected into the second, the live loop running between
  them to move the tape ring, the phosphor and the element's own playhead on.

  Four things worth knowing about the shape it landed in.

  - **The pull is where the take's clock finally reaches the picture**, and it
    belongs in `startTake` for the reason that switch exists at all: three of
    four leaves a take that looks deterministic and is not. The clock, the dice
    and the signal path were already in it, and the pictures were still
    advancing at whatever rate the browser played them at.
  - **A clip that arrives mid-take starts at its own beginning.** The position
    is `(frame - whenThisClipArrived) / fps`, so a row firing at frame 300 shows
    the top of its clip rather than five seconds in. Computed from the frame
    rather than accumulated, so asking twice gives the same answer — which is
    the property, stated as arithmetic instead of promised.
  - **A looped region wraps by modulo, and lands exactly on the in-point.** The
    live clamp overshoots by up to a frame because it can only fire once the
    playhead has crossed the out-point; arithmetic has no such lag. A difference
    from the live picture, and the right way round — the render is the one that
    can afford to be exact.
  - **A source that cannot be pulled from stays on its element**, which is every
    webcam, every generated mode, a YouTube embed, and any file the demuxer
    declines. That deck is then exactly as reproducible as it was before any of
    this, which is what makes the whole thing safe to switch on unconditionally.

  The bug worth keeping is not about video at all. Factoring the bitmap and
  direct delivery paths together dropped the sink's receiver — `Sources` is a
  class and `pushA` wants its own — so passing the method bare broke **every**
  video frame, live included, and surfaced as `this is undefined` inside the
  sink with a stack naming neither the pump nor the change. The unit tests
  passed throughout, because a test sink is an object literal of arrows.

- ~~**Four wall-clock reads, three of which move pixels.**~~ **Landed**, and
  there were five, not four: `startGlide` stamps the walk's origin as well as
  `advanceGlide` reading it. `stabGate`, `strobeGate` and `autoLock` are the
  other three. `Engine.startTake({fps, seed})` points all of them at
  `frame * 1000 / fps`; `endTake()` puts them back on the wall.

  One method rather than the argument-each this predicted. The readers are five
  unrelated places in the frame, and an argument each is five chances to pass
  the wrong one — where one private `now()` is a single switch nothing can miss.
  `strobeGate`'s comment does argue _for_ the wall clock and is right for live,
  which is why this is a mode and not a replacement. It shipped as
  `setVirtualClock`, alone; _Take state_ below is why it is now one of three
  things a single switch holds.

  Measured by `scripts/clockcheck.mjs`: sixty frames stepped in no real time
  finish a one-second morph on the virtual clock (progress `null`, arriving
  exactly on target) and move it 0.03 on the wall clock. Thirty frames get half
  way, so the readers track the counter linearly rather than merely flipping at
  the end. The wall-clock arm is a control — if it finished too, the other arm
  would prove nothing.

- ~~**Live input has no offline meaning.**~~ **Landed.** MIDI and mic/line audio
  can't be re-rendered. The answer was not to stub them but to record the
  _automation_: control writes with frame stamps during a live take, replayed
  into the offline render. `ui/automation.ts` is the tape and the arithmetic
  over it, `ui/useAutomation.ts` is the recorder, and ● in the tray is ▶ with
  the tape rolling.

  **This paragraph named the wrong funnel, and the one it named is the half that
  does not matter.** There is no single `writeControl`: a MIDI knob deliberately
  does _not_ come through it, because the physical move is its own soft takeover
  and routing it there would reset the takeover it had just satisfied. So
  tapping the funnel named above would have recorded the sliders and lost the
  controller — which is precisely the input this bullet is about. The tap is in
  `useMidi`, the one place in the app where both halves are visible at once, and
  that is an argument for the file rather than a detail of it.

  Four things worth having here rather than only in those files.

  - **Frames, not milliseconds**, and the trade is visible: a take performed in
    a tab running at 40fps renders at two thirds of the wall time it was
    performed in. That is not new — the strip's holds are already measured in
    frames, so a rundown performed at 40fps already rendered short — and
    stamping this any other way would have put the automation and the walk on
    two different clocks, which is the one thing _One walk, two clocks_ is
    arranged to avoid.
  - **The walk first, the hand second.** A row puts a look up and a hand moves a
    knob on top of it, so `onFrame` replays the rundown and then the tape. The
    other order would have a row overwrite the gesture that was made against it.
  - **Nothing the walk reproduces is on the tape**, and the wiring makes that
    structural rather than a rule to remember: a row reaches the engine through
    `useEngine.showSession` while the tap sits on the write path App owns, so a
    row's session, roll, jitter and preroll are physically out of its reach.
  - **A morph is one event, not sixty a second** — which is _The envelope
    belongs in the engine_ coming true a section early. It predicted a fault
    would be "one object an automation recorder can stamp, when that arrives",
    and the same turned out to be true of `startGlide`: both are frame-clocked
    in the engine and already right under a take's virtual clock, so one stamped
    destination reproduces the whole travel.

  **What is not on the tape is the honest limit, and it is a specific one.**
  Three engine events a hand can fire are events rather than writes, and none is
  recorded: a transition off the shelf (`startFault`), a bay strike (`fireMod`),
  and a re-patch of the bay (`setModSlots`). The first is the one that will be
  noticed, and it fails in an interesting way rather than a silent one — a
  hand-thrown transition's _cut_ replays, because the cut writes through
  `writeControls`, while the fault that hid it does not. So the picture cuts
  where it cut and does not break where it broke. `AutoEvent` is a closed union
  under a switch that will not compile without a new arm, which is what makes
  each of those a small addition rather than a redesign.

  **A tape lives as long as the tab.** It is not in `storage.ts` and not in the
  rundown, because what would make it worth persisting is the thing
  [adr/0006](adr/0006-a-take-is-a-seed-and-its-picks.md) describes and this does
  not build: a take _file_ holding the seed, the resolved `PoolRef`s and the
  tape together. A localStorage key holding one of the three is the shape that
  looks like the feature and is not it.

- ~~**The encoder is variable-framerate by construction.**~~ **Landed.**
  `useCapture.ts` was `captureStream()` + `MediaRecorder`, which timestamps by
  wall clock; an NLE conforms that badly. It is now `VideoEncoder` with an
  explicit `timestamp: i * 1e6 / fps` per frame (`ui/record.ts`) and an MP4
  muxer written for the one shape this needs (`ui/mp4.ts`) — CFR by
  construction, and indifferent to how long any frame took. ffprobe reports
  `r_frame_rate == avg_frame_rate == 60/1` on the result, which is what
  constant-framerate _is_ to everything downstream; `scripts/reccheck.mjs`
  asserts it against the real app.

  **Three things this paragraph got wrong**, all found by measuring:

  - **No `copyTextureToBuffer` is needed, and no offscreen target.**
    `new VideoFrame(webgpuCanvas)` reads the canvas directly and comes back BGRA
    and full of picture. The blank `toBlob` and the silent `captureStream()` are
    real and still true — they are simply a different path from WebCodecs. So
    the mirror-through-a-2D-canvas hack is deleted from the recording path (the
    _still_ grab still needs it, for the `toBlob` reason), and the extra copy
    per frame goes with it.
  - **This did not have to be Chrome-only.** Nightly has `VideoEncoder` and
    reports vp8, vp9, H.264 and AV1 all supported.
  - **MP4 rather than WebM was not a free choice.** Resolve does not import WebM
    at all and Premiere needs a plugin, so the container is the part that
    decides whether "an editor will conform it" is true.

  And two browser faults worth knowing before anyone touches this:

  - **H.264 needs even dimensions**, and an ordinary window gives an odd one
    (measured: 440x573). Firefox accepts the `configure` _and_ the `encode`,
    then fails the whole encoder asynchronously on its error callback with
    `NotSupportedError: Operation is not supported` and nothing naming the size.
    `record.ts` rounds down and crops.
  - **Firefox's `decoderConfig.description` is a malformed avcC.** The reserved
    bits the spec fixes at 1 are left clear, and each parameter set carries a
    duplicate of its own NAL header byte. ffmpeg decoded the picture anyway but
    reported `sps_id out of range` on every frame; `normaliseAvcc` rebuilds the
    record, and afterwards ffmpeg is silent.

### Take state

**Landed.** The last of the four, and the one that turns "the same take from the
same starting state is the same take" into "the same take is the same take".
Frame N was a function of N _and of where the engine happened to be_ at frame
zero — the tape ring, the phosphor still on the glass, the PLL's lock age, the
two servos — so two renders with the live loop running between them came out
about 5% apart, which `scripts/rendercheck.mjs` measured and then spent a
paragraph explaining it could not assert away.

`Engine.startTake({fps, seed})` is one switch over all three of the things a
take needs held, and `endTake()` puts them back:

- the clock counts frames, which is the piece that shipped first as
  `setVirtualClock` and has been folded in — flipping two of three gives a take
  that _looks_ deterministic and is not;
- everything that still rolls draws from the seed;
- and the signal path starts where a fresh engine's does.

It leaves the board alone. The look, the bay and the sources are what a take
_is_; only what has accumulated underneath them is put back.

**The reset zeroes every buffer and texture, not the four that carry state.** A
WebGPU resource is zero-initialized, so zeroing one _is_ the constructed state,
by definition and with nothing to be wrong about — where a hand-kept list of
which buffers survive a frame boundary is wrong exactly once, and the symptom is
a take that does not reproduce with no way to see why. It costs one command
submission and no frames, which is the difference from `vote/prepare.ts`: that
flushes by running 600ms of stock signal, being the same idea from outside the
engine where this one is inside it.

**Four things it turned up**, none of them predicted here:

- **The signal path rolls.** `MixState` and `TapeState` reached for
  `Math.random` from inside the frame, through the `Wow` each owns — so a vhs
  board re-rendered differently every time however clean frame zero was. Both
  take a trailing `rand` now, which is _Seeding_'s convention arriving somewhere
  that section did not look.
- **A morph in flight was a bug, not merely state.** Its origin is stamped on
  the wall clock, and a take counts from zero, so a render started under one saw
  `now() - startMs` go hugely negative and parked the board on the morph's
  _origin_ look for the whole take. `rendercheck.mjs` had a `stopGlide()` in it
  that was hiding this. The reset stops it properly.
- **The file had the wall clock in it.** `mp4.ts` stamped `Date.now()` into six
  `creation_time` / `modification_time` fields, so two takes came back the same
  length to the byte with different digests. Nothing reads them; they are zero
  now. Worth naming because it is the shape of fault that survives every check
  short of comparing the bytes.
- **The frame counter is the app's clock too**, not only the take's. The strip
  measures its holds against `frameNo()`, so a take rewinding it to zero has to
  hand it back — the same "left as it was found" rule `pauseLoop` already
  follows. What that does _not_ yet fix is the live walk ticking on rAF straight
  through a render; see _What to do next_.

~~**What a take still cannot reproduce is a clip.**~~ **It can now.** That was
true for as long as `VideoPump` pulled at wall rate: everything below the video
was deterministic and the video was not, which was build-order step 6 and the
reason the harness rendered bars. Step 6 has landed — see _The video source_
above for the two routes and why the measurements chose between them — and
`rendercheck.mjs` now asserts a clip take byte for byte alongside the bars one.

What a take still cannot reproduce is a source with no file behind it: a webcam,
a screen share, a YouTube embed. Those are live input, and _Live input has no
offline meaning_ above is the same argument about a different wire — the answer
there is automation recording, not a puller.

### The Firefox constraint that shapes the choice

Measured on Nightly on this box and written up in
`docs/handoffs/2026-08-05-freezes-and-the-worker.md`:
`copyExternalImageToTexture` accepts only `ImageBitmap`, `HTMLImageElement`,
`HTMLCanvasElement` and `OffscreenCanvas`. `importExternalTexture` is
`undefined`
([bug 1827116](https://bugzilla.mozilla.org/show_bug.cgi?id=1827116)), and **a
WebCodecs `VideoFrame` is rejected outright**. So the clean decoder path — pull
a `VideoFrame`, hand it to the GPU — does not exist here; it would have to route
through `createImageBitmap(frame)`, paying a conversion per frame. Offline that
is affordable, but it means the WebCodecs route buys frame-exactness and not
zero-copy. Re-measure before building on it; it is a snapshot of one Nightly
build. (The engine's `direct` mode in `videopump.ts` is the capability-gated
path for browsers where this _does_ work.)

**Re-measured on Nightly 151, and it stands unchanged.**
`scripts/codeccheck.mjs` asks all of it in one place: `importExternalTexture` is
still `undefined`, and `copyExternalImageToTexture` still refuses a `VideoFrame`
outright. The conversion costs **1.0 ms** a frame against a decode of 0.53 ms —
so the route is affordable exactly as this section predicted, and buys
frame-exactness rather than zero-copy, exactly as it predicted. Nothing about
the decision changes; what changes is that the paragraph above is a reading
rather than a memory, and the harness behind it can be pointed at a new browser
build in one command.

Two things worth keeping from writing that harness, because both cost time and
neither is about WebCodecs.

- **It must run over `http://localhost`, not `about:blank`.** WebCodecs is
  secure-context only, so the first cut reported `VideoDecoder` missing on a
  browser that has it — and would have reported the same for the `VideoEncoder`
  the app already ships and `reccheck.mjs` already passes on. A capability probe
  that runs somewhere the app never does answers a question nobody asked.
- **`flush()` per chunk is not "wait for this frame".** A completed flush sets
  the key-chunk requirement again, so flushing after every decode turns one
  sequential decode into sixty broken ones — Firefox says
  `VideoDecoder needs a key chunk` and is right. The thing to wait on is the
  `output` callback, and the thing to wait on _as well_ is `dequeue`, or a
  decoder holding frames for reordering deadlocks a loop that only listens for
  output.

### What a desktop shell actually buys

Honestly: **nothing for any of the four items above.** Every one is browser-API
work that runs identically in the web app, so an Electron decision is not on the
critical path and should not be allowed to block the export work. Where a shell
earns its keep is the boundary on either side:

- **Writing the file.** A multi-minute export cannot accumulate as `Blob[]` in
  memory. The web answer is File System Access `createWritable()`, which is
  Chromium-only — and the browser this project develops and measures against is
  Firefox. This is the strongest single argument.
- **Codecs.** A bundled ffmpeg gets ProRes / DNxHR and audio mux. WebCodecs gets
  H.264/VP9/AV1 — delivery codecs, not the intermediates an editor wants.
- **A pinned Chromium.** Most of `gpu/renderloop.ts` is Firefox/Linux rAF-stall
  archaeology; owning the runtime deletes that whole class of problem, and would
  restore `importExternalTexture` above. Against it: per `CLAUDE.md`, Chrome's
  ANGLE/Vulkan backend on Linux reports spurious texture-allocation errors, so
  that has to be spiked before it counts as a win. Tauri is _not_ the option
  here — WebKitGTK has no WebGPU (tauri#6381, closed not-planned).

Whatever shell it runs in, an offline render must **adopt the live device, not
create or destroy one** — see
[adr/0004](adr/0004-never-destroy-a-presenting-device.md).

## Build order

Build it in the web app first; it is the same code either way and all the risk
lives there. Revisit Electron only when the file-size wall or ProRes actually
arrives.

1. ~~**`VideoEncoder` CFR export, replacing `useCapture`.**~~ **Landed** —
   `ui/record.ts`, `ui/mp4.ts`, `scripts/reccheck.mjs`, and the mirror hack gone
   from the recording path. It was the right thing to do first for the reason
   given: nothing depended on it, and it fixed the recording that _already
   shipped_ rather than only what was planned.

   What it does **not** do yet, and the next thing anyone will want: the
   recorder is still driven by rAF, so it captures at whatever rate the tab
   renders and calls that 60fps. The file is internally consistent — every frame
   exactly one tick apart — but a tab that dropped to 40fps writes a take that
   plays 1.5x fast. Fixing that is step 2 below plus a loop that steps the
   engine rather than waiting on rAF, which is the offline render proper.

2. ~~**The virtual clock.**~~ **Landed** — five reads, one `now()`, and
   `scripts/clockcheck.mjs` to prove the inversion.

   The third piece — **owning the loop** — is `ui/render.ts` and
   `Engine.pauseLoop`/`resumeLoop`. Steps 1 and 2 could not make a render
   between them: the recorder was fed by rAF, so it captured at whatever rate
   the tab managed and stamped it 60fps, and the engine's loop kept advancing
   the counter underneath anything stepping by hand. `renderTake` stops the
   loop, steps the engine, and hands each frame straight to the encoder — so a
   take renders as fast as the GPU will go and a slow frame costs the render
   wall time and the file nothing.

   Two things it turned up. **`RenderLoop.stop()` drops a flag rather than
   cancelling**, deliberately — so two already-scheduled chains each land one
   more frame after `pauseLoop()` returns. `scripts/rendercheck.mjs` measured it
   as 122 frames across a 120-frame render; the render now waits two animation
   frames so those land _before_ it rather than interleaved, and the frames in
   the file are consecutive. And **a render was reproducible from a given
   starting state, not absolutely** — which is what step 3 turned out to be, and
   it is fixed.

3. ~~**Take state.**~~ **Landed** — _Take state_ above is the write-up.
   `Engine.startTake({fps, seed})` is one switch over the clock, the dice and a
   signal path put back to what a fresh engine has, and `rendercheck.mjs` now
   asserts what it previously spent a paragraph explaining it could not: **two
   renders of one take are the same file, byte for byte.**
4. ~~**The transition shelf.**~~ **Landed** — five entries under the T-bar and
   on the pad list, `signal/fault.ts` for the envelope and `ui/transitions.ts`
   for the table. It was as cheap as predicted and the _recipes_ were not; see
   _Landed, and what it cost_ above. The strip picks from it when it can
   preroll.
5. ~~**The live strip.**~~ **Landed to the line _The first slice_ drew**: rows,
   names, holds, the walk, drag-to-reorder, undo, duplicate, roll and shake
   rows, one transport with the music, and the seeded RNG in from the first
   commit. Everything that was filed as waiting on preroll has since landed on
   top of it — transitions between rows, and the loop's second read head — so
   what is left of this step is takes, which want the export first.
6. ~~**Frame-exact video pull.**~~ **Landed** — `ui/mp4demux.ts`,
   `ui/framePull.ts`, `VideoPump`'s take mode, and the `await` in front of
   `renderTake`'s step. Four harnesses decided it and one proves it: between
   them they closed the seek route, re-measured the Firefox constraint, checked
   the sample table against ffprobe, read each decoded frame's own index back
   out of the picture, and finally rendered a clip twice to the same bytes.

   **The constraint this step was named after was not the hard part.** It costs
   1 ms a frame, measured; what decided the design was the seek route's 38-600
   ms, which nothing in this document predicted because nobody had asked what a
   _forward one-frame_ seek costs.

7. ~~**Automation recording.**~~ **Landed** — `ui/automation.ts`,
   `ui/useAutomation.ts`, the tap in `useMidi`, and ● in the tray. _Live input
   has no offline meaning_ above is the write-up, including the funnel this
   document named and had wrong. `scripts/rendercheck.mjs` renders one tape
   twice to the same bytes and once without it to different ones; the tray arm
   in `traycheck.mjs` drives ● through the panel's own slider, which is the half
   no unit test sees.

   **It answers a want this document filed separately**, cheaply enough to be
   worth saying out loud: ⎙ renders the recorded take's length when there is
   one. _What to do next_ lists "a render range" as a thing deliberately not
   carried, on the grounds that a button rendering a song or ten seconds is
   enough to be useful and not enough to be an edit. Pressing ● and then ■ is a
   range, chosen by hand, and it arrived as a consequence rather than as a
   feature.

Steps 1 to 4 were independent of the strip and of each other, which is what made
them the ones to do while its design settled. All seven are done. What is left
is not on this list: the three engine _events_ automation does not record (_Live
input_ names them), and the take file that would make a tape outlive its tab.

## What to do next, and why in this order

Written after building it rather than before, which is why it disagrees with the
list above in two places.

1. ~~**Take state, so a render reproduces.**~~ **Landed** — _Take state_ above
   is the write-up, and the short version is that two renders of one take are
   now the same file byte for byte, which is what unblocks 3.
2. ~~**The transition shelf**~~ (step 4 above). **Landed**, and the write-up is
   _Landed, and what it cost_. What it leaves behind for whoever picks this up:
   the shelf cuts the deck's own T-bar, because that is the only cut there is
   until a rundown can preroll — the fault is the same either way, which is why
   `faultPlan` takes the `onCut` from its caller.
3. ~~**The strip's offline walk.**~~ **Landed** — nine lines, for the reason
   _One walk, two clocks_ now records, and ⎙ renders the rundown rather than
   just the board. It stops the live walk rather than running beside it, which
   is what the note here said to do.
4. ~~**Preroll depth 1**~~, ~~**transitions between rows**~~ on top of it, and
   ~~**the second read head**~~ the audio crossfade was filed under. **All three
   landed** — _Landed_ under _Performance: the boundary is the only cost_,
   _Landed: between rows_ under _Transitions_, and IDEAS.md › _Clip cues_ ›
   _Landed: the second read head_. What is left of the third is the de-click
   envelope, which is a few lines of gain and is filed there rather than here.

   Two things from the last of them are worth having here rather than only
   there, because both are about how this document was wrong rather than about
   the loop.

   **The contention it named as a policy decision was not one.** This step used
   to say the fix "costs an answer to the contention over the one `next` field
   per slot, which a looping clip and a rundown's lookahead both want", and that
   the answer was the reason it was not a small job. It dissolved on contact:
   the bound depth 1 protects is _files_, and a loop's head is the same url as
   the element on air — a decoder and no bytes — so the two want different
   budgets and get separate fields. The expensive-looking part of a feature is
   worth re-deriving before it is paid for.

   **And measuring first paid for itself twice.** Once before, because
   `scripts/wrapsound.mjs` heard the dropout rather than inferring it and found
   the silence _is_ the seek — nothing to fix in the audio graph, and the cue
   row's `wrap 0.15s` had been a readout of the sound all along. Once after,
   because the first cut of the fix made the worst case worse — two elements
   seeking one expensive file against each other, 1028 ms of dropout on half the
   laps where seeking alone cost 213 ms on all of them — and it had a _better_
   median while doing it. Nothing short of listening would have caught that, and
   the shipped version gives the head back rather than keeping it.

5. ~~**Frame-exact video pull.**~~ **Landed, both halves.** `ui/framePull.ts`
   answers "the frame shown at time t" off a `VideoDecoder` at 0.85 ms a frame;
   `VideoPump`'s take mode asks it instead of the element and owns the playhead
   while a take runs; and `renderTake` awaits it before each step.
   `scripts/rendercheck.mjs` renders `public/test.mp4` twice to the same bytes,
   which is the claim the whole of step 6 was for.

   Three predictions this list made, and how they came out.

   - **"A puller per slot, in `ui/videoSlot.ts`."** Wrong place. The url is all
     a puller needs, so the opener is one callback on the engine rather than a
     thing each slot holds — the same shape `setVideoRelay` has, minus the part
     that has to know _which_ slot's elements it is swapping. What does live per
     slot is the decoder the pump opened and the frame the clip arrived on.
   - **"The pump's own playhead, advanced by `1/fps` a frame."** Advanced was
     the wrong verb: it is _computed_ from the frame number, so asking twice
     gives the same answer and nothing drifts. An accumulated head makes the
     picture depend on how many times it was asked rather than on which frame it
     was asked for, which is the one property a take cannot do without.
   - **"The fallback stays, and it is not a lesser path."** Right, and it earns
     its keep more often than that made it sound: a webcam, a screen share, a
     generated mode and a YouTube embed are all sources with no file to open, so
     the fallback is not an error path but the ordinary answer for half of what
     a deck can hold.

   **And it carries a memory cost this list did not predict.** A puller holds
   the whole compressed file, and for a `blob:` — which is what a pool pick is —
   that file is _already_ resident, with no way to reach the `Blob` behind the
   url. So a take over two pool rows holds four copies of two files on top of
   whatever the elements have. That is bounded rather than engineered away: past
   192MB a clip is declined and its deck stays on the element, which is the same
   fallback every other decline takes and the same shape of answer preroll depth
   1 already gives — a budget nobody can see is one somebody eventually spends.

6. ~~Then **automation recording**, as before.~~ **Landed**, and _Live input has
   no offline meaning_ above is the write-up. Two things about it belong here
   rather than only there, because both are about how this list was wrong.

   **The funnel this document kept pointing at was the wrong one.** "It reuses
   the single `writeControl(key, value)` funnel" is written twice above and is
   not true: a MIDI knob deliberately bypasses it, since the physical move is
   its own soft takeover. Tapping the named funnel would have recorded a
   session's sliders and dropped its controller — the one input the feature
   exists for. The tap is `useMidi`, which owns both paths and is the only place
   they are visible together.

   **And the last item on both lists turned out to depend on nothing.** It is
   filed after frame-exact pull, and it did not need it: a tape is stamped
   against the frame counter and replayed through the render's existing
   `onFrame`, and neither of those knows what a source is. It was buildable the
   day _Take state_ landed. What made it worth doing last anyway is that the
   take it records is only reproducible because everything above it is done — a
   gesture replayed onto a picture that was not frame-exact would have been a
   gesture landing somewhere new every render.

Three things this list deliberately does not carry, all of them wants rather
than needs. **Cutting to the track's clock** rather than starting with it — the
walk's `Clock.frame` would come off `currentTime`, which `strip.ts` is already
indifferent to, but it needs an answer for what a rundown does when the song
ends. **Proportional card widths**, so a rundown can be read for its rhythm
rather than as a row of equal boxes; cheap, but it wants a decision about what
the tray is when a piece is four minutes long. And **a render range** — though
this one is now half answered by accident: ⎙ renders a recorded take's own
length, so ● and ■ are a range chosen by hand. What is still not there is a
range over a rundown nobody performed.

What used to be listed here as blocking the live half was step 1 —
`useCapture.ts` on `captureStream()` plus `MediaRecorder`, timestamped by wall
clock, fine for a screen grab and wrong for anything cut to music. It is done,
and so is the thing behind it: there is a ⎙ in the tray that writes a
constant-framerate MP4 of the length of the loaded track. (Per-note MIDI
bindings used to be listed here too; they shipped — `ActionTarget` in
`ui/midi.ts` is a second binding family beside `BindTarget`, and a row is one
more action id plus a sink in `useMidi`. What a strip would want beyond the
thirteen actions there is one that names something out of a list that changes
under the binding, which is the shape the saved-look entry in
[`IDEAS.md`](IDEAS.md) › _Patching into other apps_ describes.)
