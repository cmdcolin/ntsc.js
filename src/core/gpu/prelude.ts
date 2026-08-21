// Shared WGSL prelude prepended to every shader, and the matching uniform
// packer. PARAM_DEFS is the single source of truth for the Params struct:
// field order here IS the GPU memory layout.

import {
  ACTIVE_HEIGHT,
  ACTIVE_START,
  ACTIVE_TOP,
  ACTIVE_WIDTH,
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
  // The statistics of that generated noise, shared by both slots. Noise cannot
  // change faster than the path it arrived through lets it, so the grain is a
  // bandwidth: srcNoiseGrain is the correlation length that bandwidth implies,
  // in active pixels, converted at the packing boundary.
  ['srcNoiseGrain', 'f32'],
  ['srcNoiseLine', 'f32'], // share of the deviate that is one gain error per sweep
  ['srcNoiseLevel', 'f32'], // noise power reaching the detector, 1 = nominal
  ['srcNoiseHold', 'f32'], // display frames per noise field: the source's own refresh
  // Tape time: the frame counter the damage recorded on a deck's own medium
  // crawls on, held while that deck is paused (a held frame re-reads one track,
  // so its snow and its dropouts have to come back identical). The program
  // buffer carries A's; each feed's buffer carries that feed's deck's.
  ['srcFrame', 'u32'],
  ['invert', 'f32'], // source A polarity flip: negate composite (0.5 = solarized)
  ['deint', 'f32'], // bob-deinterlace source A: rebuild from one field, killing capture combing
  // Video synth: a bench oscillator patched into a slot instead of a picture
  // (mode 3 of the same srcNoise selector). Each oscillator's phase is carried
  // as cycles at frame start plus its walk per line and per sample, rather than
  // as one frequency, for two reasons. Precision: phase at the far corner of a
  // frame is 477750 samples of accumulation, and an f32 stops resolving a
  // subcarrier-rate phase long before it gets there. And honesty: the per-line
  // walk IS the lean of the pattern — an oscillator sitting an exact multiple of
  // line rate walks zero per line and draws standing bars, and everything
  // diagonal on screen is that number being something else.
  ['synthPhaseA', 'f32'], // osc A phase at frame start, cycles (accumulated)
  ['synthPerLineA', 'f32'], // osc A phase walk per line, cycles
  ['synthPerSampleA', 'f32'], // osc A phase walk per sample, cycles
  ['synthPhaseB', 'f32'],
  ['synthPerLineB', 'f32'],
  ['synthPerSampleB', 'f32'],
  ['synthShape', 'f32'], // waveform selector: 0 ramp, 1 triangle, 2 sine, 3 pulse
  ['synthMix', 'f32'], // combiner: 0 osc A alone, 1 sum, 2 ring mod, 3 comparator
  ['synthLevel', 'f32'], // output contrast about mid-video
  ['synthColor', 'f32'], // colorizer depth: 0 monochrome .. 1 full three-phase
  ['synthHue', 'f32'], // colorizer rotation, radians
  // The synth as a module over a picture rather than instead of one. Slot A
  // only: compose has the slot's picture in hand, and compose_b writes its
  // texture rather than reading it, so B keeps the source mode alone.
  ['synthOver', 'f32'], // synth crossfaded over the slot's picture
  ['synthFm', 'f32'], // that picture's luma into osc A's frequency, cycles/sample
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
  // Chroma keyer across the mixer: B's backing colour cut away so A shows
  // through it. Slices B's *encoded* chroma, not the RGB behind it — see
  // mix_b.wgsl for what that costs the edge, which is the whole look.
  ['bKey', 'f32'], // key amount, negative inverts which side is cut
  ['bKeyHue', 'f32'], // backing colour's chroma phase, radians (atan2(V, U))
  ['bKeyAccept', 'f32'], // acceptance half-angle about that phase, radians
  ['bKeyClip', 'f32'], // saturation floor the keyer will act on, chroma units
  ['bKeySoft', 'f32'], // comparator swing: edge softness in both angle and saturation
  ['bKeySpill', 'f32'], // chroma canceller: backing subcarrier reinjected antiphase
  ['bKeyDelay', 'f32'], // key-vs-fill horizontal registration, samples
  // The keyer's fill input — what shows through the hole. Genlocked path only,
  // because only a crossfade has a "behind" for a fill to be: the dirty sum has
  // no layers, so there the key gates B's contribution and A is simply always
  // present. 0 program A, 1 matte generator, 2 the mixer loop bus.
  ['bKeyFill', 'f32'],
  ['bKeyMatteY', 'f32'], // matte luma, 0..1
  ['bKeyMatteHue', 'f32'], // matte chroma phase, radians
  ['bKeyMatteSat', 'f32'], // matte chroma amplitude, chroma units
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
  // The floor's spectrum, as the two output weights of a lowpass and a highpass
  // arm sharing the same deviates: an IF-limited RF floor is flat to the top of
  // the video band, an FM discriminator's is triangular. Normalized CPU-side so
  // the tilt changes the noise's colour without changing its level.
  ['noiseLoW', 'f32'],
  ['noiseHiW', 'f32'],
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
  ['headClog', 'f32'], // one of the two video heads clogged: its alternate-sweep RF collapses to snow
  ['ycDelay', 'f32'], // chroma-path group delay vs luma, whole samples (colour displaced, hue held)
  ['diffGain', 'f32'], // differential gain: fraction of chroma gain lost at peak luma
  ['diffPhase', 'f32'], // differential phase: chroma phase swing at peak luma, radians
  ['fmOverdev', 'f32'], // FM over-deviation: 0 off .. 1 white clip set far too hot
  ['fmStreak', 'f32'], // inversion-streak recovery (deemphasis) time constant, samples
  ['polarityFlip', 'f32'], // hard signal/ground swap: negate whole composite incl. sync
  ['termination', 'f32'], // cable termination fault: <0 double-terminated (dim), >0 open (hot + ringing)
  ['chromaPinOnly', 'f32'], // only the chroma pin fed to composite: color, no luma, no sync
  ['connectorGlitch', 'f32'], // loose connector: intermittent contact drops bands to snow
  ['connectorMode', 'f32'], // which contact: 0 centre pin (signal + sync go), 1 shell (ground lifts, hum injects), 2 both
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
  ['crtHaloKey', 'f32'], // halation radius keyed off beam current: peak whites scatter wider
  ['crtSvm', 'f32'], // scan velocity modulation: dwell-time redistribution across horizontal edges (signed = coil polarity)
  ['crtSvmWidth', 'f32'], // SVM differentiator aperture, active pixels
  ['crtConverge', 'f32'], // gun misconvergence, active px at the edge, growing with radius (signed = which gun lands outward)
  ['crtPurity', 'f32'], // magnetised mask patch: landing error over a soft blotch, tinting by triad direction
  ['crtPurityX', 'f32'], // blotch centre on the glass, 0..1
  ['crtPurityY', 'f32'],
  ['crtPuritySize', 'f32'], // blotch radius as a fraction of picture height
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
  // Beam blanking, held on: the guns cut for most of a cycle and let through in
  // flashes. Applied in decode, upstream of the persistence layer, which is the
  // whole point — the light already on the glass keeps decaying through the dark
  // instead of the picture cutting to black.
  ['beamBlank', 'f32'], // 1 = guns cut this frame, 0 = beam scanning normally
  ['scanBeam', 'f32'], // finite beam-spot strength between scanlines
  ['scanBloom', 'f32'], // beam-spot growth with beam current: bright lines fatten, gaps close in whites
  ['phosphor', 'f32'], // P22 persistence: green-channel frame-to-frame retention (R/B decay faster)
  ['phosphorMode', 'f32'], // tube colour identity: 0 sRGB, 1 P22/SMPTE-C, 2 NTSC-1953, 3 long-persistence green
  ['phosphorSkew', 'f32'], // R/B persistence decay exponent skew relative to G (trails die toward green)
  ['phosphorBleed', 'f32'], // fraction of held light that scatters to the four neighbours per frame
  ['crtSharp', 'f32'], // horizontal Catmull-Rom reconstruction blend (0 bilinear)
  ['maskAmt', 'f32'], // aperture grille strength
  ['maskPitch', 'f32'], // grille triad pitch, canvas pixels
  ['crtZoom', 'f32'], // magnification of the glass (1 = whole screen)
  ['crtZoomX', 'f32'], // point on the glass held under the magnifier, 0..1
  ['crtZoomY', 'f32'],
  ['dbgView', 'f32'], // 0 normal, 1 gradient (present test), 2 raw composite (encode test)
] as const

