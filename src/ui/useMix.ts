import { useState } from 'react'

import { DEFAULT_CONTROLS } from '../controls'
import { MUTATE_CIRCUITS, MUTATE_SLIDERS } from './controls'
import { EMPTY_HISTORY, record, stepBack, stepForward } from './history'
import { DEFAULT_STAB, sameBay, sameGate } from './modSlots'
import { morphTo } from './morph'
import {
  MUTATE_AMOUNTS,
  SPIKE_TARGETS,
  crossover,
  mutate,
  spike,
} from './mutate'
import {
  blendMod,
  blendPresets,
  controlsEqual,
  randomPresetMix,
  randomSinglePreset,
  rollControls,
} from './presets'
import { rollBay } from './rollMod'

import type { Controls } from '../controls'
import type { GlidePlan } from '../signal/glide'
import type { SliderDef } from './controls'
import type { History } from './history'
import type { Stab, UiSlot } from './modSlots'
import type { ModSlotsApi } from './ModSlotsContext'
import type { MutateAmount } from './mutate'
import type { PresetWeights } from './presets'

// A whole look: where the controls rest, what is moving them, and the gate
// cutting the board in and out. All three, because undoing a preset that started
// an LFO has to stop the LFO too — otherwise the step back leaves the previous
// look with the new one's motion running on it — and because `reset` stops the
// stab gate, which is the one verb that can take a gate off the board.
interface Look {
  controls: Controls
  slots: readonly UiSlot[]
  stab: Stab
}

// Two looks are the same look when the controls match. The bay is deliberately
// not part of that test: modulation never moves a resting value, so a step
// whose only difference is a routing would otherwise be indistinguishable from
// no step at all, and every preset click would bank a duplicate entry.
const sameLook = (a: Look, b: Look) => controlsEqual(a.controls, b.controls)

// The same test with the bay counted, for the one verb that changes the bay and
// leaves every resting value alone. Under `sameLook` a motion roll banks
// nothing after the first — the controls have not moved, so the walk sees the
// step it already has — and the second roll would be unreachable.
//
// Deliberately only on that path rather than replacing `sameLook`: the reason
// the bay is out of the general test is recorded at it, and this is the
// exception it describes rather than a change of mind about it. The cost is at
// the seam — a preset clicked straight after a motion roll dedupes on controls
// and takes the rolled bay out of the walk with it — which is the shape every
// mixed comparator has and is cheaper than making every preset click carry a
// bay comparison it has no use for.
const sameLookAndBay = (a: Look, b: Look) =>
  sameLook(a, b) && sameBay(a.slots, b.slots)

// Everything a reset wipes, for the verb that wipes all of it: the gate counts
// here and nowhere else, since a board already at stock with the gate running is
// still a board the reset changes.
const sameBoard = (a: Look, b: Look) =>
  sameLookAndBay(a, b) && sameGate(a.stab, b.stab)

// Stable empty weights, so a stale mix passes the same map every render.
const NO_WEIGHTS: PresetWeights = new Map()

// `MUTATE_SLIDERS` — the signal path without the view — now lives in
// controls.ts, since a strip row's shake has to draw on the same list this does.
// A jitter aimed at one group is exempt and passes its own sliders: it names
// what it moves, so if that group is the magnifier's, moving it is the point.

