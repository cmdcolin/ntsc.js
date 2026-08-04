import { PASS_THROUGH } from '../signal/modstate'
import { sliderFor } from './controls'
import { useControlsApi } from './ControlsContext'
import styles from './ModRowEditor.module.css'
import { EMPTY_SLOT, MOD_SOURCES, RATE_MAX, RATE_MIN } from './modSlots'
import { useModSlotsApi } from './ModSlotsContext'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import ui from './ui.module.css'

import type { ControlKey } from '../controls'

// What is driving one control, edited under its own row. An inline expansion
// rather than a popover: it has no positioning to get wrong, it works in the
// popout's own document, and it fits the ~300px column the wide bench gives a
// panel. The `needs` note under a gated row is the same shape, so the panel
// already reads this way.
export function ModRowEditor(props: { controlKey: ControlKey }) {
  const { slots, modFor, setSlotForKey } = useModSlotsApi()
  const { controls } = useControlsApi()
  const key = props.controlKey
  const slot = modFor(key)
  const def = sliderFor(key)

  if (slot === null) {
    // Every slot busy, and none of them this control's. Naming the holders
    // beats an auto-evict: the bay is small enough that quietly unpatching
    // someone else's routing to make room would be the surprise, not the fix.
    return (
      <div className={styles.editor}>
        <div className={ui.hint}>
          all {slots.length} modulation slots are busy — free one in Modulation
          below, or press ∿ on{' '}
          {slots
            .flatMap(s => (s.target === '' ? [] : [sliderFor(s.target).label]))
            .join(', ')}{' '}
          to take it back.
        </div>
      </div>
    )
  }

  // The engine adds the wave to the resting value and clamps to the control's
  // range, so a bipolar LFO around a slider already parked at one end spends
  // half its cycle pinned against it. That reads as "the wobble is broken"
  // unless something says otherwise; the fix is to move the slider, so the note
  // says which way. The audio followers are exempt — they only ever push one
  // way, which is what they are for.
  const rest = controls[key]
  const swing = slot.depth * (def.max - def.min)
  const clipped =
    PASS_THROUGH.has(slot.source) || swing === 0
      ? null
      : rest - swing < def.min
        ? 'down'
        : rest + swing > def.max
          ? 'up'
          : null

  return (
    <div className={styles.editor}>
      <SelectRow
        tag="∿"
        title="what drives this control"
        value={slot.source}
        options={MOD_SOURCES}
        onChange={source => setSlotForKey(key, { ...slot, source })}
      />
      {PASS_THROUGH.has(slot.source) ? null : (
        <Slider
          label="rate"
          unit="Hz"
          min={RATE_MIN}
          max={RATE_MAX}
          step={0.02}
          value={slot.rateHz}
          defaultValue={EMPTY_SLOT.rateHz}
          help="How fast this wobble cycles, in Hz. Slow rates drift the control the way a warming-up circuit does; fast ones buzz it per frame."
          onChange={rateHz => setSlotForKey(key, { ...slot, rateHz })}
        />
      )}
      <Slider
        label="depth"
        unit=""
        min={0}
        max={1}
        step={0.01}
        value={slot.depth}
        defaultValue={EMPTY_SLOT.depth}
        help="How far the wobble swings this control, as a fraction of its own slider range. The slider itself stays put — it is the centre the motion happens around, which is why a preset or a link still holds the look."
        onChange={depth => setSlotForKey(key, { ...slot, depth })}
      />
      {clipped === null ? null : (
        <div className={ui.hint}>
          “{def.label}” is resting at the {clipped === 'down' ? 'bottom' : 'top'}{' '}
          of its range, so the swing only goes one way — move the slider toward
          the middle for a full wobble.
        </div>
      )}
      <button
        className={styles.remove}
        title={`stop modulating ${def.label}`}
        onClick={() => setSlotForKey(key, null)}
      >
        remove
      </button>
    </div>
  )
}
