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

## ~~The unlocked H-osc coasts too cleanly~~

Shipped: the free-run branch now carries a lock age (`timing[LOCK_AGE]`,
persistent across frames) that scales its phase noise, so lock decays over
roughly a frame of lost lines instead of coasting — plus an occasional
phantom-edge trigger the flywheel chases at the hold gain, because a slicer
hunting in noise triggers on noise. Full scramble now writhes with no
`hDetuneHz` dialled in. The presets that carried the compensation
(`scrambled channel`, `ssavi`, `dead channel`, `chroma only`) were rechecked:
their looks hold, since below the slicer level the tip is still found and the
decay never engages — the change only bites where sync is genuinely gone.

## RF / tuner front end

The whole chain is baseband. Everything from the transmitter or head-end to the
tuner is missing, and several existing effects are baseband stand-ins for
mechanisms that behave differently on a carrier. This is one new pass between
encode and channel, not a scatter of knobs.

- **Envelope detection, negative modulation.** Sync tip is peak carrier, white
  is 12.5%. Weak-signal snow is therefore multiplicative and Rician, not the
  additive Gaussian `noiseIre` adds: grain density tracks picture level and sync
  is the last thing to die. That asymmetry is what makes fringe reception read
  as fringe reception instead of grey fuzz.
- **Tuner mistune.** Off-channel, the vestigial-sideband filter cuts
  asymmetrically: detail drops, the 4.5 MHz sound carrier climbs out of its
  trap, 920 kHz beat appears. Couples straight into the existing `soundIre`
  herringbone — mistuning makes the buzz louder, which is the interaction the
  premise wants.
- **Adjacent channel.** Cable is a 6 MHz comb; a weak trap lets the neighbour
  through as the drifting diagonal windshield-wiper bars, plus its sound carrier
  1.5 MHz into the picture. Needs the RF domain: what leaks in is a _carrier
  beat_, not a summed picture, so the source-B path does not cover it.
- **Ingress.** CB or ham into a cracked shield — a herringbone that sweeps and
  comes and goes with speech. Reuses the `audio[row]` trick `soundIre` already
  uses for intercarrier buzz.

## Vertical interval content

The VBI carries nothing today. `decode` already wraps rolled rows into view, so
anything put there shows up in the rolling bar for free — which is where most of
the payoff is.

- **Macrovision.** Pseudo-sync and AGC pulses on lines 12–19. `sync.wgsl`
  averages sync depth over `row > VSYNC_LAST + 3` (= row >= 12), which is
  exactly the window Macrovision was built to poison, so the existing `agc`
  control makes the picture breathe and crush with no decode-side changes at
  all. Colorstripe is a burst-phase inversion on a subset of lines, which the
  burst-lock path already turns into hue banding. Best mechanism-composition
  payoff left on the list.
- **VITS / VIR, and line-21 caption data.** A multiburst and staircase on 17–18,
  a dashed data burst on 21. Invisible in normal framing and then the roll bar
  has real content in it. Cheap.
- **Underscan.** `vSize` (see Deflection below) is what makes head switch, the
  VBI, and everything above visible rather than cropped. Build it first if any
  of this is wanted.

## Tape mechanisms not modelled

- **Azimuth crosstalk from the adjacent track** (EP/SLP). Narrow tracks plus
  azimuth suppression that only works at high frequency, so the neighbouring
  track bleeds through as a _low-frequency-only_ ghost — a soft, colourless
  second picture that swims when tracking is off. Distinct from the multipath
  ghost, which is sharp and full-bandwidth.
- ~~**Crease / edge damage.**~~ Shipped as the loop bin's `tapeWear`, though
  only on the loop: defects seeded on _position on the tape_ so they recur every
  lap. The same idea on the main deck still wants doing — it has no
  tape-position coordinate to hang a defect off, which is exactly what the ring
  gave the loop.
- **Servo hunting.** `trackPos` is a static knob; a real auto-tracking deck
  searches and settles after a scene change or on exiting shuttle.
- **Luma FM beating the 629 kHz color-under carrier.** The fine crawling chroma
  noise in saturated reds. Modelling the luma FM properly is expensive; the
  honest cheap version is the beat product alone.

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
- **Vertical geometry.** `vSize` / `vLin` are nearly free by contrast — they
  only change which source row a screen row picks. `vSize` is also the gate on
  the vertical-interval work above.
- **Fractional bend.** `hoff` is `round()`ed to whole samples; at large
  amplitudes adjacent rows stair-step. Resampling the tile with `catmull` would
  smooth it, at the cost of restructuring the staging.

