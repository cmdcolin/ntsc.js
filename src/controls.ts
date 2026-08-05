// The user-facing control schema: every knob, in physical units. This is the
// shared vocabulary between the UI (sliders, presets, MIDI) and the Engine
// (which converts it to GPU uniforms). It deliberately depends on neither, so
// importing a control's type doesn't drag in the GPUDevice.

import type { ModWave } from './signal/modstate'

// All user-facing controls, in physical units.
export const DEFAULT_CONTROLS = {
  // source conditioning
  deint: 0, // bob-deinterlace source A (0 off, 1 on) — kills capture-card field combing
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
  hvSagUs: 0, // beam-current deflection sag: bright content bends the scan
  hvRing: 0.5, // supply damping: 0 smooth droop .. 1 ringing / chaotic
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
  // analog premium-channel scrambling, applied at the head-end
  scramble: 0, // sync-tip suppression depth (0 = in the clear)
  scrambleMode: 0, // 0 gated (every line), 1 line-alternate, 2 SSAVI (+ video inversion)
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
  soundIre: 0,
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
  tbJitterNs: 0,
  tbWowNs: 0,
  dubGens: 1, // tape dub generations: the channel block runs this many times
  // feedback
  fbMix: 0,
  fbZoom: 1.05,
  fbRotateDeg: 0,
  fbShiftX: 0,
  fbShiftY: 0,
  fbGain: 1,
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
