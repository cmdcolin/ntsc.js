# Ideas / backlog

Things worth doing that aren't done, and things that look worth doing but aren't
— so a future pass doesn't re-litigate them. Line numbers drift; grep the
described feature.

The last two ideas from the original list — the video-synth oscillator source
and chroma key — have shipped; see the two sections below for what each one
deliberately left. That list is now empty.

## Modulation: kill the remaining naked periodic waves

The premise (see `ARCHITECTURE.md`) is that a fault should be _mechanistic_. A
single periodic wave traced straight down the raster violates that — it reads as
a filter effect, not a fault (the warning `signal/audiostate.ts` opens with).
The shared home for bounded-aperiodic drift is **`signal/noise.ts`**
(`valueNoise`, `Lorenz`, `Wow`); reuse it rather than rolling a new sine. Tape
wow, the modulation LFOs and intercarrier buzz have already been converted; what
is left is the one item below.

### Deferred — mains-frequency roll drift (hum), `channel.wgsl`

The 60 Hz hum fundamental is a clean sine and **should stay one** — it's mains,
it really is that periodic. The boring part is the fixed roll rate (the
`f32(P.frame) * 0.0037` term): real mains frequency wanders with grid load, so
the beat against field rate should breathe instead of ticking at a constant
rate.

Approach: replace the constant with a slowly-drifting phase accumulated CPU-side
(same pattern as `Engine.advanceScPhase`), driven by an OU/`valueNoise` slow
term from `signal/noise.ts`. Optionally add a 120 Hz full-wave harmonic.

Deferred because it's the only one of the modulation ideas that needs a new
uniform + phase plumbing (a `PARAM_DEFS` field, `DEFAULT_CONTROLS`,
`uniformValues`) for the least-visible win. Everything else in the batch was
self-contained.

### Not worth aperiodic-ising

These read like naked periodic waves but are physically correct — don't
"aperiodic-ise" them:

- **Hum fundamental** (`channel.wgsl`) — mains is a clean sine; only its _roll
  rate_ is worth drifting (above).
- **Wipe ping-pong** (`signal/mixstate.ts`) — a switcher sweep is _deliberately_
  periodic; that's what the hardware does.
- **Source-B detune / roll** (`signal/mixstate.ts`) — a mistuned crystal really
  does sit at a fixed wrong frequency. The constant is the point.
- **Decode bend ripple** (`decode.wgsl`) — spatial, not animated; nothing to
  make aperiodic in time.

## Tape mechanisms not modelled

- **Azimuth crosstalk from the adjacent track** (EP/SLP). Narrow tracks plus
  azimuth suppression that only works at high frequency, so the neighbouring
  track bleeds through as a _low-frequency-only_ ghost — a soft, colourless
  second picture that swims when tracking is off. Distinct from the multipath
  ghost, which is sharp and full-bandwidth.
- **Crease / edge damage on the main deck.** The loop bin's `tapeWear` seeds
  defects on _position on the tape_ so they recur every lap; the same idea on
  the main deck still wants doing — it has no tape-position coordinate to hang a
  defect off, which is exactly what the ring gave the loop.
- **Servo hunting.** `trackPos` is a static knob; a real auto-tracking deck
  searches and settles after a scene change or on exiting shuttle.
- **Luma FM beating the 629 kHz color-under carrier.** The fine crawling chroma
  noise in saturated reds. Modelling the luma FM properly is expensive; the
  honest cheap version is the beat product alone.

## Noise mechanisms not modelled