## Screen-domain effects not yet built

The neon phosphor colour work (beam transfer, `phosphorMode` tube identities,
persistence skew/bleed, the magnifier) shipped in full; these two items are what
remains of it.

- **Luma-keyed halation radius.** `crt_face` already adds a wide warm
  glass-scatter halo (`crtHalation` × the 15-px golden-angle tap ring, tinted
  `WARM`), but at a fixed radius. Real glass scatter depends on beam current and
  so blooms disproportionately on peak whites; keying the halo radius off local
  luma would read more like an old tube.
- **Per-channel bloom radius.** One radius for all three channels; the phosphors
  don't actually scatter alike.

## Boxes in the rack (from the commercial-processing-unit pass)

Shipped out of this batch: the receiver **tint** knob, non-quadrature **demod
axes**, **audio → demod reference phase**, a chroma bandwidth ceiling raised to
3 MHz, **output stage clip**, and the **dropout compensator**. The rest of the
pass, in rough payoff-per-effort order.

- ~~**Dropout compensator.**~~ Shipped as `dropoutComp`, and the half cycle did
  all the work: 1-line patches come back complementary, 2-line come back clean,
  and neither helps where the held line lost the same samples. One thing learned
  building it — substitute the _difference_ (`comp[n - bl*SPL] - comp[n]`)
  rather than the sample, and the patch keeps the noise, hum and buzz the line
  already carries, which is what a delay line inside the playback path would
  hand back. Replacing the sample outright leaves a conspicuously clean streak.
- **Differential gain and differential phase.** On the spec sheet of every VTR
  and proc amp ever sold, and absent here. The video amplifier's gain is not
  flat against DC level, so chroma riding bright luma is compressed (DG) and its
  phase shifts (DP): saturation dies in the highlights and hue swings with
  brightness. A soft nonlinearity on the composite in `channel.wgsl` gives DG
  for free; DP needs an explicit amplitude-dependent delay. Inside the mixer
  loop it separates a feedback trail into colour layers by brightness, because
  `cfbDelay`'s rotation per generation stops being uniform.
- **Convergence, purity, and the magnet on the tube.** The screen section models
  beam, phosphor, mask and glass, but the three guns are perfectly registered,
  which no tube is. Two per-channel offsets in `crt_face`: convergence error
  growing with radius (colour fringes at the corners), and a magnetized patch of
  the mask as a fixed soft purity blotch the picture rolls through. Both magnify
  with the lens.
- **Scan velocity modulation.** Consumer sets slowed the beam at dark→bright
  transitions to fake sharpness; emission goes as dwell time, so brightness
  redistributes asymmetrically across the edge — white overshoot one side, black
  notch the other. Lives in `crt_face` over the decoded image, so it sidesteps
  the decode-tiling constraint that blocks intra-line geometry.
- ~~**ABL (automatic beam limiter).**~~ Shipped as `abl`, as a second-order
  servo with the damping on the knob — underdamped it genuinely hunts at its own
  couple of Hz, and its natural frequency is deliberately unequal to the
  auto-iris's so the two pumps beat. It also throttles the beam current the HV
  sag integrates, one field late.
