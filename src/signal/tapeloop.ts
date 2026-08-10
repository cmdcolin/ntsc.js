// The loop bin: one loop of tape threaded from the record head, round the path,
// back to the play head. Everything the CPU has to know about where that tape
// is — how far behind the play head is running right now, and when the splice
// next reaches it — lives here, so it is testable without a GPU.
//
// What separates this from a digital delay is that none of its numbers are set
// directly. The delay is a length of tape divided by the speed it is moving at,
// so wander in the capstan moves the delay *time*; and the loop having two ends
// joined means one point on it is a splice, which passes the head once per lap.

import { clamp, wrap } from '../math'
import {
  LINES,
  SAMPLES_PER_LINE,
  TAPE_FRAMES,
  TAPE_MM_PER_S,
} from './constants'
import { advanceCrossings } from './crossings'
import { Wow } from './noise'

const N = SAMPLES_PER_LINE * LINES
const FPS = 60

export interface TapeControls {
  tapeLoopMm: number // record head to play head, millimetres of tape
  tapeWowPct: number // capstan speed wander, percent
  tapeColourFrame: number // 1 = hold the delay on a subcarrier cycle
  tapeMix: number // the loop is out of circuit entirely at 0
  tapeRecord: number // 1 = the record head is down, 0 = lifted
  tapeTransport: number // 0 reverse, 1 stopped, 2 forward, 3 scrub back
  tapeShuttle: number // loop speed as a multiple of play; transport gives the sign
}

// Transport positions. `scrub` is appended rather than slotted in beside
// `reverse` so the three that shipped keep the values any saved link already
// holds — the list is a set of modes, not a number line.
export const TAPE_REVERSE = 0
export const TAPE_STOPPED = 1
export const TAPE_FORWARD = 2
export const TAPE_SCRUB = 3

export interface TapeUniforms {
  tapeSlot: number
  tapeDelayFrames: number
  tapeDelaySamples: number
  tapeSpliceFrames: number
  tapeSpliceRem: number
  tapeHoldSlot: number
  tapeHoldFrames: number
  tapeHoldRem: number
  tapeScrub: number
  tapeShuttleBars: number
  tapeShuttlePhase: number
}

// Whether anything is actually reaching the tape. The record head being down is
// not enough on its own — with the fader shut the loop is out of circuit and
// nothing is laid down either, and a window that kept advancing through that
// would leave the play heads reading tape nobody recorded. One definition, used
// both to gate the pass and to park the window.
export const tapeRecording = (c: {
  tapeMix: number
  tapeRecord: number
}): boolean => c.tapeMix !== 0 && c.tapeRecord >= 0.5

// Which way the tape is running, in frames of tape per frame of time. Laying
// tape down means the transport is going forward by definition — you cannot
// record into a loop you are pulling backwards through the heads — so the
// switch only means anything once the record head is up. Scrub runs backwards
// like reverse does; what differs is the drum, not the capstan.
const SPEEDS: Record<number, number> = {
  [TAPE_REVERSE]: -1,
  [TAPE_STOPPED]: 0,
  [TAPE_FORWARD]: 1,
  [TAPE_SCRUB]: -1,
}

// The transport switch supplies the sign, the shuttle the magnitude, exactly
// the way a deck has mode buttons and a wheel. Stopped is zero whatever the
// wheel says.
const transportSpeed = (c: TapeControls): number =>
  tapeRecording(c)
    ? 1
    : (SPEEDS[Math.round(c.tapeTransport)] ?? 1) * Math.max(0, c.tapeShuttle)

// Whether the head is reading in tape order instead of sweep order — the drum
// stalled while the capstan keeps pulling. Only reachable with the record head
// up, for the same reason the direction switch is.
const tapeScrubbing = (c: TapeControls): boolean =>
  !tapeRecording(c) && Math.round(c.tapeTransport) === TAPE_SCRUB

export class TapeState {
  private wow = new Wow()
  private t = 0 // transport time, seconds
  // Where the splice has got to along the tape path, measured from the record
  // head. It reaches a play head when it draws level with that head, so this
  // one number serves however many heads are in the path — see tape_play.wgsl.
  private splicePast = 0
  // The stretch of tape the heads are running over. While the record head is
  // down this is simply the tape being laid down now; once it lifts, the window
  // stays where it was and `holdPhase` walks the heads round it.
  private holdSlot = 0
  private holdPhase = 0
  private wasRecording = false
  // Where the track-crossing pattern has drifted to, in crossings. Same
  // quantity the deck keeps for `shuttleX` (Engine.advanceShuttle).
  private shuttlePhase = 0