Shipped from this pass: the generated no-signal sources became one parameterized
generator (`snowSource` in `prelude.ts`, four statistics on the Source stage),
and the program-bus floor got a spectrum (`noiseTilt`, an RF lowpass against an
FM discriminator's first difference over the same deviates in `channel.wgsl`).
Two things learned there, for whoever adds the next one. A **first** difference
is triangular (power ∝ f²) and a 1-2-1 signed pair is not (∝ f⁴) — the honest FM
shape is the cheaper kernel. And the two arms share taps, so holding the floor's
level constant across the tilt needs the covariance, not just the weights;
without it the knob reads as a noise-amount control with a side effect. The
algebra is in `noiseTiltWeights` (`pipeline.ts`), CPU-side.

What is left, in rough payoff order:

- **Camera sensor noise, in the feedback camera.** `compose.wgsl` models an iris
  servo, a black cut and a full-well knee, and has no noise at all. Three
  mechanisms, all cheap, and this is the one that _compounds_: shot noise (σ ∝
  √signal, so highlights are noisiest — the opposite weighting from tape grain,
  and the tell that separates a photographed screen from an electronic path);
  **fixed-pattern noise**, which is fixed to the _sensor_ rather than to the
  glass, so each pass zooms and rotates the previous generation's pattern and
  adds its own, breeding grain into structure with nothing drawing it; and gain
  noise coupled to the camera's own auto-gain, so noise pumps against the iris
  hunt at a third rhythm alongside the beam limiter.
- **Flicker (1/f) and popcorn noise in the video amplifier.** Everything
  aperiodic in the chain is per-sample and everything slow is periodic (hum).
  Missing: a random-walk level, so black level and brightness breathe sub-Hz,
  and **burst/RTS noise** — a defective junction switching the DC between two
  discrete states at random intervals, so the picture level _clunks_ rather than
  drifts. CPU-side out of `signal/noise.ts` (an OU term, and a two-state Markov
  chain for the popcorn) into one DC uniform; the AGC, the clamp and the killer
  then react to it for free.
- **A wandering spurious carrier (switching-supply birdie).** Every periodic
  interference here is locked to line rate (`soundIre`, `rfAdjacent`) or to
  mains (`humAmp`). A switch-mode supply or a nearby computer sits at some
  arbitrary 15–60 kHz that _drifts with load_, so it draws a herringbone that
  creeps and breathes instead of standing still — the drift is what identifies
  it — and it intermodulates with the subcarrier. Same CPU-accumulated-phase
  pattern as the deferred hum-drift item above, and it is what the "kill the
  naked periodic waves" section actually wants.
- **Noise on decisions rather than on picture.** The dropout _detector_ is the
  good one: a real DOC fires on an RF envelope dip, so a noisy floor trips it on
  lines that were fine and it patches them anyway — and the patch comes back in
  the complementary hue, by the 227.5-cycle logic `dropoutComp` already has. A
  corrective box misfiring on noise is more interesting than noise you can see.
  The sync slicer and the colour killer are the same idea, and the killer's is
  partly reachable already through `accLagLines`.
- **A fixed noise floor with a varying signal, instead of substituted snow.**
  Structural rather than a knob: `channel.wgsl` mixes snow in at a set level per
  band (tracking, head clog, shuttle, head switch). If the preamp's floor were
  fixed and the _RF level_ varied, noise would appear wherever signal is weak
  from one mechanism, and the four blocks would collapse into it. The honest
  version, and it would delete code; also the largest of these.

## Per-input feeds — what is still on the program bus

The feeds (`feed.wgsl`, the `FEEDS` table in `feedgates.ts`) give each input its
own deck, head-end and cable. The loose connector and the ground loop shipped
per input, which is what the split is for: a fault on one feed makes the two
signals disagree, and the sync fight, the AGC and the other input are all
downstream of the disagreement.

Everything below still damages the **mixed bus**, which for several of them is
physically incoherent once two decks are patched in — the fault belongs to one
machine. Adding one is a `FEEDS` entry, a `packFeed` override, a shader block
and a `feedFaults` line; see `ARCHITECTURE.md` for the trap in the middle of
that. Rough payoff order:

- **Transport (shuttle / rewind / still), per input.** The biggest one.
  `shuttleX` sits on the summed bus (`channel.wgsl`), but shuttle bars are _one
  deck's head_ crossing tracks — `tape_play.wgsl` already says so out loud. Per
  input it gives B rewinding under a playing A, with B's bars sweeping B's
  raster and rolling with B's picture through the dirty sum, each strip between
  bars a different recorded track with its own timing and colour-under phase.
  The strips that lose sync hand the fight to A and the ones that don't fight
  back, so the picture flickers between two geometries at bar rate. Most of the
  machinery is already there: `feed.wgsl`'s pause path computes a per-row offset
  and `catmull`- resamples, and shuttle is that path with a per-strip offset
  instead of a random scatter. `decode`'s row-uniform constraint does not bind
  here — a feed is 1-D on the composite. It also makes `aPause`/`bPause` the
  _zero_ of a transport continuum rather than a separate button, the way
  `tapeTransport` already reads.
- **Head clog, per input.** Cheapest violent effect left, ~6 lines keyed on
  `P.frame`. The heads alternate sweeps, so a clogged head on one input makes
  the receiver alternate _which source it locks to_ at field rate.
- **Multipath ghost, per input.** One input off-air, one on a line. Under the
  dirty sum the ghost is a third sync edge arriving late, so the PLL has three
  candidates per line. Same shape as `terminate`'s echo tap.
- **Tracking error, per input.** A band parked on one deck that then rides that
  source's roll. Cheap; less novel than the three above.
- **Macrovision is A-only.** `mvAgcIre`/`mvStripe` live in
  `encode_composite.wgsl`; `encode_composite_b.wgsl` has no equivalent, so B can
  never carry a protected tape. Narrow, but it is a real asymmetry, and a
  protected B summed against a clean A makes the receiver's `agc` pump against a
  signal whose sync is fine.

## Chroma key follow-ons

The keyer shipped in `mix_b.wgsl` on both mix paths, slicing `uvfB` — B's chroma
after the encoder's bandlimit — so the soft-across/sharp-down composite edge and
the per-line breathing on the dirty path are the filter and the detune doing it,
not anything drawn. Two things learned, for whoever extends it.

The keyer had to read B's chroma at **B's own raster index** on the dirty path,
the same index the fill is resampled from. Keying at the output sample instead
parks the hole on the output raster and the subject rolls out from under it —
the three-domain mistake in one line.

And **spill suppression cannot be a colour operation here**: luma and chroma are
the same wire, so the only honest null is reinjecting the backing's subcarrier
antiphase, which means the suppressor has to know B's carrier phase. It does,
exactly, on the genlocked path; on the dirty path it is always late by however
far the fractional slip has rotated the carrier between samples, which leaves a
residue that breathes. That asymmetry is the mechanism, not a gap to close.

What was left:

Shipped since: the **fill selector** (program A, the box's matte generator, or
the mixer loop bus). One thing learned there — a fill is only meaningful on the
genlocked path, because a fill is what sits _behind_ the foreground and only a
crossfade has a behind. On the dirty sum both signals are on the wire at once,
so the key gates B's contribution and the program is simply always present. That
is a mechanical limit, not a gap to close, and the row is gated on genlock.

- **The PiP inset keeps its luma key alone.** Wiring the chroma key into the
  inset as well is two lines, since `chromaKey` already takes an index and the
  inset re-encodes from `yuvB`/`uvfB`; left out to keep the first pass one box.
- **Nothing keys off A.** A self-key on the program bus (A's own backing cut so
  the loop bus shows through) is the same function pointed at the other input,
  and would need A's chroma materialized the way `uvfB` materializes B's.
- **Keyer bandwidth is the encoder's.** A real keyer has its own key-processing
  filter ahead of the slicer, usually narrower than the encoder's chroma. A
  short boxcar over `uvfB` would make edge softness a control of its own rather
  than a side effect of `encChromaMHz` — at the cost of four more storage taps
  per active sample, which is why it is not there.

## Video synth follow-ons

Shipped as mode 3 of the same `srcNoise` selector the static sources use — one
`videoSynth` in the prelude, two call sites, no new pass and no new buffer.
Phase is carried as cycles at frame start plus the walk per line and per sample
rather than as a frequency, both for f32 precision across a 477750-sample frame
and because the per-line walk **is** the lean of the pattern.

Shipped since: **the synth over a picture rather than instead of one**, which is
what made the luma → VCO patch possible — a mix knob (`synthOver`) beside the
source mode, plus `synthFm`. Two things learned. The FM term has to multiply the
sample index, not the phase: pulling a frequency makes the wave genuinely run
faster through bright picture, where offsetting a phase only slides the pattern
about and never produces a contour. And it is **slot A only** — `compose` has
the slot's picture in hand while `compose_b` writes its texture rather than
reading one, so a synth over B would need that pass restructured or a second
texture. Left as an asymmetry rather than plumbed around.

- **One waveform selector serves both oscillators.** Hardware would have one per
  VCO; a ramp beating against a pulse is a patch this cannot express.
- **No ramp reset off drive.** Real ramp generators are reset by H and V drive,
  which is why they hold still; here a "ramp" is an oscillator that happens to
  be at drive rate, so it is only ever as steady as the number typed in. Exact
  is reachable (`synthAHz` = 15734 lands within a hertz), but a genuine
  drive-locked mode would give a gradient that cannot creep at all.
- **The colorizer is a phase rotator, not three comparators.** Cheap colorizers
  sliced the signal at three different thresholds, which bands by level instead
  of turning through hue — a different and more brutal look, and one more mode.

## The mixer has no hardware model

`mix_b.wgsl` combines the two inputs with arithmetic —
`aGain * a + gate * (bGain * b + ...)`. Three real mechanisms are missing, all
of them cheap:

- **Crosspoint crosstalk.** A cheap switcher leaks the unselected input at about
  −40 dB, and the leak path is stray capacitance, so it is _high-pass_: what
  gets through is B's subcarrier and edges, never B's flat areas. With the fader
  fully closed you still get a faint moving rainbow from B's detuned carrier
  beating the burst-locked decoder, and no visible picture — "there's something
  else on this wire", which is not drawable. Note it interacts with the gates: a
  non-zero crosstalk floor has to appear in `bWaveOn`/`bOn` or B's chain is
  switched off underneath it.
- **Summing-bus rails.** Two full composites summed is 2× amplitude going into
  `channel` unclipped. `rails()` in `fb_composite.wgsl` is the model already
  written. It squashes the sum's sync tips, changing the character of the fight,
  and the compression manufactures sum/difference products between A's and B's
  subcarriers — the honest version of what `bRing` fakes with an explicit
  multiply.
- **Genlock that can lose lock.** `bGenlock` is an absolute TBC today. Real
  genlock has a capture range: push B's pause wander or wow past it and lock
  drops, B rips for a few lines, and it re-hunts. That makes the corrective
  box's _failure_ a function of how hard B is driven — crank B's pause and the
  clean dissolve starts breaking on its own.
- **Mid-field cut.** A switcher cuts at the vertical interval; a cheap A/B box
  or a relay cuts wherever you pressed it, tearing one frame into two
  half-pictures with a broken field sequence. Cheap in `mix_b` (a cut position
  in raster time rather than a crossfade), and it is the natural performance
  gesture.

Considered and left: **a house-reference selector** (letting B be the raster
instead of A) would double the expressive range of all of the above, but B _is_
the second raster — it is a restructure, not a knob.

## Capture / deinterlace (grown out of the RCA-input work)

- **Motion-adaptive deinterlace.** Current `deint` is an unconditional
  even-field bob — halves vertical resolution even on still frames. Weave where
  fields match (full res on static areas) and bob only where they differ (a
  per-pixel inter-field delta metric); keeps sharpness off motion.
- **Deint modes instead of on/off.** Turn the toggle into a mode select: off /
  bob (current) / blend (average both fields — ghosts on motion, keeps res) /
  weave. Blend is cheaper and some people prefer its look.
- **Auto-detect interlacing.** Measure a comb metric on the incoming source and
  flip `deint` on automatically only for genuinely-interlaced feeds, instead of
  hard-enabling it on every webcam/USB connect (progressive USB cams get
  needlessly softened today).
- **Remember the last capture device.** Persist the chosen `deviceId` so a
  reconnect re-selects the dongle rather than the OS default camera.
- **PAL capture.** Composite grabbers also deliver 720×576/50i; the pipeline is
  NTSC-shaped (525/60). At minimum square-pixel it correctly; ideally note the
  standard mismatch in the UI.

## Deflection (follow-ons to the sync/bend work)

- **Intra-line geometry.** `hSize`, `hLin` (S-correction failure stretching one
  side), pincushion. Blocked on decode's tiling: the workgroup stages one
  contiguous 128-sample span per row, so only _row-uniform_ horizontal offsets
  are free. Non-uniform scaling within a line reads outside the halo.
- **Vertical geometry.** `vSize` shipped and was nearly free (the raster row
  remap is a function of the screen row alone, so decode's row-uniform
  constraint never bites). `vLin` — the top-of-frame stretch of a failing
  vertical output stage — is the remaining half, a quadratic term in the same
  row remap.
- **Fractional bend.** `hoff` is `round()`ed to whole samples; at large
  amplitudes adjacent rows stair-step. Resampling the tile with `catmull` would
  smooth it, at the cost of restructuring the staging.

## Screen-domain effects not yet built

The neon phosphor colour work (beam transfer, `phosphorMode` tube identities,
persistence skew/bleed, the magnifier) shipped in full, and the luma-keyed
halation radius shipped as `crtHaloKey`; this one item is what remains of it.

- **Per-channel bloom radius.** One radius for all three channels; the phosphors
  don't actually scatter alike. Note that `crtHaloKey` keys the halo radius off
  the _destination_ pixel's own drive, because a gather has to pick its radius
  before it samples. That widens how far a bright area reaches _in_, which is
  the visible half; genuinely widening how far a highlight throws light _out_
  needs a second, higher-threshold ring rather than a keyed radius. Worth
  knowing before anyone tries to key the bloom radius the same way.

## Boxes in the rack (from the commercial-processing-unit pass)

What is left of the pass, in rough payoff-per-effort order. (A preset worth
authoring off the shipped `diffPhaseDeg`: inside the mixer loop, differential
phase separates a feedback trail into colour layers by brightness, because
`cfbDelay`'s rotation per generation stops being uniform.)

The two tube items from this list shipped together: convergence error
(`crtConverge`) and the magnetised purity patch (`crtPurity`), plus scan
velocity modulation (`crtSvm`), all in `crt_face`. Two things learned there, for
whoever adds the next screen fault. Convergence has to re-run the whole
beam-spot integral per channel — blurring one shared sample averages the landing
error away instead of leaving a fringe — so it costs 3× the spot taps whenever
it is non-zero, behind a uniform branch. And every new mechanism has to be added
to the identity-copy early-out at the top of `main`, or turning it on by itself
reads as a dead control.

- **A DVE / framestore, as the digital box in the analog last mile.** Distinct
  from the digital cable tier below, and more era-correct. An ADO / A53 /
  WJ-MX50 cannot work on composite, so it decodes to 4:2:2 601 on a 720×486,
  13.5 MHz raster — a different raster from ours — and re-encodes. The payoff is
  **cascaded encode/decode generations**: whatever the decoder got wrong becomes
  real picture, so dot crawl bakes into luma, re-encodes as chroma, crawls
  again, and `combMode` selects which fixed point the iteration falls into. That
  is why multi-generation composite editing looked the way it did, and it is the
  one mechanism here that manufactures colour from nothing. Once the framestore
  exists the consumer digital-effects buttons follow as one mechanism each —
  mosaic and multi-image are decimation with no prefilter, so the tiles alias
  and the subsample pattern beats against the mask.
- **Frame-recursive noise reducer.** A corrective box whose failure mode is the
  effect, which is why it is more interesting than the TBC declined below. Frame
  averaging gated on a motion threshold: below it, noise freezes into fixed
  plateaus and the picture goes plasticky; above it, motion drags a soft trail
  with a hard edge where the gate trips. Put the threshold in the noise floor
  and the grain drives the detector, so still areas breathe.
- **Rutt/Etra scan deflection.** The source's own luma patched into the vertical
  deflection amplifier: the raster becomes a relief map of the picture, and the
  brightness comes free from line bunching (line density _is_ luminance). Fits
  the deflection domain exactly — geometry detonates while hue stays put. The
  catch is that it is a per-pixel _vertical_ gather, so it wants `crt_face` over
  the decoded image with a bounded column search, not `decode`.
- **Setup mismatch** — a 0 IRE deck into a 7.5 IRE set and back, for crushed or
  milky blacks. The last of the smaller trims (Y/C delay and head clog shipped).

Considered and not worth it: **PAL / Hanover bars** (a raster change, not an
effect — `constants.ts` is 525/60 throughout) and **standards-converter
judder**, which needs 50 Hz first.

## Interlace — the gap `ARCHITECTURE.md` names and this file forgot

`ARCHITECTURE.md` calls progressive 525/60 "the largest remaining authenticity
gap" and has done for a while, but it has never had an entry here. It is a
raster restructure rather than a knob, which is presumably why: fields at 262.5
lines with the half-line offset, and everything indexed by row has to learn
which field it is in.

What it pays for. Vertical roll steps a whole frame at a time today because a
frame is the only unit there is; at field rate it would creep the way a real one
does. Head switch would land where it actually lands. The 2- and 3-line combs
would see the line relationships they were designed around instead of the
progressive stand-in.

And it changes what `dropoutComp` looks like: a real compensator's 1H delay
operates _within a field_, so the line it patches from is two raster lines up on
the glass, not one. The complementary hue is the same either way — 227.5 cycles
does not care — but the patch would visibly come from further away, which on
fine horizontal detail is a different artifact. Worth knowing before anyone
tunes that control's look.

## Instruments and pixel checks

- **A waveform monitor, overlaid.** One line of it landed as the scope tap
  (`?dbg=6`): a single line traced against an IRE graticule inside `decode`,
  columns filled min..max so an edge connects and a modulated sample draws its
  envelope. What is still open is the real instrument, every line of the field
  overlaid at once, where the density of the trace is how many lines agree — a
  chroma error on eight lines out of 480 is invisible on one line and obvious on
  all of them. That one is a pass: `decode` would scatter into a bins buffer and
  `present` draw it, with a finite spot on the way out, or a flat field lands
  every sample in one bin and draws as a speck.
- **A line selector for the scope.** It traces the middle line because that is
  the line the cursor is parked on; the interesting lines are the ones you
  choose — the head-switch line, a line inside the VBI, the line a dropout is
  on. Wants a control and a draggable cursor, not just a constant.
- **Extend pixelcheck.** `scripts/pixelcheck.mjs` pins the six SMPTE hues and
  the fine-tuning cliff; any deterministic `?set=` look plus a probe is one more
  pinned fact. Candidates: burst-lock hue rotation, the killer threshold,
  scramble's wash-out level.

## Digital cable tier

Macroblocking, DCT ringing, frozen last-good-blocks, motion-vector smear. Large
— it is a codec, not a knob — and it does not compose with the composite chain,
so it is only interesting under one framing: a digital head-end feeding an
analog last mile. Box → impairment → NTSC encode → the entire existing chain,
which is era-correct for the late nineties and is genuinely mechanism modelling
rather than artifact drawing. Not worth starting until something needs it.

## Patching into other apps (Max/MSP, Jitter, TouchDesigner, VJ software)

Already works with no code: MIDI CC + MIDI clock in (`src/ui/midi.ts`) via a
virtual port (IAC bus / loopMIDI); audio in via a loopback device (BlackHole),
which reaches `audioBendUs` / `audioLoad` / `audioIre`; Jitter output in as a
webcam through a Syphon→virtual-camera bridge; and output back out by pointing
an OBS browser source at the page. The gaps below are what would make it feel
like a patchable module rather than a coincidence.

- **OSC control, via a local WebSocket bridge.** Browsers can't speak UDP, so
  this needs a small node process doing OSC↔WebSocket. Worth it because
  `DEFAULT_CONTROLS` is already a flat named record and `useMidi` already
  funnels every store-origin change through one `writeControl(key, value)`: a
  bridge lets Max address `/hHold`, `/scDetuneKHz`, `/bendUs` by name, with
  float precision and no 128-control CC ceiling. The app side is a thin client
  that validates the key against `ControlKey` and calls the existing write path.
- **Bidirectional state.** Same channel in reverse — emit control changes so a
  Max patch's UI tracks the app (and so presets/scenes can be recalled from
  outside). Needs a loop guard on the write path.
- **MIDI note / program-change → scene recall.** Scenes and presets exist
  (`useScenes.ts`, `presets.ts`) but are mouse-only; note-on or PC is the
  natural performance trigger and reuses the MIDI input already open.
- **MIDI transport, not just clock.** `midi.ts` handles `0xF8`/`0xFC`; honouring
  `0xFA` start / `0xFB` continue would let clock-locked rates reset phase on
  downbeat instead of free-running from whenever the tick stream began.
- **Live low-latency output.** WebRTC to a local peer, or NDI via a native
  helper, for feeding the result back into Jitter without the OBS round-trip.
  Meaningfully more work than the rest of this list; only worth it for
  performance use.

Note for anyone evaluating the reverse arrangement: Max's `jweb` embeds a web
view but is unlikely to expose WebGPU, so hosting ntsc.js inside a patch
probably isn't viable — it wants to be a separate app you route into.

## Fixed-framerate export (and whether it wants a desktop app)

Not to be confused with **Capture / deinterlace** above, which is about a
composite grabber on the way _in_. This is the way _out_: rendering a clip where
frame N is a pure function of N, at a constant frame rate, decoupled from
whatever the GPU managed in real time. It is what separates "screen recording of
a toy" from "an export an editor will conform".

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
  `writeControl(key, value)` funnel that the OSC idea above also leans on.
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

### Suggested order

Build it in the web app first; it is the same code either way and all the risk
lives there. Virtual clock (small — four call sites) → `VideoEncoder` CFR export
replacing `useCapture` (self-contained, and fixes the VFR problem for the
recording that already ships) → frame-exact video pull (the real project) →
automation recording. Revisit Electron only when the file-size wall or ProRes
actually arrives.

## Motion follow-ups (after the ∿-on-every-row pass)

Shipped: the bay lifted into `useModSlots` (eight slots), a `∿` on every control
row that claims a slot on first press, presets/scenes/`?mod=` carrying motion, a
global motion amount with a phase-holding freeze, and an undo walk that restores
routings alongside controls.

Shipped since: the **one-shot envelope** (`trig`), which is the gesture the bay
had no source for — every other source describes what a knob is doing
continuously, this one says what you just did. Instant attack, exponential
decay, `rateHz` read as the decay rate so the existing rate row and its clock
lock still mean "faster". Two things it had to get right. Firing is an
**event**, so it goes to the engine as a method rather than a field on `ModSlot`
— a flag on a slot list that presets, links and undo rewrite wholesale would
have to be cleared by whoever set it. And a press lands _between_ two frames, so
the trigger is held in a set until a frame picks it up; sampling an edge at 60
Hz loses roughly one press in every few otherwise.

What is still open on it: **MIDI note-on** should fire a slot (`IDEAS.md`'s
"MIDI note / program-change → scene recall" is the same wire), and there is no
keyboard binding for `fire all` — both buttons are mouse-only, which is the
wrong input for a gesture whose whole point is timing.

What was deliberately left from the original pass:

- **Performance macros — cut, not deferred by accident.** The design was three
  assignable 0..1 knobs, routed through the same eight slots as the LFOs. That
  makes the good case the expensive one: a macro is only worth a knob once it
  drives several controls at once, which is exactly when it eats the most slots,
  at four clicks and one slot per control. The motion amount does the
  one-gesture-scales-the-patch job with no assignment ritual at all, and now
  that the MIDI binding key reaches beyond `ControlKey` (a knob can drive the
  motion amount or a preset weight), the chips already cover the
  several-controls-per-gesture case. If macros come back they need their own
  routing table, not a berth in the LFO bay — or they are a slider that does
  less than the slider it is standing in for.
- **Modulating the five filter controls** (`encChromaMHz`, `demodMHz`,
  `chromaTail`, `lumaMHz`, `lumaPeak`) rebuilds the FIR bank every frame.
  Allowed from the UI deliberately — it is a real patch someone may want — but
  authored presets are forbidden from it by `presets.test.ts`. If it ever needs
  to be cheap, the bank would have to be rebuilt only when the modulated value
  crosses a meaningful step rather than on every frame.
- **`?surprise` on boot stays controls-only.** A rolled recipe applies its
  motion in the app, but the boot path layers controls before the bay exists.
  Accepted asymmetry, not a bug worth plumbing around.

### The stab gate — what the freeze fix left open

Shipped: the gate no longer goes dead under the freeze. The "stabs" row reads
what the gate is _running_ at, so `❚❚` pinned that at 0 however far the slider
was dragged, with nothing on the row saying why — dialing the gate on now lifts
the freeze, the same rule a claim and a restart in the bay already follow, and
`panelcheck.mjs` drives every state the row can be in.

Two things it is still missing, both surfaced by pulling on "the stabs slider
does not work":

- **It does not travel with the look.** The gate lives in `localStorage` and
  nowhere else — not in `?mod=`, not in a preset's routings, not in a saved
  look. A link, a preset or a saved profile therefore drops the most visible
  thing the bay does, and whoever opens it sees a still picture where the board
  had been cutting four times a second. `useModSlots.ts` already carries the
  reasoning for why it belongs in both — a stab train is part of the look in a
  way a freeze is not — so what is owed is the schema change to `?mod=` and to
  the preset routings, with readers that tolerate its absence the way `readStab`
  already tolerates a junk entry.
- **No knob can reach it.** The row passes `sync` but no `midi`, so the one
  lever here described as "the kill switch a bender keeps a thumb on"
  (`signal/stab.ts`) is mouse-only, while the motion fader an inch away is a
  `BindTarget` sitting at the front of the auto-map spine. It wants a `'stab'`
  target beside `'motion'` in `ui/midi.ts` — its span is the row's own
  0..`STAB_HZ_MAX` in tenths rather than the `UNIT_SPAN` the other two
  non-control targets share, and since the layering puts `midi.ts` under
  `modSlots.ts` that number has to be written twice and pinned with a test, the
  way `STOCK_HOLD` and `VIEW_KEYS` are pinned — plus a sink in `app.tsx` beside
  `setMotion`. The open question is `AUTOMAP_TARGETS`: inserting it after
  `MOTION` shifts every knob for anyone who re-runs the auto-map, which is a
  real cost to weigh against a gate that is arguably the most performable thing
  in the bay.

## Loop bin follow-ons (after the tape-delay pass)

The loop shipped with the play head's own damage model — band loss, medium
noise, wear, splice — rather than routing the return through the real `channel`
block. Two things were considered and left:

- **Erase residue.** A record head with no full erase leaves the previous lap
  under the new one. Cut because on a loop whose length _is_ the delay, the tape
  reaching the record head is the tape that just played, so residue is
  arithmetically the same as more loop gain — a second knob for the fader's job.
  It would become a distinct mechanism only if the record and play heads were
  independently placeable round the loop.
- **Routing the return through `channel`/`timebase`.** Physically the honest
  version of generation loss, and it would give the loop dropouts and time-base
  wander for free. It needs a second set of scratch buffers (`chromaExtract` →
  `underDown` → `channel` → `timebase` is a four-buffer chain) and roughly
  doubles the loop's cost. The 1-2-1 kernel in `tape_play` gets the dominant
  term — chroma dying faster than luma — for one tap.

Worth doing if the loop ever needs to sound like a _different deck_ from the
main one, which is the case the current model cannot express.

- **Per-strip timing on the loop's shuttle bars.** The deck's shuttle gives each
  strip between its noise bars its own timing and colour-under phase (via
  `linestate`), so the picture tears and rainbows at the boundaries; the loop's
  strips come off one contiguous read, so they are clean between bars. Doing it
  would need per-line offsets on the loop read, which `decode`'s row-uniform
  constraint does not block but `tape_play` has no per-line buffer for yet.

## Clip cues — what shipped left

`ui/cue.ts` marks a cue on a clip's own timeline and loops a stretch of it; the
clamp is `VideoPump.wrap`. Three things around it are deliberately not done.

- **A cue row in the Deck.** The Deck is the panel's second index for controls a
  hand moves during a take (`Deck.tsx` argues the case), and a cue is exactly
  that. It is not there because every row the Deck renders is backed by a
  control read through `ControlsContext`, and a cue is deliberately _not_ a
  control — two timestamps into one clip cannot be recalled by a preset or moved
  by mutate. So the Deck would need a way to take per-source state, which is a
  new pattern rather than a placement. The command palette carries the two verbs
  in the meantime, which is where the roll-and-keep verbs went for the same
  reason.
- **MIDI on the cue.** This is the one that would matter most for playing it,
  and it is blocked behind the same gap the mod bay's triggers are: `midi.ts`
  takes any Note On as "fire the whole bay", so there is no way to bind one note
  to one action. A per-note binding family is the prerequisite (already noted
  above), and the cue tap and the retrigger are two of the best arguments for
  building it — the retrigger in particular is a drum pad, not a knob.
- **Beat-snapped loops.** `useTempo` already has a beat, from MIDI clock or
  tapped in, and ½/1/2/4-bar buttons from the cue would give exact musical
  loops. Left out on purpose for now: it doubles the row, and it is inert on a
  machine with no tempo set, which is most of them. The free-marked loop works
  everywhere and is the thing worth having first.

- **Judging the wrap cost rather than reporting it.** The cue row now shows what
  a loop's jump back is measuring (`wrap 0.15s`, off the `seeked` event in
  `VideoPump`), and deliberately makes no claim about whether that is bad. Two
  goes at a threshold were both wrong, and the second is the one worth
  remembering: at 2.2x-the-frame-cadence it fired on `public/demo-v2.mp4`, a
  _well_ encoded file, which the enc:dense arm of `scripts/cuecheck.mjs` caught.
  Re-measuring then showed why no cutoff works here — the reproducible gap
  between the fine tier (~90ms) and the slow tier (~150ms) is about the size of
  the run-to-run variance on a loaded machine, and one early reading of 513ms on
  a file that otherwise sits near 150ms is how much a single sample is worth. A
  verdict is buildable on a quiet machine with a proper distribution behind it;
  it was not buildable from what was measured here, and a readout the user can
  re-mark against turned out to be more useful than a label anyway.

