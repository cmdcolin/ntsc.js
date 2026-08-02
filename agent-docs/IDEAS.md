# Ideas / backlog

Things worth doing that aren't done, and things that look worth doing but aren't
— so a future pass doesn't re-litigate them. Line numbers drift; grep the
described feature.

## Modulation: kill the remaining naked periodic waves

The premise (see `../docs/ARCHITECTURE.md`) is that a fault should be
_mechanistic_. A single periodic wave traced straight down the raster violates
that — it reads as a filter effect, not a fault (the warning
`signal/audiostate.ts` opens with). The shared home for bounded-aperiodic drift
is now **`signal/noise.ts`** (`valueNoise`, `Lorenz`, `Wow`); reuse it rather
than rolling a new sine.

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

### Landed

Replaced with `signal/noise.ts` sources (commit "Replace periodic modulators
with bounded-aperiodic sources"):

- **Tape wow** (`signal/linestate.ts`) — was a single 0.6 Hz sine; now `Wow`, a
  quasi-periodic sum of incommensurate eccentricities.
- **Modulation LFOs** (`signal/modstate.ts`) — added `smooth` (value noise),
  `hold` (sample & hold), `lorenz` (strange attractor) sources.
- **Intercarrier buzz** (`channel.wgsl`) — the 4.5 MHz sound carrier's FM is now
  driven from `audio[row]` (it physically _is_ the audio leaking past the trap),
  so it's content-driven and silence leaves a clean stationary weave.

## Not worth aperiodic-ising

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
  beat_, not a summed picture, so the source-B path below does not cover it.
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
- **Underscan / `vSize`.** Noted in the root `ideas.md` as nearly free. Worth
  more than it looks: it is what makes head switch, the VBI, and everything
  above visible rather than cropped. Build it first if any of this is wanted.

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

## Digital cable tier

Macroblocking, DCT ringing, frozen last-good-blocks, motion-vector smear. Large
— it is a codec, not a knob — and it does not compose with the composite chain,
so it is only interesting under one framing: a digital head-end feeding an
analog last mile. Box → impairment → NTSC encode → the entire existing chain,
which is era-correct for the late nineties and is genuinely mechanism modelling
rather than artifact drawing. Not worth starting until something needs it.

## Not worth building

- **Cochannel interference.** Already reachable: source B's dirty-sum path is a
  second non-genlocked composite beating against A, with its own line and
  subcarrier detune. That _is_ cochannel. (Adjacent-channel is not — see the RF
  section.)
- **A TBC.** A corrective box that removes `tbJitter`/`tbWow`. Considered and
  declined; inverse-effect controls are interesting for performance but nobody
  has wanted one.
