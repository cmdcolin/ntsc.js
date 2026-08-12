import { useState } from 'react'

import { DEFAULT_CONTROLS, atRest } from '../controls'
import styles from './ControlGroup.module.css'
import { GROUPS, NEEDS, sliderFor } from './controls'
import {
  useControlReading,
  useControls,
  useControlsApi,
  useControlValue,
} from './ControlsContext'
import { matchedSliders, useFilterQuery } from './filter'
import { DiceIcon } from './icons'
import { MagnifierFrame } from './MagnifierFrame'
import { SYNCABLE_KEYS } from './midi'
import { ModRowEditor } from './ModRowEditor'
import { EMPTY_SLOT } from './modSlots'
import { useModSlotsApi } from './ModSlotsContext'
import { mutateAmountFor } from './mutate'
import { PipControl } from './PipControl'
import { PurityFrame } from './PurityFrame'
import { sameKeySet, sameList } from './sameList'
import { Section } from './Section'
import { SIGNAL_TAPS, tapFor } from './signalTap'
import { useSignalTapApi } from './SignalTapContext'
import { Rack, Slider } from './Slider'
import { WipeFrame } from './WipeFrame'

import type { ControlKey } from '../controls'
import type { Group, SliderDef, SliderNeed } from './controls'
import type { ControlsApi } from './ControlsContext'
import type { ReactElement } from 'react'

const SYNCABLE_SET = new Set<ControlKey>(SYNCABLE_KEYS)

// One control row. A component, not a render function, so building it costs a
// props object: the panel holds 121 rows and mounts about six, and the render
// function did every row's gate lookup and accessory allocation per write.
export function ControlSlider(props: {
  slider: SliderDef
  // Gates already announced by the group's banner, so the row skips its own
  // copy of the same note.
  muted?: ReadonlySet<ControlKey>
}) {
  const api = useControlsApi()
  const mod = useModSlotsApi()
  const [modOpen, setModOpen] = useState(false)
  const s = props.slider
  const need = NEEDS[s.key]
  // Two subscriptions, and the row re-renders when either number moves and at
  // no other time. The gate falls back to this row's own key so the hook count
  // doesn't depend on whether the control has a gate at all.
  const value = useControlValue(s.key)
  const gate = useControlValue(need === undefined ? s.key : need.key)
  // Whether the gate is closed at all, as opposed to whether this row is the
  // one that says so: a banner-muted row is still inert, and offering to
  // modulate a control whose path is shut would start an LFO nothing can show.
  const inert = need !== undefined && !need.ok(gate)
  const unmet = inert && props.muted?.has(need.key) !== true
  const slot = mod.modFor(s.key)
  const routed = slot !== null
  return (
    <Slider
      label={s.label}
      unit={s.unit}
      min={s.min}
      max={s.max}
      step={s.step}
      value={api.lockedValue(s.key) ?? value}
      defaultValue={DEFAULT_CONTROLS[s.key]}
      onChange={v => api.writeControl(s.key, v)}
      choices={s.choices}
      curve={s.curve}
      redline={s.redline}
      help={s.help}
      needs={unmet ? needsNote(need, api) : undefined}
      favorite={{
        on: api.favorites.has(s.key),
        onToggle: () => api.toggleFavorite(s.key),
      }}
      midi={
        api.midiReady
          ? {
              label: api.bindLabel(s.key),
              armed: api.armed === s.key,
              pickup: api.pickup(s.key),
              onArm: () => api.toggleArm(s.key),
            }
          : undefined
      }
      sync={
        api.midiReady && SYNCABLE_SET.has(s.key)
          ? {
              label: api.syncLabel(s.key),
              live: api.clockLive,
              onCycle: () => api.cycleSync(s.key),
            }
          : undefined
      }
      // Not offered on a row whose gate is shut, and not on a choice control:
      // stepping a mode enum with an LFO picks tubes nobody asked for.
      //
      // Unless it is already routed — a preset, a link or a since-closed gate
      // can all leave one there, and hiding the ∿ on those rows hid the only
      // way to see what is driving the control or to hand the slot back. The
      // rule is about what may be *claimed*, not about what may be shown.
      mod={
        routed || (!inert && s.choices === undefined)
          ? {
              routed,
              // Running, as opposed to merely patched. The badge is the switch
              // and this is what it reads.
              on: slot?.on === true,
              open: modOpen,
              // The one-click park, from the row you are already looking at. It
              // keeps the source, rate and depth — the point of it is that the
              // wobble comes back exactly as you dialed it.
              onToggleOn: () => {
                if (slot !== null) mod.setSlotOn(s.key, !slot.on)
              },
              onToggle: () => {
                // Claim on open, so the first press already moves the picture
                // rather than handing over an editor with nothing patched into
                // it. Handing the slot back is the remove button, one click
                // away — a claim you can see and undo beats a form to fill in.
                if (!routed) mod.setSlotForKey(s.key, DEFAULT_ROUTING)
                setModOpen(!modOpen)
              },
            }
          : undefined
      }
      modEditor={
        modOpen ? (
          <ModRowEditor controlKey={s.key} onDone={() => setModOpen(false)} />
        ) : undefined
      }
    />
  )
}

