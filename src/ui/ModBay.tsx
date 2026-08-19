import { useState } from 'react'

import { PASS_THROUGH } from '../signal/modstate'
import { cx } from './cx'
import { SYNC_DIVISIONS } from './midi'
import styles from './ModBay.module.css'
import { ModRowEditor } from './ModRowEditor'
import {
  bayKeyFor,
  isBayKey,
  targetLabel,
  DEFAULT_DUTY,
  DEFAULT_STAB,
  DUTY_MAX,
  DUTY_MIN,
  MOD_SOURCES,
  RATE_MAX,
  RATE_MIN,
  EMPTY_SLOT,
  STAB_HZ_MAX,
  STAB_MS_MAX,
  STAB_MS_MIN,
  gateFlips,
  slotRate,
} from './modSlots'
import { useModSlotsApi } from './ModSlotsContext'
import { groupOf, stageOf } from './placement'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import { TempoRow } from './TempoRow'
import ui from './ui.module.css'

import type { BayField, ModTarget } from '../controls'
import type { UiSlot } from './modSlots'
import type { Tempo } from './useTempo'

// The stab gate: the one thing in this section that is not a slot. It drives the
// whole board rather than one control, so there is nothing to point at a target —
// which is also why it needs no depth. Two numbers, the beat, and what is at the
// far end of it.
//
// Directly under the tempo row because that is what it wants most: "twice a
// second" is a musical statement, so the ♩ on the rate is the point rather than a
// refinement, and the row that provides the beat is right above it.
//
// Every row here says one of two things depending on whether a look is held at
// the far end, because the gate is genuinely two features and they want
// different words and a different length. Written as one component rather than
// two, so the state a hold puts the gate into cannot drift from the state a drop
// takes it out of — and because the rate row is the same row either way.
function StabRows() {
  const { stab, stabHz, setStab, cycleStabSync, holdLook, dropLook, bpm } =
    useModSlotsApi()
  const flips = gateFlips(stab)
  return (
    <>
      <Slider
        label={flips ? 'flips' : 'stabs'}
        unit="/s"
        min={0}
        max={STAB_HZ_MAX}
        step={0.1}
        // The resolved rate, so a clock lock reads as the rate it is running at —
        // the same thing a slot's rate row shows. The dialed Hz stays underneath.
        value={stabHz}
        defaultValue={DEFAULT_STAB.hz}
        help={
          flips
            ? 'Cuts the whole board between the look you are dialing and the one you held, this many times a second. 0 is off. It does not fade: each side arrives as a hard cut, which is the only version of this the signal path can afford — a fade would redesign the filter bank every frame, where a flip does it twice a cycle. Everything with memory runs straight through the flip, so the phosphor trail and the feedback each side leaves are still there when the other one lands. Lock it to the beat with ♩.'
            : 'Cuts the whole look out and pokes it back in, this many times a second — a clean picture with the fault stabbed into it, rather than the fault running continuously. 0 is off. What it does not do is fade: each stab is a hard cut to stock and back, so the picture between them is the clean signal, still carrying the phosphor trail and the feedback the last stab put there. The look itself is untouched — every slider stays where you left it, and so does where you are looking from. Lock it to the beat with ♩.'
        }
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
      {stab.hz === 0 ? null : flips ? (
        /* A share of the cycle rather than a length in ms, because the two ends
           of a flip are peers and what a set wants to hold still across a tempo
           change is the ratio — PulsePlan.duty carries the whole argument. */
        <Slider
          label="live look's share"
          unit="%"
          min={DUTY_MIN * 100}
          max={DUTY_MAX * 100}
          step={1}
          value={(stab.duty ?? DEFAULT_DUTY) * 100}
          defaultValue={DEFAULT_DUTY * 100}
          help="How much of each cycle sits on the look you are dialing, with the held one taking the rest. A share rather than a length, so dialing the rate or changing the tempo leaves the split where you put it: at 50 the two get equal time, and pushing it either way makes one look the state and the other the interruption — which at the far end is the same gesture as a stab, with your own look in place of clean."
          onChange={pct => setStab({ ...stab, duty: pct / 100 })}
        />
      ) : (
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
      <FarEnd
        flips={flips}
        // Whether it is actually cutting, which the sentence below has to know:
        // a look can be held with the rate still at 0, and "flipping against a
        // held look" over a still picture is the bay claiming something the
        // screen plainly is not doing. The dialed rate rather than the resolved
        // one, so the freeze reads as a freeze and not as a gate that was never
        // set up — the strip above is where ❚❚ is explained and undone.
        running={stab.hz > 0}
        onHold={holdLook}
        onDrop={dropLook}
      />
    </>
  )
}

// What sits at the far end of the gate, and the one gesture that changes it.
//
// A button rather than a picker, and that is the design decision worth stating:
// the look you want to flip against is almost always the one you were just
// looking at, so the gesture is "hold this" — dial a look, hold it, dial the
// other one against it. A dropdown could only ever offer what somebody else
// authored, and every preset is reachable this way anyway, by clicking the chip
// and then holding it.
//
// It reads as a statement about the gate rather than as a control, because that
// is what it is: one line saying which of two things this gate is doing, with
// the way to change it on the end of it.
function FarEnd(props: {
  flips: boolean
  running: boolean
  onHold: () => void
  onDrop: () => void
}) {
  return (
    <>
      <div className={ui.hint}>
        {!props.flips
          ? 'The far end is stock, so each stab pokes a clean picture through. Hold a look there and the gate cuts between the two instead.'
          : props.running
            ? 'Cutting against a held look. The sliders are still the live one — the held look is a copy, and nothing you do here moves it.'
            : 'A look is held at the far end, and the rate above is at 0 — set it and the board starts cutting between the two.'}
      </div>
      <div className={styles.farEnd}>
        <button
          className={ui.btn}
          title={
            props.flips
              ? 'replace the held look with the one on screen now'
              : 'hold the look on screen now at the far end of the gate — then dial a different one and the gate cuts between them'
          }
          onClick={props.onHold}
        >
          {props.flips ? '⧉ re-hold this look' : '⧉ hold this look'}
        </button>
        {!props.flips ? null : (
          <button
            className={cx(ui.btn, styles.dropHeld)}
            title="drop the held look and go back to stabbing stock — the rate and the beat lock stay"
            onClick={props.onDrop}
          >
            × drop
          </button>
        )}
      </div>
    </>
  )
}

// The head of a patched slot: its number, what it is driving, and the way to
// hand it back.
//
// This replaced a dropdown of every slider in the app — 273 options in one
// flat `<select>`, labelled "control — module" because nothing else could tell
// two `gain`s apart. It was the panel's one surface that flattened the chain
// into an alphabetical list, and it was a second route to a choice the chain
// already makes better: a control row's own ∿ claims a free slot, so the target
// is picked at the control it drives, where you are already looking at it.
//
// So the name here is a readout and a way back rather than a picker. It opens
// the module the control lives in, which is the same jump "This look"'s captions
// make and for the same reason — a routing you cannot find the row for is a
// wobble with no way to tune what it is wobbling.
//
// "driving" is in front of the name because the name alone does not say what
// kind of thing it is. `bend amount — Deflection` reads as a slot caption unless
// you already know the panel well enough to recognise a slider by name, which is
// exactly the reader who most needs the bay to explain itself — and the row gave
// them a bare noun phrase with no verb and no chrome. One dim word fixes the
// half the styling cannot: the name is now the object of a sentence rather than
// a heading over the rows below it.
function SlotHead(props: {
  // 1-based, as the bay numbers its slots.
  n: number
  target: ModTarget
  // The stages that will actually open right now. A branch with nothing patched
  // into it opens onto nothing, and a look carried in from a preset or a link
  // can hold a routing into one — so this is a live question, not a property of
  // the table. Same guard as LookSection's captions.
  openStages: ReadonlySet<string>
  onOpenGroup: (stage: string, group: string) => void
  onRemove: () => void
}) {
  // A wire onto another wire names a knob in this same bay, so there is no
  // module to open and no ambiguity to resolve: "slot 3 depth" is already the
  // whole address, and the row it names is a few lines up or down this list.
  const group = isBayKey(props.target) ? undefined : groupOf(props.target)
  const stage = group === undefined ? null : stageOf(group)
  const name = targetLabel(props.target)
  // "control — module", the same pair the dropdown's options carried: the
  // control name alone is ambiguous across 273 of them, and the module is also
  // the thing the button opens.
  const label = group === undefined ? name : `${name} — ${group.name}`
  return (
    <div className={styles.slotHead}>
      <span className={styles.tag} title={`mod slot ${props.n}`}>
        {props.n}
      </span>
      {/* Not a label for the row — a verb, so the name after it reads as the
          control it names. Quiet enough (fg4, like every other word in the panel
          that is grammar rather than a value) that a reader who already knows
          what a slot head says skips straight over it to the name. */}
      <span className={styles.driving}>driving</span>
      {group !== undefined && stage !== null && props.openStages.has(stage) ? (
        <button
          className={styles.target}
          title={`open ${group.name} in the ${stage} stage — the row this slot is driving`}
          onClick={() => props.onOpenGroup(stage, group.name)}
        >
          {label}
        </button>
      ) : (
        <span className={styles.target} title={label}>
          {label}
        </span>
      )}
      <button
        className={styles.remove}
        title={`stop modulating ${name} and hand slot ${props.n} back`}
        aria-label={`unpatch slot ${props.n}`}
        onClick={props.onRemove}
      >
        ×
      </button>
    </div>
  )
}

// One of a routing's own two knobs, wired so a second routing can be clipped
// onto it (modSlots.ts › BAY_TARGETS).
//
// The same row a control gets, with the same ⋮ ∿ and the same editor under it —
// which is the whole argument for the bay's knobs living in the control key
// space. A wire onto a wire is not a second kind of patch to learn: it is
// claimed where it lands, exactly like every other one, and the routing that
// results appears as its own numbered slot in this list with rows of its own.
//
// Both ends read the same way. This row wears ∿ because something is driving
// it; the driver's own head, a few lines up or down, says `driving slot 3
// depth`.
function BayKnob(props: { i: number; slot: UiSlot; field: BayField }) {
  const { bpm, setSlot, cycleSlotSync, modFor, setSlotForKey, setSlotOn } =
    useModSlotsApi()
  const [modOpen, setModOpen] = useState(false)
  const key = bayKeyFor(props.i, props.field)
  const driver = modFor(key)
  const routed = driver !== null
  const s = props.slot
  const rate = props.field === 'rate'
  return (
    <Slider
      label={rate ? 'rate' : 'depth (of slider range)'}
      unit={rate ? 'Hz' : ''}
      min={rate ? RATE_MIN : 0}
      max={rate ? RATE_MAX : 1}
      step={rate ? 0.02 : 0.01}
      // Tempo's business while ♩ is set; the dialed Hz stays put underneath and
      // comes back when the lock cycles off.
      value={rate ? slotRate(s, bpm) : s.depth}
      defaultValue={rate ? EMPTY_SLOT.rateHz : EMPTY_SLOT.depth}
      help={
        rate
          ? "How fast this slot's LFO cycles, in Hz. Slow rates drift the target control the way a warming-up circuit does; fast ones buzz it per-frame. Lock it to the beat with ♩ in the ⋮ menu, or clip another slot onto it with ∿ — a rate being walked by a second LFO is an oscillator that speeds up and slows down instead of keeping time."
          : 'How far the modulation swings the target, as a fraction of that control’s own slider range. The resting slider position stays the centre, so presets and saved looks still hold the look. Clip another slot onto this with ∿ and the wobble comes and goes on its own: leave this at 0 and the second one brings it in from nothing, which is the difference between a fault that is running and one that keeps happening.'
      }
      sync={
        rate
          ? {
              label:
                s.syncDiv === undefined
                  ? null
                  : SYNC_DIVISIONS[s.syncDiv].label,
              live: bpm !== null,
              onCycle: () => cycleSlotSync(props.i),
            }
          : undefined
      }
      mod={{
        routed,
        on: driver?.on === true,
        open: modOpen,
        onToggleOn: () => {
          if (driver !== null) setSlotOn(key, !driver.on)
        },
        onToggle: () => {
          // Claim on open, the same as a control row: the first press moves
          // something rather than handing over an empty form.
          if (!routed) setSlotForKey(key, DRIVER_ROUTING)
          setModOpen(!modOpen)
        },
      }}
      modEditor={
        modOpen ? (
          <ModRowEditor controlKey={key} onDone={() => setModOpen(false)} />
        ) : undefined
      }
      onChange={v => setSlot(props.i, rate ? { rateHz: v } : { depth: v })}
    />
  )
}

// What a wire onto another wire patches in when it is first claimed, and it is
// deliberately not what a control row claims. This one is not moving the
// picture — it is deciding how much the routing under it moves — so it wants a
// slow aimless drift rather than a legible cycle: at 0.08 Hz a walk takes about
// twelve seconds to change its mind, which is the rate at which a fault reads
// as coming and going rather than as stuttering.
const DRIVER_ROUTING = {
  source: 'walk' as const,
  rateHz: 0.08,
  depth: 0.5,
}

// The whole bay, one entry per patched slot. State, persistence and the push to
// the render loop all moved to useModSlots when motion stopped being this
// section's private business — presets carry it, links carry it, and any control
// row can claim a slot from its own ∿. What is left here is the view that shows
// the bay as a bay, which is still the only place the eight read as a set: a
// routing's own row can say what drives that control and cannot say what else
// is moving, or how much of the bay is left.
//
// Empty slots draw nothing. They used to be eight rows reading "off", which was
// the section's whole resting height spent on the absence of eight things — and
// each of those rows was a picker, which is why the bay looked like the place
// motion was set up from. It isn't: it is the place motion is read and taken
// back. What is left of "there are eight" is the free count under the list.
//
// No `Section` around any of it any more, and that is the point of the file
// being a bay rather than a section: this is the body of the Modulation stage,
// which is a box floating off the chain map (controls.ts, MOD_STAGE). The stage
// head carries the name, the blurb and the patched count that the fold used to
// — and while the stage is shut, none of this is built at all, which a folded
// section could not say.
export function ModBay(props: {
  tempo: Tempo
  openStages: ReadonlySet<string>
  onOpenGroup: (stage: string, group: string) => void
}) {
  const { slots, setSlot, setSlotForKey, fire } = useModSlotsApi()
  // Slot number and slot in one, because the number is the slot's identity —
  // the engine's phase is keyed by position, so filtering the empties out must
  // not renumber the ones that are left.
  const patchedSlots = slots.flatMap((slot, i) =>
    slot.target === '' ? [] : [{ slot, target: slot.target, n: i + 1, i }],
  )
  const free = slots.length - patchedSlots.length
  // Whether anything in the bay is playable, which is what decides if the
  // fire-everything button is worth a row.
  const anyTrig = slots.some(s => s.target !== '' && s.source === 'trig')
  return (
    <>
      {/* What the stage's own heading does not already say. It used to open on
          "LFOs, drift and the audio envelope wiggling any control", which is
          now the blurb one line above it, and to explain the ∿, which the free
          count at the foot of the bay explains again — three sentences of the
          same instruction on a bay holding nothing. What is left is the one
          thing in here that is not a routing. */}
      <div className={ui.hint}>
        The gate below is the one thing in the bay that drives the whole board
        rather than one control: it cuts between the look you are dialing and a
        second one on the beat. That second one is stock until you hold a look
        at the far end of it, so out of the box each cut pokes a clean picture
        through.
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
          title="strike every one-shot envelope in the bay at once — or press t"
          onClick={() => fire()}
        >
          ⚡ fire all
        </button>
      ) : null}
      <StabRows />
      {patchedSlots.map(({ slot: s, target, n, i }) => (
        // Slots are positional identities (slot 1..8), so the index IS the key.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={i}>
          <SlotHead
            n={n}
            target={target}
            openStages={props.openStages}
            onOpenGroup={props.onOpenGroup}
            // The same call the row's own "remove" makes, rather than a second
            // way to blank a slot: it hands the slot back with its run switch
            // restored, which matters because the switch belongs to a routing —
            // left thrown on an empty slot it would park whatever got patched
            // there next, with nothing on the row that claimed it to say why it
            // isn't moving.
            onRemove={() => setSlotForKey(target, null)}
          />
          <SelectRow
            tag="∿"
            title="modulation source"
            value={s.source}
            options={MOD_SOURCES}
            onChange={source => setSlot(i, { source })}
          />
          {PASS_THROUGH.has(s.source) ? null : (
            <BayKnob i={i} slot={s} field="rate" />
          )}
          {/* The only control in the bay you play rather than set. It has to be
              next to the rate, because the rate is this envelope's decay and the
              two are read together — press, watch it fall, adjust, press again.

              Gone while the slot is parked, because ❚❚ means it: a parked
              routing is not on the engine's list, so the strike would land on
              nothing. The button going with the switch says that, where a live
              button that quietly does nothing would read as the envelope being
              broken. */}
          {s.source === 'trig' && s.on ? (
            <button
              className={ui.btn}
              title={`strike slot ${n}'s envelope`}
              onClick={() => fire(i)}
            >
              ⚡ fire
            </button>
          ) : null}
          <BayKnob i={i} slot={s} field="depth" />
          {/* Per slot, because the master amount above is all of them at once
              and "off, except that one" is the shape a set actually wants.
              Everything the slot is patched with survives it — the same switch
              the control row's ∿ throws. */}
          <button
            className={cx(ui.btn, !s.on && ui.slotEmpty)}
            title={
              s.on
                ? `hold slot ${n} still, keeping what it is patched with`
                : `start slot ${n} again, as it is set`
            }
            onClick={() => setSlot(i, { on: !s.on })}
          >
            {s.on ? '❚❚ hold still' : '▶ start again'}
          </button>
        </div>
      ))}
      {/* What is left of the eight empty rows: the count, and the one gesture
          that fills one. Both states are worth a line — with the bay full, a ∿
          press has nowhere to go, and the row that gets pressed says so from
          inside its own editor but only after you have pressed it. */}
      <div className={ui.hint}>
        {free === 0
          ? `all ${slots.length} slots are patched — hand one back with its × to free it.`
          : `${free} of ${slots.length} slots free — press ∿ on any control row to patch one.`}
      </div>
    </>
  )
}
