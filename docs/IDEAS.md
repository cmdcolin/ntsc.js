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

## The unlocked H-osc coasts too cleanly

Found while building sync suppression, and it caps how good several existing
effects can look. When `sync_measure` finds no edge, `sync.wgsl` models the line
as `pll + 0.15 * (rand01() - 0.45)` — a tiny random walk. `P.hRate` (the
`hDetuneHz` free-run drift) is added separately and unconditionally. So a
receiver sitting exactly on 15.734 kHz that loses sync entirely keeps drawing an
almost perfect raster, which no real set does: a free-running line oscillator
has phase noise, and a slicer hunting in noise triggers on noise.

Consequence: sync suppression, `chromaPinOnly`, `polarityFlip` and the no-signal
presets all need `hDetuneHz` dialled in before they look like anything, and the
knob that is nominally causing the fault is not the knob doing the work. Worth
fixing at the source — give the unlocked branch honest oscillator jitter scaled
by how long it has been since the last good measurement, so lock decays instead
of coasting. Everything above then reads correctly at its own setting, and the
presets can stop carrying a detune to compensate.

Check `presets.ts` afterwards: `scrambled channel`, `ssavi`, `dead channel` and
`chroma only` all lean on that compensation today.

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
- **Crease / edge damage.** A scar at a fixed _tape_ position, recurring on the
  helical period rather than randomly like `dropoutRate`. Reads as damage
  instead of noise.
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
persistence skew/bleed, the magnifier) shipped in full; these two items are
what remains of it.

- **Luma-keyed halation radius.** `crt_face` already adds a wide warm
  glass-scatter halo (`crtHalation` × the 15-px golden-angle tap ring, tinted
  `WARM`), but at a fixed radius. Real glass scatter depends on beam current and
  so blooms disproportionately on peak whites; keying the halo radius off local
  luma would read more like an old tube.
- **Per-channel bloom radius.** One radius for all three channels; the phosphors
  don't actually scatter alike.

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
- **The filter and the palette don't know about modulation.** `sliderMatches` is
  a pure function of the static slider def, so "what is moving" is not
  searchable and a routed control cannot be jumped to by name. The row's ∿ tint
  and the stage fold's `· ∿` cover the local case; a global "3 moving → show me"
  does not exist.
- **Modulating the five filter controls** (`encChromaMHz`, `demodMHz`,
  `chromaTail`, `lumaMHz`, `lumaPeak`) rebuilds the FIR bank every frame. Allowed
  from the UI deliberately — it is a real patch someone may want — but authored
  presets are forbidden from it by `presets.test.ts`. If it ever needs to be
  cheap, the bank would have to be rebuilt only when the modulated value crosses
  a meaningful step rather than on every frame.
- **`?surprise` on boot stays controls-only.** A rolled recipe applies its
  motion in the app, but the boot path layers controls before the bay exists.
  Accepted asymmetry, not a bug worth plumbing around.

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
