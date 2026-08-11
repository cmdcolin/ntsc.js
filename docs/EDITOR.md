# The editor — a rundown, and an export an NLE will conform

Playing one source at a time is the whole app today. The ask behind this
document is music videos: a series of clips, set up in advance, played back to
back. It is the design, written before the code, because one decision in it
(seeding, below) is cheap now and expensive to retrofit.

It has two halves and one boundary.

- **The strip** is the live half — an ordered list of cued states you can also
  fire by hand, and a shelf of transitions to get between them. It is a rundown,
  not an NLE timeline, for reasons argued below.
- **Fixed-framerate export** is the offline half — rendering a take where frame
  N is a pure function of N, so an editor can conform the result. Most of its
  precondition is already paid for reasons that had nothing to do with export.
- **The boundary** is that none of this becomes a plugin for somebody else's
  timeline. That was investigated and declined, and the reasoning is first
  because it is what shapes the rest.

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

When the code lands, this rule is the part that should become an ADR — it is the
one a later reader would otherwise be within their rights to simplify into
`Math.random()`.

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
- **Four wall-clock reads, three of which move pixels.** `advanceGlide` (twice),
  `stabGate`, `strobeGate`, and `autoLock` all take `performance.now()`. Fix is
  one argument each: pass the virtual `frame * 1000 / fps`. Note `strobeGate`'s
  comment argues _for_ wall clock so the rate is honest under a frame lock and
  on a 144 Hz panel — that reasoning is right for live and inverted for export,
  where the output timebase is the honest one.
- **Live input has no offline meaning.** MIDI and mic/line audio can't be
  re-rendered. The interesting answer is not to stub them but to record the
  _automation_: capture control writes with frame stamps during a live take,
  replay them into the offline render. That is the feature that would actually
  make this a performance tool — perform at whatever rate the GPU gives you,
  render at quality afterwards — and it reuses the single
  `writeControl(key, value)` funnel that the OSC idea in [`IDEAS.md`](IDEAS.md)
  › _Patching into other apps_ also leans on.
- **The encoder is variable-framerate by construction.** `useCapture.ts` is
  `captureStream()` + `MediaRecorder`, which timestamps by wall clock; an NLE
  conforms that badly. The replacement is `VideoEncoder` with an explicit
  `timestamp: i * 1e6 / fps` per frame and an mp4 muxer — CFR by construction,
  and indifferent to how long each frame took to render. It also lets the whole
  `present` path be bypassed: render to an offscreen target and
  `copyTextureToBuffer`, which drops the mirror-through-a-2D-canvas hack that
  `useCapture.ts` needs today (Firefox returns a blank image from a WebGPU
  canvas's `toBlob`, and `captureStream()` emits no frames from one).

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

1. **`VideoEncoder` CFR export, replacing `useCapture`.** Self-contained, 152
   lines to replace, and it fixes the variable-framerate problem for the
   recording that _already ships_ rather than only for what is planned. It also
   deletes the mirror-through-a-2D-canvas hack. Do it first because nothing else
   depends on it and everything else is worth less without it.
2. **The virtual clock.** Small — the four wall-clock reads above, one argument
   each, all in `pipeline.ts`.
3. **The transition shelf.** Cheap, and it does not need the strip: A and B are
   both live today, so the first transitions can run off the T-bar and a MIDI
   pad with no rundown anywhere near them. A table of named recipes over
   existing controls, plus the envelope and the cut point — no new uniforms, no
   new pass. The strip later just picks from the shelf.
4. **The live strip.** Rows, holds, the walk, preroll depth 1 — with the seeded
   RNG in from the first commit, because it cannot be retrofitted onto takes
   already recorded.
5. **Frame-exact video pull.** The real project, and the one with the Firefox
   constraint sitting on it.
6. **Automation recording.** Control writes with frame stamps, replayed offline;
   the thing that makes performing and rendering the same take.

Steps 1, 2 and 3 are independent of the strip and of each other, which makes
them the ones to do while the strip's design settles. Step 4 is the hard
prerequisite for any offline render of a rolling strip — and the point at which
transitions between _rows_ (rather than between the two live decks) need its
preroll.

One other thing blocks the live half, and it is the same item as step 1:
`useCapture.ts` is `captureStream()` plus `MediaRecorder`, timestamped by wall
clock. Fine for a screen grab, wrong for anything cut to music. (Per-note MIDI
bindings used to be listed here too; they shipped — `ActionTarget` in
`ui/midi.ts` is a second binding family beside `BindTarget`, and a row is one
more action id plus a sink in `useMidi`. What a strip would want beyond the
thirteen actions there is one that names something out of a list that changes
under the binding, which is the shape the saved-look entry in
[`IDEAS.md`](IDEAS.md) › _Patching into other apps_ describes.)