A last one is a real limit rather than a choice: the wrap is a hard cut in the
clip's audio, audible as a click when playback audio is on. Nothing short of a
crossfade fixes it, and a crossfade needs two read heads on one element, which a
`<video>` does not have.

## The clip strip — a rundown, not a timeline

Playing one source at a time is the whole app today. The ask behind this is
music videos: a series of clips, set up in advance, played back to back. This
section is the design, written before the code because one decision in it
(seeding, below) is cheap now and expensive to retrofit.

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
The hard-cut click above is filed as "a real limit rather than a choice" because
a `<video>` has one read head — a preroll element is the second one.

### Seeding: the decision that is expensive later

**Every roll goes through a seeded RNG, and a take records the seed plus the
resolved picks.** This is the one thing in here that must be right from the
first commit.

If rows roll, a take is unreproducible by construction — and the whole point of
the fixed-framerate export above is to re-render a take at quality after
performing it. Record four good minutes with unseeded rolls and there is no way
back to them. Storing the resolved picks means storing **identity, not urls**,
for the reason `sources/pool.ts` already gives: a url is a rendering, and the
one that worked today 404s when a transcode ladder is rebuilt. `PoolRef` — its
origin, title and kind — is the thing to keep.

This is also the natural carrier for the automation recording described under
fixed-framerate export — control writes with frame stamps, replayed offline. A
seed plus a resolved pick list plus stamped control writes _is_ a take.

