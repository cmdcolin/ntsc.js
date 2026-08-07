// The user-facing control schema: every knob, in physical units. This is the
// shared vocabulary between the UI (sliders, presets, MIDI) and the Engine
// (which converts it to GPU uniforms). It deliberately depends on neither, so
// importing a control's type doesn't drag in the GPUDevice.

import type { ModWave } from './signal/modstate'

// All user-facing controls, in physical units.
export const DEFAULT_CONTROLS = {
  // source conditioning
  deint: 0, // bob-deinterlace source A (0 off, 1 on) — kills capture-card field combing
  // the generated no-signal sources (TV static, blank tape), as statistics of
  // the path the noise arrived through rather than as two fixed looks
  srcNoiseBwMHz: 4.2, // bandwidth of that path: sets the grain's correlation length
  srcNoiseLine: 0.15, // per-sweep gain error (tuner AGC, head contact), 0..1
  srcNoiseLevel: 1, // noise power reaching the detector
  srcNoiseHz: 60, // the source's own refresh rate; below 60 each field is held
  // encoder
  encChromaMHz: 1.3,
  invert: 0, // polarity flip on the composite line (alligator-pin swap)
  // decoder
  demodMHz: 0.6,
  chromaTail: 0, // causal demod kernel blend: color trails rightward past edges
  chromaCoarse: 1, // chroma reconstruction lattice, samples (>1 = CUE rainbows)
  chromaGain: 1,
  burstLock: 1,
  tintDeg: 0, // the set's tint knob: demod reference rotated (180 = complementary)
  demodAxisDeg: 90, // angle between the two synchronous demod axes (90 = quadrature)
  matrixClip: 0, // RGB output stage: 0 hue-preserving fit, 1 hard per-gun rails
  scDetuneKHz: 0, // bent 3.58 MHz crystal: demod LO pulled off-frequency
  killThresh: 2, // IRE
  accLagLines: 0, // chroma AGC time constant, lines of burst memory (0 = instantaneous)
  svideoBleed: 0, // Y/C miswire: bleed chroma into luma (S-video pins into composite)
  combMode: 0,
  hHold: 0.35,
  vHold: 1, // vertical hold: pull-in authority of the v-osc trigger
  vFreqHz: 60, // free-running vertical oscillator rate; off 60 the picture rolls
  syncBendUs: 0, // horizontal PLL kick out of vertical retrace (top-of-picture flag)
  // deflection geometry (tube-side scan bend, downstream of the decoder)
  bendUs: 0, // horizontal displacement amplitude
  bendShape: 0, // 0 flag, 1 skew, 2 bow, 3 ripple
  bendPeriod: 60, // flag decay constant / ripple period, screen lines
  vSize: 1, // vertical deflection amplitude: <1 underscans, showing the raster past the picture
  hvSagUs: 0, // beam-current deflection sag: bright content bends the scan
  hvRing: 0.5, // supply damping: 0 smooth droop .. 1 ringing / chaotic
  abl: 0, // beam limiter: 0 generous flyback .. 1 undersized and underdamped (pumps)
  hDetuneHz: 0, // horizontal oscillator detune off nominal line rate
  // audio patched at the yoke, one sample per line
  audioGain: 1, // input trim after auto-normalization
  audioBendUs: 0, // audio waveform straight into horizontal displacement
  audioLoad: 0, // audio driven into the HV tank (rings via hvSag/hvRing)
  audioIre: 0, // audio patched straight into the composite line, IRE
  audioHueDeg: 0, // audio waveform into the demod reference phase, degrees per unit
  // Bass onset straight onto the sag *amplitude*. Distorting all the time reads
  // as a broken picture; keeping the tube near-clean and slamming it on the hit
  // is what reads as the bass punching the image.
  audioSagUs: 0,
  // envelopes detuning the hold oscillators: transients knock sync out of lock
  audioRoll: 0, // bass-onset envelope into the vertical oscillator (lurch per kick)
  audioTear: 0, // level into the horizontal oscillator (tear on transients)
  // channel / tape
  lumaMHz: 4.2,
  polarityFlip: 0, // hard polarity flip: negate the whole line, sync included
  termination: 0, // cable termination fault (<0 double-terminated, >0 unterminated)
  chromaPinOnly: 0, // only the chroma pin patched to composite (color, no luma/sync)
  connectorGlitch: 0, // loose/intermittent connector
  connectorMode: 0, // which contact: 0 centre pin (signal + sync), 1 shell (ground lifts), 2 both
  // analog premium-channel scrambling, applied at the head-end
  scramble: 0, // sync-tip suppression depth (0 = in the clear)
  scrambleMode: 0, // 0 gated (every line), 1 line-alternate, 2 SSAVI (+ video inversion)
  // copy protection authored onto the source's vertical interval
  macrovision: 0, // Macrovision pseudo-sync/AGC pulse depth on VBI lines 12-19
  mvStripeDeg: 0, // colorstripe: burst rotation on walking line bands, degrees
  vbi: 1, // VBI test signals: VITS multiburst/staircase, VIR, line-21 captions (broadcast furniture)
  // bent video enhancer, patched inline between the deck and the set
  enhClampUs: 0, // clamp gate slid off the back porch (0 = correct)
  enhDroopUs: 0, // coupling-capacitor time constant (0 = DC coupled, no droop)
  enhPeakMHz: 0, // detail resonator center (0 = off)
  enhPeakQ: 0.5, // resonator feedback: ring length, and past 0.75 it howls
  enhPeakBoost: 0, // resonator mixed back into the video
  enhSync: 0, // sync regenerator mix (0 = box bypassed)
  enhSliceIre: -20, // regenerator slice level
  lumaPeak: 0,
  noiseIre: 0,
  noiseTilt: 0, // where the floor comes from: 0 IF-limited RF, 1 FM discriminator (triangular)
  impulseRate: 0, // arc events per frame, 0..24 (storm-clustered; duration sets shape)
  impulseIre: 90, // impulse peak amplitude
  impulseHz: 0, // periodic ignition train rate; hits form drifting diagonal lattices
  impulseMains: 0, // dimmer lock: random hits bunch into two bands riding the hum
  strikeRate: 0, // big multi-line strikes per second (lightning / arcing breaker)
  soundIre: 0,
  // RF front end: the tuner between the cable and the detector
  rfAdjacent: 0, // adjacent-channel leak through the IF trap (carrier beats, not a picture)
  rfMistuneMHz: 0, // fine tuning error: + frees the sound carrier, - slides down the Nyquist slope
  rfSnow: 0, // weak signal into the envelope detector: Rician snow, whites boil first
  ingress: 0, // CB/ham through a cracked shield: a keyed carrier's sweeping herringbone
  agc: 0,
  ghostDelayUs: 0,
  ghostGain: 0,
  humAmp: 0,
  humMod: 0, // mains ripple inside a line amp's supply: hum that multiplies, not adds
  colorUnderMix: 0,
  chromaNoiseIre: 0, // noise inside the color-under path, before up-conversion
  underJitterDeg: 0,
  dropoutRate: 0,
  dropoutLenUs: 5,
  dropoutComp: 0, // dropout compensator: 0 none, 1 one-line delay, 2 two-line
  headSwitchNoise: 0,
  headSwitchShiftUs: 0,
  headClog: 0, // one of the two video heads clogged: alternate sweeps collapse to snow
  ycDelayNs: 0, // chroma path late (+) or early (-) vs luma: colour displaced off its edges
  diffGain: 0, // differential gain: chroma compressed as the luma it rides brightens
  diffPhaseDeg: 0, // differential phase: hue swings with brightness
  fmOverdev: 0, // FM over-deviation: hard bright edges fold the luma demod to black streaks
  fmStreakUs: 0.4, // inversion-streak recovery (deemphasis) time constant
  tbJitterNs: 0,
  tbWowNs: 0,
  tbStickNs: 0, // sticky-shed stick-slip: relaxation-oscillator shear bands

  dubGens: 1, // tape dub generations: the channel block runs this many times
  // feedback
  fbMix: 0,
  fbZoom: 1.05,
  fbRotateDeg: 0,
  fbShiftX: 0,
  fbShiftY: 0,
  fbGain: 1,
  fbIris: 0, // auto-iris servo on the loop: 0 manual exposure .. 1 underdamped hunting
  fbFocus: 0.7,
  fbVign: 0.2,
  fbBlack: 0.03,
  fbKnee: 0.35,
  // CRT faceplate (what the feedback camera and display photograph)
  crtCutoff: 0, // beam cutoff, 0 = off (identity, no black crush)
  crtGamma: 1, // gun gamma, 1 = linear passthrough
  crtSat: 1, // saturation around luma, 1 = unchanged
  crtSpot: 0.6, // beam-spot radius on the glass, active px (0 = point-sampled pixels)
  crtGrain: 0.07, // granular phosphor deposit mottling emitted light
  crtBloom: 0,
  crtHalation: 0,
  crtGlow: 0,
  crtHaloKey: 0, // halation radius keyed off beam current, 0 = the fixed radius
  crtSvm: 0, // scan velocity modulation depth, signed (coil polarity)
  crtSvmWidth: 1.2, // SVM differentiator aperture, active px
  crtConverge: 0, // gun misconvergence at the picture edge, active px
  crtPurity: 0, // magnetised mask patch depth
  crtPurityX: 0.3, // blotch centre on the glass
  crtPurityY: 0.35,
  crtPuritySize: 0.3, // blotch radius, fraction of picture height
  // mixer loop (composite-level feedback)
  cfbMix: 0,
  cfbGain: 1,
  cfbDelayUs: 0.15,
  cfbLines: 0,
  cfbKey: 0,
  cfbKeyLevel: 45,
  cfbKeySoft: 8,
  cfbHold: 0,
  cfbTrail: 0,
  cfbFilterMHz: 0, // loop resonance center, 0 = flat loop
  cfbFilterQ: 0.5, // loop resonance selectivity
  cfbFilterBoost: 2, // added in-band loop gain once a center is set
  cfbServoUs: 0, // varactor on the loop delay: us of pull per 100 IRE of its own video
  cfbRing: 0, // loop bus ring-modulated against the live program
  // tape loop (a loop of tape threaded record head -> play head)
  tapeMix: 0,
  tapeLoopMm: 20, // record head to play head; delay = length / 33.35 mm/s
  tapeGain: 1,
  tapeHfLoss: 0.25, // band lost per pass: generation loss, colour first
  tapeNoiseIre: 1.5, // the medium's own noise floor
  tapeWear: 0, // fraction of the loop with the oxide worn off
  tapeSplice: 0, // the joint crossing a head, once per lap
  tapeRecord: 1, // record head down; lift it and the loop holds what it has
  tapeTransport: 2, // 0 reverse, 1 stopped, 2 forward, 3 scrub — only means anything held
  tapeShuttle: 1, // loop speed as a multiple of play; the transport gives the sign
  tapeHeads: 1, // playback heads in the path: a lap returns once per head
  tapeHeadSpread: 1, // where they sit along it; 1 = even subdivisions
  tapeWowPct: 0, // capstan wander: moves the delay time, not just the picture
  tapeColourFrame: 1, // hold the delay on a subcarrier cycle (0 = hue spins with it)
  // per-source feeds: each input's own cable and head-end, ahead of the mix —
  // a fault here damages one signal alone, unlike the program-bus channel
  // controls above which damage the mixed output
  aScramble: 0, // sync suppression on A's feed alone
  aScrambleMode: 0, // 0 gated, 1 line-alternate, 2 SSAVI (+ video inversion)
  aTermination: 0, // A's cable termination (<0 double-terminated, >0 open)
  aNoiseIre: 0, // snow on A's feed alone, IRE rms
  aPolarity: 0, // hard polarity flip on A's connector, sync included
  aHumIre: 0, // ground loop on A's cable alone, IRE (sign = which mains leg)
  aConnector: 0, // A's plug intermittent: bands of bad contact, re-rolled per frame
  aConnectorMode: 0, // which of A's contacts: 0 centre pin, 1 shell, 2 both
  aPause: 0, // A deck's pause button: held frame, defeated servo, mistrack stripe
  aDropoutRate: 0, // dropout events per frame on A's own tape
  aDropoutLenUs: 5, // mean dropout length on A's feed
  bScramble: 0, // sync suppression on B's feed alone
  bScrambleMode: 0,
  bTermination: 0, // B's cable termination fault
  bNoiseIre: 0, // snow on B's feed alone, IRE rms
  bPolarity: 0, // hard polarity flip on B's connector, sync included
  bHumIre: 0, // ground loop on B's cable alone, IRE (sign = which mains leg)
  bConnector: 0, // B's plug intermittent: bands of bad contact, re-rolled per frame
  bConnectorMode: 0, // which of B's contacts: 0 centre pin, 1 shell, 2 both
  bDropoutRate: 0, // dropout events per frame on B's own tape
  bDropoutLenUs: 5, // mean dropout length on B's feed
  // dirty mixer (source B, non-genlocked)
  aGain: 1, // A level on the summing bus, signed (negative inverts A)
  bGain: 0, // defaults are the clean baseline; the landing look adds B on top
  bRing: 0,
  bLineHz: 0.15,
  bDetuneHz: 40,
  bRollLps: 0.1,
  bHueDeg: 0,
  bVidGain: 1,
  bInv: 0,
  bPause: 0, // B deck's pause button: held frame, defeated servo, mistrack stripe
  bGenlock: 0, // 0 dirty sum .. 1 clean genlocked crossfade (dissolve/wipe)
  wipeMode: 0,
  wipePos: 0.5,
  wipeSoft: 0.05,
  wipeRate: 0,
  // picture-in-picture inset (source B), active-picture UV
  pipMix: 0,
  pipX: 0.72,
  pipY: 0.28,
  pipW: 0.36,
  pipH: 0.36,
  pipBorder: 0.006,
  pipSoft: 0.004,
  pipKey: 0,
  pipKeyLevel: 0.2,
  pipKeySoft: 0.08,
  // VHS tracking error
  trackAmt: 0,
  trackPos: 0.85,
  shuttleX: 1, // transport speed as multiple of play: 0 pause, <0 review, 1 clean
  // display
  scanBeam: 0.3,
  scanBloom: 0, // beam-spot growth with beam current: bright lines fatten
  phosphor: 0, // persistence: green retention per frame; red/blue decay faster
  phosphorMode: 0, // 0 sRGB, 1 P22/SMPTE-C, 2 NTSC-1953, 3 long-persistence green
  phosphorSkew: 0.7, // R/B decay exponent skew vs green (0.7 = 1.7/1.0/2.4)
  phosphorDecayMix: 0, // 0 peak-hold trails (strobe), 1 additive light
  phosphorBleed: 0.15, // light scattering sideways in the layer: trails soften as they age
  crtSharp: 0,
  maskAmt: 0,
  maskPitch: 3,
  crtZoom: 1, // magnifier on the glass: 1 = whole screen
  crtZoomX: 0.5,
  crtZoomY: 0.5,
  scope: 0, // vectorscope overlay opacity (0 = off, and the pass does no work)
  // time
  timeScale: 1, // sim steps per display frame: everything slows together, 0 freezes
}