// What a row patches in when it first asks for motion: slow enough to read as
// drift rather than flicker, deep enough to see at a glance.
const DEFAULT_ROUTING = {
  source: EMPTY_SLOT.source,
  rateHz: EMPTY_SLOT.rateHz,
  depth: EMPTY_SLOT.depth,
}

// The note under an inert control, and the one-click fix for its gate.
function needsNote(need: SliderNeed, api: ControlsApi) {
  const prereq = sliderFor(need.key)
  return {
    hint: need.hint,
    title: `does nothing until "${prereq.label}" moves — click to set it to ${need.fix}${prereq.unit}`,
    onFix: () => api.writeControl(need.key, need.fix),
  }
}

// These groups' geometry is dragged on a miniature of the picture rather than
// read off sliders; the sliders stay behind the reveal, where MIDI and clock
// sync live.
function WipeControl() {
  const controls = useControls()
  const { writeControl } = useControlsApi()
  return (
    <WipeFrame
      mode={controls.wipeMode}
      pos={controls.wipePos}
      soft={controls.wipeSoft}
      swept={controls.wipeRate > 0}
      inert={controls.wipeMode < 1}
      onFix={() => writeControl('wipeMode', 1)}
      onChange={pos => writeControl('wipePos', pos)}
    />
  )
}

function PurityControl() {
  const controls = useControls()
  const { writeControl, writeControls } = useControlsApi()
  return (
    <PurityFrame
      inert={controls.crtPurity === 0}
      // Enough to see the stain without swamping the picture — the same job the
      // `fix` value on a NEEDS gate does for a slider row.
      onFix={() => writeControl('crtPurity', 0.6)}
      patch={{
        x: controls.crtPurityX,
        y: controls.crtPurityY,
        size: controls.crtPuritySize,
      }}
      // One write for all three, so placing the patch notifies once.
      onChange={patch =>
        writeControls({
          ...controls,
          crtPurityX: patch.x,
          crtPurityY: patch.y,
          crtPuritySize: patch.size,
        })
      }
    />
  )
}

function ZoomControl() {
  const controls = useControls()
  const { writeControls } = useControlsApi()
  return (
    <MagnifierFrame
      zoom={controls.crtZoom}
      point={{ x: controls.crtZoomX, y: controls.crtZoomY }}
      // One write for both axes, so aiming the lens notifies once.
      onChange={point =>
        writeControls({ ...controls, crtZoomX: point.x, crtZoomY: point.y })
      }
      // A box dragged on the miniature sets where and how far in together, so
      // the magnification travels with the aim in the same single write.
      onLens={lens =>
        writeControls({
          ...controls,
          crtZoom: lens.zoom,
          crtZoomX: lens.x,
          crtZoomY: lens.y,
        })
      }
    />
  )
}

// Wherever frameLock's own group ends up living, rather than a hardcoded group
// name: both are non-signal "how the picture is watched" controls, so they
// belong beside each other, and pinning to frameLock's key survives the group
// being renamed or reshuffled in a way a literal string wouldn't.
const TAP_HOST_GROUP = GROUPS.find(g =>
  g.sliders.some(s => s.key === 'frameLock'),
)?.name

// Not a ControlKey — dbgView lives on the engine, outside Controls, so this
// reads its own context instead of useControlsApi(). Laid out like frameLock
// rather than stepped: it decides what the picture on screen even is, which
// is worth reaching directly rather than cycling through.
function SignalTapControl() {
  const { tap, onTap } = useSignalTapApi()
  const index = SIGNAL_TAPS.findIndex(t => t.value === tapFor(tap).value)
  return (
    <Slider
      label="signal tap"
      unit=""
      min={0}
      max={SIGNAL_TAPS.length - 1}
      step={1}
      value={index}
      defaultValue={0}
      choices={SIGNAL_TAPS.map(t => t.short)}
      help={`View a point inside the decode instead of the finished picture.

        - **waveform** — the whole line as brightness, sync tip and burst
          included, squeezed into the picture width.
        - **luma** — Y after Y/C separation.
        - **chroma** — the demodulated axes as false colour: red |U|, green |V|.
        - **burst** — what the receiver measured: red burst amplitude, green
          phase error, blue the gain the ACC settled at.
        - **scope** — one line traced against an IRE graticule, sync tip and
          burst included, with the picture dimmed above it.

        Advanced settings has the same picker with a longer note; the ☰ trigger
        only badges whichever tap is live.`}
      onChange={i => onTap(SIGNAL_TAPS[i].value)}
    />
  )
}

