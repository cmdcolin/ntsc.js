import { PASS_THROUGH } from '../signal/modstate'
import { sliderFor } from './controls'
import { useControlValue } from './ControlsContext'
import { cx } from './cx'
import { SYNC_DIVISIONS } from './midi'
import styles from './ModRowEditor.module.css'
import {
  EMPTY_SLOT,
  MOD_SOURCES,
  RATE_MAX,
  RATE_MIN,
  slotRate,
} from './modSlots'
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
export function ModRowEditor(props: {
  controlKey: ControlKey
  // Folds the editor away once there is nothing left to edit — the row owns
  // that flag, and remove is the one action here that ends the editor's subject.
  onDone: () => void
}) {
  const { slots, bpm, modFor, setSlotForKey, setSlotOn, cycleSyncForKey } =
    useModSlotsApi()
  // Above the early returns below, because it is a hook. The one control this
  // editor is about, so it subscribes to that key rather than to the whole set.
  const rest = useControlValue(props.controlKey)
  const key = props.controlKey
  const slot = modFor(key)
  const def = sliderFor(key)

  if (slot === null) {
    // Nothing drives this control and the bay has room, so the claim was never
    // made or has since been handed back — e.g. the Modulation section switched
    // this slot off from the other side. There is nothing to say and nothing to
    // edit; the busy note below would be a flat lie about a bay with free slots.
    if (slots.some(s => s.target === '')) {
      return null
    }
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
          // What it is running at, which is the tempo's business while the ♩ is
          // set. The dialed Hz underneath is untouched and comes back when the
          // lock does off — same as a clock-locked control row.
          value={slotRate(slot, bpm)}
          defaultValue={EMPTY_SLOT.rateHz}
          help="How fast this wobble cycles, in Hz. Slow rates drift the control the way a warming-up circuit does; fast ones buzz it per frame. Lock it to the beat with ♩ in the ⋮ menu."
          sync={{
            label:
              slot.syncDiv === undefined
                ? null
                : SYNC_DIVISIONS[slot.syncDiv].label,
            live: bpm !== null,
            onCycle: () => cycleSyncForKey(key),
          }}
          onChange={rateHz => setSlotForKey(key, { ...slot, rateHz })}
        />
      )}
      {/* Where the beat is coming from, said once, at the only place a lock can
          be thrown from without the tempo being on screen: the ♩ in this editor
          is three folds away from the Modulation section that holds the number
          it reads, so a rate locked from here would otherwise show a division
          and a Hz with nothing to say what put them together. */}
      {slot.syncDiv === undefined ? null : (
        <div className={ui.hint}>
          ♩{SYNC_DIVISIONS[slot.syncDiv].label} of{' '}
          {bpm === null ? 'a tempo not set yet' : `${bpm.toFixed(1)} BPM`} — the
          tempo is at the top of Modulation, below.
        </div>
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
          “{def.label}” is resting at the{' '}
          {clipped === 'down' ? 'bottom' : 'top'} of its range, so the swing
          only goes one way — move the slider toward the middle for a full
          wobble.
        </div>
      )}
      {/* The two kinds of off, side by side, which is the only place they are
          legible as a pair: hold it still and it comes back exactly as it is set
          here, remove it and the slot goes back to the bay. The ∿ on the row
          above is the same switch — this one is here because a reader who opened
          the editor to turn the wobble off should find it where they looked. */}
      <div className={styles.actions}>
        <button
          className={styles.action}
          title={
            slot.on
              ? `hold ${def.label} still, keeping this patch`
              : `start ${def.label} wobbling again`
          }
          onClick={() => setSlotOn(key, !slot.on)}
        >
          {slot.on ? '❚❚ hold still' : '▶ start again'}
        </button>
        <button
          className={cx(styles.action, styles.remove)}
          title={`stop modulating ${def.label} and hand the slot back`}
          onClick={() => {
            setSlotForKey(key, null)
            props.onDone()
          }}
        >
          remove
        </button>
      </div>
    </div>
  )
}
