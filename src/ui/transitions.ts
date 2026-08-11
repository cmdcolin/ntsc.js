// The shelf: named transitions, as recipes over controls that already exist.
//
// The design is [`docs/EDITOR.md`](../../docs/EDITOR.md) › _Transitions_, and
// the premise is the whole project's: **you do not draw a wipe over the cut —
// you break something, cut while it is broken, and let it heal onto the new
// clip.** `signal/fault.ts` is the envelope that does the breaking; this is the
// list of what to break, which is the part with taste in it.
//
// **The domain decides what a transition reads as**, which is why the five
// below are five different things rather than one effect at five intensities.
// The three-way split is [`ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)'s —
// signal, sync, deflection — and the two tape entries come free because the
// deck's own damage is already a set of controls.
//
// No new uniforms, no new pass and no shader work: every value here is one a
// hand could dial, which is exactly what makes this cheap enough to be a table.
// What it costs instead is defaults — a fault big enough to hide a cut is a
// fault big enough to be unpleasant at the wrong duration — so the peaks below
// are chosen to be worth pressing rather than to show the range.

import type { Controls } from '../controls'
import type { FaultPlan } from '../signal/fault'

export const TRANSITION_NAMES = [
  'tracking',
  'roll',
  'collapse',
  'shuttle',
  'dub',
] as const
export type TransitionName = (typeof TRANSITION_NAMES)[number]

export interface Transition {
  name: TransitionName
  // What the button says. Lowercase, like every other deck button.
  label: string
  // What a *row card* says, where there is no room for the word.
  //
  // The deck has a button's width and uses `label`; a strip row has five other
  // chips beside it in 190px, and the words are long enough that "collapse"
  // pushed the ✕ off the end of the card, where `overflow: hidden` made it
  // unclickable. Measured at 203px of feet in a 190px card, and the card's own
  // `.field` rule already states the rule that broke: a control must not resize
  // under the pointer that is clicking it.
  //
  // So the card falls back on the idiom it already has — `.kind` draws a row's
  // filling as one glyph with the words in the `title` — and this is that glyph.
  // One character each, so stepping the ring cannot move the chips beside it.
  glyph: string
  // What it does, in the words the mechanism's own slider uses — this is a
  // title attribute, and the point of it is that somebody who has met the
  // control recognises it.
  title: string
  // The board at full depth. Only the controls the fault drives; everything
  // else stays wherever the hand and the bay left it.
  peak: Partial<Controls>
  // Where the swap lands, 0..1. See `FaultPlan.cut`.
  cut: number
  // How long it runs. **Per entry, not a rate control**, and that is the taste
  // call _Transitions_ says this shelf lives or dies on: a fault big enough to
  // hide a cut is a fault big enough to be unpleasant at the wrong duration, and
  // the right duration is a property of the mechanism rather than of the moment.
  // A raster takes about a second to collapse and reopen; three generations of
  // dub need longer than that to read as wear rather than as a glitch. One
  // thumbwheel over both would be a knob whose good setting changes with the
  // button next to it, which is the shape of a control nobody trusts.
  //
  // It also makes a bound MIDI pad fire exactly what the button fires, with no
  // deck-local state for a pad to be unable to see.
  seconds: number
}

