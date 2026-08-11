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
// Each deck feeds its own feed pass (feedA, feedB), which scatters that
// source's waveform on its own raster — so B's mistrack stripe lives on B's
// rows and rolls with B's picture, the way damage on the tape must.
// B's drum additionally alternates two reads whose colour-under phase was
// never interleaved, so B's hue flickers at frame rate; that phase machinery
// stays B's own, baked into its carrier by encode_composite_b.

import { wrap } from '../math'
import { F_H, LINES, SAMPLES_PER_LINE } from './constants'
import { Wow, valueNoise } from './noise'

const LINE_S = 1 / F_H

// One paused deck's servo state, as the feed pass consumes it. feed.wgsl reads
// whichever deck's state its instance was handed off the shared bPause* uniform
// fields, so this is the shape the feed uniform pack writes — not four loose
// numbers named for the deck they came from.
export interface DeckPause {
  pause: number // the button: 0 play, >0 held with this much servo damage
  shift: number // the defeated capstan's wander, samples
  bar: number // head-mistrack stripe centre, source rows (walks on its own)
  row: number // the vertical servo's hunt, whole lines
}

// The deck itself: its own clock (only advances while held), the defeated
// capstan's wander, where the tape happened to stop, and the vertical hunt. The
// noise channels differ per deck so two paused decks wander independently.
class PauseDeck {
  t = 0
  private wow: Wow
  private bar: number
  private readonly chanBar: number
  private readonly chanKick: number

  constructor(
    bar0: number,
    chanBar: number,
    chanKick: number,
    rand: () => number,
  ) {
    this.bar = bar0
    this.chanBar = chanBar
    this.chanKick = chanKick
    this.wow = new Wow(rand)
  }

  update(pause: number): DeckPause {
    if (pause <= 0) return { pause: 0, shift: 0, bar: this.bar, row: 0 }
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
    return {
      pause,
      shift,
      bar: this.bar,
      row: k > 0.55 ? Math.round(k * 4 * pause) : 0,
    }
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
  wipePos: number
  // The two paused decks, consumed by the feed uniform packs rather than by
  // PARAM_DEFS — the program-bus params describe no deck at all.
  decks: { a: DeckPause; b: DeckPause }
}

export class MixState {
  private hShift = 0
  private scPhase = 0 // turns
  private vRoll = 0
  // The auto-sweep's offset from the wipe lever, and the lever position it was
  // last seen against — see the parking rule in update().
  private wipeT = 0
  private wipeLever = 0
  // the two decks park their tape in different places and hunt on their own
  // noise channels, so pausing both never moves them in lockstep
  private deckA: PauseDeck
  private deckB: PauseDeck
  private parity = 0

  // The dice the two decks' wow draws from, on the trailing-`rand` convention
  // `rng.ts` states: live it is `Math.random`, and a take hands over a seeded
  // one so the same take wanders the same way twice. Nothing else here rolls —
  // the slip, the roll and the wipe are all accumulators.
  constructor(rand: () => number = Math.random) {
    this.deckA = new PauseDeck(0.4 * LINES, 5, 29, rand)
    this.deckB = new PauseDeck(0.75 * LINES, 7, 23, rand)
  }

  update(c: MixControls): MixUniforms {
    const shiftPerLine = (c.bLineHz / F_H) * SAMPLES_PER_LINE
    this.hShift = wrap(this.hShift + shiftPerLine * LINES, SAMPLES_PER_LINE)
    this.scPhase = wrap(this.scPhase + c.bDetuneHz * LINE_S * LINES, 1)
    this.vRoll = wrap(this.vRoll + c.bRollLps, LINES)
    // The sweep is an offset the auto-sweep walks on top of the wipe lever, and
    // stopping it parks the boundary where it stopped. Zeroing the offset
    // instead snapped the boundary back to the lever the instant the rate hit
    // 0, which is the opposite of why anyone stops a sweep — you stop it
    // because you like where it is. Touching the lever while stopped drops the
    // parked offset, so a drag still reads as an absolute position rather than
    // one measured from wherever the sweep happened to leave off; moving it
    // while the sweep runs keeps offsetting the sweep, as before.
    if (c.wipeRateHz !== 0) {
      this.wipeT = wrap(this.wipeT + (2 * c.wipeRateHz) / 60, 2)
    } else if (c.wipePos !== this.wipeLever) {
      this.wipeT = 0
    }
    this.wipeLever = c.wipePos
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
      bShift0: wrap(this.hShift, SAMPLES_PER_LINE),
      bShiftLine: shiftPerLine,
      bPhase0: this.scPhase * 2 * Math.PI + pausePhase,
      bPhaseLine: 2 * Math.PI * c.bDetuneHz * LINE_S,
      bRowOff: Math.floor(this.vRoll),
      decks: { a, b },
    }
  }
}
