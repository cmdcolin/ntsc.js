import { useState } from 'react'

import { DEFAULT_CONTROLS, atRest } from '../controls'
import styles from './ControlGroup.module.css'
import { NEEDS, sliderFor } from './controls'
import { useControlsApi } from './ControlsContext'
import { matchedSliders, useFilterQuery } from './filter'
import { MagnifierFrame } from './MagnifierFrame'
import { SYNCABLE_KEYS } from './midi'
import { ModRowEditor } from './ModRowEditor'
import { EMPTY_SLOT } from './modSlots'
import { useModSlotsApi } from './ModSlotsContext'
import { mutateAmountFor } from './mutate'
import { PipFrame } from './PipFrame'
import { PurityFrame } from './PurityFrame'
import { Section } from './Section'
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
  // Whether the gate is closed at all, as opposed to whether this row is the
  // one that says so: a banner-muted row is still inert, and offering to
  // modulate a control whose path is shut would start an LFO nothing can show.
  const inert = need !== undefined && !need.ok(api.controls[need.key])
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
      value={api.displayValue(s.key)}
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
  const { controls, writeControl } = useControlsApi()
  return (
    <WipeFrame
      mode={controls.wipeMode}
      pos={controls.wipePos}
      soft={controls.wipeSoft}
      swept={controls.wipeRate > 0}
      inert={controls.wipeMode < 1}
      onChange={pos => writeControl('wipePos', pos)}
    />
  )
}

function PipControl() {
  const { controls, writeControls } = useControlsApi()
  return (
    <PipFrame
      inert={controls.pipMix === 0}
      border={controls.pipBorder}
      soft={controls.pipSoft}
      box={{
        x: controls.pipX,
        y: controls.pipY,
        w: controls.pipW,
        h: controls.pipH,
      }}
      // One write, not four: a drag moves all four at once, so the engine
      // notifies (and React renders) once per pointer move.
      onChange={box =>
        writeControls({
          ...controls,
          pipX: box.x,
          pipY: box.y,
          pipW: box.w,
          pipH: box.h,
        })
      }
    />
  )
}

function PurityControl() {
  const { controls, writeControl, writeControls } = useControlsApi()
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
  const { controls, writeControls } = useControlsApi()
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

export function ControlGroup(props: { group: Group; defaultOpen?: boolean }) {
  const { group } = props
  const { controls, writeControl, mutateGroup, resetGroup } = useControlsApi()
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
  const fine = query === '' ? unframed.filter(s => s.fine === true) : []
  const shown = query === '' ? unframed.filter(s => s.fine !== true) : unframed
  // Every row actually on screen, which is what the gate scan below counts: a
  // banner is a summary of the notes it replaces, so a trim folded behind the
  // fine tier must not be one of the three that raises it.
  const onScreen = showFine ? [...shown, ...fine] : shown
  const touched = group.sliders.some(s => !atRest(controls[s.key], s.key))
  const fineTouched = fine.filter(s => !atRest(controls[s.key], s.key)).length
  // The touched count can't cover motion: a routing never moves the resting
  // value, so a folded trim being driven by an LFO looks untouched from here.
  const fineMod = fine.some(s => mod.modFor(s.key) !== null)

  // When most of a group is dead behind the same gate (e.g. all of the mixer loop
  // behind loop mix), one banner beats a stack of identical per-row notes; the
  // notes stay only for the odd ones out.
  const unmet = new Map<ControlKey, { need: SliderNeed; n: number }>()
  for (const s of onScreen) {
    const need = NEEDS[s.key]
    if (need !== undefined && !need.ok(controls[need.key])) {
      const seen = unmet.get(need.key)
      if (seen === undefined) unmet.set(need.key, { need, n: 1 })
      else seen.n += 1
    }
  }
  const banners = [...unmet.values()].filter(e => e.n >= 3)
  const muted: ReadonlySet<ControlKey> = new Set(banners.map(e => e.need.key))

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
          {touched ? (
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
            title={`shake only this stage's controls around where they sit — shift for a wilder roll, alt for a gentle one, ctrl (or cmd) for turbo (${group.name})`}
            aria-label={`jitter ${group.name}`}
            onClick={e => mutateGroup(group.sliders, mutateAmountFor(e))}
          >
            ⚄
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
        {shown.map(s => (
          <ControlSlider key={s.key} slider={s} muted={muted} />
        ))}
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
            {showFine
              ? fine.map(s => (
                  <ControlSlider key={s.key} slider={s} muted={muted} />
                ))
              : null}
          </>
        )}
      </Rack>
    </Section>
  )
}
