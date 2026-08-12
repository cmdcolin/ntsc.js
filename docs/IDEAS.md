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
- **Crease / edge damage on the main deck.** The delay loop's `tapeWear` seeds
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
- **A saved look on a pad.** The note-binding family shipped (`ActionTarget` in
  `ui/midi.ts`), so the wire exists — what it carries is the thirteen gestures
  that need nothing but a velocity. A saved look is the obvious next one and is
  a different shape: its name comes from a list that changes under the binding,
  which is the problem `preset:` already solves for knobs by binding the name
  and dropping the entry when the name goes. `savedProfiles.ts` would need the
  same treatment. Program change is the other half — one message per look, which
  is what a PC number _is_ — and would want its own family again, since a PC
  carries a number rather than a velocity.
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

## The editor — moved to its own document

The clip strip, fixed-framerate export and the declined NLE plugin used to be
three sections here. They are one project, so they are now one document:
[`EDITOR.md`](EDITOR.md) — the rundown and its transition shelf, the constant-
framerate render an editor can conform, why it is not a plugin for somebody
else's timeline, and the build order across all of it.

What stayed here belongs to the shipped app rather than to that project: **Clip
cues** below, and **Patching into other apps** above.

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

Both halves of what was open on it have shipped: a pad fires the whole bay or
any one slot (the note-binding family, below), and `t` fires the bay from the
keyboard. What that pass learned, for whoever extends the family: the rule worth
naming was what an _unbound_ note does, and it is `noteAction` in `ui/midi.ts` —
with nothing bound every note fires the bay, which is what shipped and the right
reading of an unmapped keyboard, and binding one pad lifts the blanket. Written
the other way round (bound pads plus a blanket that never lifts) a pad would
strike its slot and knock every other envelope over on the way.

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

Shipped since: **the far end takes a held look**, which turns the same gate into
a hard flip between two looks — `⧉ hold this look` parks the resting board at the
other side and the length row becomes a duty, because the two ends of a flip are
peers where a stab's are not. Worth knowing for anything built near it: the
_hard_ flip is the affordable one and a crossfade is not, since the filter bank
is redesigned whenever a filter control moves — a cut pays that on the two edges
of a cycle, a fade would pay it every frame. That is also why this is the gate's
job and not a mod slot's: a routing drives one `ControlKey`, and two looks is
every key at once.

Two things it is still missing, both surfaced by pulling on "the stabs slider
does not work":

- **It does not travel with the look, and now there is more of it not to
  travel.** The gate lives in `localStorage` and nowhere else — not in `?mod=`,
  not in a preset's routings, not in a saved look. A link, a preset or a saved
  profile therefore drops the most visible thing the bay does, and whoever opens
  it sees a still picture where the board had been cutting four times a second.
  `useModSlots.ts` already carries the reasoning for why it belongs in both — a
  stab train is part of the look in a way a freeze is not — so what is owed is
  the schema change to `?mod=` and to the preset routings, with readers that
  tolerate its absence the way `readStab` already tolerates a junk entry.

  The held-look pass raised the stakes and complicated the schema in the same
  stroke. A gate whose far end is a look is not two numbers any more, it is two
  numbers and a whole second board — so a link carrying one would roughly double
  the query string, and a "look" someone shares is now genuinely two looks. The
  shape to reach for is probably the same one the strip uses for a row: store
  the far board as a diff against stock, since a held look is usually a handful
  of controls off it and `writeProfileParams` already knows how to write that.
  Storing a preset *name* is the tempting cheap version and it is wrong for the
  same reason `Stab.to` is a board rather than a name — the look you hold is
  usually one you dialed, not one somebody authored.
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

## Delay loop follow-ons (after the tape-delay pass)

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
- ~~**MIDI on the cue.**~~ Shipped with the note-binding family: `cue:a/b` and
  `jump:a/b` are four of its thirteen actions, and both go through the same
  `slotFor` lookup the keyboard's `i` and `o` use, so a pad and a key cannot
  disagree about which deck they are on. The retrigger was the argument for
  building the family — it is a drum pad, not a knob.
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

A last one used to be a real limit rather than a choice: the wrap is a hard cut
in the clip's audio when playback audio is on. Nothing short of a crossfade
fixes it, and a crossfade needs two read heads on one element, which a `<video>`
does not have. **That one is now built** — `armHead` / `promoteHead` in
`ui/videoSlot.ts`, and the write-up is at the end of this section.