const FRAMES: {
  group: string
  keys: ReadonlySet<ControlKey>
  Frame: () => ReactElement
}[] = [
  {
    group: 'Wipe (A/B)',
    keys: new Set<ControlKey>(['wipePos']),
    Frame: WipeControl,
  },
  {
    group: 'PiP inset (source B)',
    keys: new Set<ControlKey>(['pipX', 'pipY', 'pipW', 'pipH']),
    Frame: PipControl,
  },
  {
    group: 'Mask & convergence',
    keys: new Set<ControlKey>(['crtPurityX', 'crtPurityY', 'crtPuritySize']),
    Frame: PurityControl,
  },
  {
    group: 'View',
    keys: new Set<ControlKey>(['crtZoomX', 'crtZoomY']),
    Frame: ZoomControl,
  },
]

// A list of rows, and the component boundary is the point of it.
//
// The group header around it reads the controls — it has counts to show and
// gates to check — so its own JSX is rebuilt on every write, and rows built
// inline there would be rebuilt with it. Behind this boundary the compiler
// memoizes on two props that a write does not touch, so React skips the lot.
// Both props therefore have to keep their identity across a write: `sliders`
// comes through sameList, `muted` through sameKeySet.
export function ControlRows(props: {
  sliders: readonly SliderDef[]
  muted?: ReadonlySet<ControlKey>
}) {
  // Wrapped rather than returning the array bare: the compiler only treats a
  // function as a component worth memoizing if it returns JSX, and this one
  // exists solely to be memoized.
  return (
    <>
      {props.sliders.map(s => (
        <ControlSlider key={s.key} slider={s} muted={props.muted} />
      ))}
    </>
  )
}

// Every gate the rows on screen sit behind, and how many of them sit behind
// each — which is a fact about the rows, not about where the controls are.
function gatesBehind(
  onScreen: readonly SliderDef[],
): { need: SliderNeed; n: number }[] {
  const gates = new Map<ControlKey, { need: SliderNeed; n: number }>()
  for (const s of onScreen) {
    const need = NEEDS[s.key]
    if (need !== undefined) {
      const seen = gates.get(need.key)
      if (seen === undefined) gates.set(need.key, { need, n: 1 })
      else seen.n += 1
    }
  }
  return [...gates.values()]
}

