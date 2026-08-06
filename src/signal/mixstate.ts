// Non-genlocked source B: its line frequency, field rate, and subcarrier are
// all slightly off from A, so its picture slips horizontally, rolls
// vertically, and its chroma beats against the burst-locked decoder. The
// accumulators live here in f64 and are folded into per-frame uniforms.
//
// The pause block is the B deck's pause button. A paused deck is a broken
// timing source: the drum keeps re-reading one track while the capstan servo —
// the thing that held the timebase steady — has nothing to serve, so the
// timing wanders aperiodically; the parked tape creeps, walking the
// head-mistrack stripe; and the two reads the drum alternates between never
// had their colour-under phase interleaved, so chroma flickers at frame rate.
// All of it lands on the accumulators the dirty sum already carries, which is
// why a paused deck into the mixer beats and fights instead of sitting still.

import { F_H, LINES, SAMPLES_PER_LINE } from './constants'
import { Wow, valueNoise } from './noise'

const LINE_S = 1 / F_H

const wrap = (x: number, m: number) => ((x % m) + m) % m

export interface MixControls {
  bLineHz: number // B line-frequency offset
  bDetuneHz: number // B subcarrier detune
  bRollLps: number // B vertical slip, lines per frame
  bPause: number // B deck pause: 0 play, >0 held with this much servo damage
  wipePos: number // wipe position slider
  wipeRateHz: number // auto-sweep rate (ping-pong)
}

export interface MixUniforms {
  bShift0: number
  bShiftLine: number
  bPhase0: number
  bPhaseLine: number
  bRowOff: number
  bPause: number
  bPauseBar: number
  wipePos: number
}

export class MixState {
  private hShift = 0
  private scPhase = 0 // turns
  private vRoll = 0
  private wipeT = 0
  // pause-deck state: its own clock (only advances while held), the servo
  // wander, where the tape happened to stop, and the drum's read parity
  private pauseT = 0
  private pauseWow = new Wow()
  private barPos = 0.75 * LINES
  private parity = 0

  update(c: MixControls): MixUniforms {
    const shiftPerLine = (c.bLineHz / F_H) * SAMPLES_PER_LINE
    this.hShift = wrap(this.hShift + shiftPerLine * LINES, SAMPLES_PER_LINE)
    this.scPhase = wrap(this.scPhase + c.bDetuneHz * LINE_S * LINES, 1)
    this.vRoll = wrap(this.vRoll + c.bRollLps, LINES)
    this.wipeT =
      c.wipeRateHz === 0 ? 0 : wrap(this.wipeT + (2 * c.wipeRateHz) / 60, 2)
    const wp = wrap(c.wipePos + this.wipeT, 2)

    let pauseShift = 0
    let pausePhase = 0
    let rowKick = 0
    if (c.bPause > 0) {
      this.pauseT += 1 / 60
      this.parity ^= 1
      this.pauseWow.advance(1 / 60)
      // the defeated capstan: the same wander machinery the tape loop uses,
      // but with nothing correcting it the excursion is samples, not ns
      pauseShift = this.pauseWow.at(this.pauseT, 0) * c.bPause * 30
      // the parked tape creeps and settles, so the mistrack stripe walks
      this.barPos = wrap(
        this.barPos + valueNoise(this.pauseT * 0.35, 7) * 0.9 * c.bPause,
        LINES,
      )
      // colour-under discontinuity between the drum's two reads: a hue flip
      // at frame rate, plus a slow wander as the phase error drifts
      pausePhase =
        c.bPause * (this.parity * 1.9 + 1.2 * valueNoise(this.pauseT * 0.8, 11))
      // the servo hunting vertically: intermittent whole-line hops
      const kick = valueNoise(this.pauseT * 2.1, 23)
      if (kick > 0.55) rowKick = Math.round(kick * 4 * c.bPause)
    }

    return {
      wipePos: wp < 1 ? wp : 2 - wp,
      bShift0: wrap(this.hShift + pauseShift, SAMPLES_PER_LINE),
      bShiftLine: shiftPerLine,
      bPhase0: this.scPhase * 2 * Math.PI + pausePhase,
      bPhaseLine: 2 * Math.PI * c.bDetuneHz * LINE_S,
      bRowOff: Math.floor(this.vRoll) + rowKick,
      bPause: c.bPause,
      bPauseBar: this.barPos,
    }
  }
}
