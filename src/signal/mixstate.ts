// Non-genlocked source B: its line frequency, field rate, and subcarrier are
// all slightly off from A, so its picture slips horizontally, rolls
// vertically, and its chroma beats against the burst-locked decoder. The
// accumulators live here in f64 and are folded into per-frame uniforms.
//
// The pause decks are the two inputs' pause buttons. A paused deck is a broken
// timing source: the drum keeps re-reading one track while the capstan servo —
// the thing that held the timebase steady — has nothing to serve, so the
// timing wanders aperiodically; the parked tape creeps, walking the
// head-mistrack stripe; and the servo hunts vertically in whole-line hops.
// B's deck feeds the accumulators the dirty sum already carries, which is why
// a paused deck into the mixer beats and fights instead of sitting still.
// A's deck feeds the feedA pass instead — A is the house reference, so its
// pause scatters the program's own timing before anything else touches it.
// B's drum additionally alternates two reads whose colour-under phase was
// never interleaved, so B's hue flickers at frame rate; that phase machinery
// stays B's own, on its carrier accumulator.

import { F_H, LINES, SAMPLES_PER_LINE } from './constants'
import { Wow, valueNoise } from './noise'

const LINE_S = 1 / F_H

const wrap = (x: number, m: number) => ((x % m) + m) % m

// One paused deck's servo state: its own clock (only advances while held),
// the defeated capstan's wander, where the tape happened to stop, and the
// vertical hunt. The noise channels differ per deck so two paused decks
// wander independently.
class PauseDeck {
  t = 0
  private wow = new Wow()
  private bar: number
  private readonly chanBar: number
  private readonly chanKick: number

  constructor(bar0: number, chanBar: number, chanKick: number) {
    this.bar = bar0
    this.chanBar = chanBar
    this.chanKick = chanKick
  }

  update(pause: number): { shift: number; bar: number; kick: number } {
    if (pause <= 0) return { shift: 0, bar: this.bar, kick: 0 }
    this.t += 1 / 60
    this.wow.advance(1 / 60)
    // the defeated capstan: the same wander machinery the tape loop uses,
    // but with nothing correcting it the excursion is samples, not ns
    const shift = this.wow.at(this.t, 0) * pause * 30
    // the parked tape creeps and settles, so the mistrack stripe walks
    this.bar = wrap(
      this.bar + valueNoise(this.t * 0.35, this.chanBar) * 0.9 * pause,
      LINES,
    )
    // the servo hunting vertically: intermittent whole-line hops
    const k = valueNoise(this.t * 2.1, this.chanKick)
    const kick = k > 0.55 ? Math.round(k * 4 * pause) : 0
    return { shift, bar: this.bar, kick }
  }
}

export interface MixControls {
  aPause: number // A deck pause: 0 play, >0 held with this much servo damage
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
  // A's paused deck, consumed by the feedA uniform pack rather than PARAM_DEFS
  aPauseShift: number
  aPauseBar: number
  aPauseRow: number
}

export class MixState {
  private hShift = 0
  private scPhase = 0 // turns
  private vRoll = 0
  private wipeT = 0
  // the two decks park their tape in different places and hunt on their own
  // noise channels, so pausing both never moves them in lockstep
  private deckA = new PauseDeck(0.4 * LINES, 5, 29)
  private deckB = new PauseDeck(0.75 * LINES, 7, 23)
  private parity = 0

  update(c: MixControls): MixUniforms {
    const shiftPerLine = (c.bLineHz / F_H) * SAMPLES_PER_LINE
    this.hShift = wrap(this.hShift + shiftPerLine * LINES, SAMPLES_PER_LINE)
    this.scPhase = wrap(this.scPhase + c.bDetuneHz * LINE_S * LINES, 1)
    this.vRoll = wrap(this.vRoll + c.bRollLps, LINES)
    this.wipeT =
      c.wipeRateHz === 0 ? 0 : wrap(this.wipeT + (2 * c.wipeRateHz) / 60, 2)
    const wp = wrap(c.wipePos + this.wipeT, 2)

    const a = this.deckA.update(c.aPause)
    const b = this.deckB.update(c.bPause)
    let pausePhase = 0
    if (c.bPause > 0) {
      this.parity ^= 1
      // colour-under discontinuity between the drum's two reads: a hue flip
      // at frame rate, plus a slow wander as the phase error drifts
      pausePhase =
        c.bPause *
        (this.parity * 1.9 + 1.2 * valueNoise(this.deckB.t * 0.8, 11))
    }

    return {
      wipePos: wp < 1 ? wp : 2 - wp,
      bShift0: wrap(this.hShift + b.shift, SAMPLES_PER_LINE),
      bShiftLine: shiftPerLine,
      bPhase0: this.scPhase * 2 * Math.PI + pausePhase,
      bPhaseLine: 2 * Math.PI * c.bDetuneHz * LINE_S,
      bRowOff: Math.floor(this.vRoll) + b.kick,
      bPause: c.bPause,
      bPauseBar: b.bar,
      aPauseShift: a.shift,
      aPauseBar: a.bar,
      aPauseRow: a.kick,
    }
  }
}
