import { cx } from './cx'
import { controlsEqual, presetControls } from './presets'
import { Section } from './Section'
import ui from './ui.module.css'

import type { Controls } from '../controls'

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

// Numbered snapshot slots for live sets: presets are authored looks, scenes
// are yours for tonight. Recall/save also ride the 1–9 keys (see app.tsx).
export function ScenesSection(props: {
  controls: Controls
  scenes: Partial<Record<string, Partial<Controls>>>
  onSave: (n: number) => void
  onRecall: (n: number) => void
  onClear: (n: number) => void
}) {
  return (
    <Section title="Scenes" defaultOpen={false}>
      {SLOTS.map(n => {
        const scene = props.scenes[n]
        const isActive =
          scene !== undefined &&
          controlsEqual(presetControls(scene), props.controls)
        return (
          <button
            key={n}
            className={cx(
              ui.btn,
              scene === undefined && ui.slotEmpty,
              isActive && ui.active,
            )}
            title={
              scene === undefined
                ? `save the current look to scene ${n}`
                : `scene ${n} — click to recall · shift+click to overwrite · alt+click to clear`
            }
            onClick={e => {
              if (scene === undefined || e.shiftKey) props.onSave(n)
              else if (e.altKey) props.onClear(n)
              else props.onRecall(n)
            }}
          >
            {n}
          </button>
        )
      })}
      <div className={ui.hint}>
        snapshots of the whole board — keys 1–9 recall · shift+1–9 save
      </div>
    </Section>
  )
}