export function ControlGroup(props: { group: Group; defaultOpen?: boolean }) {
  const { group } = props
  const { writeControl, mutateGroup, resetGroup } = useControlsApi()
  const mod = useModSlotsApi()
  const query = useFilterQuery()
  // A live filter drops the miniature, so a search can reach the sliders it
  // stands in for.
  const [showFramed, setShowFramed] = useState(false)
  const [showFine, setShowFine] = useState(false)
  const frame =
    query === '' ? FRAMES.find(f => f.group === group.name) : undefined

  const matched = matchedSliders(group, query, key => mod.modFor(key) !== null)
  const unframed =
    frame === undefined || showFramed
      ? matched
      : matched.filter(s => !frame.keys.has(s.key))
  // The trims a group hides so its look-makers stay in reach. A filter reaches
  // them for free: with a query up the tier collapses, so a search or a palette
  // jump lands on the row itself rather than on a toggle that hides it.
  // Both through sameList, because both are what ControlRows is memoized on:
  // the members change when the query or the fold does, and a fresh array in
  // between is the difference between React skipping every row in the group and
  // rebuilding it.
  const fine = sameList(
    query === '' ? unframed.filter(s => s.fine === true) : [],
  )
  const shown = sameList(
    query === '' ? unframed.filter(s => s.fine !== true) : unframed,
  )
  // Every row actually on screen, which is what the gate scan below counts: a
  // banner is a summary of the notes it replaces, so a trim folded behind the
  // fine tier must not be one of the three that raises it.
  const onScreen = showFine ? [...shown, ...fine] : shown
  // Three readings, not a copy of the controls. This component builds every row
  // in the group, so what it reads decides what re-renders: reading the object
  // hands the compiler a dependency that changes on every write, and the rows go
  // with it. Reading three primitives means a write to some other control
  // returns the same three answers, the memo block holds, and React skips the
  // rows entirely — which is the difference between 19ms a write and a frame
  // that never notices.
  // A count, not a `some` — the header shows it (Section's `dot`), and the same
  // sum over the same predicate is what the stage's heading counts, so the two
  // agree by construction. It costs a re-render of the group's rows on each
  // *crossing* of stock, where the boolean only paid on the first; a drag
  // crosses once, and `fineTouched` below has always been a count on the same
  // terms, so the reading budget this block is written for is unchanged.
  const touched = useControlReading(
    c => group.sliders.filter(s => !atRest(c[s.key], s.key)).length,
  )
  const fineTouched = useControlReading(
    c => fine.filter(s => !atRest(c[s.key], s.key)).length,
  )
  // The touched count can't cover motion: a routing never moves the resting
  // value, so a folded trim being driven by an LFO looks untouched from here.
  const fineMod = fine.some(s => mod.modFor(s.key) !== null)

  // When most of a group is dead behind the same gate (e.g. all of the mixer loop
  // behind loop mix), one banner beats a stack of identical per-row notes; the
  // notes stay only for the odd ones out.
  //
  // How many rows sit behind each gate is a property of which rows are showing,
  // so it is counted here, off the controls entirely; where the controls come in
  // is only *which* of those gates are shut, and that is the reading below.
  const behind = gatesBehind(onScreen)
  const shut = useControlReading(c =>
    behind
      .filter(g => !g.need.ok(c[g.need.key]))
      .map(g => g.need.key)
      .join(' '),
  )
  const shutKeys = new Set(shut === '' ? [] : shut.split(' '))
  const banners = behind.filter(g => g.n >= 3 && shutKeys.has(g.need.key))
  // Through sameKeySet, not `new Set(...)`: this is a prop on every row in the
  // group, and a fresh Set on each write would be enough on its own to re-render
  // all of them.
  const muted = sameKeySet(banners.map(e => e.need.key))

  // A group the query left with nothing — no rows, no folded trims to offer,
  // and no miniature — is a header over an empty body, so it drops out entirely.
  return shown.length === 0 &&
    fine.length === 0 &&
    frame === undefined ? null : (
    <Section
      title={group.name}
      defaultOpen={props.defaultOpen}
      openOnFilter
      dot={touched}
      help={
        <>
          {/* Only on a group that has something to put back — the same rule the
              row's own ↺ follows, and the reason neither costs anything on the
              majority of headers that are still at stock. It sits before the
              dice because the pair reads as "back / further" in that order. */}
          {touched > 0 ? (
            <button
              className={styles.revert}
              title={`put this stage's controls back to stock, and leave the rest of the look alone (ctrl+z takes it back)`}
              aria-label={`reset ${group.name} to defaults`}
              onClick={() => resetGroup(group.sliders)}
            >
              ↺
            </button>
          ) : null}
          <button
            className={styles.dice}
            title={`nudge only this stage's controls randomly around where they sit — shift for a wilder roll, alt for a gentler one, ctrl (or cmd) for turbo (${group.name})`}
            aria-label={`nudge ${group.name} randomly`}
            onClick={e => mutateGroup(group.sliders, mutateAmountFor(e))}
          >
            <DiceIcon />
          </button>
        </>
      }
    >
      {frame === undefined ? null : (
        <>
          <frame.Frame />
          <button
            className={styles.sliderToggle}
            onClick={() => setShowFramed(!showFramed)}
          >
            {showFramed ? '▾ sliders' : '▸ sliders'}
          </button>
        </>
      )}
      {banners.map(({ need, n }) => (
        <button
          key={need.key}
          className={styles.groupNeeds}
          title={`click to set "${sliderFor(need.key).label}" to ${need.fix}${sliderFor(need.key).unit}`}
          onClick={() => writeControl(need.key, need.fix)}
        >
          {n} controls here are inert — needs {need.hint} · click to set
        </button>
      ))}
      {/* Sized off the whole group rather than off what is currently on screen,
          so unfolding the fine tier doesn't re-align the rows above it — the
          reserve is the same whichever rows are showing. */}
      <Rack sliders={group.sliders}>
        <ControlRows sliders={shown} muted={muted} />
        {group.name === TAP_HOST_GROUP ? <SignalTapControl /> : null}
        {fine.length === 0 ? null : (
          <>
            <button
              className={styles.sliderToggle}
              onClick={() => setShowFine(!showFine)}
              title="trims that shape an effect something else turns on"
            >
              {showFine ? (
                '▾ fine tweaks'
              ) : (
                <>
                  {`▸ ${fine.length} fine tweaks`}
                  {fineTouched === 0 ? null : (
                    <span className={styles.fineTouched}>
                      {` · ${fineTouched} touched`}
                    </span>
                  )}
                  {fineMod ? (
                    <span className={styles.fineMod}> · ∿</span>
                  ) : null}
                </>
              )}
            </button>
            {showFine ? <ControlRows sliders={fine} muted={muted} /> : null}
          </>
        )}
      </Rack>
    </Section>
  )
}
