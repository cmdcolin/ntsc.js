// The adjacent channel's transmitter: its own sync generator and its own
// crystals, nothing about it locked to us. What the shader needs per frame is
// where that raster sits against ours (a time offset in samples, plus the
// line-rate mismatch that slants and sweeps its bars) and where the two beat
// carriers' phases have got to. The mismatch wanders instead of ticking — two
// head-end oscillators drift against each other, they do not oscillate — and
// it crosses zero, which is where the wiper bars hang, flatten, and reverse.
// Everything is a function of the frame count, so harness runs reproduce.

import { wrap } from '../math'
import { LINES, SAMPLES_PER_LINE } from './constants'
import { valueNoise } from './noise'

const N = SAMPLES_PER_LINE * LINES
const TAU = 2 * Math.PI

interface RfUniforms {
  rfAdjEps: number
  rfAdjTau: number
  rfAdjPhase: number
  rfAdjPhaseS: number
  ingressCps: number
  ingressRowCyc: number
  ingressPhase: number
  ingressKey: number
}

export class RfState {
  private tau = 0
  private phV = 0
  private phS = 0
  private phI = 0

  update(frame: number): RfUniforms {
    const t = frame / 60
    // Their line rate off ours, as a fraction. Biased off zero — a neighbour's
    // crystal has some fixed error — with a wander wide enough to swing
    // through zero now and then. At the top of the range their blanking bar
    // slants a full screen width over the height and crosses in about a
    // second; near zero it stands almost vertical and creeps.
    const eps =
      1.6e-3 *
      (0.3 + 0.55 * valueNoise(t * 0.17, 21) + 0.15 * valueNoise(t * 0.9, 22))
    this.tau = wrap(this.tau + eps * N, N)
    // Residual carrier offsets off the exact 6.0 / 1.5 MHz beat grid: a few
    // hundred Hz of drift keeps the fine texture boiling rather than frozen.
    this.phV = wrap(this.phV + (TAU * 700 * valueNoise(t * 0.31, 23)) / 60, TAU)
    // The sound beat also carries their audio: FM at speech-ish rates, so the
    // herringbone sways with a programme nobody can hear.
    this.phS = wrap(
      this.phS +
        (TAU *
          (160 * valueNoise(t * 0.23, 24) + 45 * valueNoise(t * 2.3, 25))) /
          60,
      TAU,
    )
    // The ingress rig: a two-way radio whose carrier owes nothing to any NTSC
    // frequency. Its visible beat wanders around ~2.3 MHz — the herringbone
    // holds no fixed angle — and the operator keys the mic in stretches, so
    // the interference arrives in transmissions with real silence between,
    // not as a steady tone.
    const cps =
      0.16 + 0.045 * valueNoise(t * 0.19, 33) + 0.008 * valueNoise(t * 1.7, 34)
    this.phI = wrap(this.phI + TAU * cps * N, TAU)
    // Biased so a turned-up knob shows something within a few seconds, while
    // the slow term still drops the sum below zero for real off-air stretches.
    const key = Math.min(
      1,
      Math.max(
        0,
        0.2 + 1.5 * valueNoise(t * 0.34, 31) + 0.7 * valueNoise(t * 1.2, 32),
      ),
    )
    return {
      rfAdjEps: eps,
      rfAdjTau: this.tau,
      rfAdjPhase: this.phV,
      rfAdjPhaseS: this.phS,
      ingressCps: cps,
      ingressRowCyc:
        SAMPLES_PER_LINE * cps - Math.floor(SAMPLES_PER_LINE * cps),
      ingressPhase: this.phI,
      ingressKey: key,
    }
  }
}
