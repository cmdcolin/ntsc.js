import { useState } from 'react'

import { DEFAULT_CONTROLS } from '../controls'
import { ALL_SLIDERS, VIEW_KEYS } from './controls'
import { EMPTY_HISTORY, record, stepBack, stepForward } from './history'
import { MUTATE_AMOUNTS, mutate } from './mutate'
import {
  blendMod,
  blendPresets,
  controlsEqual,
  presetControls,
  randomPresetMix,
} from './presets'

import type { Controls } from '../controls'
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
// Deliberately not persisted to scenes or the URL: those store resolved
// controls, which are version-stable, whereas a recipe binds to preset names and
// patches that drift as presets are retuned. A recalled look can still be
// re-mixed — startMix rebaselines from whatever is live.
export function useMix(args: {
  controls: Controls
  writeControls: (controls: Controls) => void
  sourceBOn: boolean
  mod: Pick<ModSlotsApi, 'slots' | 'setSlots' | 'setRoutings'>
}) {
  const { controls, writeControls, mod } = args
  const [lastPreset, setLastPreset] = useState<string | null>(null)
  const [history, setHistory] = useState<History<Look>>(EMPTY_HISTORY)
  const [mix, setMix] = useState<{ base: Controls; weights: PresetWeights }>(
    () => ({ base: DEFAULT_CONTROLS, weights: new Map() }),
  )

  // The weights only describe the look while nothing else has moved it. Once a
  // randomize, slider, MIDI or scene recall changes the controls, "how much of
  // preset X is in this" is unrecoverable — blendPresets sums each preset's
  // departures, so many recipes land on the same look. So the fills are shown
  // only while the live controls still equal what the mix produced; the instant
  // anything diverges they read empty rather than lie, and the next drag
  // rebaselines onto whatever is live (startMix). Modulation is not in that
  // list: it moves controls only inside the engine's own frame and restores
  // them, so a running LFO never invalidates a recipe.
  const mixed = blendPresets(mix.base, mix.weights)
  const weights = controlsEqual(controls, mixed) ? mix.weights : NO_WEIGHTS

  const live = (): Look => ({ controls, slots: mod.slots })

  // Every destructive path goes through here, so the walk covers all of them.
  const apply = (next: Controls) => {
    setHistory(h => record(h, live(), sameLook))
    writeControls(next)
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
        writeControls(presetControls(patch))
        setMix({ base: DEFAULT_CONTROLS, weights: new Map() })
        mod.setRoutings([])
      } else {
        // Clicking tops the preset up to full without clearing partials already
        // dialed in — the same as dragging its slider to 100%.
        const next = new Map(mix.weights).set(name, 1)
        writeControls(blendPresets(mix.base, next))
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
    // Anything outside the mix — a slider, MIDI, a scene recall — can have
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
    surprise: () => {
      const next = randomPresetMix(args.sourceBOn)
      // Where you are looking is yours, not part of the roll — same rule
      // mutate follows. A roll that reached "across the room" otherwise pulled
      // the picture back into a little set in a dark room, which reads as the
      // app having done something wrong rather than as a new look.
      const blended = blendPresets(DEFAULT_CONTROLS, next)
      for (const key of VIEW_KEYS) blended[key] = controls[key]
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
      apply(mutate(controls, MUTATE_SLIDERS, MUTATE_AMOUNTS[amount]))
      setLastPreset(null)
    },
    // The same roll aimed at one group, from its header. Jittering all ~120
    // controls answers "give me something else"; this answers "keep this look
    // and shake one circuit", which is how a patch actually gets dialed in.
    mutateGroup: (
      sliders: readonly SliderDef[],
      amount: MutateAmount = 'normal',
    ) => {
      apply(mutate(controls, sliders, MUTATE_AMOUNTS[amount]))
      setLastPreset(null)
    },
  }
}