- ~~**Chroma AGC with a time constant.**~~ Shipped as `accLagLines`, in exactly
  the bounded-exponential-FIR shape this entry asked for: `line_analyze`
  re-measures the previous bursts per line into `lineInfo.w`, and decode's gain
  and killer read the lagged value. Phase stays instantaneous — the AFPC is a
  faster loop than the gain leg.
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
- ~~**Auto-iris hunting in the camera loop.**~~ Shipped as `fbIris` — GPU state
  rather than the CPU floats proposed here (two more slots in `timingBuf`,
  updated in `sync`'s serial pass, applied by `compose` a frame late), which
  avoided a readback entirely. Second-order like the ABL, and the light it
  meters is beam load × the ABL's drive, so the two servos share a sense line as
  well as a loop.
- **Rutt/Etra scan deflection.** The source's own luma patched into the vertical
  deflection amplifier: the raster becomes a relief map of the picture, and the
  brightness comes free from line bunching (line density _is_ luminance). Fits
  the deflection domain exactly — geometry detonates while hue stays put. The
  catch is that it is a per-pixel _vertical_ gather, so it wants `crt_face` over
  the decoded image with a bounded column search, not `decode`.
- **Smaller trims.** A **Y/C delay** mistrim (colour shifted bodily sideways off
  edges, distinct from `chromaTail`'s asymmetric smear); **head clog** (one of
  the two heads dead, so alternating segments go to snow, keyed off the existing
  head-switch point); **setup mismatch** (a 0 IRE deck into a 7.5 IRE set and
  back, for crushed or milky blacks).

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

## Instruments, and the fact that nothing tests a pixel

- ~~**Vectorscope.**~~ Shipped as `scope`. Notes for whoever adds the next
  instrument: it is _not_ a pass — `decode` scatters into `scopeBuf` and
  `present` reads it in the fragment shader — which is what keeps
  `pipeline-graph.test.ts` and the pass diagram out of it. And a histogram of a
  flat field lands every sample in one bin, so it needs a finite spot on the way
  out or it draws as a one-pixel speck; the 3x3 tap in `present` is that, for
  the same reason the picture has a beam spot.
- **A waveform monitor** is the obvious companion — line-rate luma against IRE
  graticule, where sync depth, setup and the AGC's pumping would be readable
  instead of inferred. `?dbg=2` already paints the composite; this is that with
  a scale on it.
- **Nothing asserts a rendered pixel.** `shaders.test.ts` proves the WGSL
  compiles, `pipeline-graph.test.ts` proves the pass order matches these docs,
  and the `signal/` specs cover the DSP — but every visual claim in the repo
  rests on someone having looked at a screenshot. The pieces for a cheap
  regression exist: `scripts/shot.mjs` drives Firefox Nightly, `?set=`
  configures a session, `vf.step()` is deterministic with the CPU-side jitter
  controls at zero. Decode SMPTE bars, assert the six hues land within
  tolerance. Too heavy for `pnpm test`; right for a script CI runs on its own
  schedule.

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

- ~~**Screen capture as a source mode.**~~ Shipped: `screen` on both A and B
  (`useEngine.startScreen`). The browser's picker is the only confirmation, so
  there is no dialog of our own; the share names itself in the caption, which
  reopens the picker; ending the share from the browser's bar drops A to snow
  and switches B off. It cannot round-trip through a link — the grant dies with
  the page and the picker needs a gesture the loader hasn't got — so `screen` is
  filtered out of the `?src=` contract alongside `file`.
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
- ~~**The filter and the palette don't know about modulation.**~~ Shipped: the
  filter takes a motion query (`∿`, or the words `moving` / `modulated` /
  `motion` / `lfo`, unioned with the text match so prose still hits), and the
  motion strip's `N∿` count is the button that asks it. `sliderMatches` /
  `groupMatches` take the bay as an `isRouted` predicate rather than reading a
  context, so `filter.ts` stays pure and the bay stays in its own context. The
  spine narrows with everything else, which turns the chain map into a
  where-is-the-motion display for free. The palette still indexes controls by
  their static def — it reaches this through a `show what is moving` action
  rather than by ranking routed controls higher, since the palette has no
  per-item place to say "and this one is moving".
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

- ~~**Transport speeds other than ±1 and 0.**~~ Shipped as `tapeShuttle`, with
  the track-crossing model it needed: the loop carries its own `speed - 1`
  crossings and drives the same bar the deck's `shuttleX` does. Falling out of
  that rather than being special-cased: a paused loop has one bar and a reversed
  one has two, so only play speed forwards is clean. What is still missing is
  the deck's _second_ half — `linestate` gives each strip between the deck's
  bars its own timing and colour-under phase, so the picture tears and rainbows
  at the boundaries. The loop's strips come off one contiguous read, so they are
  clean between bars. Doing it would need per-line offsets on the loop read,
  which `decode`'s row-uniform constraint does not block but `tape_play` has no
  per-line buffer for yet.

## In flight — preset screening, round 2

Ten retuned candidates sit schema-checked in `scripts/candidates.example.mjs`;
`scripts/contact.mjs` (documented in `DEVELOPMENT.md`) renders them into a
linked contact sheet. Needs a quiet machine — each candidate is ~800 stepped
frames, and on a loaded box candidates trip the protocol timeout. Nothing
depends on it; the shipped presets stand alone.

## Not worth building

- **Cochannel interference.** Already reachable: source B's dirty-sum path is a
  second non-genlocked composite beating against A, with its own line and
  subcarrier detune. That _is_ cochannel. (Adjacent-channel is not — see the RF
  section.)
- **A TBC.** A corrective box that removes `tbJitter`/`tbWow`. Considered and
  declined; inverse-effect controls are interesting for performance but nobody
  has wanted one.