**This used to say "audible as a click", and that undersold it by two orders of
magnitude.** The app's own readout is the evidence, and it was shipping the
whole time: `loopHealth().medianMs` is the median time from issuing the wrap's
`currentTime = start` to its `seeked`, and `cuecheck` prints it every run —
**199 ms on a densely-keyframed clip and 524 ms on a sparse one**. A seeking
element is not playing, so what a loop actually does to the sound is drop out
for a fifth to half a second, every lap. A click is what is left at the edges of
that.

Three things follow, and they are why this is worth more than its place in the
build order suggests.

- **A de-click envelope is not the cheap version of this.** Fading the gain to
  zero across the join and back is the standard fix for a seek discontinuity,
  and here it tidies the edges of a half-second hole. Worth almost nothing on
  its own.
- **The two-element fix has no sync cost**, which is the objection that would
  otherwise sink it. The instinct is to crossfade the audio while the picture
  stays on the outgoing element, and that trades a click for lip-sync error. But
  the second element can carry _both_: `playUrl` already promotes a parked
  element for picture and sound together, so the loop's double-buffer is a swap
  and not a blend, and nothing leads anything.
- **The machinery is nearly all built, and `strip.ts` says so in passing.**
  `land`'s comment already notices that a one-row looping rundown prerolls the
  clip it is playing and calls it "an odd-looking case that happens to be the
  loop's best behaviour" — which is exactly this feature, arrived at sideways. A
  loop's second read head _is_ a preroll of the same clip at its in-point. Two
  gaps: a parked element is paused, and it would have to be rolling before the
  outgoing one reaches `r.end`; and there is one `next` field per slot, so a
  looping clip and a rundown's lookahead contend for it. That contention is a
  policy decision and is the reason this is not simply a small job.

**Measured, and it is both.** `scripts/wrapsound.mjs` listens rather than
inferring — an AudioWorklet tapping the app's own analyser, on a generated 440
Hz tone so that floor means silence and not a quiet bar, with the same GOP arms
`loopseek` uses. Three runs, medians, Firefox Nightly / Linux:

    arm      keyframes   seek (app)   silence (heard)   worst   quiet
    intra          600      4-6 ms         11 ms        21 ms      1%
    dense           40     11-14 ms      11-21 ms       85 ms    1-3%
    sparse           1    188-219 ms    203-235 ms     469 ms   16-19%
    control         40         --           --           --        0%

**Read the middle two columns against each other, not the absolute numbers.**
These are `testsrc` fixtures, which loopseek's header is emphatic about: they
are about as cheap a thing to decode as exists, and the same "frames back" buys
an order of magnitude more on real footage. The dense arm at 11-14 ms is not
`demo-v2.mp4`, which the same `medianMs` instrument puts at 64-90 ms.

What transfers is the relationship, and it is the finding:

- **The silence _is_ the seek, plus about one animation frame.** Two independent
  instruments — a worklet on the audio thread, and the app's own `seeked` timing
  — agree to within about 15 ms on every arm, across three orders of magnitude
  of seek. So there is no separate audio cost hiding here and nothing to fix in
  the audio graph: whatever removes the seek removes the dropout.
- **Which means the app has been displaying the dropout all along.** The cue
  row's `wrap 0.15s` is `wrapCostMs`, off the same `seeked` timing — so every
  number in the table above can now be read as milliseconds of silence without
  re-measuring anything: 12-15 ms on minnie-moocher, 64-90 ms on demo-v2,
  128-233 ms on haunted-house. That readout was built to be re-marked against,
  and it turns out to be a readout of the sound.
- **Both earlier claims were right, about different clips.** "Audible as a
  click" is what the well-encoded end does, and there the de-click envelope
  above really would be the whole fix. "A fifth to half a second" is what the
  sparse end does: **19% of the run silent, and one wrap in 469 ms**. Neither
  number is a property of _looping_ — both are properties of the file, which is
  the same conclusion the wrap-cost readout reached from the picture side and
  declined to threshold.

So this is worth building for the clips that need it and worth nothing for the
rest. Two of the four clips this repo ships are in the slow tier, and an
archive.org pick is whatever it is; that is the case the second read head is
for.

The control arm is what makes the rest a measurement: same clip, no loop marked,
0% quiet and no wraps. Without it "the sound sits at floor" cannot be told from
an analyser that was never fed.