export type Controls = typeof DEFAULT_CONTROLS
export type ControlKey = keyof Controls

// Every control key, for the code that has to walk the whole record (uniform
// packing, the URL mirror, MIDI takeover, preset comparison). Lives here beside
// the schema so those callers share one list instead of each re-deriving it —
// `Object.keys` widens to string, so this is the one place that narrows it.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above
export const CONTROL_KEYS = Object.keys(DEFAULT_CONTROLS) as ControlKey[]

// What a bare load lands on, layered over the defaults: a whisper of source B
// summed into the composite, so the mixer is visibly doing something on
// arrival. Deliberately *not* folded into DEFAULT_CONTROLS — `clean` and
// hold-to-compare both mean stock, and neither should carry it.
//
// It lives beside the schema rather than in urlParams (which is what applies
// it) because the panel has to know it too: see atRest below.
export const LANDING_LOOK: Partial<Controls> = { bGain: 0.16 }

// Whether a control is sitting where nobody put it — on stock, or on the
// landing look's value for it.
//
// Two resting values rather than one, because the app has two states it can
// arrive in without anyone having touched anything, and the panel's "you have
// changed something" signals are all derived by comparison: the "This look"
// section, a stage's `• N` on the chain map, a group's amber dot. Against
// DEFAULT_CONTROLS alone, every bare load opened with the mixer stage lit amber
// and a one-row "This look" listing a B gain the visitor had never seen, under
// a caption inviting them to pick a preset and start.
//
// The seam this leaves is deliberate: a *row's* ↺ still means "off stock" and
// still puts the control back to DEFAULT_CONTROLS, because that is the question
// a single row is answering — where is this knob against the clean signal. This
// is the other question, the one the summaries ask: has anything been done
// here. Only the summaries use it.
export const atRest = (value: number, key: ControlKey) =>
  value === DEFAULT_CONTROLS[key] || value === LANDING_LOOK[key]

export interface FrameStats {
  fps: number
}

// A modulation routing: `source`/`rateHz` drive an oscillator in ModState;
// depth is a fraction of the target control's slider span [min, max]. Supplied
// by the UI (which owns the slider ranges) via setModSlots.
export interface ModSlot extends ModWave {
  target: ControlKey
  depth: number
  min: number
  max: number
}