// The look and how it got here: the preset mix, and the walk of looks behind
// the one on screen. The engine owns the controls — this owns the recipe that
// produced them, kept only so a weight can be dragged back.
//
// Deliberately not persisted to a saved look or the URL: those store resolved
// controls, which are version-stable, whereas a recipe binds to preset names and
// patches that drift as presets are retuned. A recalled look can still be
// re-mixed — startMix rebaselines from whatever is live.
export function useMix(args: {
  controls: Controls
  // The same controls, read at the moment a verb runs rather than closed over
  // from the render that built it. Two of the verbs below (`mutateGroup`,
  // `resetGroup`) are handed to every control row through ControlsApi, and a
  // verb that captures `controls` changes identity on every write — which puts
  // all 202 rows back on the write path. The render-time `controls` above is
  // still what the mix compares against, because that is a render-time question.
  getControls: () => Controls
  writeControls: (controls: Controls) => void
  // Hand a look to the engine to travel to over a span of seconds rather than
  // writing it. See signal/glide.ts and ui/morph.ts.
  startGlide: (plan: GlidePlan) => void
  // Where a morph already in flight is going, or null if none is. Only the walk
  // asks — see `banked`.
  getGlideTarget: () => Controls | null
  // How long the verbs below take to arrive. 0 is a cut, which is what every one
  // of them used to be.
  morphSeconds: number
  sourceBOn: boolean
  // `master` and its setter are here for the motion roll alone — see the freeze
  // it lifts there. The other verbs deliberately leave the amount where it is:
  // a preset is a statement about the look and the freeze is a gesture over it.
  // The gate is the other way round — a stab train is part of the look, so it
  // rides the walk with the slots and `reset` stops it.
  mod: Pick<
    ModSlotsApi,
    | 'slots'
    | 'setSlots'
    | 'setRoutings'
    | 'master'
    | 'setMaster'
    | 'stab'
    | 'setStab'
  >
}) {
  const { controls, getControls, writeControls, morphSeconds, mod } = args
  const [lastPreset, setLastPreset] = useState<string | null>(null)
  const [history, setHistory] = useState<History<Look>>(EMPTY_HISTORY)
  const [mix, setMix] = useState<{ base: Controls; weights: PresetWeights }>(
    () => ({ base: DEFAULT_CONTROLS, weights: new Map() }),
  )

  // The weights only describe the look while nothing else has moved it. Once a
  // randomize, slider, MIDI or saved-look recall changes the controls, "how much of
  // preset X is in this" is unrecoverable — blendPresets sums each preset's
  // departures, so many recipes land on the same look. So the fills are shown
  // only while the live controls still equal what the mix produced; the instant
  // anything diverges they read empty rather than lie, and the next drag
  // rebaselines onto whatever is live (startMix). Modulation is not in that
  // list: it moves controls only inside the engine's own frame and restores
  // them, so a running LFO never invalidates a recipe.
  const mixed = blendPresets(mix.base, mix.weights)
  const weights = controlsEqual(controls, mixed) ? mix.weights : NO_WEIGHTS

  // The look to bank: where the board has settled, or where a morph in flight is
  // taking it. The two differ only mid-morph, and there the destination is the
  // honest answer for everything the walk does — a tween is a frame, not a look.
  // Bank the frame and the look you were stepping out of is unreachable: redo
  // would land on an arbitrary point along the path to it, which is the one
  // thing a retraceable walk may not do. Same reason a mutate fired mid-morph
  // banks the preset that was still arriving rather than the frame it had got
  // to — undo then takes back the whole journey, which is what it always meant.
  //
  // Not the same as where a gesture *sets off from*: surprise and the mutates
  // read `getControls()` for that, deliberately, because chaining off the tween
  // is the point of a long morph.
  const banked = (): Look => ({
    controls: args.getGlideTarget() ?? getControls(),
    slots: mod.slots,
    stab: mod.stab,
  })

  // Where a look arrives. At `cut` this is the write it always was; at any other
  // duration the destination goes to the engine and the board travels there over
  // that many seconds (signal/glide.ts).
  //
  // The recipe is set by the caller either way and at once, not when the morph
  // lands — the fills already read empty whenever the live controls disagree
  // with the recipe, which mid-flight they do, so a morph shows no recipe while
  // it travels and fills it in on arrival. That is the honest reading: halfway to
  // a stack of three presets is not 100% of any of them.
  const land = (next: Controls) => {
    if (morphSeconds <= 0) writeControls(next)
    else args.startGlide(morphTo(next, morphSeconds))
  }

  // Every destructive path goes through here, so the walk covers all of them.
  const apply = (next: Controls) => {
    setHistory(h => record(h, banked(), sameLook))
    land(next)
  }

  // A rolled recipe onto the board: the look, the chips that explain it, and
  // the motion it asks for. Shared by the two whole-look rolls, which differ
  // only in the recipe they hand over — a stack of presets, or one of them.
  //
  // Where you are looking is yours, not part of the roll (`rollControls`) —
  // same rule mutate follows, and the same one the `?surprise` boot path
  // follows in useEngine. A roll that drew a view preset otherwise moved the
  // magnifier: 'nose against the glass' puts you up against the grain, and
  // 'across the room' (since removed) pulled the picture back into a little set
  // in a dark room. Either reads as the app having done something wrong rather
  // than as a new look.
  const landRecipe = (next: PresetWeights, preset: string | null) => {
    apply(rollControls(next, getControls()))
    setMix({ base: DEFAULT_CONTROLS, weights: next })
    // A roll is a whole look, motion included — and a roll that lands on a
    // preset with no opinion about motion leaves what was patched running,
    // which is the same rule a click follows.
    const rolledMod = blendMod(next)
    if (rolledMod !== null) mod.setRoutings(rolledMod)
    setLastPreset(preset)
  }

  // One preset's weight written onto a baseline. `base`/`from` are passed in
  // rather than read from `mix` because the MIDI path rebaselines and writes in
  // the same call, and a second setMix would only be the one that landed.
  const writeWeight = (
    name: string,
    w: number,
    base: Controls,
    from: PresetWeights,
  ) => {
    const next = new Map(from).set(name, w)
    writeControls(blendPresets(base, next))
    setMix({ base, weights: next })
    setLastPreset(name)
  }

  // Both directions are the same move: take the step the walk offers, if any.
  //
  // Through `land`, so a step back arrives however the look bar says looks
  // arrive. Undo is the verb this is least obviously right for — a take-back
  // wants to be instant — but the walk is a walk *through look space*, and at a
  // long morph the way back is as much worth watching as the way out was;
  // stepping back and forth over one boundary is the cheapest way to find where
  // it actually sits. At `cut` it is the write it always was.
  //
  // The bay still cuts, on the next effect flush: it led the controls by a frame
  // before and by the morph's length now, which is the same skew a preset click
  // has always had (applyPreset re-cables at once too). Modulation is additive
  // around whatever the controls are doing, so the new motion rides the morph
  // rather than fighting it.
  const goto = (out: { history: History<Look>; value: Look } | null) => {
    if (out !== null) {
      setHistory(out.history)
      land(out.value.controls)
      mod.setSlots(out.value.slots)
      mod.setStab(out.value.stab)
    }
  }

  // Stock, and nothing running: the controls, the recipe, the bay and the gate.
  // Without the step it records, which its two callers each own — the button
  // banks one, and the "clean" chip is already inside `applyPreset`'s.
  //
  // The gate is the part a reset used to leave behind, and it was the loudest
  // thing it could leave: the chip put every slider back to stock and the board
  // carried on cutting to it several times a second, so the one verb that
  // promises a still picture was the one verb that could not deliver it.
  //
  // The motion amount stays where it is, deliberately — with the bay empty there
  // is nothing left for it to scale, and a freeze is a gesture within a set
  // rather than a setting the board holds (the same rule the motion roll and a
  // fresh claim follow, from the other side).
  const toStock = () => {
    // A roll of nothing at all, which is what stock is — and it goes through
    // `rollControls` for the rule that function owns: the view comes back from
    // where you are looking rather than from the destination. A reset was the
    // last way left in the app to lose a magnifier you had aimed, and it only
    // did it at `morph: cut`, since every other duration holds the view keys
    // back (`morphTo`) — so what the button did to your view depended on a
    // setting about how long looks take to arrive.
    land(rollControls(NO_WEIGHTS, getControls()))
    setMix({ base: DEFAULT_CONTROLS, weights: new Map() })
    mod.setRoutings([])
    mod.setStab(DEFAULT_STAB)
    setLastPreset('clean')
  }

  return {
    weights,
    lastPreset,
    // Handed out so a saved-look recall arrives the same way a preset does — it
    // is the same gesture (a whole board, at once), and the number keys over the
    // library are where a live set actually does it from. It records nothing: a recall
    // already banks its own step through `snapshotForUndo`.
    landLook: land,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    // Bank the look on the board before overwriting it, so undo can restore it.
    snapshotForUndo: () => setHistory(h => record(h, banked(), sameLook)),
    undo: () => goto(stepBack(history, banked())),
    redo: () => goto(stepForward(history, banked())),
    applyPreset: (name: string, patch: Partial<Controls>) => {
      // Recorded here rather than relying on the pointer-down that usually
      // precedes it: a chip activated from the keyboard fires a bare click, so
      // startMix never runs and the step went unrecorded — the one way to apply
      // a preset that could not be undone. Deduped against startMix's snapshot,
      // so the ordinary mouse path still banks exactly one step.
      setHistory(h => record(h, banked(), sameLook))
      if (Object.keys(patch).length === 0) {
        // "clean" is the only empty patch, and it is the reset — the same one
        // the look bar's button presses, so the chip and the button cannot come
        // to mean two different amounts of stock.
        toStock()
      } else {
        // Clicking tops the preset up to full without clearing partials already
        // dialed in — the same as dragging its slider to 100%.
        const next = new Map(mix.weights).set(name, 1)
        land(blendPresets(mix.base, next))
        setMix({ base: mix.base, weights: next })
        // Motion changes on a whole-preset apply only — this, surprise, and a
        // link. Dragging a chip is a partial statement about the controls, and
        // a bay is not partial: re-cabling it on every pointer step of a drag
        // would destroy hand-patched routings the drag never mentioned.
        const nextMod = blendMod(next)
        if (nextMod !== null) mod.setRoutings(nextMod)
      }
      setLastPreset(name)
    },
    // Anything outside the mix — a slider, MIDI, a saved-look recall — can have
    // moved the controls since the last weight change. Whatever is live becomes
    // the new baseline, so the next drag layers onto it instead of silently
    // reverting it.
    startMix: () => {
      if (!controlsEqual(controls, mixed)) {
        setMix({ base: controls, weights: new Map() })
      }
      setHistory(h => record(h, banked(), sameLook))
    },
    setPresetWeight: (name: string, w: number) =>
      writeWeight(name, w, mix.base, mix.weights),
    // The same fader under a knob. A knob has no press to rebaseline on, so the
    // drift check startMix does on pointer-down happens here instead, on
    // whichever message first finds the look moved out from under the mix — and
    // the walk is recorded only there, so a sweep banks one step to undo rather
    // than one per MIDI message.
    midiPresetWeight: (name: string, w: number) => {
      const drifted = !controlsEqual(controls, mixed)
      if (drifted) setHistory(h => record(h, banked(), sameLook))
      writeWeight(
        name,
        w,
        drifted ? controls : mix.base,
        drifted ? NO_WEIGHTS : mix.weights,
      )
    },
    // A fresh look from the authored presets: one full preset plus one or two
    // partial ones from other groups, over clean defaults. Built through the mix
    // machinery so the chips show the recipe — each roll teaches what made it.
    //
    // The verb a morph does the most for, because it is the one that gets hit
    // repeatedly: rolls chain. The engine takes its origin from wherever the
    // board actually is (startGlide), so hitting this again mid-flight sets off
    // from the tween rather than snapping back and starting over — hold the
    // button down at 8s and the look wanders continuously through the space
    // between the authored presets, which is where the ones worth keeping are.
    surprise: () => {
      landRecipe(randomPresetMix(args.sourceBOn), null)
    },
    // The same landing, one authored preset in it. `lastPreset` is the name
    // rather than null because here it is true: the board *is* that preset, so
    // the chip lights up as its own and the caption says which look you are
    // looking at — which is most of what this roll is for.
    surpriseOne: () => {
      const next = randomSinglePreset(args.sourceBOn)
      landRecipe(next, next.keys().next().value ?? null)
    },
    // Sparse and hard, where `mutateLook` is dense and soft. See `spike`.
    spikeLook: (amount: MutateAmount = 'normal') => {
      apply(spike(getControls(), MUTATE_SLIDERS, SPIKE_TARGETS[amount]))
      setLastPreset(null)
    },
    // The look on the board crossed with a fresh roll, circuit by circuit.
    //
    // Not through `landRecipe`, and it must not be: only some of the recipe
    // landed, so the chips would be describing presets whose controls are not
    // on the board. The fills read empty by themselves once the live controls
    // disagree with the mix, and leaving `mix` alone is what says the honest
    // thing — there is no recipe for this look, because it is half of one and
    // half of whatever you had.
    crossLook: () => {
      const recipe = randomPresetMix(args.sourceBOn)
      const from = getControls()
      apply(crossover(from, rollControls(recipe, from), MUTATE_CIRCUITS))
      setLastPreset(null)
    },
    mutateLook: (amount: MutateAmount = 'normal') => {
      apply(mutate(getControls(), MUTATE_SLIDERS, MUTATE_AMOUNTS[amount]))
      setLastPreset(null)
    },
    // The third roll: what is *moving*, rather than where the board rests. See
    // rollMod.ts for how a target and a depth are picked; what belongs here is
    // what it does to everything else, which is almost nothing.
    //
    // Not through `apply`, and that is the point of it being its own verb: no
    // resting value changes, so there is nothing to land and nothing to morph.
    // The recipe survives for the same reason — a routing leaves the slider
    // where it is, so the preset chips are still telling the truth about the
    // look and `lastPreset` is still the preset it came from. This is the only
    // roll in the row that can be pressed without losing what the fills say.
    //
    // `MUTATE_SLIDERS` rather than every control: a rolled routing must not
    // reach the view, on the rule VIEW_KEYS is drawn for — and a modulated
    // `timeScale` would present as the dead rendering step of ADR 0004.
    rollMotion: (
      amount: MutateAmount = 'normal',
      opts: { audioLive?: boolean } = {},
    ) => {
      setHistory(h => record(h, banked(), sameLookAndBay))
      mod.setSlots(
        rollBay({
          amount,
          sliders: MUTATE_SLIDERS,
          controls: getControls(),
          audioLive: opts.audioLive === true,
        }),
      )
      // The same rule a claim from a control row's ∿ follows, and this button
      // needs it most: rolling motion onto a frozen bay would cable five slots,
      // light five rows up as driven, and move nothing whatsoever. Asking for
      // motion is unambiguous; the freeze is a gesture within a set.
      if (mod.master === 0) mod.setMaster(1)
    },
    // The whole board back to stock, from the look bar. The same verb as the
    // "clean" chip, up where it can be reached without opening a section and
    // finding one chip among seventy — which is the reason a session that had
    // wandered somewhere unusable used to reload the page, and a reload throws
    // away the walk that could have taken it back.
    //
    // Undoable like everything else the bar does, and the gate is why the walk
    // now banks one: a reset is the only gesture that stops a stab train, so
    // without it in the step, ctrl+z came back to the look with the gate gone.
    reset: () => {
      setHistory(h => record(h, banked(), sameBoard))
      toStock()
    },
    // One circuit back to stock, from its header. The row-level ↺ is the fine
    // move and "clean" is the whole board; between them sat the thing a session
    // actually wants after a bad detour — put *this stage* back and keep the
    // rest of the look. Through `apply`, so it is one step on the walk: a
    // gesture that can wipe twenty controls has to be one ctrl+z to take back.
    resetGroup: (sliders: readonly SliderDef[]) => {
      const next = { ...getControls() }
      for (const s of sliders) next[s.key] = DEFAULT_CONTROLS[s.key]
      apply(next)
    },
    // The same roll aimed at one group, from its header. Jittering all ~120
    // controls answers "give me something else"; this answers "keep this look
    // and shake one circuit", which is how a patch actually gets dialed in.
    //
    // Every slider in the circuit, resting or not (`wake: 1`) — the opposite of
    // what the bar's nudge does, and for the reason it does it: the bar is
    // rolling the whole rig and has to leave most of it alone to stay a nudge,
    // where pressing the die on a stage names that stage. One sitting at stock
    // would otherwise take the press and do nothing at all.
    mutateGroup: (
      sliders: readonly SliderDef[],
      amount: MutateAmount = 'normal',
    ) => {
      apply(
        mutate(getControls(), sliders, MUTATE_AMOUNTS[amount], Math.random, 1),
      )
      setLastPreset(null)
    },
  }
}
