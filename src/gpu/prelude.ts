// Shared WGSL prelude prepended to every shader, and the matching uniform
// packer. PARAM_DEFS is the single source of truth for the Params struct:
// field order here IS the GPU memory layout.

import {
  ACTIVE_HEIGHT,
  ACTIVE_START,
  ACTIVE_TOP,
  ACTIVE_WIDTH,
  BAR_FULL_SCALE,
  BAR_TARGETS,
  BURST_AMP_IRE,
  BURST_LEN,
  BURST_START,
  HEAD_SWITCH_LINE,
  IRE_BLACK,
  IRE_BLANK,
  IRE_SYNC,
  IRE_VIDEO_RANGE,
  LINES,
  SAMPLES_PER_LINE,
  SYNC_LEN,
  TAPE_FRAMES,
  VSYNC_FIRST,
  VSYNC_LAST,
} from '../signal/constants'
import {
  FILTER_STRIDE,
  SEC_CHROMA_BP,
  SEC_DEMOD,
  SEC_ENC_CHROMA,
  SEC_LUMA,
  SEC_UNDER,
  TAPS,
} from '../signal/filters'
import { DOWN_PER_SAMPLE } from '../signal/linestate'

export const PARAM_DEFS = [
  ['frame', 'u32'],
  ['gen', 'u32'], // dub generation index: decorrelates noise/dropout seeds per pass
  ['canvasW', 'f32'],
  ['canvasH', 'f32'],
  ['srcAspect', 'f32'],
  ['srcNoise', 'f32'], // GPU-generated source A: 0 texture, 1 TV static, 2 VHS blank-tape static
  ['srcFrameA', 'u32'], // frame counter A's snow generator crawls on; held while A's deck is paused
  ['invert', 'f32'], // source A polarity flip: negate composite (0.5 = solarized)
  ['deint', 'f32'], // bob-deinterlace source A: rebuild from one field, killing capture combing
  // dirty mixer: source B is a second, non-genlocked composite signal
  ['srcNoiseB', 'f32'], // GPU-generated source B: 0 texture, 1 TV static, 2 VHS blank-tape static
  ['aGain', 'f32'], // A level on the summing bus, signed (negative inverts A)
  ['bGain', 'f32'], // additive mix gain
  ['bRing', 'f32'], // ring modulation amount
  ['bRowOff', 'f32'], // vertical slip, lines (accumulated)
  ['bShift0', 'f32'], // horizontal slip, samples (accumulated)
  ['bShiftLine', 'f32'], // horizontal skew per line (line-frequency offset)
  ['bPhase0', 'f32'], // subcarrier detune phase base (accumulated)
  ['bPhaseLine', 'f32'], // subcarrier detune phase per line
  ['bHue', 'f32'], // B proc-amp hue trim, radians
  ['bVidGain', 'f32'], // B proc-amp video gain
  ['bInv', 'f32'], // B video inversion amount (0.5 = solarized midpoint)
  ['bPause', 'f32'], // B deck's pause button: 0 play, >0 held frame with servo damage
  ['bPauseBar', 'f32'], // head-mistrack stripe centre, source rows (walks on its own)
  ['bGenlock', 'f32'], // 0 dirty sum, 1 clean genlocked crossfade (dissolve/wipe)
  ['wipeMode', 'f32'], // 0 off, 1 h, 2 v, 3 box, 4 diamond
  ['wipePos', 'f32'], // wipe position incl. auto-sweep (accumulated)
  ['wipeSoft', 'f32'], // wipe edge softness
  // picture-in-picture: source B squeezed into a positionable window, re-encoded
  // genlocked to the house raster (a DVE/switcher inset — dot-crawls, no beat)
  ['pipMix', 'f32'], // inset key over program, 0 off
  ['pipX', 'f32'], // window center X, active-picture UV
  ['pipY', 'f32'], // window center Y, active-picture UV
  ['pipW', 'f32'], // window width, active-picture UV
  ['pipH', 'f32'], // window height, active-picture UV
  ['pipBorder', 'f32'], // matte border thickness, active-picture UV
  ['pipSoft', 'f32'], // window edge softness, active-picture UV
  ['pipKey', 'f32'], // inset luma key amount, negative inverts polarity
  ['pipKeyLevel', 'f32'], // inset luma key slice, 0..1
  ['pipKeySoft', 'f32'], // inset luma key edge softness, luma units
  // VHS tracking error: a mistracked head produces a noise band that tears and
  // bends the picture at an adjustable height (the "tracking" knob).
  ['trackAmt', 'f32'], // severity, 0 locked
  ['trackPos', 'f32'], // band vertical position, 0..1
  // VHS picture search: off play speed each head sweep crosses several
  // recorded tracks; the RF envelope nulls at every crossing.
  ['shuttleBars', 'f32'], // track crossings per field, signed (shuttle speed - 1)
  ['shuttlePhase', 'f32'], // crossing pattern phase, in crossings
  // decoder
  ['combMode', 'f32'], // 0 chroma trap, 1 two-line comb, 2 three-line comb
  ['hHold', 'f32'], // sync PLL gain (horizontal hold)
  ['vHold', 'f32'], // vertical oscillator pull-in gain (vertical hold lock strength)
  ['vRollRate', 'f32'], // free-run roll velocity, lines/frame, from the v-osc detune
  ['syncBend', 'f32'], // PLL kick at the vertical seam, samples (flagging)
  // deflection geometry: tube-side scan distortion, downstream of the decoder,
  // so it bends the picture without moving the burst gate or spinning hue
  ['bendAmt', 'f32'], // horizontal displacement amplitude, samples
  ['bendShape', 'f32'], // 0 flag, 1 skew, 2 bow, 3 sine
  ['bendPeriod', 'f32'], // flag decay constant / sine period, screen lines
  ['vSize', 'f32'], // vertical deflection amplitude: <1 underscans, raster and retrace come into view
  ['hvSag', 'f32'], // beam-current deflection sag amplitude, samples
  ['hvRing', 'f32'], // supply damping: 0 smooth droop .. 1 ringing / chaotic
  ['hRate', 'f32'], // horizontal oscillator free-run drift, samples/line
  // audio patched into the receiver, one sample per line
  ['audioBend', 'f32'], // direct horizontal displacement, samples
  ['audioLoad', 'f32'], // audio driven into the HV tank alongside beam current
  ['audioIre', 'f32'], // audio patched straight into the composite line, IRE per unit
  ['audioHue', 'f32'], // audio driven into the demod reference phase, radians per unit
  ['chromaGain', 'f32'],
  ['burstLock', 'f32'], // 0..1: how much the decoder trusts the (degraded) burst
  ['tint', 'f32'], // the set's tint control: demod reference rotated, radians (PI = complementary)
  ['demodAxis', 'f32'], // angle between the two synchronous demod axes, radians (PI/2 = quadrature)
  ['matrixClip', 'f32'], // RGB output stage: 0 hue-preserving fit .. 1 hard per-gun rails
  ['scDetunePhase', 'f32'], // bent-crystal demod LO phase error at frame start, radians (accumulated)
  ['scDetunePerSample', 'f32'], // LO phase error growth per sample, radians
  ['killThresh', 'f32'], // IRE of burst amplitude below which color killer engages
  ['accLines', 'f32'], // chroma AGC time constant, lines of burst memory (0 = instantaneous)
  ['svideoBleed', 'f32'], // Y/C cross-wire: chroma bled into luma (0.5 defeats the trap)
  ['chromaCoarse', 'f32'], // chroma demod decimation factor; >1 lerps between lattice points (CUE rainbows)
  // channel / tape
  ['soundIre', 'f32'], // 4.5 MHz sound carrier leaking past the trap, IRE
  // RF front end: what the tuner hands the detector besides our own channel
  ['rfSoften', 'f32'], // mistuned low: the Nyquist-slope high cut on the luma path, 0..1
  ['rfIntermod', 'f32'], // detector intermod depth: the loose sound carrier multiplied against the video
  ['rfAdjIre', 'f32'], // adjacent-channel leak: beat amplitude at the neighbour's peak carrier, IRE
  ['rfAdjEps', 'f32'], // the neighbour's line rate vs ours, fractional offset (CPU-wandered)
  ['rfAdjTau', 'f32'], // the neighbour raster's time offset at frame start, samples (accumulated)
  ['rfAdjPhase', 'f32'], // their vision-carrier beat phase at frame start, radians (accumulated)
  ['rfAdjPhaseS', 'f32'], // their sound-carrier beat phase, radians (their audio FM rides here)
  ['rfSnow', 'f32'], // weak signal: IF noise into the envelope detector (Rician, whites first)
  ['ingressIre', 'f32'], // shield ingress: the radio's carrier amplitude, IRE
  ['ingressKey', 'f32'], // whether the mic is keyed right now, 0..1 (CPU-walked stretches)
  ['ingressCps', 'f32'], // its visible beat frequency, cycles/sample (wanders)
  ['ingressRowCyc', 'f32'], // fract(cps * SPL): the beat's per-line phase step
  ['ingressPhase', 'f32'], // beat phase at frame start, radians (accumulated)
  ['agc', 'f32'], // receiver AGC action, 0 fixed gain .. 1 full
  ['abl', 'f32'], // beam limiter: 0 generous flyback .. 1 undersized and underdamped (hunts)
  ['noiseSigma', 'f32'], // additive noise, IRE rms
  ['impulseRate', 'f32'], // impulse (ignition/arc) noise events per frame, storm-clustered CPU-side
  ['impulseIre', 'f32'], // impulse peak amplitude, IRE
  ['impulseTrainPos', 'f32'], // ignition train: sample offset of the frame's first event
  ['impulseTrainStep', 'f32'], // ignition train: samples between events (0 = no train)
  ['impulseMains', 'f32'], // random hits bunched at the dimmer's mains firing phase
  ['strikeRate', 'f32'], // millisecond multi-line strikes per second
  ['ghostDelay', 'f32'], // samples
  ['ghostGain', 'f32'],
  ['humAmp', 'f32'], // IRE
  ['humMod', 'f32'], // supply-ripple gain modulation depth (multiplies, sync included)
  ['colorUnderMix', 'f32'], // 0 direct chroma .. 1 full VHS color-under path
  ['chromaNoise', 'f32'], // noise injected into the color-under signal, IRE rms
  ['dropoutRate', 'f32'], // expected dropout events per frame
  ['dropoutLen', 'f32'], // mean dropout length, samples
  ['dropoutComp', 'f32'], // dropout compensator delay: 0 none, 1 one line, 2 two
  ['headSwitchNoise', 'f32'], // 0..1
  ['polarityFlip', 'f32'], // hard signal/ground swap: negate whole composite incl. sync
  ['termination', 'f32'], // cable termination fault: <0 double-terminated (dim), >0 open (hot + ringing)
  ['chromaPinOnly', 'f32'], // only the chroma pin fed to composite: color, no luma, no sync
  ['connectorGlitch', 'f32'], // loose connector: intermittent contact drops bands to snow
  ['scramble', 'f32'], // head-end sync suppression depth: sync tip lifted toward blanking
  ['scrambleMode', 'f32'], // 0 gated, 1 line-alternate, 2 SSAVI (suppression + video inversion)
  // copy protection authored onto the source tape's vertical interval
  ['mvAgcIre', 'f32'], // Macrovision AGC-pulse level at full cycle, IRE (0 = unprotected)
  ['mvStripe', 'f32'], // colorstripe burst rotation on walking line bands, radians
  ['vbi', 'f32'], // VBI test signals: VITS on 17-18, VIR on 19, line-21 captions (1 = broadcast furniture on)
  // bent video enhancer, inline between the deck and the set
  ['enhClampOff', 'f32'], // clamp gate displaced off the back porch, samples
  ['enhDroop', 'f32'], // coupling-capacitor leak per sample (0 = DC coupled)
  ['enhPeakFc', 'f32'], // detail resonator center, cycles/sample (0 = off)
  ['enhPeakR', 'f32'], // resonator pole radius: ring length, and past 1 it howls
  ['enhPeakBoost', 'f32'], // resonator output mixed back into the video, IRE per IRE
  ['enhSync', 'f32'], // sync regenerator mix, 0 bypassed
  ['enhSlice', 'f32'], // regenerator slice level, IRE
  // feedback (camera-at-monitor)
  ['fbMix', 'f32'],
  ['fbZoom', 'f32'],
  ['fbRotate', 'f32'], // radians
  ['fbShiftX', 'f32'],
  ['fbShiftY', 'f32'],
  ['fbGain', 'f32'],
  ['fbFocus', 'f32'], // camera lens defocus radius, output pixels
  ['fbVign', 'f32'], // lens vignette strength
  ['fbBlack', 'f32'], // sensor black cut level (trails die into black)
  ['fbKnee', 'f32'], // sensor s-curve amount (bloom + highlight compression)
  ['fbIris', 'f32'], // camera auto-iris: 0 manual exposure .. 1 underdamped servo (hunts)
  // CRT faceplate: the emissive screen the camera photographs (and the display
  // shows). Sits between the decoded signal and the camera/lens model above.
  ['crtCutoff', 'f32'], // beam cutoff: drive below the knee emits no light (true black background)
  ['crtGamma', 'f32'], // gun luminance response, luminance ~ drive^gamma (expands highlights, deepens shadows)
  ['crtSat', 'f32'], // saturation around luma, applied after the beam transfer
  ['crtSpot', 'f32'], // beam-spot radius on the glass, active pixels: spreads all light, not just highlights
  ['crtGrain', 'f32'], // granular phosphor deposit: static mottling of emitted light
  ['crtBloom', 'f32'], // highlight bloom spread from bright phosphor cores
  ['crtHalation', 'f32'], // wide warm glass-scatter halo around highlights
  ['crtGlow', 'f32'], // phosphor black-level glow / faceplate haze
  // mixer loop: previous frame's composite fed back electrically
  ['cfbMix', 'f32'], // crossfader position toward the loop bus
  ['cfbGain', 'f32'], // loop proc-amp trim, negative inverts
  ['cfbDelay', 'f32'], // loop delay, samples (1 sample = 90 deg hue spin)
  ['cfbLines', 'f32'], // vertical offset per generation, lines
  ['cfbKey', 'f32'], // luma key amount, negative inverts polarity
  ['cfbKeyLevel', 'f32'], // key slice level, IRE
  ['cfbKeySoft', 'f32'], // key edge softness, IRE
  ['cfbTrail', 'f32'], // frame-store peak-hold decay (trails), 0 = plain capture
  ['cfbFilterFc', 'f32'], // loop resonance center, cycles/sample (0 = flat loop)
  ['cfbFilterQ', 'f32'], // loop resonance selectivity, 0 broad .. 1 narrow/ringing
  ['cfbFilterBoost', 'f32'], // added in-band loop gain (self-oscillates past unity round trip)
  ['cfbServo', 'f32'], // varactor on the loop delay: samples of pull per 100 IRE of its own video
  ['cfbRing', 'f32'], // loop bus ring-modulated against the live program
  // tape loop: a loop of tape threaded record head -> play head, seconds long
  ['tapeMix', 'f32'], // crossfader position toward the play head, 0 = loop out of circuit
  ['tapeGain', 'f32'], // playback proc-amp trim, negative inverts
  ['tapeHfLoss', 'f32'], // head/tape band loss per pass (takes chroma first)
  ['tapeNoise', 'f32'], // medium noise, IRE rms — fixed to the tape, not the frame
  ['tapeWear', 'f32'], // fraction of the loop's lines with the oxide worn off
  ['tapeSplice', 'f32'], // severity of the joint crossing a head, 0 = no splice
  ['tapeHeads', 'f32'], // playback heads in the path: one lap returns once per head
  ['tapeHeadSpread', 'f32'], // head layout along the path: 1 = even subdivisions
  ['tapeColourFrame', 'f32'], // 1 = hold every head on a whole subcarrier cycle
  ['tapeSpliceFrames', 'u32'], // how far the splice has run from the record head...
  ['tapeSpliceRem', 'f32'], // ...in whole frames plus this remainder
  ['tapeSlot', 'u32'], // ring frame the record head is laying down
  ['tapeScrub', 'f32'], // 1 = drum stalled: read in tape order, so backwards reverses the waveform
  ['tapeShuttleBars', 'f32'], // loop track crossings per sweep (speed - 1): the pause/cue bars
  ['tapeShuttlePhase', 'f32'], // crossing pattern phase, in crossings
  ['tapeHoldSlot', 'u32'], // ring frame the loop window sits on (= tapeSlot while recording)
  ['tapeHoldFrames', 'u32'], // how far the heads have walked round a held loop...
  ['tapeHoldRem', 'f32'], // ...in whole frames plus this remainder (0 while recording)
  ['tapeDelayFrames', 'u32'], // the far head trails the record head by this many whole frames...
  ['tapeDelaySamples', 'f32'], // ...plus this remainder (the total overruns f32's integers)
  // display
  ['scanBeam', 'f32'], // finite beam-spot strength between scanlines
  ['scanBloom', 'f32'], // beam-spot growth with beam current: bright lines fatten, gaps close in whites
  ['phosphor', 'f32'], // P22 persistence: green-channel frame-to-frame retention (R/B decay faster)
  ['phosphorMode', 'f32'], // tube colour identity: 0 sRGB, 1 P22/SMPTE-C, 2 NTSC-1953, 3 long-persistence green
  ['phosphorSkew', 'f32'], // R/B persistence decay exponent skew relative to G (trails die toward green)
  ['phosphorDecayMix', 'f32'], // persistence combine: 0 peak-hold (strobe) .. 1 additive light
  ['phosphorBleed', 'f32'], // fraction of held light that scatters to the four neighbours per frame
  ['crtSharp', 'f32'], // horizontal Catmull-Rom reconstruction blend (0 bilinear)
  ['maskAmt', 'f32'], // aperture grille strength
  ['maskPitch', 'f32'], // grille triad pitch, canvas pixels
  ['crtZoom', 'f32'], // magnification of the glass (1 = whole screen)
  ['crtZoomX', 'f32'], // point on the glass held under the magnifier, 0..1
  ['crtZoomY', 'f32'],
  ['scope', 'f32'], // vectorscope overlay opacity, 0 = the pass does no work
  ['dbgView', 'f32'], // 0 normal, 1 gradient (present test), 2 raw composite (encode test)
] as const

