# Ideas / backlog

Things worth doing that aren't done, and things that look worth doing but aren't
— so a future pass doesn't re-litigate them. Line numbers drift; grep the
described feature.

Ideas from the original list still unclaimed: the video-synth oscillator source
and chroma key.

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

- **A waveform monitor** is the obvious companion to the shipped vectorscope —
  line-rate luma against IRE graticule, where sync depth, setup and the AGC's
  pumping would be readable instead of inferred. `?dbg=2` already paints the
  composite; this is that with a scale on it. Build it the way the scope was
  built: not a pass (`decode` scatters, `present` draws), and with a finite spot
  on the way out, or a flat field lands every sample in one bin and draws as a
  speck.
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

## Motion follow-ups (after the ∿-on-every-row pass)

Shipped: the bay lifted into `useModSlots` (eight slots), a `∿` on every control
row that claims a slot on first press, presets/scenes/`?mod=` carrying motion, a
global motion amount with a phase-holding freeze, and an undo walk that restores
routings alongside controls. What was deliberately left:

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
