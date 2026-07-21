import { useState } from 'react'

import { presetControls } from './presets'
import { readJSON, writeJSON } from './storage'

import type { Controls } from '../controls'
import type { Engine } from '../gpu/pipeline'
import type { RefObject } from 'react'

// Numbered performance snapshots (slots 1–9). localStorage is the source of
// truth so the mount-anchored key handlers never work from stale React state.
export type SceneMap = Partial<Record<string, Partial<Controls>>>
const SCENES_STORE = 'video_feedback_scenes'
const loadScenes = () => readJSON<SceneMap>(SCENES_STORE, {})

export function useScenes(
  engineRef: RefObject<Engine | null>,
  writeControls: (controls: Controls) => void,
  beforeRecall: () => void,
) {
  const [scenes, setScenes] = useState<SceneMap>(loadScenes)
  const persist = (next: SceneMap) => {
    writeJSON(SCENES_STORE, next)
    setScenes(next)
  }
  const saveScene = (n: number) => {
    const cur = engineRef.current?.getControls()
    if (cur !== undefined) persist({ ...loadScenes(), [n]: cur })
  }
  const recallScene = (n: number) => {
    const scene = loadScenes()[n]
    if (scene !== undefined) {
      beforeRecall()
      writeControls(presetControls(scene))
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