// Workgroup width of the tiled-FIR passes; pipeline.ts sizes their dispatches
// from the same number so the WGSL and the dispatch cannot drift apart.
export const TILE_WG = 64

// Vectorscope grid. `decode` bins its own demodulator output into this and
// `present` draws it, so the two have to agree on the resolution and on what
// the edge of the display means — which is why it lives in the prelude both
// of them already share.
export const SCOPE_N = 128
export const SCOPE_BYTES = SCOPE_N * SCOPE_N * 4

export const PARAM_BYTES = Math.ceil((PARAM_DEFS.length * 4) / 16) * 16
export const GEN_OFFSET = PARAM_DEFS.findIndex(([n]) => n === 'gen') * 4

// Union of every uniform name. Requiring a full record below makes a param
// added to PARAM_DEFS but never supplied a compile error instead of a runtime
// `missing param` throw.
export type ParamName = (typeof PARAM_DEFS)[number][0]

export function packParams(
  values: Record<ParamName, number>,
  out: ArrayBuffer,
): void {
  const dv = new DataView(out)
  PARAM_DEFS.forEach(([name, type], i) => {
    const v = values[name]
    if (type === 'u32') dv.setUint32(i * 4, v >>> 0, true)
    else dv.setFloat32(i * 4, v, true)
  })
}

