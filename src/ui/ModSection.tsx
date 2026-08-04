import { PASS_THROUGH } from '../signal/modstate'
import { GROUPS } from './controls'
import { MOD_SOURCES, RATE_MAX, RATE_MIN, EMPTY_SLOT } from './modSlots'
import { useModSlotsApi } from './ModSlotsContext'
import { Section } from './Section'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import ui from './ui.module.css'

// Every slider is a bend point: flatten the groups into target options. The
// slider's range doubles as the modulation span, so depth stays meaningful
// across controls with wildly different units.
const TARGET_OPTIONS = [
  { value: '' as const, label: 'off' },
  ...GROUPS.flatMap(g =>
    g.sliders.map(s => ({ value: s.key, label: `${s.label} — ${g.name}` })),
  ),
]

// The whole bay, one row per slot. State, persistence and the push to the
// render loop all moved to useModSlots when motion stopped being this section's
// private business — presets carry it, links carry it, and any control row can
// claim a slot from its own ∿. What is left here is the view that shows all
// eight at once, which is still the only place to see the bay as a bay.
export function ModSection() {
  const { slots, active, setSlot } = useModSlotsApi()
  return (
    <Section title="Modulation" defaultOpen={false} dot={active.length > 0}>
      <div className={ui.hint}>
        LFOs, drift and the audio envelope wiggling any control around its
        slider setting — or press ∿ on any control row.
      </div>
      {slots.map((s, i) => (
        // Slots are positional identities (slot 1..8), so the index IS the key.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={i}>
          <SelectRow
            tag={String(i + 1)}
            title={`mod slot ${i + 1}`}
            value={s.target}
            options={TARGET_OPTIONS}
            onChange={target => setSlot(i, { target })}
          />
          {s.target === '' ? null : (
            <>
              <SelectRow
                tag="∿"
                title="modulation source"
                value={s.source}
                options={MOD_SOURCES}
                onChange={source => setSlot(i, { source })}
              />
              {PASS_THROUGH.has(s.source) ? null : (
                <Slider
                  label="rate"
                  unit="Hz"
                  min={RATE_MIN}
                  max={RATE_MAX}
                  step={0.02}
                  value={s.rateHz}
                  defaultValue={EMPTY_SLOT.rateHz}
                  help="How fast this slot's LFO cycles, in Hz. Slow rates drift the target control the way a warming-up circuit does; fast ones buzz it per-frame."
                  onChange={v => setSlot(i, { rateHz: v })}
                />
              )}
              <Slider
                label="depth (of slider range)"
                unit=""
                min={0}
                max={1}
                step={0.01}
                value={s.depth}
                defaultValue={EMPTY_SLOT.depth}
                help="How far the modulation swings the target, as a fraction of that control's own slider range. The resting slider position stays the centre, so presets and scenes still hold the look."
                onChange={v => setSlot(i, { depth: v })}
              />
            </>
          )}
        </div>
      ))}
    </Section>
  )
}