  update(c: TapeControls, frame: number): TapeUniforms {
    const dt = 1 / FPS
    this.t += dt
    this.wow.advance(dt)
    const speed =
      TAPE_MM_PER_S * (1 + (c.tapeWowPct / 100) * this.wow.at(this.t, 0))
    // The play head cannot reach tape the record head has not written yet, and
    // it cannot reach past the far end of the bin: one frame to a full ring.
    let delay = clamp(
      (c.tapeLoopMm / Math.max(speed, 1e-3)) * FPS * N,
      N,
      TAPE_FRAMES * N,
    )
    // Colour framing. The subcarrier rides the same tape, so a delay of d
    // samples brings hue back rotated 90 degrees per sample — and a frame is
    // 477750 samples, which is 2 (mod 4), so consecutive frames of delay return
    // opposite hue. Rounding the delay onto a whole subcarrier cycle costs at
    // most 140 ns of picture shift and is what an edit controller is doing when
    // it insists on colour framing; leaving it off lets hue spin with the wow.
    if (c.tapeColourFrame >= 0.5) delay = Math.round(delay / 4) * 4

    // A lap is one trip round the loop, which is exactly the delay, and the
    // splice runs the path at one frame of tape per frame. Reporting where it
    // sits rather than when it next arrives is what lets several heads each
    // meet it at their own moment: a head at distance d sees the joint when
    // the splice has run that far. A loop is rarely a whole number of frames
    // long, so where that lands walks down the raster lap by lap.
    // The joint is a point on the tape, so it runs past the heads whichever way
    // the transport is going, and sits still when the transport does.
    const transport = transportSpeed(c)
    this.splicePast = wrap(this.splicePast, delay)
    const past = this.splicePast
    this.splicePast = wrap(past + transport * N, delay)

    // Lifting the record head does not stop the tape — it keeps circulating
    // over the same loop-length of oxide, so the heads have to wrap inside that
    // window rather than walk off the back of it into whatever the ring held
    // before. Parking the window on the current frame with zero phase while
    // recording makes one expression in the shader cover both cases.
    //
    // The window has to advance once more on the frame the head lifts, and this
    // is the easiest thing here to get wrong by one. `tapePlay` runs before
    // `tapeRec`, so while recording frame f the newest tape on the loop is
    // frame f-1 and the window ends there. By the time the head is up, frame f
    // has been laid down — so the base steps on one last time, or the window
    // closes just short of the newest tape and the last thing recorded is the
    // one thing that never plays back.
    //
    // Direction lives here and nowhere else. The heads read at `phase + n`, so
    // walking the phase backwards a frame at a time while `n` still runs
    // forward within each one is exactly a reversed transport under a scanner
    // that still sweeps the same way: frames come off in reverse order, each
    // one whole. Motion runs backwards and the picture stays a picture — which
    // is what reverse play on a helical machine actually looks like, as opposed
    // to dragging the tape backwards past a fixed head, which would time-
    // reverse the waveform itself and hand the set a mirrored line with its
    // sync on the wrong end.
    const slot = wrap(frame, TAPE_FRAMES)
    const recording = tapeRecording(c)
    if (recording || this.wasRecording) {
      this.holdSlot = slot
      this.holdPhase = 0
    } else {
      this.holdPhase = wrap(this.holdPhase + transport * N, delay)
    }
    this.wasRecording = recording

    // Off play speed the head stops following one track — the same mechanism
    // the program deck's shuttle runs on, and the same arithmetic, which is why
    // it lives in signal/crossings.ts rather than here. What is the loop's own
    // is where `bars` comes from: a transport that can be pulled backwards, so
    // reverse crosses two per sweep and is not clean either.
    const bars = transport - 1
    this.shuttlePhase = advanceCrossings(this.shuttlePhase, bars)

    const tapeDelayFrames = Math.floor(delay / N)
    const tapeSpliceFrames = Math.floor(past / N)
    const tapeHoldFrames = Math.floor(this.holdPhase / N)
    return {
      tapeSlot: slot,
      tapeScrub: tapeScrubbing(c) ? 1 : 0,
      tapeShuttleBars: bars,
      tapeShuttlePhase: this.shuttlePhase,
      tapeHoldSlot: this.holdSlot,
      tapeHoldFrames,
      tapeHoldRem: this.holdPhase - tapeHoldFrames * N,
      tapeDelayFrames,
      tapeDelaySamples: delay - tapeDelayFrames * N,
      tapeSpliceFrames,
      tapeSpliceRem: past - tapeSpliceFrames * N,
    }
  }
}
