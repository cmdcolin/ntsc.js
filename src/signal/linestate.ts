// CPU-side per-line processes that must be continuous across frames: time-base
// error (wow + flutter random walk of an un-TBC'd deck), color-under phase
// wander, head-switch offset, per-line dropout seeds. Uploaded each frame as
// one vec4 per line: (tbOffsetSamples, underBasePhase, underJitterPhase, seed)

import {
  FSC,
  HEAD_SWITCH_LINE,
  LINES,
  SAMPLES_PER_LINE,
  SAMPLE_RATE,
  usToSamples,
} from './constants'
import { Wow } from './noise'

const F_UNDER = (40 * FSC) / 227.5 // 629.37 kHz color-under carrier
const F_DOWN = FSC - F_UNDER // heterodyne frequency
const DOWN_PER_SAMPLE = F_DOWN / SAMPLE_RATE

export interface LineStateControls {
  tbJitterNs: number // flutter: rms of per-line random walk step
  tbWowNs: number // wow: slow sinusoidal wander amplitude
  underJitterDeg: number // color-under phase wander per line
  headSwitchShiftUs: number // horizontal shift after the head switch point
  trackAmt: number // VHS tracking error severity
  trackPos: number // tracking band vertical position, 0..1
  shuttleBars: number // picture-search track crossings per field (speed - 1)
  shuttlePhase: number // crossing pattern phase, in crossings
}

// Deterministic per-segment hash: a shuttle strip keeps its timing offset for
// as long as it persists on screen, unlike Math.random per frame.
function hash01(v: number) {
  let h = Math.imul(v ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export class LineState {
  readonly data = new Float32Array(LINES * 4)
  private flutter = 0
  private underWalk = 0
  private t = 0
  private lastFrame = -1
  private gen = 0
  // One transport per dub generation. A dub is a second deck playing the same
  // instant, so the generations must not share a wow — sharing one makes every
  // generation wander the same way and their offsets sum coherently, which is a
  // deeper wobble rather than the independent wander of another machine.
  private wows: Wow[] = []

  // `rand` is injectable, like ModState's and Wow's, so the per-line geometry
  // (shuttle strips, the tracking-band tear, the flutter walk) can be pinned in
  // tests instead of only ever being eyeballed.
  constructor(private rand: () => number = Math.random) {}

  // Returns the live `data` buffer, not a copy — consume it (upload, read)
  // before calling again, since the next frame overwrites it in place.
  //
  // Called once per dub generation within a frame, so `frame` is what marks
  // wall time passing: a second deck reading the same instant does not make the
  // scanner spin faster. Advancing `t` per call instead ran wow at dubGens
  // times its rate — 4x at the top of the range.
  update(c: LineStateControls, frame: number): Float32Array<ArrayBuffer> {
    if (frame === this.lastFrame) {
      this.gen += 1
    } else {
      this.lastFrame = frame
      this.gen = 0
      this.t += 1 / 60
    }
    const wow = this.wowFor(this.gen)
    wow.advance(1 / 60)
    for (let row = 0; row < LINES; row++) {
      // flutter: random walk with a restoring pull, advanced per line
      this.flutter +=
        (this.rand() - 0.5) * usToSamples(c.tbJitterNs * 1e-3) * 0.7
      this.flutter *= 0.995
      // wow: quasi-periodic wander of the rotating parts, never a naked sine
      const wander = usToSamples(c.tbWowNs * 1e-3) * wow.at(this.t, row / LINES)
      const headSwitched = row >= HEAD_SWITCH_LINE
      const hs = headSwitched ? usToSamples(c.headSwitchShiftUs) : 0

      // tracking band tear: lines near the mistracked band hook sideways,
      // strongest at the band center, with a little per-line jitter
      const trackCenter = c.trackPos * LINES
      const trackHalf = 3 + 18 * c.trackAmt
      const trackDist = Math.abs(row - trackCenter)
      const track =
        c.trackAmt > 0 && trackDist < trackHalf
          ? usToSamples(6 * c.trackAmt) *
            (1 - trackDist / trackHalf) *
            (0.6 + 0.8 * this.rand())
          : 0

      // picture search: each strip between crossing bars is a different
      // recorded track, with its own horizontal timing; lines nearest a
      // crossing hook into the bar as the RF fades out
      let shuttle = 0
      let shuttleHue = 0
      if (c.shuttleBars !== 0) {
        const ab = Math.abs(c.shuttleBars)
        const x = (row / LINES) * ab + c.shuttlePhase
        const k = Math.floor(x)
        const f = x - k
        const dLines = (Math.min(f, 1 - f) / ab) * LINES
        const half = 8
        shuttle =
          usToSamples(2.5) * (hash01(k) - 0.5) +
          (dLines < half
            ? usToSamples(4) * (1 - dLines / half) * (0.5 + this.rand())
            : 0)
        shuttleHue = 2.5 * (hash01(k ^ 0x3ac1) - 0.5)
      }

      // color-under playback carrier phase for this line: exact base phase
      // (computed in f64 — f32 cannot hold it) plus accumulated jitter walk
      const globalSample = (frame * LINES + row) * SAMPLES_PER_LINE
      const base = (DOWN_PER_SAMPLE * globalSample) % 1
      this.underWalk +=
        (this.rand() - 0.5) * ((c.underJitterDeg * Math.PI) / 180)
      this.underWalk *= 0.99

      const o = row * 4
      this.data[o] = this.flutter + wander + hs + track + shuttle
      this.data[o + 1] = base * 2 * Math.PI
      this.data[o + 2] = this.underWalk + (headSwitched ? 0.9 : 0) + shuttleHue
      this.data[o + 3] = this.rand()
    }
    return this.data
  }

  private wowFor(gen: number): Wow {
    while (this.wows.length <= gen) this.wows.push(new Wow(this.rand))
    return this.wows[gen]
  }
}

export { F_DOWN, DOWN_PER_SAMPLE }
