// The arithmetic behind the deck — the panel's second organization of controls
// it already has, by gesture instead of by mechanism.
//
// Nothing here touches React or the store. What it encodes is the part that is
// easy to get subtly wrong: which control a single throw of the T-bar is
// actually driving, and how a shuttle's travel maps to tape speed. Both are
// decisions about the *signal path*, so they are testable statements rather
// than something buried in a pointer handler.

import { clamp01 } from '../math'

import type { Controls } from '../controls'

// A wipe pattern is selected, so the mixer's transition is a wipe rather than a
// dissolve. Rounded because wipeMode is an enum riding on a float uniform, and
// mix_b.wgsl tests it with the same `> 0.5` band.
export const wipeEngaged = (wipeMode: number) => wipeMode > 0.5

// What the deck is holding, for the box on the map to wear while it is shut —
// the count and the clause that says what the count counts, from one function
// and for the same reason bayLoad() is one (modSlots.ts): the two drawings would
// otherwise each write their own sentence about it.
//
// Not "controls off stock", which is the sentence every box on the *trunk*
// wears. Every control the deck touches already lights the stage that owns it —
// the wipe is Mix's, the tracking is Tape's, the hold is the view's — so a count
// of them here would be the same edits counted a second time on the same map.
// What has no other box to be counted on is the thing the deck is for: which
// gestures are currently doing something. A threaded loop and a held picture are
// facts about the take, and this is the one place that says both at once.
export interface DeckLoad {
  n: number
  // Reads as a clause on its own, because both drawings drop it into a sentence
  // of theirs. Empty when nothing is engaged, which is when neither draws it.
  say: string
}

export function deckLoad(c: Controls): DeckLoad {
  const live = [
    wipeEngaged(c.wipeMode) ? 'a wipe armed' : '',
    c.pipMix > 0 ? 'the inset up' : '',
    c.shuttleX !== 1 ? 'the tape off play' : '',
    c.tapeMix > 0 ? 'the loop threaded' : '',
    c.trackAmt > 0 ? 'the head off track' : '',
    c.timeScale === 0
      ? 'the picture held'
      : c.timeScale !== 1
        ? 'the picture slowed'
        : '',
  ].filter(s => s !== '')
  return {
    n: live.length,
    // Serial comma and a final "and", so three clauses read as a sentence
    // fragment rather than as a list of three things that might be two.
    say:
      live.length < 2
        ? (live[0] ?? '')
        : `${live.slice(0, -1).join(', ')} and ${live[live.length - 1]}`,
  }
}

// Where the bar is sitting, read off whichever control it is currently
// throwing. Not stored: the bar has no state of its own, so a preset, a MIDI
// knob or the slider row behind it all move it, and it can never disagree with
// the picture.
export const barPosition = (c: Controls) =>
  wipeEngaged(c.wipeMode) ? clamp01(c.wipePos) : clamp01(c.bGain)

// What one throw writes.
//
// With a pattern selected the bar is the wipe lever, which is the whole point
// of a switcher's transition-type buttons sitting next to it: the same hand
// movement dissolves or wipes depending on what is armed.
//
// With no pattern it is the crossfade — and which controls that means depends
// on the path. Genlocked, mix_b crossfades B over A with bGain alone and A is
// implied by (1 - bGain), so writing aGain there would move a control the
// shader does not read on that branch. On the dirty sum both gains are live on
// the summing bus, so a manual crossfade has to take A down as it brings B up;
// that is the fader move the stage was named for, and doing it from two sliders
// in the same group is what made it awkward.
export function barThrow(c: Controls, p: number): Controls {
  const pos = clamp01(p)
  if (wipeEngaged(c.wipeMode)) return { ...c, wipePos: pos }
  return c.bGenlock >= 0.5
    ? { ...c, bGain: pos }
    : { ...c, bGain: pos, aGain: 1 - pos }
}