const paramStruct = `struct Params {\n${PARAM_DEFS.map(([n, t]) => `  ${n}: ${t},`).join('\n')}\n}\n`

export const PRELUDE = /* wgsl */ `
const SPL = ${SAMPLES_PER_LINE}u;
const NLINES = ${LINES}u;
const BUF_LEN = ${SAMPLES_PER_LINE * LINES}u;
const SYNC_LEN = ${SYNC_LEN}u;
const BURST_START = ${BURST_START}u;
const BURST_LEN = ${BURST_LEN}u;
const ACTIVE_START = ${ACTIVE_START}u;
const ACTIVE_W = ${ACTIVE_WIDTH}u;
const ACTIVE_TOP = ${ACTIVE_TOP}u;
const ACTIVE_H = ${ACTIVE_HEIGHT}u;
// Persistent servo state in the timing buffer, past the three sync scalars.
// The two gain servos each carry (gain, velocity): they are second-order loops
// on purpose, so an under-damped setting genuinely overshoots and hunts.
const ABL_GAIN = ${LINES + 3}u;
const ABL_VEL = ${LINES + 4}u;
const IRIS_GAIN = ${LINES + 5}u;
const IRIS_VEL = ${LINES + 6}u;
// Lines since the sync separator last found a real edge. The free-running
// H-osc's phase noise grows with it, so lock decays instead of coasting.
const LOCK_AGE = ${LINES + 7}u;
const SAG_BASE = ${LINES + 8}u; // deflection sag region of the timing buffer
const VSYNC_FIRST = ${VSYNC_FIRST}u;
const VSYNC_LAST = ${VSYNC_LAST}u;
const HEAD_SWITCH_LINE = ${HEAD_SWITCH_LINE}u;
const TAPE_LEN = ${TAPE_FRAMES * SAMPLES_PER_LINE * LINES}u; // loop bin capacity, samples
const IRE_SYNC = ${IRE_SYNC}.0;
const IRE_BLANK = ${IRE_BLANK}.0;
const IRE_BLACK = ${IRE_BLACK};
const VIDEO_RANGE = ${IRE_VIDEO_RANGE};
const BURST_AMP = ${BURST_AMP_IRE}.0;
const FILTER_STRIDE = ${FILTER_STRIDE}u;
const SEC_ENC_CHROMA = ${SEC_ENC_CHROMA}u;
const SEC_DEMOD = ${SEC_DEMOD}u;
const SEC_LUMA = ${SEC_LUMA}u;
const SEC_CHROMA_BP = ${SEC_CHROMA_BP}u;
const SEC_UNDER = ${SEC_UNDER}u;
const ENC_CHROMA_TAPS = ${TAPS.encChroma}u;
const DEMOD_TAPS = ${TAPS.demod}u;
const LUMA_TAPS = ${TAPS.luma}u;
const CHROMA_BP_TAPS = ${TAPS.chromaBp}u;
const UNDER_TAPS = ${TAPS.under}u;
const DOWN_PER_SAMPLE = ${DOWN_PER_SAMPLE}; // (fsc - f_under) / sample_rate
const PI = 3.14159265359;
// FIR tiling: each TILE_WG-thread workgroup stages its input span plus a
// 32-sample halo per side in shared memory, so symmetric kernels up to
// 65 taps read storage once per sample instead of once per tap. The width
// trades halo overhead against scheduling granularity: staging costs
// (TILE_WG + 64) / TILE_WG loads per output, so wider workgroups re-stage
// less — but measured on the dev GPU it doesn't pay: 64 and 128 are within
// noise and 256 is ~8% slower, so the halo traffic is not the bottleneck.
const TILE_WG = ${TILE_WG}u;
const TILE = ${TILE_WG + 64}u;
const HALO = 32u;

// Vectorscope, shared by the pass that fills it and the one that draws it.
// Full scale is where an undamaged 100% bar lands, so the outer circle means
// "out of range" rather than being a decorative edge. The lattice step is why
// a flat area of colour does not serialize a hundred thousand atomic adds onto
// one bin — a trace only needs enough hits to read.
const SCOPE_N = ${SCOPE_N}u;
const SCOPE_STEP = 2u;
const SCOPE_FS = ${BAR_FULL_SCALE};

// Graticule targets, generated from BAR_TARGETS in signal/constants.ts so the
// boxes cannot drift from the matrix they describe. See the derivation there.
const BAR_UV = array<vec2f, 6>(
${BAR_TARGETS.map(([u, v]) => `  vec2f(${u}, ${v}),`).join('\n')}
);

${paramStruct}

// Subcarrier (sin, cos) at global sample index n. Sampling at exactly 4x fsc
// puts every sample on a 4-phase lattice, so the carrier is exact — no trig,
// no phase accumulation error. 910 samples/line = 227.5 cycles gives the
// 180-degree line alternation, 525 lines gives the frame alternation, both
// automatically via n mod 4.
fn carrier(n: u32, frame: u32) -> vec2f {
  let j = (n + 2u * (frame & 1u)) & 3u;
  let odd = j & 1u;
  // the lattice is (0,1) (1,0) (0,-1) (-1,0): bit 0 picks the axis, bit 1 the
  // sign. Same four values the table held, without a dynamically indexed
  // local array. (Quadrants 2 and 3 produce a -0.0 where the table had +0.0;
  // these are only ever multiplied and summed, where the two are identical.)
  let sign = 1.0 - f32(j & 2u);
  return vec2f(f32(odd) * sign, f32(1u - odd) * sign);
}

// The exact-lattice carrier rotated by a slow phase error (a detuned source's
// subcarrier slip, or a proc-amp hue trim). delta = 0 is the house carrier.
fn carrierRot(n: u32, frame: u32, delta: f32) -> vec2f {
  let sc = carrier(n, frame);
  let cd = cos(delta);
  let sd = sin(delta);
  return vec2f(sc.x * cd + sc.y * sd, sc.y * cd - sc.x * sd);
}

// One NTSC line's blanking-interval structure — equalizing pulses, serrated
// vsync, sync tip, breezeway/back porch, and 9-cycle colorburst — shared by
// every composite generator so the raster timing lives in exactly one place.
// (Editing the raster, e.g. the progressive->interlaced fix, then touches only
// this.) delta rotates the burst carrier for a detuned source; picture true
// means the sample is active video, which the caller fills in with luma + chroma.
struct LineSlot {
  value: f32,
  picture: bool,
}

fn ntscLineSlot(row: u32, s: u32, n: u32, frame: u32, delta: f32) -> LineSlot {
  var slot = LineSlot(IRE_BLANK, false);
  if (row < VSYNC_FIRST || (row > VSYNC_LAST && row < 12u)) {
    // equalizing pulses: narrow half-line-rate pulses flanking vsync
    slot.value = select(IRE_BLANK, IRE_SYNC, (s % 455u) < 33u);
  } else if (row >= VSYNC_FIRST && row <= VSYNC_LAST) {
    // serrated broad pulses: mostly sync level, rising near each half-line end
    let serration = (s >= 430u && s < 498u) || s >= 880u;
    slot.value = select(IRE_SYNC, IRE_BLANK, serration);
  } else if (s < SYNC_LEN) {
    slot.value = IRE_SYNC;
  } else if (s >= BURST_START && s < BURST_START + BURST_LEN && row > VSYNC_LAST + 1u) {
    // burst at 180 degrees on the U axis: -A*sin
    slot.value = -BURST_AMP * carrierRot(n, frame, delta).x;
  } else if (s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W && row >= ACTIVE_TOP && row < ACTIVE_TOP + ACTIVE_H) {
    slot.picture = true;
  }
  return slot;
}

// Active-picture composite sample: black pedestal plus quadrature chroma on the
// subcarrier, with proc-amp video gain and continuous inversion (0.5 = solarized
// midpoint, 1 = full invert; reflects active video around the black+white mid so
// sync and burst are untouched). The chroma is pre-filtered by the caller,
// whose FIR read differs (workgroup tile vs storage).
fn activeComposite(y: f32, uf: f32, vf: f32, sc: vec2f, vidGain: f32, inv: f32) -> f32 {
  let v = IRE_BLACK + VIDEO_RANGE * (y + uf * sc.x + vf * sc.y) * vidGain;
  return mix(v, 2.0 * IRE_BLACK + VIDEO_RANGE - v, inv);
}

fn clampIdx(i: i32) -> u32 {
  return u32(clamp(i, 0, i32(BUF_LEN) - 1));
}

// Raster row wrap that survives negative offsets: vertical roll runs both ways
// (the v-osc detunes either side of 60 Hz) and u32() of a negative float is
// undefined in WGSL.
fn wrapRow(r: i32) -> u32 {
  return u32(((r % i32(NLINES)) + i32(NLINES)) % i32(NLINES));
}

fn pcg(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn rand01(v: u32) -> f32 {
  return f32(pcg(v)) / 4294967295.0;
}

fn gauss(seed: u32) -> f32 {
  let a = max(rand01(seed), 1e-7);
  let b = rand01(seed ^ 0x9E3779B9u);
  return sqrt(-2.0 * log(a)) * cos(2.0 * PI * b);
}

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

// Gamut limit by desaturation. A hard per-channel clamp on an out-of-gamut
// colour only clips the overflowing channel, which rotates hue toward the
// remaining primaries — saturated content goes duller and wrong at the clipping
// point. This instead pulls the colour toward its own (clamped) luma along the
// chroma axis just far enough to re-enter the cube, so hue is preserved and a
// real tube's saturated highlights stay electric. In-gamut colours are returned
// unchanged.
//
// slack is how much of that pullback the limiter declines to apply — a ratio on
// one operation, not a crossfade between two different mappings. At 0 the
// colour is brought fully inside; at 1 nothing is pulled back and the three
// guns simply run into their rails one at a time, which is what a set with no
// limiter ahead of them does, and is why an overdriven picture on one migrates
// toward the primaries instead of holding its hue.
fn gamutLimit(c: vec3f, slack: f32) -> vec3f {
  let y = luma(c);
  let l = clamp(y, 0.0, 1.0);
  let d = c - vec3f(y);
  let moves = abs(d) > vec3f(1e-5);
  // how much of d each channel has left before it hits 0 or 1; a channel that
  // barely moves along the chroma axis constrains nothing
  let room = select(vec3f(l), vec3f(1.0 - l), d > vec3f(0.0));
  let reach = select(vec3f(1.0), room / max(abs(d), vec3f(1e-5)), moves);
  let s = clamp(min(reach.x, min(reach.y, reach.z)), 0.0, 1.0);
  return clamp(vec3f(l) + mix(s, 1.0, slack) * d, vec3f(0.0), vec3f(1.0));
}

fn gamutFit(c: vec3f) -> vec3f {
  return gamutLimit(c, 0.0);
}

// Catmull-Rom fractional-delay read. Linear interpolation is -6 dB at fsc for
// half-sample offsets, so chroma pumps as a delay wanders; the cubic stays
// flat past fsc. t = 0 returns p1 exactly.
fn catmull(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}

// Same curve on a colour, for the display-side horizontal reconstruction.
fn catmull3(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}

// The GPU-generated no-signal sources, shared by A (compose) and B (compose_b)
// so the two cannot drift apart. Regenerated every frame, so they crawl.
// Below 1.5 is broadcast snow: fine, full-contrast luminance noise whose
// high-frequency energy blooms into rainbow speckle through the encoder. Above
// it is blank VHS tape: grayer, bluish, smeared along the head's scan with a
// slow per-line brightness drift.
fn snowSource(mode: f32, xy: vec2u, frame: u32) -> vec3f {
  var out: vec3f;
  if (mode < 1.5) {
    out = vec3f(rand01(pcg(xy.x + xy.y * ACTIVE_W + frame * 2654435761u)));
  } else {
    let line = rand01(pcg(xy.y * 2246822519u + frame * 40503u));
    let fine = rand01(pcg((xy.x / 4u) + xy.y * ACTIVE_W + frame * 2654435761u));
    let v = 0.32 + 0.30 * fine + 0.14 * line;
    out = vec3f(v * 0.8, v * 0.9, v);
  }
  return out;
}
`
