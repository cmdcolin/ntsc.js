// The control board converted to the uniform block, in the units the shaders
// read: physical units in, samples / radians / per-sample rates out. A pure
// function of the controls and the engine's per-frame state so the headless
// profiler (scripts/gpuprof) packs exactly what the app packs.

import { clamp01 } from '../math'
import {
  ACTIVE_WIDTH,
  F_H,
  IRE_VIDEO_RANGE,
  LINES,
  SAMPLE_RATE,
  SAMPLES_PER_LINE,
} from '../signal/constants'
import { valueNoise } from '../signal/noise'

import type { Controls } from '../controls'

// Bent-crystal demod LO: how fast a detuned 3.58 MHz oscillator's phase error
// grows, per composite sample.
export const loRadPerSample = (detuneKHz: number): number =>
  (2 * Math.PI * detuneKHz * 1e3) / SAMPLE_RATE

// Impulse interference arrives in storms, not rain: trains of hits with real
// quiet between flurries. A bursty aperiodic envelope on the random-hit rate —
// rectified-and-squared so the quiet stretches are genuinely silent — and
// deterministic in the frame count, so harness runs stay reproducible.
export const impulseStorm = (t: number): number => {
  const e = Math.max(0, 0.4 + 1.3 * valueNoise(t * 0.6, 5))
  return e * e * (1 + 0.4 * valueNoise(t * 2.7, 9))
}

// The correlation length a bandwidth implies, in active pixels: a path that
// stops at B Hz cannot change faster than one half-cycle of B, and the source
// raster is 754 px across the 910 samples of a line.
export const noiseGrainPx = (bwMHz: number): number =>
  ((SAMPLE_RATE / (2 * Math.max(bwMHz, 0.05) * 1e6)) * ACTIVE_WIDTH) /
  SAMPLES_PER_LINE

// The Gaussian whose half-power point sits at a band edge, as a sigma in
// composite samples: exp(-2 pi^2 sigma^2 f^2) = 1/sqrt(2) at f = B gives
// sigma = 0.1325 / B. Capped where the gather's radius would stop paying.
export const bandSigmaPx = (bwMHz: number): number =>
  bwMHz > 0 ? Math.min((0.1325 * SAMPLE_RATE) / (bwMHz * 1e6), 8) : 0

// Output weights for the two arms of the noise floor's spectrum (channel.wgsl):
// a 1-2-1 lowpass and a first difference over the same three deviates. Because
// they share taps they are correlated, so holding the floor's level constant
// across the tilt needs the covariance and not just the weights — with unit
// deviates, corr(sum, difference) = 1 / (2 * sqrt(3)). Without this the mid
// positions of the knob are audibly (visibly) quieter than either end, and the
// tilt would read as a noise-amount control with a side effect.
const RHO = 1 / (2 * Math.sqrt(3))
export const noiseTiltWeights = (tilt: number): [number, number] => {
  const t = clamp01(tilt)
  const norm = 1 / Math.sqrt((1 - t) ** 2 + t ** 2 + 2 * t * (1 - t) * RHO)
  return [(1 - t) * norm, t * norm]
}

// What the engine knows this frame that the controls do not: counters, the
// phases it walks between frames, what the sources are showing, and the
// audio side's envelope followers.
export interface UniformEnv {
  frame: number
  canvasW: number
  canvasH: number
  srcAspect: number
  srcNoise: number
  srcNoiseB: number
  srcFrame: number
  beamBlank: number
  scPhase: number
  audioHit: number
  audioLevel: number
  impulseTrainPos: number
  impulseTrainStep: number
  shuttlePhase: number
  dbgView: number
}