### One walk, two clocks

Playing the strip is: walk the rows, apply each through the existing
`writeControls` / `startGlide` funnel, preroll the next row's source. That walk
is the same live and offline; only what advances it differs.

- **Live** — wall clock, preroll depth 1, manual override (jump to any row,
  hold, retrigger).
- **Offline** — the virtual clock from _Fixed-framerate export_ above, where
  frame N is a function of N.

Which is why the live path is worth building first: it is a hard prerequisite
for the offline one, since a CFR render of a rolling strip means nothing until
the rolls are reproducible.

Transitions are largely built too. `ui/morph.ts` gives a `morphTo` over
`MORPH_SECONDS` (0/1/4/8/30), `presets.ts` has `blendPresets`, and `TBar.tsx` is
the A/B throw. A row's arrival is a choice among those rather than a new
mechanism.

### What blocks the live half

- **Per-note MIDI bindings.** `ui/midi.ts` fires the whole bay on any Note On
  and its own comment says per-slot notes "want a binding family of their own".
  Triggering rows from a controller needs that family, and the strip is one of
  the best arguments for building it — firing rows is a drum pad, not a knob.
- **The recorder is variable-framerate.** `useCapture.ts` is `captureStream()`
  plus `MediaRecorder`, timestamped by wall clock. Fine for a screen grab, wrong
  for anything cut to music, and the reason the `VideoEncoder` swap above is
  worth doing early — it fixes what already ships, not only what is planned.

