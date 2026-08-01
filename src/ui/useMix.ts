import { useState } from 'react'

import { DEFAULT_CONTROLS } from '../controls'
import { ALL_SLIDERS } from './controls'
import { mutate } from './mutate'
import { PRESETS, blendPresets, controlsEqual, presetControls } from './presets'

import type { Controls } from '../controls'
import type { PresetWeights } from './presets'

// Stable empty weights, so a stale mix passes the same map every render.
const NO_WEIGHTS: PresetWeights = new Map()

// The look and how it got here: the preset mix, and one step of undo for the
// destructive applies (preset, scene recall, mutate, surprise). The engine owns
// the controls — this owns the recipe that produced them, kept only so a weight
// can be dragged back.
//
// Deliberately not persisted to scenes or the URL: those store resolved
// controls, which are version-stable, whereas a recipe binds to preset names and
// patches that drift as presets are retuned. A recalled look can still be
// re-mixed — startMix rebaselines from whatever is live.
export function useMix(args: {
  controls: Controls
  writeControls: (controls: Controls) => void
  sourceBOn: boolean
}) {
  const { controls, writeControls } = args
  const [lastPreset, setLastPreset] = useState<string | null>(null)
  const [undoSnapshot, setUndoSnapshot] = useState<Controls | null>(null)
  const [mix, setMix] = useState<{ base: Controls; weights: PresetWeights }>(
    () => ({ base: DEFAULT_CONTROLS, weights: new Map() }),
  )

  // The weights only describe the look while nothing else has moved it. Once a
  // randomize, slider, MIDI, mod, or scene recall changes the controls, "how
  // much of preset X is in this" is unrecoverable — blendPresets sums each
  // preset's departures, so many recipes land on the same look. So the fills are
  // shown only while the live controls still equal what the mix produced; the
  // instant anything diverges they read empty rather than lie, and the next drag
  // rebaselines onto whatever is live (startMix).
  const mixed = blendPresets(mix.base, mix.weights)
  const weights = controlsEqual(controls, mixed) ? mix.weights : NO_WEIGHTS

  const apply = (next: Controls) => {
    setUndoSnapshot(controls)
    writeControls(next)
  }

  return {
    weights,
    lastPreset,
    canUndo: undoSnapshot !== null,
    // Capture the live look before overwriting it, so undo can restore it.
    snapshotForUndo: () => setUndoSnapshot(controls),
    undo: () => {
      if (undoSnapshot !== null) {
        writeControls(undoSnapshot)
        setUndoSnapshot(null)
      }
    },
    applyPreset: (name: string, patch: Partial<Controls>) => {
      if (Object.keys(patch).length === 0) {
        // "clean" (the only empty patch) is the reset: wipe the mix to defaults.
        apply(presetControls(patch))
        setMix({ base: DEFAULT_CONTROLS, weights: new Map() })
      } else {
        // Clicking tops the preset up to full without clearing partials already
        // dialed in — the same as dragging its slider to 100%. startMix (fired
        // on pointer down) has already rebaselined onto the live look and
        // snapshotted undo, so this only adds the weight.
        const next = new Map(mix.weights).set(name, 1)
        writeControls(blendPresets(mix.base, next))
        setMix({ base: mix.base, weights: next })
      }
      setLastPreset(name)
    },
    // Anything outside the mix — a slider, MIDI, a mod slot, a scene recall —
    // can have moved the controls since the last weight change. Whatever is live
    // becomes the new baseline, so the next drag layers onto it instead of
    // silently reverting it.
    startMix: () => {
      if (!controlsEqual(controls, mixed)) {
        setMix({ base: controls, weights: new Map() })
      }
      setUndoSnapshot(controls)
    },
    setPresetWeight: (name: string, w: number) => {
      const next = new Map(mix.weights).set(name, w)
      writeControls(blendPresets(mix.base, next))
      setMix({ base: mix.base, weights: next })
      setLastPreset(name)
    },
    // A fresh look from the authored presets: one full preset plus one or two
    // partial ones from other groups, over clean defaults. Built through the mix
    // machinery so the chips show the recipe — each roll teaches what made it.
    surprise: () => {
      const pool = PRESETS.filter(
        p =>
          p.group !== 'Clean' && (args.sourceBOn || p.group !== 'A/B mixing'),
      )
      const groups = [...new Set(pool.map(p => p.group))].sort(
        () => Math.random() - 0.5,
      )
      const next = new Map<string, number>()
      groups.slice(0, 2 + Math.floor(Math.random() * 2)).forEach((g, i) => {
        const opts = pool.filter(p => p.group === g)
        const p = opts[Math.floor(Math.random() * opts.length)]
        next.set(p.name, i === 0 ? 1 : 0.3 + Math.random() * 0.5)
      })
      apply(blendPresets(DEFAULT_CONTROLS, next))
      setMix({ base: DEFAULT_CONTROLS, weights: next })
      setLastPreset(null)
    },
    mutateLook: () => {
      apply(mutate(controls, ALL_SLIDERS))
      setLastPreset(null)
    },
  }
}
