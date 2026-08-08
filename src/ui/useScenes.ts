import { useState } from 'react'

import { slotsToRoutings } from './modSlots'
import { presetControls } from './presets'
import { readRecord, writeJSON } from './storage'

import type { Controls } from '../controls'
import type { EngineApi } from '../gpu/engineapi'
import type { ModRouting } from './modSlots'
import type { ModSlotsApi } from './ModSlotsContext'
import type { RefObject } from 'react'

// Numbered performance snapshots (slots 1–9). localStorage is the source of
// truth so the mount-anchored key handlers never work from stale React state.
//
// A scene is the whole board, which now includes what is moving: with presets
// and links carrying motion, a scene that carried only controls would be the
// one recall that leaves the previous patch's LFOs running over the new look —
// mid-set, that reads as the app having lost track of itself.
export interface Scene {
  controls: Partial<Controls>
  mod: readonly ModRouting[]
}
export type SceneMap = Partial<Record<string, Scene>>
const SCENES_STORE = 'video_feedback_scenes'

// Scenes saved before motion was part of a look are a bare control map. They
// are read as "these controls, nothing moving" — which is what they were.
function readScene(raw: unknown): Scene | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const controls: unknown = 'controls' in raw ? raw.controls : raw
  if (typeof controls !== 'object' || controls === null) return undefined
  const mod: unknown = 'mod' in raw ? raw.mod : []
  return {
    controls,
    mod: Array.isArray(mod) ? mod : [],
  }
}

function loadScenes(): SceneMap {
  const stored = readRecord<Record<string, unknown>>(SCENES_STORE, {})
  return Object.fromEntries(
    Object.entries(stored).flatMap(([k, v]) => {
      const scene = readScene(v)
      return scene === undefined ? [] : [[k, scene]]
    }),
  )
}

// `land` rather than a plain write: a recall is the same gesture as a preset
// click — a whole board at once — so it arrives however the look bar says looks
// arrive, cut or morph. A scene *saved* mid-morph is deliberately the tween and
// not the destination: what the picture is doing when you press the key is the
// thing worth keeping, and half way between two scenes is a look no slot held.
export function useScenes(
  engineRef: RefObject<EngineApi | null>,
  land: (controls: Controls) => void,
  beforeRecall: () => void,
  mod: Pick<ModSlotsApi, 'slots' | 'setRoutings'>,
) {
  const [scenes, setScenes] = useState<SceneMap>(loadScenes)
  const persist = (next: SceneMap) => {
    writeJSON(SCENES_STORE, next)
    setScenes(next)
  }
  const saveScene = (n: number) => {
    const cur = engineRef.current?.getControls()
    if (cur !== undefined) {
      persist({
        ...loadScenes(),
        [n]: { controls: cur, mod: slotsToRoutings(mod.slots) },
      })
    }
  }
  const recallScene = (n: number) => {
    const scene = loadScenes()[n]
    if (scene !== undefined) {
      beforeRecall()
      land(presetControls(scene.controls))
      mod.setRoutings(scene.mod)
    }
  }
  const clearScene = (n: number) =>
    persist(
      Object.fromEntries(
        Object.entries(loadScenes()).filter(([k]) => k !== String(n)),
      ),
    )
  return { scenes, saveScene, recallScene, clearScene }
}
