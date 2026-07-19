// Non-genlocked source B: its line frequency, field rate, and subcarrier are
// all slightly off from A, so its picture slips horizontally, rolls
// vertically, and its chroma beats against the burst-locked decoder. The
// accumulators live here in f64 and are folded into per-frame uniforms.

import { LINES, SAMPLES_PER_LINE } from './constants'

const F_H = 4500000 / 286 // line rate, 15734.27 Hz
const LINE_S = 1 / F_H

export interface MixControls {
  bLineHz: number // B line-frequency offset
  bDetuneHz: number // B subcarrier detune
  bRollLps: number // B vertical slip, lines per frame
}

export class MixState {
  private hShift = 0
  private scPhase = 0 // turns
  private vRoll = 0

  update(c: MixControls): { bShift0: number; bShiftLine: number; bPhase0: number; bPhaseLine: number; bRowOff: number } {
    const wrap = (x: number, m: number) => ((x % m) + m) % m
    const shiftPerLine = (c.bLineHz / F_H) * SAMPLES_PER_LINE
    this.hShift = wrap(this.hShift + shiftPerLine * LINES, SAMPLES_PER_LINE)
    this.scPhase = wrap(this.scPhase + c.bDetuneHz * LINE_S * LINES, 1)
    this.vRoll = wrap(this.vRoll + c.bRollLps, LINES)
    return {
      bShift0: this.hShift,
      bShiftLine: shiftPerLine,
      bPhase0: this.scPhase * 2 * Math.PI,
      bPhaseLine: 2 * Math.PI * c.bDetuneHz * LINE_S,
      bRowOff: Math.floor(this.vRoll),
    }
  }
}
