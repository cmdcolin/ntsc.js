import { PASS_THROUGH } from '../signal/modstate'
import { GROUPS } from './controls'
import { cx } from './cx'
import { SYNC_DIVISIONS } from './midi'
import {
  DEFAULT_STAB,
  MOD_SOURCES,
  RATE_MAX,
  RATE_MIN,
  EMPTY_SLOT,
  STAB_HZ_MAX,
  STAB_MS_MAX,
  STAB_MS_MIN,
  slotRate,
} from './modSlots'
import { useModSlotsApi } from './ModSlotsContext'
import { Section } from './Section'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import { TempoRow } from './TempoRow'
import ui from './ui.module.css'

import type { Tempo } from './useTempo'

// Every slider is a bend point: flatten the groups into target options. The
// slider's range doubles as the modulation span, so depth stays meaningful
// across controls with wildly different units.
const TARGET_OPTIONS = [
  { value: '' as const, label: 'off' },
  ...GROUPS.flatMap(g =>
    g.sliders.map(s => ({ value: s.key, label: `${s.label} — ${g.name}` })),
  ),
]

// The stab gate: the one thing in this section that is not a slot. It drives the
// whole board rather than one control, so there is nothing to point at a target —
// which is also why it needs no depth. Two numbers and the beat.
//
// Directly under the tempo row because that is what it wants most: "twice a
// second" is a musical statement, so the ♩ on the rate is the point rather than a
// refinement, and the row that provides the beat is right above it.
function StabRows() {
  const { stab, stabHz, setStab, cycleStabSync, bpm } = useModSlotsApi()
  return (
    <>
      <Slider
        label="stabs"
        unit="/s"
        min={0}
        max={STAB_HZ_MAX}
        step={0.1}
        // The resolved rate, so a clock lock reads as the rate it is running at —
        // the same thing a slot's rate row shows. The dialed Hz stays underneath.
        value={stabHz}
        defaultValue={DEFAULT_STAB.hz}
        help="Cuts the whole look out and pokes it back in, this many times a second — a clean picture with the fault stabbed into it, rather than the fault running continuously. 0 is off. What it does not do is fade: each stab is a hard cut to stock and back, so the picture between them is the clean signal, still carrying the phosphor trail and the feedback the last stab put there. The look itself is untouched — every slider stays where you left it, and so does where you are looking from. Lock it to the beat with ♩."
        sync={{
          label:
            stab.syncDiv === undefined
              ? null
              : SYNC_DIVISIONS[stab.syncDiv].label,
          live: bpm !== null,
          onCycle: cycleStabSync,
        }}
        onChange={hz => setStab({ ...stab, hz })}
      />
      {/* Hidden while the gate is off rather than sitting there inert: with no
          stabs there is nothing for a length to be the length of, and this
          section already asks a lot of a first read. */}
      {stab.hz === 0 ? null : (
        <Slider
          label="stab length"
          unit="ms"
          min={STAB_MS_MIN}
          max={STAB_MS_MAX}
          step={4}
          value={stab.ms}
          defaultValue={DEFAULT_STAB.ms}
          help="How long each stab of the look lasts. Milliseconds rather than a share of the gap, so changing the rate leaves the hit the same weight: 60ms is about four frames, short enough that the clean signal is what you are watching. Below one frame it is one frame — the stab still lands rather than being skipped."
          onChange={ms => setStab({ ...stab, ms })}
        />
      )}
    </>
  )
}