export function uniformValues(c: Controls, env: UniformEnv) {
  const [noiseLoW, noiseHiW] = noiseTiltWeights(c.noiseTilt)
  return {
    frame: env.frame,
    gen: 0,
    canvasW: env.canvasW,
    canvasH: env.canvasH,
    srcAspect: env.srcAspect,
    srcNoise: env.srcNoise,
    srcNoiseB: env.srcNoiseB,
    srcNoiseGrain: noiseGrainPx(c.srcNoiseBwMHz),
    srcNoiseLine: c.srcNoiseLine,
    srcNoiseLevel: c.srcNoiseLevel,
    srcNoiseHold: 60 / Math.max(c.srcNoiseHz, 0.5),
    srcFrame: env.srcFrame,
    invert: c.invert,
    deint: c.deint,
    capLumaSigma: bandSigmaPx(c.capLumaMHz),
    capChromaSigma: bandSigmaPx(c.capChromaMHz),
    capYcDelay: c.capYcDelayNs * 1e-9 * SAMPLE_RATE,
    capNoise: c.capNoiseIre / IRE_VIDEO_RANGE,
    capChromaNoise: c.capChromaNoiseIre / IRE_VIDEO_RANGE,
    synthShape: c.synthShape,
    synthMix: c.synthMix,
    synthLevel: c.synthLevel,
    synthColor: c.synthColor,
    synthHue: (c.synthHueDeg * Math.PI) / 180,
    synthOver: c.synthOver,
    // Authored in Hz per unit luma, converted to the same cycles-per-sample
    // the oscillator's own walk is in — the FM input adds to that walk, so the
    // two have to arrive in the same units.
    synthFm: c.synthFm / SAMPLE_RATE,
    beamBlank: env.beamBlank,
    chromaGain: c.chromaGain,
    burstLock: c.burstLock,
    tint: (c.tintDeg * Math.PI) / 180,
    demodAxis: (c.demodAxisDeg * Math.PI) / 180,
    matrixClip: c.matrixClip,
    scDetunePhase: env.scPhase,
    scDetunePerSample: loRadPerSample(c.scDetuneKHz),
    killThresh: c.killThresh,
    accLines: c.accLagLines,
    svideoBleed: c.svideoBleed,
    combMode: c.combMode,
    hHold: c.hHold,
    vHold: c.vHold,
    // beat between the free-running v-osc and the incoming field rate: a
    // slower oscillator retraces late, so the raster start creeps down the
    // source and the picture climbs
    vRollRate: LINES * (60 / (c.vFreqHz - c.audioRoll * env.audioHit) - 1),
    syncBend: c.syncBendUs * 1e-6 * SAMPLE_RATE,
    bendAmt: c.bendUs * 1e-6 * SAMPLE_RATE,
    bendShape: c.bendShape,
    bendPeriod: c.bendPeriod,
    vSize: c.vSize,
    hvSag: (c.hvSagUs + c.audioSagUs * env.audioHit) * 1e-6 * SAMPLE_RATE,
    hvRing: c.hvRing,
    // beat between the free-running H-osc and the incoming line rate, in
    // samples of phase gained per line
    hRate:
      SAMPLES_PER_LINE *
      (F_H / (F_H + c.hDetuneHz + c.audioTear * env.audioLevel) - 1),
    audioBend: c.audioBendUs * 1e-6 * SAMPLE_RATE,
    audioLoad: c.audioLoad,
    audioIre: c.audioIre,
    audioHue: (c.audioHueDeg * Math.PI) / 180,
    noiseSigma: c.noiseIre,
    noiseLoW,
    noiseHiW,
    impulseRate: c.impulseRate * impulseStorm(env.frame / 60),
    impulseIre: c.impulseIre,
    impulseTrainPos: env.impulseTrainPos,
    impulseTrainStep: env.impulseTrainStep,
    impulseMains: c.impulseMains,
    strikeRate: c.strikeRate,
    ghostDelay: c.ghostDelayUs * 1e-6 * SAMPLE_RATE,
    ghostGain: c.ghostGain,
    humAmp: c.humAmp,
    humMod: c.humMod,
    colorUnderMix: c.colorUnderMix,
    chromaNoise: c.chromaNoiseIre,
    dropoutRate: c.dropoutRate,
    dropoutLen: c.dropoutLenUs * 1e-6 * SAMPLE_RATE,
    dropoutComp: c.dropoutComp,
    headSwitchNoise: c.headSwitchNoise,
    headClog: c.headClog,
    // whole samples: the shader indexes with it, and sub-sample trims are
    // below what a delay-line mistrim resolves anyway
    ycDelay: Math.round(c.ycDelayNs * 1e-9 * SAMPLE_RATE),
    diffGain: c.diffGain,
    diffPhase: (c.diffPhaseDeg * Math.PI) / 180,
    fmOverdev: c.fmOverdev,
    fmStreak: Math.max(c.fmStreakUs * 1e-6 * SAMPLE_RATE, 1),
    polarityFlip: c.polarityFlip,
    termination: c.termination,
    chromaPinOnly: c.chromaPinOnly,
    connectorGlitch: c.connectorGlitch,
    connectorMode: c.connectorMode,
    scramble: c.scramble,
    scrambleMode: c.scrambleMode,
    mvAgcIre: 160 * c.macrovision,
    mvStripe: (c.mvStripeDeg * Math.PI) / 180,
    vbi: c.vbi,
    enhClampOff: c.enhClampUs * 1e-6 * SAMPLE_RATE,
    // RC leak per sample from the coupling time constant; 0 us is the
    // DC-coupled box, which never lets the level move at all.
    enhDroop:
      c.enhDroopUs > 0
        ? 1 - Math.exp(-1 / (c.enhDroopUs * 1e-6 * SAMPLE_RATE))
        : 0,
    enhPeakFc: (c.enhPeakMHz * 1e6) / SAMPLE_RATE,
    // Pole radius: 0.85 rings for a handful of samples, 1.0 rings forever,
    // and above it the stage is regenerative and climbs to the rails.
    enhPeakR: 0.85 + 0.2 * c.enhPeakQ,
    enhPeakBoost: c.enhPeakBoost,
    enhSync: c.enhSync,
    enhSlice: c.enhSliceIre,
    fbMix: c.fbMix,
    fbZoom: c.fbZoom,
    fbRotate: (c.fbRotateDeg * Math.PI) / 180,
    fbShiftX: c.fbShiftX,
    fbShiftY: c.fbShiftY,
    fbGain: c.fbGain,
    fbFocus: c.fbFocus,
    fbVign: c.fbVign,
    fbBlack: c.fbBlack,
    fbKnee: c.fbKnee,
    fbIris: c.fbIris,
    crtCutoff: c.crtCutoff,
    crtGamma: c.crtGamma,
    crtSat: c.crtSat,
    crtSpot: c.crtSpot,
    crtGrain: c.crtGrain,
    crtBloom: c.crtBloom,
    crtHalation: c.crtHalation,
    crtGlow: c.crtGlow,
    crtHaloKey: c.crtHaloKey,
    crtSvm: c.crtSvm,
    crtSvmWidth: c.crtSvmWidth,
    crtConverge: c.crtConverge,
    crtPurity: c.crtPurity,
    crtPurityX: c.crtPurityX,
    crtPurityY: c.crtPurityY,
    crtPuritySize: c.crtPuritySize,
    aGain: c.aGain,
    bGain: c.bGain,
    bRing: c.bRing,
    bHue: (c.bHueDeg * Math.PI) / 180,
    bVidGain: c.bVidGain,
    bInv: c.bInv,
    // No deck is paused on the program bus — a held deck is a fault on one
    // source's feed, and packFeed overwrites these with that deck's state.
    bPause: 0,
    bPauseBar: 0,
    bGenlock: c.bGenlock,
    wipeMode: c.wipeMode,
    wipeSoft: c.wipeSoft,
    pipMix: c.pipMix,
    pipX: c.pipX,
    pipY: c.pipY,
    pipW: c.pipW,
    pipH: c.pipH,
    pipBorder: c.pipBorder,
    pipSoft: c.pipSoft,
    pipKey: c.pipKey,
    pipKeyLevel: c.pipKeyLevel,
    pipKeySoft: c.pipKeySoft,
    bKey: c.bKey,
    bKeyHue: (c.bKeyHueDeg * Math.PI) / 180,
    bKeyAccept: (c.bKeyAcceptDeg * Math.PI) / 180,
    bKeyClip: c.bKeyClip,
    bKeySoft: c.bKeySoft,
    bKeySpill: c.bKeySpill,
    bKeyDelay: c.bKeyDelayUs * 1e-6 * SAMPLE_RATE,
    bKeyFill: c.bKeyFill,
    bKeyMatteY: c.bKeyMatteY,
    bKeyMatteHue: (c.bKeyMatteHueDeg * Math.PI) / 180,
    bKeyMatteSat: c.bKeyMatteSat,
    trackAmt: c.trackAmt,
    trackPos: c.trackPos,
    shuttleBars: c.shuttleX - 1,
    shuttlePhase: env.shuttlePhase,
    cfbMix: c.cfbMix,
    cfbGain: c.cfbGain,
    cfbDelay: c.cfbDelayUs * 1e-6 * SAMPLE_RATE,
    cfbLines: c.cfbLines,
    cfbKey: c.cfbKey,
    cfbKeyLevel: c.cfbKeyLevel,
    cfbKeySoft: c.cfbKeySoft,
    cfbTrail: c.cfbTrail,
    cfbFilterFc: (c.cfbFilterMHz * 1e6) / SAMPLE_RATE,
    cfbFilterQ: c.cfbFilterQ,
    cfbFilterBoost: c.cfbFilterBoost,
    cfbServo: c.cfbServoUs * 1e-6 * SAMPLE_RATE,
    cfbRing: c.cfbRing,
    tapeMix: c.tapeMix,
    tapeGain: c.tapeGain,
    tapeHfLoss: c.tapeHfLoss,
    tapeNoise: c.tapeNoiseIre,
    tapeWear: c.tapeWear,
    tapeSplice: c.tapeSplice,
    tapeHeads: c.tapeHeads,
    tapeHeadSpread: c.tapeHeadSpread,
    tapeColourFrame: c.tapeColourFrame,
    // Mistuning frees the sound carrier from its trap, so the buzz the
    // soundIre knob dials in deliberately arrives uninvited — same term,
    // two causes on one wire.
    soundIre: c.soundIre + 15 * Math.max(c.rfMistuneMHz, 0) ** 1.5,
    rfSoften: clamp01(-c.rfMistuneMHz),
    rfIntermod: 0.22 * Math.max(c.rfMistuneMHz, 0),
    rfAdjIre: 18 * c.rfAdjacent,
    rfSnow: c.rfSnow,
    ingressIre: 11 * c.ingress,
    agc: c.agc,
    abl: c.abl,
    chromaCoarse: c.chromaCoarse,
    scanBeam: c.scanBeam,
    scanBloom: c.scanBloom,
    phosphor: c.phosphor,
    phosphorMode: c.phosphorMode,
    phosphorSkew: c.phosphorSkew,
    phosphorBleed: c.phosphorBleed,
    crtSharp: c.crtSharp,
    maskAmt: c.maskAmt,
    maskPitch: c.maskPitch,
    crtZoom: c.crtZoom,
    crtZoomX: c.crtZoomX,
    crtZoomY: c.crtZoomY,
    dbgView: env.dbgView,
  }
}