### Deliberately not this

- **Tracks, a scrubbable playhead, trim handles.** A large amount of UI for a
  storyboard, and the argument in _Clip cues_ above applies — the panel is built
  around what a hand moves during a take.
- **ffmpeg.wasm anywhere in the live path.** It is a transcoder, not a player.
  Concatenating clips with it means re-encoding ahead of time (stream-copy needs
  every clip to match codec, resolution and timebase), losing live cut points,
  and stacking codec damage _upstream_ of the signal path — backwards for a
  project whose premise is modelling the mechanism. `scripts/clips.mjs` already
  shells out to native ffmpeg offline, which is where it belongs.

When the code lands, the seeding rule above is the part that should become an
ADR — it is the one a later reader would otherwise be within their rights to
simplify into `Math.random()`.

## In flight — preset screening, round 2

Ten retuned candidates sit schema-checked in `scripts/candidates.example.mjs`;
`scripts/contact.mjs` (documented in `DEVELOPMENT.md`) renders them into a
linked contact sheet. Needs a quiet machine — each candidate is ~800 stepped
frames, and on a loaded box candidates trip the protocol timeout. Nothing
depends on it; the shipped presets stand alone.

## Not worth building

- **Cochannel interference.** Already reachable: source B's dirty-sum path is a
  second non-genlocked composite beating against A, with its own line and
  subcarrier detune. That _is_ cochannel. (Adjacent-channel is not — that one
  shipped as `rfAdjacent`, and is carrier beats rather than a second picture.)
- **A TBC.** A corrective box that removes `tbJitter`/`tbWow`. Considered and
  declined; inverse-effect controls are interesting for performance but nobody
  has wanted one.