// The whole bay, one row per slot. State, persistence and the push to the
// render loop all moved to useModSlots when motion stopped being this section's
// private business — presets carry it, links carry it, and any control row can
// claim a slot from its own ∿. What is left here is the view that shows all
// eight at once, which is still the only place to see the bay as a bay.
export function ModSection(props: { tempo: Tempo }) {
  const { slots, bpm, setSlot, cycleSlotSync, stab, fire } = useModSlotsApi()
  // Whether anything in the bay is playable, which is what decides if the
  // fire-everything button is worth a row.
  const anyTrig = slots.some(s => s.target !== '' && s.source === 'trig')
  // Read off the bay itself, not off `active`: that list is scaled by the motion
  // amount, so freezing (amount 0) emptied it and the dot went out on a section
  // still holding eight routings. The dot says what is patched — the strip's own
  // ❚❚ says what is running — and it is the same rule the strip counts by.
  // The gate counts as patched: it is the one thing in here that moves the
  // picture without a slot, so a section showing no dot while the whole board is
  // being cut in and out four times a second would be the panel's most visible
  // effect with nothing anywhere pointing at where it lives.
  const patched = slots.some(s => s.target !== '' && s.depth > 0) || stab.hz > 0
  return (
    <Section title="Modulation" defaultOpen={false} dot={patched}>
      <div className={ui.hint}>
        LFOs, drift and the audio envelope wiggling any control around its
        slider setting — or press ∿ on any control row. The stabs below are the
        one that drives the whole board: it cuts the look out and pokes it back
        in on the beat.
      </div>
      {/* The beat every ♩ in the panel reads, at the top of the section whose
          rates are the ones most often locked to it. Here rather than in MIDI:
          that section only exists once a controller is wired up, and a tempo you
          tapped in yourself is exactly what a session with no MIDI at all
          needs. */}
      <TempoRow tempo={props.tempo} />
      {/* One key for the whole bay, above the slots rather than inside any of
          them: several envelopes at different decay rates fired together is one
          gesture, and hitting them one row at a time is not that gesture. */}
      {anyTrig ? (
        <button
          className={ui.btn}
          title="strike every one-shot envelope in the bay at once"
          onClick={() => fire()}
        >
          ⚡ fire all
        </button>
      ) : null}
      <StabRows />
      {slots.map((s, i) => (
        // Slots are positional identities (slot 1..8), so the index IS the key.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={i}>
          <SelectRow
            tag={String(i + 1)}
            title={`mod slot ${i + 1}`}
            value={s.target}
            options={TARGET_OPTIONS}
            // Switching a slot off restores its run switch too: the switch
            // belongs to a routing, and left thrown on an empty slot it would
            // park whatever got patched there next, with nothing on the row
            // that claimed it to say why it isn't moving.
            onChange={target =>
              setSlot(i, target === '' ? { target, on: true } : { target })
            }
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
                  // Tempo's business while ♩ is set; the dialed Hz stays put
                  // underneath and comes back when the lock cycles off.
                  value={slotRate(s, bpm)}
                  defaultValue={EMPTY_SLOT.rateHz}
                  help="How fast this slot's LFO cycles, in Hz. Slow rates drift the target control the way a warming-up circuit does; fast ones buzz it per-frame. Lock it to the beat with ♩ in the ⋮ menu."
                  sync={{
                    label:
                      s.syncDiv === undefined
                        ? null
                        : SYNC_DIVISIONS[s.syncDiv].label,
                    live: bpm !== null,
                    onCycle: () => cycleSlotSync(i),
                  }}
                  onChange={v => setSlot(i, { rateHz: v })}
                />
              )}
              {/* The only control in the bay you play rather than set. It has
                  to be next to the rate, because the rate is this envelope's
                  decay and the two are read together — press, watch it fall,
                  adjust, press again. */}
              {s.source === 'trig' ? (
                <button
                  className={ui.btn}
                  title={`strike slot ${i + 1}'s envelope`}
                  onClick={() => fire(i)}
                >
                  ⚡ fire
                </button>
              ) : null}
              <Slider
                label="depth (of slider range)"
                unit=""
                min={0}
                max={1}
                step={0.01}
                value={s.depth}
                defaultValue={EMPTY_SLOT.depth}
                help="How far the modulation swings the target, as a fraction of that control's own slider range. The resting slider position stays the centre, so presets and saved looks still hold the look."
                onChange={v => setSlot(i, { depth: v })}
              />
              {/* Per slot, because the master amount above is all of them at
                  once and "off, except that one" is the shape a set actually
                  wants. Everything the slot is patched with survives it — the
                  same switch the control row's ∿ throws. */}
              <button
                className={cx(ui.btn, !s.on && ui.slotEmpty)}
                title={
                  s.on
                    ? `hold slot ${i + 1} still, keeping what it is patched with`
                    : `start slot ${i + 1} again, as it is set`
                }
                onClick={() => setSlot(i, { on: !s.on })}
              >
                {s.on ? '❚❚ hold still' : '▶ start again'}
              </button>
            </>
          )}
        </div>
      ))}
    </Section>
  )
}