// **`bGenlock` is deliberately absent from every recipe.** Whether the two
// sources are a clean genlocked crossfade or a dirty sum both fighting for lock
// is the most on-premise choice in the deck (`controls.ts` calls it "0 dirty
// sum .. 1 clean genlocked crossfade"), and a transition that forced it would be
// taking that choice away at the exact moment it is most interesting. The shelf
// breaks a domain; the mix path is the board's to say.
export const TRANSITIONS: readonly Transition[] = [
  {
    name: 'tracking',
    label: 'track',
    // The band of noise, as the waveform the mechanism is.
    glyph: '∿',
    title:
      'the head comes off track — a band of noise sweeps up the picture, the clip changes under it, and the band retreats',
    // The band travels as the fault deepens and retreats as it heals, because
    // both keys ride the one envelope: `trackPos` leaving its resting 0.85 for
    // the top of the frame *is* the sweep, and it comes back down on the way
    // out. One curve, and the mechanism does the rest.
    peak: { trackAmt: 1, trackPos: 0.12 },
    cut: 0.5,
    // Long enough for the band to be seen travelling, which is the whole
    // gesture — at half this it reads as a flash of noise.
    seconds: 1.5,
  },
  {
    name: 'roll',
    label: 'roll',
    // The picture travelling up the screen and round again.
    glyph: '↕',
    title:
      'the receiver loses its hold — the picture tears and rolls, the cut lands mid-roll, and the sync separator re-hunts onto the new source',
    // Three keys, and the third is the one this needed: `vHold` at 0 hands the
    // field to the receiver's own oscillator, but an oscillator free-running at
    // exactly 60 sits perfectly still, so letting it win changes nothing.
    // `vFreqHz` is what it wins *to* — the slider's own help says it "only
    // bites once vertical hold is loose enough to let the oscillator win", and
    // the first draft of this recipe was the half that does not bite.
    // `scripts/faultcheck.mjs` measured it at 0.4/255 from rest, which is a
    // transition that transitions nothing.
    //
    // `hHold` at its floor is the loose flywheel underneath: it drifts and
    // skews rather than snapping, so the rolling frame tears as it goes. What
    // makes this a transition rather than a mess is the part no recipe has to
    // write down — the PLL's lock age is engine state, so the re-hunt on the
    // way out is genuinely the set finding the new signal.
    peak: { hHold: 0.02, vHold: 0, vFreqHz: 50 },
    cut: 0.5,
    // The one that wants the least time. A picture that has been rolling for
    // two seconds has stopped being a transition and become a fault someone
    // needs to fix.
    seconds: 1,
  },
  {
    name: 'collapse',
    label: 'collapse',
    // The raster folded down to the one line a dying tube leaves.
    glyph: '▬',
    title:
      'the CRT power-cycle — the raster folds toward a line, the clip changes inside it, and the scan opens back out',
    // The one everybody recognises, and the reason it needs both keys: `vSize`
    // alone shrinks the picture tidily, and it is `hvSagUs` bending the scan on
    // the way down that makes it read as a supply failing rather than as a
    // zoom.
    peak: { vSize: 0.2, hvSagUs: -60, hvRing: 1 },
    cut: 0.5,
    // A tube takes about a second to let go and come back, and it is the one
    // entry where the audience already knows how long it should take.
    seconds: 1,
  },
  {
    name: 'shuttle',
    label: 'shuttle',
    // The transport running away, as the bars it sweeps through the frame.
    glyph: '≫',
    title:
      'the transport runs away — head-crossing bars sweep the frame, and the new clip is between them',
    peak: { shuttleX: 8 },
    cut: 0.5,
    seconds: 1.5,
  },
  {
    name: 'dub',
    label: 'dub',
    // Wear, as the only glyph on the shelf that is made of noise.
    glyph: '▩',
    title:
      'a copy of a copy — generations pile up, the new clip arrives already worn, and it cleans up',
    // **Generations compound damage; they do not invent it.** `dubGens` alone
    // runs the channel block four times over whatever the board is doing, and
    // on a clean board four times nothing is nothing — measured at 0.6/255 from
    // rest, which is the same failure `roll` had for its own reason. So the
    // recipe brings the tape's own faults with it and the generations multiply
    // them: each pass adds independent noise, its own dropouts and its own
    // timebase wander, which is exactly the mechanism `dubGens`' help
    // describes and the reason a third-generation dub falls apart faster than
    // one pass at triple the damage.
    peak: {
      dubGens: 4,
      tapeNoiseIre: 6,
      dropoutRate: 40,
      tbJitterNs: 500,
    },
    cut: 0.35,
    // The longest, because generation loss is cumulative rather than
    // instantaneous: the tape has to be seen getting worse and then better, and
    // a second is not enough frames of the channel block running four times for
    // either half to register.
    seconds: 2.5,
  },
]

// The plan a press hands the engine. Here rather than in the component because
// both surfaces that fire a transition — the shelf and a bound MIDI pad — have
// to hand over the same thing, and "the same thing" includes the frame count.
//
// `onCut` is the caller's, because what a cut *is* depends on where it came
// from: the shelf throws the deck's bar, and a rundown will swap the row's
// source. The fault is the same either way, which is the whole point of the
// shelf being a table.
export const faultPlan = (t: Transition, onCut: () => void): FaultPlan => ({
  peak: t.peak,
  // The sim's own rate, which is what `FaultPlan.frames` counts in.
  frames: Math.round(t.seconds * 60),
  cut: t.cut,
  onCut,
})

export const transitionOf = (name: string): Transition | undefined =>
  TRANSITIONS.find(t => t.name === name)