// Workgroup width of the tiled-FIR passes; pipeline.ts sizes their dispatches
// from the same number so the WGSL and the dispatch cannot drift apart.
export const TILE_WG = 64

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
// The three sync scalars the flywheel carries across frames, sitting directly
// above the per-line offsets. Named rather than written as 525/526/527 at the
// eight sites that touch them: the raster is a constant here, so a literal
// index is the one thing in this buffer that would not move if LINES did.
const V_PHASE = ${LINES}u; // vertical oscillator phase, signed fractional lines
const PLL_STATE = ${LINES + 1}u;
const AGC_GAIN = ${LINES + 2}u;
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
const TAPE_LEN = ${TAPE_FRAMES * SAMPLES_PER_LINE * LINES}u; // delay loop capacity, samples
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
  } else if (s >= BURST_START && s < BURST_START + BURST_LEN) {
    // burst at 180 degrees on the U axis: -A*sin. No row guard: everything
    // below line 12 was already claimed by the two branches above, so the
    // first line that can carry burst is the first one with a real sync tip.
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

// Analog premium-channel scrambling, applied at a head-end. The scrambler lifts
// the carrier during the horizontal sync interval; after envelope detection that
// is the sync tip pulled up toward blanking, and a set with no decoder box has
// nothing left to slice a line start out of. Past half depth the tip clears the
// separator's -20 IRE level entirely and horizontal lock is gone.
//
// Only the line-rate gate is modelled, which is why the frame stays roughly
// framed: the broad vertical pulses are far wider than the gate, so their bodies
// still read as sync level mid-line and the vertical oscillator keeps
// triggering. An unauthorized premium channel sheared and pumped rather than
// tumbling, and that is the mechanism behind it.
//
// mode 1 scrambles alternate lines; mode 2 is SSAVI, which suppressed sync *and*
// inverted the video, so the picture that leaks through is a negative as well as
// an unstable one. Burst sits in the back porch and is left alone, so hue
// survives the inversion.
//
// One definition for the program bus (channel) and the per-source feeds, which
// scramble one input alone — a premium channel is scrambled per channel, not
// per set, so the two differ only in what they are handed.
fn scrambleAt(v: f32, row: u32, s: u32, depth: f32, mode: f32) -> f32 {
  if (depth <= 0.0 || (mode >= 0.5 && mode <= 1.5 && (row & 1u) == 1u)) {
    return v;
  }
  var out = v;
  if (s < SYNC_LEN) {
    out = mix(out, IRE_BLANK, depth);
  }
  let picture = s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W
    && row >= ACTIVE_TOP && row < ACTIVE_TOP + ACTIVE_H;
  if (mode > 1.5 && picture) {
    out = mix(out, 2.0 * IRE_BLACK + VIDEO_RANGE - out, depth);
  }
  return out;
}

// Mains phase at this line. One cycle per field, creeping against field rate
// because the mains and the field rate are not the same number — which is why a
// hum bar rolls instead of standing still. One definition, because the program
// bus's ground loop and a feed's have to roll together: they are the same
// building's mains, and two bars drifting at different rates would say they were
// not. A triac dimmer's firing angle is on the same mains, so it asks in
// fractional lines (where its event landed), which is why the row is f32.
fn humPhase(row: f32, frame: u32) -> f32 {
  return 2.0 * PI * (row / f32(NLINES) + f32(frame) * 0.0037);
}

// A loose plug at the input jack. This takes a mode rather than a depth alone
// because an RCA connector has two contacts and they fail into two different
// pictures:
//
//  - the CENTRE PIN going intermittent breaks the signal path, so the jack sees
//    an open through its own terminator and the input stage's noise floor comes
//    up where the picture was. Sync goes with it, which is what makes this worth
//    having per source: the receiver still has the *other* input's tips to lock
//    to, so a band of bad contact hands the line start over and takes it back a
//    band later, with nothing drawing the hand-off.
//  - the SHELL going intermittent leaves the signal path intact and breaks the
//    ground reference instead. The return current has to find the mains earth
//    through both boxes' supplies, so a ground loop's IR drop lands in series
//    with the video: the line rides a 60 Hz pedestal and the level walks, while
//    the picture and its sync survive. This is the buzz you get by wiggling a
//    plug that is still passing a picture — the fault that sounds broken and
//    looks nearly fine.
//
// Contact is decided per band of lines and re-rolled every frame, the way a plug
// hanging on its own cable weight makes and breaks. The two contacts carry
// independent band maps, so mode 2 interleaves two faults rather than doubling
// one, and the gen seed decorrelates one input's bad plug from the other's.
fn connectorAt(v: f32, row: u32, n: u32, frame: u32, gen: u32, amt: f32, mode: f32) -> f32 {
  if (amt <= 0.0) {
    return v;
  }
  var out = v;
  let band = row / 12u;
  if (mode < 0.5 || mode > 1.5) {
    let r = rand01(pcg(frame * 2246822519u + band * 40503u + gen * 7u));
    if (r < amt * 0.5) {
      let snow = 20.0 * gauss(n ^ pcg(frame * 131u + n));
      out = mix(out, snow, 0.9) - 35.0 * amt;
    }
  }
  if (mode > 0.5) {
    let r = rand01(pcg(frame * 1103515245u + band * 26947u + gen * 13u));
    if (r < amt * 0.5) {
      out = out + 40.0 * amt * sin(humPhase(f32(row), frame));
    }
  }
  return out;
}

// Cable termination fault. Correct is one 75-ohm terminator (0). An open,
// unterminated line (>0) reflects the wave back: the signal runs hot and each
// edge rings with a short round-trip echo. Daisy-chaining a second monitor
// double-terminates (<0), halving the signal so contrast and sync depth collapse
// toward a dim, barely-locking roll. The echo argument is the sample one round
// trip back down the cable, which each caller taps out of its own input buffer:
// the program bus off the pre-channel signal, a feed off that source's own deck.
// Callers guard on a non-zero term, so a correct line costs no tap.
fn terminate(v: f32, term: f32, echo: f32) -> f32 {
  return v * pow(2.0, term) + max(term, 0.0) * 0.6 * echo;
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

// What a detector hands back when the signal it was demodulating is not there.
// The two shapes are not interchangeable and both are used several times over,
// which is the reason they live here rather than being retyped at each site.
//
// rfNull is an RF envelope collapsing: the limiter is still running, so what
// comes out is the front end's own noise about blanking — zero-mean, and it
// takes sync and burst with it wherever it lands. This is a mistracked head, a
// clogged one, a track crossing, a splice crossing the gap.
//
// dropoutNull is oxide that is simply not there: no RF at all, so the detector
// sits at the top of its range and the gap reads as a bright streak rather than
// as hash. The lift is the whole visual difference between the two.
fn rfNull(v: f32, amt: f32, seed: u32) -> f32 {
  return mix(v, 45.0 * gauss(seed), clamp(amt, 0.0, 0.95));
}

fn dropoutNull(v: f32, amt: f32, seed: u32) -> f32 {
  return mix(v, 55.0 + 45.0 * gauss(seed), amt);
}

// Off play speed the spinning head no longer follows a single recorded track:
// each sweep crosses |speed - 1| of them and the RF envelope nulls at every
// crossing, so that many noise bars sweep the frame. One definition for the
// deck (channel) and the delay loop (tape_play) — it is the same drum losing the
// same signal, and the two reading differently would say it was not.
fn shuttleNull(v: f32, row: u32, bars: f32, phase: f32, seed: u32) -> f32 {
  if (bars == 0.0) {
    return v;
  }
  let ab = abs(bars);
  let fx = fract(f32(row) / f32(NLINES) * ab + phase);
  let dLines = min(fx, 1.0 - fx) / ab * f32(NLINES);
  let half = 8.0;
  if (dLines >= half) {
    return v;
  }
  return rfNull(v, (1.0 - dLines / half) * 1.7, seed);
}

// One step of the color-under heterodyne phasor, shared by the record side
// (under_down) and the playback up-conversion (channel). Both walk the same
// (fsc - f_under) per sample, so the step is one constant and one rotation.
const HET_STEP = 2.0 * PI * DOWN_PER_SAMPLE;

fn stepPhasor(p: vec2f) -> vec2f {
  let c = cos(HET_STEP);
  let s = sin(HET_STEP);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

// RGB -> YUV baseband, the encoder's matrix. Read straight off a source texel
// by each encoder pass; there is no yuv buffer between a picture and its
// composite any more (docs/OPTIMIZATIONS.md).
fn yuvOf(rgb: vec3f) -> vec3f {
  let y = luma(rgb);
  return vec3f(y, 0.492 * (rgb.b - y), 0.877 * (rgb.r - y));
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

// One band-limited deviate field, correlated along the scan and nowhere else.
// Noise cannot change faster than the path it came through allows, so the field
// is a lattice of independent deviates at grain active pixels, interpolated
// along x — and independent line to line, because successive lines are
// successive moments in time and the noise is not on the picture, it is in the
// wire. The interpolation costs variance as the grain widens, which is not an
// artifact to correct: a narrower path passes less noise power.
fn noiseFieldX(x: f32, y: u32, grain: f32, seed: u32) -> f32 {
  let ry = (y * 2246822519u) ^ seed;
  // The lattice gets its own phase per row and per frame (ry carries both).
  // Interpolating two deviates costs variance where it lands mid-cell and none
  // at a lattice point, so a lattice fixed in x would ripple the noise power
  // with it — a standing ladder of quieter columns, one per cell, in a
  // mechanism that has no fixed structure anywhere.
  let p = x / max(grain, 1.0) + rand01(ry);
  let i = u32(p);
  let t = fract(p);
  let a = gauss(i ^ ry);
  let b = gauss((i + 1u) ^ ry);
  // Smoothstep rather than linear: a triangular blend leaves a visible kink at
  // every lattice point, which reads as a texture the mechanism never had.
  return mix(a, b, t * t * (3.0 - 2.0 * t));
}

// The playback head's own aperture, active px. A second bandwidth in series
// with whatever the noise arrived with, and the reason blank tape is coarse
// where an untuned tuner is fine.
const TAPE_APERTURE_PX = 3.4;

// Which noise field is on screen. A source whose own refresh is slower than the
// display holds each field for several frames, and a non-integer ratio holds
// them unevenly — the same cadence 3:2 pulldown has, from the same arithmetic.
fn noiseFrame(frame: u32, hold: f32) -> u32 {
  return u32(f32(frame) / max(hold, 1.0));
}

// The GPU-generated no-signal sources, shared by A (compose) and B (compose_b)
// so the two cannot drift apart. What separates the two is where the noise is
// detected, which decides its distribution — the knobs (grain, per-sweep level
// error, noise power, refresh rate) are statistics of the path and apply to
// both. Deliberately monochrome: neither source carries a subcarrier, so any
// colour on screen is the receiver's decoder failing on noise, which is the
// killer's and the comb's business rather than something to paint in here.
fn snowSource(mode: f32, xy: vec2u, frame: u32, grain: f32, lineShare: f32, level: f32) -> vec3f {
  let sd = pcg(frame * 2654435761u);
  let x = f32(xy.x);
  var v: f32;
  if (mode < 1.5) {
    // An untuned tuner: the IF carries noise and no carrier at all, so what the
    // envelope detector recovers is |n| with n complex — Rayleigh, not Gaussian.
    // That asymmetry is where snow's sparse hard specks over a dense dark floor
    // come from; a symmetric field reads as evenly lit fuzz instead.
    let i = noiseFieldX(x, xy.y, grain, sd ^ 0x9e3779b9u);
    let q = noiseFieldX(x, xy.y, grain, sd ^ 0x85ebca6bu);
    v = level * 0.4 * sqrt(i * i + q * q);
  } else {
    // Blank tape: no RF to lock to, so the FM demodulator's limiter free-runs on
    // its own noise and the discriminator hands back a level wandering across
    // the deviation band. Bounded rather than spiky — a limiter cannot hand back
    // a spike — and centred, because the deemphasis network still sets the DC.
    let g = noiseFieldX(x, xy.y, sqrt(grain * grain + TAPE_APERTURE_PX * TAPE_APERTURE_PX), sd ^ 0x9e3779b9u);
    v = 0.5 + level * 0.34 * tanh(g);
  }
  // A level error is a gain error — the tuner's AGC hunting on the noise it is
  // measuring, the head's contact varying sweep to sweep — so it multiplies the
  // noise it is amplifying, and it is one number for the whole line because
  // that is how long a sweep lasts.
  let ln = gauss((xy.y * 2654435761u) ^ sd ^ 0x5bf03635u);
  v = v * max(1.0 + lineShare * 0.7 * ln, 0.0);
  return vec3f(clamp(v, 0.0, 1.0));
}

// The synth's patch, gathered so the generator can live here beside snowSource
// instead of in one of its two callers. Params travel as arguments for the same
// reason snowSource's statistics do: the prelude is prepended to every shader,
// including the ones that bind no uniform block at all, so nothing in it may
// name P.
struct SynthPatch {
  phaseA: f32,
  perLineA: f32,
  perSampleA: f32,
  phaseB: f32,
  perLineB: f32,
  perSampleB: f32,
  shape: f32,
  combine: f32,
  level: f32,
  color: f32,
  hue: f32,
  // Picture luma into oscillator A's frequency input, cycles per sample per
  // unit luma. The classic video-synth patch, and the one thing in here that
  // needs a picture to exist: with the oscillator's frequency a function of
  // brightness, equal-brightness regions run at equal frequency and the wave
  // arrives at each of them in a different place, so the image draws itself as
  // contour lines nobody traced.
  fm: f32,
}

// Gathering the patch off the uniform block, once. The prelude may not name a
// binding, but it declares Params itself, so taking one by value is legal here
// and keeps the field list in a single place — a second copy in each of the two
// callers is exactly how a generator ends up doing different things in the two
// slots it is supposed to be identical in.
fn synthPatch(p: Params) -> SynthPatch {
  return SynthPatch(
    p.synthPhaseA, p.synthPerLineA, p.synthPerSampleA,
    p.synthPhaseB, p.synthPerLineB, p.synthPerSampleB,
    p.synthShape, p.synthMix, p.synthLevel, p.synthColor, p.synthHue,
    p.synthFm,
  );
}

// One oscillator through the waveform selector, at phase cyc in cycles. All
// four shapes come back 0..1 so the combiner and the colorizer below never
// have to know which one is patched.
fn synthWave(cyc: f32, shape: f32) -> f32 {
  let p = fract(cyc);
  if (shape < 0.5) {
    return p;
  }
  if (shape < 1.5) {
    return 1.0 - abs(2.0 * p - 1.0);
  }
  if (shape < 2.5) {
    return 0.5 + 0.5 * sin(2.0 * PI * p);
  }
  return select(0.0, 1.0, p < 0.5);
}

// A video synthesizer patched into a slot: two oscillators, a combiner and a
// colorizer, generating a picture instead of photographing one. Shared by A
// (compose) and B (compose_b) the same way snowSource is, so the two slots
// cannot drift apart.
//
// The whole instrument is one idea: an oscillator running free against a fixed
// raster. Nothing here draws a bar, a gradient or a diagonal — it sets a
// frequency, and what a frequency error against 15.734 kHz looks like is the
// picture. Sit an oscillator on line rate and its phase walk per line is zero,
// so it paints one standing vertical edge; a few hertz off and every line
// starts a little later than the last, which leans the bars and creeps them
// frame to frame. Wind it down to field rate and the same ramp becomes a
// vertical gradient — a ramp generator IS an oscillator locked to drive, which
// is why one knob covers both. Wind it up to 3.579545 MHz and it lands on the
// subcarrier, so the encoder downstream reads the whole screen as chroma and
// hands back flat colour; detune it from there and the hue turns across the
// picture on its own.
//
// Phase is counted from the sample index including blanking, because a bench
// oscillator does not stop for the retrace — the picture is a window onto a
// wave that was already running, and that offset is part of where the pattern
// lands.
fn videoSynth(xy: vec2u, sp: SynthPatch, pic: f32) -> vec3f {
  let row = f32(ACTIVE_TOP + xy.y);
  let s = f32(ACTIVE_START + xy.x);
  // The FM term multiplies the sample index, not the phase, because pulling an
  // oscillator's frequency is not the same as offsetting its phase: phase
  // modulation would slide the pattern about, where this makes the wave
  // genuinely run faster through bright picture and slower through dark, so the
  // spacing of the bars is the brightness. It reads the picture at this pixel
  // alone — a control line has no memory of where it has been — which is why
  // the contours land on the picture rather than trailing it.
  let a = synthWave(sp.phaseA + sp.perLineA * row + (sp.perSampleA + sp.fm * pic) * s, sp.shape);
  let b = synthWave(sp.phaseB + sp.perLineB * row + sp.perSampleB * s, sp.shape);
  var g = a;
  if (sp.combine > 0.5 && sp.combine < 1.5) {
    // A summing amplifier, referenced to mid-video: two signals added run into
    // the rails rather than wrapping, which is what makes a sum read as two
    // patterns lying over each other instead of a third pattern.
    g = clamp(a + b - 0.5, 0.0, 1.0);
  } else if (sp.combine > 1.5 && sp.combine < 2.5) {
    // Doubly-balanced multiply, both inputs referenced to mid so both carriers
    // are suppressed and only the sum and difference survive (the same bridge
    // the mixer loop's ring mod uses). Two free-running oscillators beating
    // against each other draw a moire whose own beat rate is the difference of
    // two frequency errors, so it breathes at a rate neither knob names.
    g = clamp(0.5 + 2.0 * (a - 0.5) * (b - 0.5), 0.0, 1.0);
  } else if (sp.combine > 2.5) {
    // A comparator with the second oscillator on its reference input: hard
    // two-level output, and the threshold is itself a moving waveform, so the
    // duty cycle is modulated everywhere the two patterns cross.
    g = select(0.0, 1.0, a > b);
  }
  let lvl = clamp(0.5 + sp.level * (g - 0.5), 0.0, 1.0);
  // The colorizer: one signal into three guns through three phase shifts 120
  // degrees apart, which is all a colorizer ever was. At depth 0 the three
  // agree and the signal comes out as the grey it is; opened up, level becomes
  // hue and a ramp turns through the wheel.
  //
  // Half a turn across the level range, not a whole one. A full turn brings the
  // top of the range back to the colour the bottom started on, which is fine on
  // a ramp and useless on anything two-level: a pulse would put both its states
  // on the same hue and come out a flat field. Half a turn keeps black and
  // white opposite, which is what a level-to-hue converter is for.
  let tint = 0.5 + 0.5 * cos(PI * lvl + sp.hue + vec3f(0.0, -2.0943951, 2.0943951));
  return clamp(mix(vec3f(lvl), tint, sp.color), vec3f(0.0), vec3f(1.0));
}
`