// Throwing the bar to whichever end it is not at. The `cut` button's move, and
// the one a transition makes on its cut frame — one definition, so a fault that
// hides a cut and the button that makes one plainly cannot disagree about which
// way "the other end" is.
export const barCut = (c: Controls): Controls =>
  barThrow(c, barPosition(c) < 0.5 ? 1 : 0)

// The bar is throwing a wipe with B's fader shut. mix_b multiplies the wipe
// gate *into* bGain on both paths, so the boundary moves and nothing appears —
// the same "does nothing until…" situation a slider row states with a gate
// note, in the one spot the deck has to state it.
export const barInert = (c: Controls) => wipeEngaged(c.wipeMode) && c.bGain <= 0

// Where the far end of the throw lands the fader when the deck opens it: full
// B, which is what a wipe is asking for and where a dissolve ends.
export const B_ON_AIR = 1

// Shuttle travel.
//
// A deck's shuttle ring is not linear in speed. The first part of the throw is
// where the picture is still readable (play to double), and the far end is the
// screaming spool nobody parks on — a linear track spends four fifths of itself
// past 8x. Speed grows geometrically with the throw instead, so every equal
// nudge is an equal *ratio*, and the two directions are exact inverses so a
// value round-trips through the ring without creeping.
//
// Anchored at zero rather than at play: 0 is pause, a real detent on a real
// deck, and it is the one speed you want to be able to hit exactly.
const SHUTTLE_MAX = 32
const SHUTTLE_BASE = SHUTTLE_MAX + 1

export const travelToShuttle = (t: number) =>
  Math.sign(t) * (Math.pow(SHUTTLE_BASE, Math.abs(t)) - 1)

export const shuttleToTravel = (v: number) =>
  (Math.sign(v) * Math.log(Math.abs(v) + 1)) / Math.log(SHUTTLE_BASE)

// The speeds worth a button rather than a throw: review, pause, play, cue. Play
// is the one the ring springs back to, and it is the only one of the four that
// is not an artifact — off it the head crosses tracks and the noise bars start.
//
// Labelled as speeds and not as `◀◀ ❚❚ ▶ ▶▶`, which is what they were. The
// glyphs made this row a media transport, and it is not one: shuttleX is a
// signal control, the sweep rate of the spinning head, and what it produces off
// 1 is noise bars (`shuttleBars` in gpu/pipeline.ts). Nothing here plays or
// pauses anything. The damage was that `▶` sat lit in every fresh session —
// shuttleX rests at 1 — beside a source with no timeline at all, while the real
// playhead (Scrub/CueRow, under the source picker) looked less like a transport
// than this did. A number cannot make that claim: `1x` reads as the speed it is.
export const SHUTTLE_STOPS = [
  { value: -2, label: '-2x', title: 'review — twice play speed, backwards' },
  { value: 0, label: '0', title: 'stopped — the head re-reads one sweep' },
  {
    value: 1,
    label: '1x',
    title: 'play speed — the head tracks one recording, the picture is clean',
  },
  { value: 4, label: '4x', title: 'cue — four times play speed, forwards' },
]

// The loop bin's own deck: which way a held loop runs past the heads. Index is
// the value tapeTransport takes, so these are the same numbers the slider's
// `choices` are indexed by.
export const LOOP_TRANSPORT = ['◀◀', '❚❚', '▶', '≋']

// How long an auto-take runs, in seconds. Cycled rather than typed: a take is a
// performance gesture and these are the four durations a switcher's rate
// thumbwheel actually gets left on.
export const TAKE_SECONDS = [0.5, 1, 2, 4]

// Where an auto-take has got to. Split out so the easing is one statement
// rather than something read out of a rAF closure: a switcher's auto-take is a
// constant-rate throw of the bar, not an eased one — the lever moves at the
// speed the rate control sets and stops at the end of its travel.
export const takeAt = (
  from: number,
  to: number,
  elapsed: number,
  dur: number,
) => (dur <= 0 ? to : from + (to - from) * Math.min(1, elapsed / dur))