Two notes for anyone re-running it. `public/test.mp4` — the sparse clip every
existing reading comes from — **has no audio track at all**, which is why the
fixtures are generated rather than pointed at `public/`. And the run steps the
engine from Node rather than riding rAF, because the region clamp lives in
`VideoPump.pump()`: on an occluded window the loop wraps once a second and the
harness would be measuring the window manager.

### Landed: the second read head

`armHead` / `promoteHead` in `ui/videoSlot.ts`, and a `Relay` the pump asks at
the wrap. Same harness, `?loophead=0` against the shipped path, both arms of
each clip minutes apart on one quiet machine:

    arm            wraps   seek     silence   quiet   free
    intra:seek        13    7 ms      11 ms      1%     0%
    intra:head        11     --       11 ms      0%    73%
    dense:seek        13   14 ms      21 ms      2%     0%
    dense:head        13     --       11 ms      0%    85%
    sparse:seek       10  237 ms     245 ms     18%     0%
    sparse:head       13     --       11 ms      0%    85%

**A sparse clip goes from a fifth of the run silent to none of it.** 85% of
wraps make no sound at all; the rest are 11 ms, which is the instrument's floor
rather than a reading. `seek --` is the app recording fewer than two seeks in a
fourteen-second run — the head essentially never gave up on a one-second lap.

Four things are worth keeping from building it, and the first two were not in
the design above.

- **The two elements do not contend for the preroll slot, because the bound that
  rule protects is _files_.** This section filed the contention as a policy
  decision and it dissolved instead: a preroll is speculative and names a
  different clip, so it can cost a whole download; a loop's head is the same url
  as the element on air, which for a `blob:` is the same object and otherwise a
  cache hit. Sharing one field would have made a rundown's lookahead and a
  marked loop take turns breaking each other, to protect a budget only one of
  them spends.
- **The first cut made the sparse case worse, and only the measurement said
  so.** Where the outgoing head cannot re-park within one lap, both elements
  seek the same expensive file at once: 1028 ms of dropout on half the laps in
  place of 213 ms on all of them — a better median, a worse sound, and a shape
  that reads as fine if you look at the wrong number. So the re-park is held
  against its own lap and an overrun retires the head for the life of the cue.
  There is no minimum-lap constant, because whether a head can keep up is a
  question about the clip and the loop together that the first lap answers and
  no threshold written here could.

  **A deadline and not a stopwatch**, which is the correction the first fix
  needed in its turn. Checking the elapsed time inside `seeked` cannot fire
  until the re-park finishes, so an overrun stayed armed for the whole of its
  own overrun — and every wrap in that span found a head that was not ready and
  seeked against it, which is the contention being retired for. Worse, a re-park
  that never completes at all never fired the check, so the one case with no
  bound on it was the one nothing retired. A timer armed at the lap catches
  both.

- **The promotion deliberately does not go through `setVideoSource`.** That is a
  source change, and `retarget` clears the region on purpose — a loop routed
  through it ends at its first lap. The pump asks for an element and installs it
  itself (`continueOn`), so it never has to learn what a read head is, which is
  the same seam `faultPlan` uses to avoid learning what a rundown is.
- **The wrap-cost readout became the threshold two attempts could not build.** A
  loop with a working head does not seek, so `wrapCostMs` reports nothing; when
  the head gives up, the number comes back. It now appears exactly when looping
  this clip here is costing something — by mechanism rather than by a cutoff
  someone had to pick, and nothing was calibrated to make it true.

  It takes one line to hold, and it did not have it at first: a relayed wrap has
  to _clear_ the health window rather than merely not add to it. A head is armed
  unawaited, so on a big file a lap or two wraps by seeking before it lands —
  and those two laps were otherwise the number the row showed for the rest of
  the cue, while every wrap after them was free. Clearing is safe rather than
  blinding because a head cannot alternate: one that misses its lap is retired
  at the deadline, so the window refills within two laps and the number returns.

Still open, and genuinely small now: the **de-click envelope** at the top of
this section. 11 ms is one frame, which is a click rather than a dropout, and
fading the gain across the join is the standard fix for exactly that. It was
worth almost nothing against a half-second hole; against what is left it is the
whole of the remainder.

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
- **An After Effects / Premiere / OpenFX plugin.** Declined at length in
  [`EDITOR.md`](EDITOR.md), which also says what the reusable part turned out to
  be and where the editor-facing work actually goes.
