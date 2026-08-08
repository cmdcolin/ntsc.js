import { useState } from 'react'

import styles from './CommandPalette.module.css'
import { GROUPS } from './controls'
import { cx } from './cx'
import dlg from './dialog.module.css'
import { formatValue } from './format'
import { PRESETS, presetLabel } from './presets'
import { useModalDialog } from './useModalDialog'

import type { ControlKey, Controls } from '../controls'
import type { SliderDef } from './controls'
import type { PresetDef } from './presets'
import type { KeyboardEvent } from 'react'

export interface PaletteAction {
  name: string
  blurb: string
  run: () => void
}

type Item =
  | { kind: 'preset'; def: PresetDef }
  | { kind: 'control'; slider: SliderDef; group: string }
  | { kind: 'action'; action: PaletteAction }

// One flat index of everything reachable from the palette, built once at module
// load. Presets first so a bare query lands on a look rather than a knob.
const CONTROL_ITEMS: Item[] = GROUPS.flatMap(g =>
  g.sliders.map((slider): Item => ({ kind: 'control', slider, group: g.name })),
)
const PRESET_ITEMS: Item[] = PRESETS.map(def => ({ kind: 'preset', def }))

const MAX_RESULTS = 40

// Name match beats prose match, and an earlier hit in the name beats a later
// one, so typing "vhs" ranks the preset above the sliders that mention VHS.
function score(query: string, name: string, prose: string): number {
  const i = name.toLowerCase().indexOf(query)
  return i >= 0
    ? 1000 - i
    : prose.toLowerCase().includes(query)
      ? 100 - Math.min(99, prose.toLowerCase().indexOf(query) / 8)
      : -1
}

const itemName = (it: Item) =>
  it.kind === 'preset'
    ? presetLabel(it.def)
    : it.kind === 'control'
      ? it.slider.label
      : it.action.name

const itemProse = (it: Item) =>
  it.kind === 'preset'
    ? `${it.def.group} ${it.def.blurb}`
    : it.kind === 'control'
      ? `${it.group} ${it.slider.help}`
      : it.action.blurb

// A control's coarse nudge: 1% of its span for continuous knobs, one mode for
// discrete ones, snapped back onto the control's own step grid.
function nudge(s: SliderDef, value: number, dir: number): number {
  const delta =
    s.choices === undefined
      ? Math.max(s.step, Math.round((s.max - s.min) / 100 / s.step) * s.step)
      : 1
  const next = Math.round((value + dir * delta) / s.step) * s.step
  return Math.max(s.min, Math.min(s.max, next))
}

function readout(s: SliderDef, value: number): string {
  return s.choices === undefined
    ? `${formatValue(value, s.step)}${s.unit}`
    : (s.choices[Math.round(value)] ?? String(value))
}

export function CommandPalette(props: {
  controls: Controls
  actions: PaletteAction[]
  onApplyPreset: (name: string, patch: Partial<Controls>) => void
  onMixStart: () => void
  onWriteControl: (key: ControlKey, value: number) => void
  // Surfaces a control in the panel behind the palette by filtering to it —
  // every section force-opens while a filter is live, so this reaches controls
  // in collapsed stages and in the contextual A/B and audio sections alike.
  onRevealControl: (label: string) => void
  onClose: () => void
}) {
  const ref = useModalDialog()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const q = query.trim().toLowerCase()
  const pool = [
    ...PRESET_ITEMS,
    ...CONTROL_ITEMS,
    ...props.actions.map((action): Item => ({ kind: 'action', action })),
  ]
  const results =
    q === ''
      ? pool.filter(it => it.kind !== 'control').slice(0, MAX_RESULTS)
      : pool
          .map(it => ({ it, s: score(q, itemName(it), itemProse(it)) }))
          .filter(r => r.s >= 0)
          .toSorted((a, b) => b.s - a.s)
          .slice(0, MAX_RESULTS)
          .map(r => r.it)

  const selected =
    results.length === 0 ? null : results[Math.min(cursor, results.length - 1)]
  const choose = (it: Item) => {
    if (it.kind === 'preset') {
      props.onMixStart()
      props.onApplyPreset(it.def.name, it.def.patch)
      props.onClose()
    } else if (it.kind === 'action') {
      it.action.run()
      props.onClose()
    } else {
      props.onRevealControl(it.slider.label)
      props.onClose()
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const n = results.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => (n === 0 ? 0 : (Math.min(c, n - 1) + 1) % n))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => (n === 0 ? 0 : (Math.min(c, n - 1) + n - 1) % n))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selected !== null) choose(selected)
    } else if (
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      selected?.kind === 'control'
    ) {
      // Adjust without leaving: the picture is right there behind the palette.
      e.preventDefault()
      const s = selected.slider
      props.onWriteControl(
        s.key,
        nudge(s, props.controls[s.key], e.key === 'ArrowRight' ? 1 : -1),
      )
    }
  }

  return (
    <dialog
      ref={ref}
      className={cx(dlg.modal, styles.paletteModal)}
      aria-label="command palette"
      onCancel={props.onClose}
      onClick={e => {
        if (e.target === ref.current) props.onClose()
      }}
    >
      <div className={styles.paletteCard} onKeyDown={onKeyDown}>
        <input
          data-autofocus
          className={styles.paletteInput}
          type="text"
          placeholder="jump to a preset, control, or action…"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setCursor(0)
          }}
        />
        <div className={styles.paletteList}>
          {results.length === 0 ? (
            <div className={styles.paletteEmpty}>
              nothing matches “{query.trim()}”
            </div>
          ) : (
            results.map((it, i) => (
              <button
                key={`${it.kind}:${itemName(it)}`}
                className={cx(
                  styles.paletteRow,
                  it === selected && styles.paletteRowOn,
                )}
                // Movement, not entry: a pointer left resting over the list
                // would otherwise claim the cursor back from the arrow keys
                // every time the results re-rendered under it.
                onPointerMove={() => setCursor(i)}
                onClick={() => choose(it)}
              >
                <span className={styles.paletteKind}>
                  {it.kind === 'preset'
                    ? 'preset'
                    : it.kind === 'control'
                      ? 'control'
                      : 'action'}
                </span>
                <span className={styles.paletteName}>{itemName(it)}</span>
                <span className={styles.paletteSub}>
                  {it.kind === 'control' ? it.group : itemProse(it)}
                </span>
                {it.kind === 'control' ? (
                  <span className={styles.paletteValue}>
                    {readout(it.slider, props.controls[it.slider.key])}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className={styles.paletteFoot}>
          ↑↓ move · ↵ apply or jump · ←→ nudge a control live · esc close
        </div>
      </div>
    </dialog>
  )
}
