import { useState } from 'react'

import { DEFAULT_CONTROLS } from '../controls'
import { ALL_SLIDERS, VIEW_KEYS } from './controls'
import { EMPTY_HISTORY, record, stepBack, stepForward } from './history'
import { morphTo } from './morph'
import { MUTATE_AMOUNTS, mutate } from './mutate'
import {
  blendMod,
  blendPresets,
  controlsEqual,
  presetControls,
  randomPresetMix,
} from './presets'

import type { Controls } from '../controls'
import type { GlidePlan } from '../signal/glide'
import type { SliderDef } from './controls'
import type { History } from './history'
import type { UiSlot } from './modSlots'
import type { ModSlotsApi } from './ModSlotsContext'
import type { MutateAmount } from './mutate'
import type { PresetWeights } from './presets'

// A whole look: where the controls rest, and what is moving them. Both, because
// undoing a preset that started an LFO has to stop the LFO too — otherwise the
// step back leaves the previous look with the new one's motion running on it.
interface Look {
  controls: Controls
  slots: readonly UiSlot[]
}

// Two looks are the same look when the controls match. The bay is deliberately
// not part of that test: modulation never moves a resting value, so a step
// whose only difference is a routing would otherwise be indistinguishable from
// no step at all, and every preset click would bank a duplicate entry.
const sameLook = (a: Look, b: Look) => controlsEqual(a.controls, b.controls)

// Stable empty weights, so a stale mix passes the same map every render.
const NO_WEIGHTS: PresetWeights = new Map()

// Mutate jitters the signal path, not where you're looking at it: the
// magnifier's zoom/pan stay put so a mutate never yanks the view. A jitter
// aimed at one group is exempt — it names what it moves, so if that group is
// the magnifier's, moving it is the point.
const MUTATE_SLIDERS = ALL_SLIDERS.filter(s => !VIEW_KEYS.has(s.key))

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
  // How long the verbs below take to arrive. 0 is a cut, which is what every one
  // of them used to be.
  morphSeconds: number
  sourceBOn: boolean
  mod: Pick<ModSlotsApi, 'slots' | 'setSlots' | 'setRoutings'>
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

  const live = (): Look => ({ controls: getControls(), slots: mod.slots })

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
  // The step banked is where the board was when the gesture started, morph or
  // not: undo takes back the whole journey, not the frame it had reached.
  const apply = (next: Controls) => {
    setHistory(h => record(h, live(), sameLook))
    land(next)
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
  // Controls are written synchronously and the bay lands on the next effect
  // flush — a bounded one-frame skew that modulation (additive and clamped)
  // absorbs, so this deliberately does not try to sequence the two.
  const goto = (out: { history: History<Look>; value: Look } | null) => {
    if (out !== null) {
      setHistory(out.history)
      writeControls(out.value.controls)
      mod.setSlots(out.value.slots)
    }
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
    // Capture the live look before overwriting it, so undo can restore it.
    snapshotForUndo: () => setHistory(h => record(h, live(), sameLook)),
    undo: () => goto(stepBack(history, live())),
    redo: () => goto(stepForward(history, live())),
    applyPreset: (name: string, patch: Partial<Controls>) => {
      // Recorded here rather than relying on the pointer-down that usually
      // precedes it: a chip activated from the keyboard fires a bare click, so
      // startMix never runs and the step went unrecorded — the one way to apply
      // a preset that could not be undone. Deduped against startMix's snapshot,
      // so the ordinary mouse path still banks exactly one step.
      setHistory(h => record(h, live(), sameLook))
      if (Object.keys(patch).length === 0) {
        // "clean" (the only empty patch) is the reset: wipe the mix to defaults
        // — and stillness is part of that, so this is the one place a preset
        // asserts an empty bay rather than staying silent about motion.
        land(presetControls(patch))
        setMix({ base: DEFAULT_CONTROLS, weights: new Map() })
        mod.setRoutings([])
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
      setHistory(h => record(h, live(), sameLook))
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
      if (drifted) setHistory(h => record(h, live(), sameLook))
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
      const next = randomPresetMix(args.sourceBOn)
      // Where you are looking is yours, not part of the roll — same rule
      // mutate follows. A roll that reached "across the room" otherwise pulled
      // the picture back into a little set in a dark room, which reads as the
      // app having done something wrong rather than as a new look.
      const blended = blendPresets(DEFAULT_CONTROLS, next)
      const now = getControls()
      for (const key of VIEW_KEYS) blended[key] = now[key]
      apply(blended)
      setMix({ base: DEFAULT_CONTROLS, weights: next })
      // A roll is a whole look, motion included — and a roll that lands on a
      // preset with no opinion about motion leaves what was patched running,
      // which is the same rule a click follows.
      const rolledMod = blendMod(next)
      if (rolledMod !== null) mod.setRoutings(rolledMod)
      setLastPreset(null)
    },
    mutateLook: (amount: MutateAmount = 'normal') => {
      apply(mutate(getControls(), MUTATE_SLIDERS, MUTATE_AMOUNTS[amount]))
      setLastPreset(null)
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
    mutateGroup: (
      sliders: readonly SliderDef[],
      amount: MutateAmount = 'normal',
    ) => {
      apply(mutate(getControls(), sliders, MUTATE_AMOUNTS[amount]))
      setLastPreset(null)
    },
  }
}
