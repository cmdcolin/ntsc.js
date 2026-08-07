import { useRef, useState } from 'react'

import { cx } from './cx'
import { Dialog } from './Dialog'
import { BulbIcon } from './icons'
import { clamp01 } from './miniFrame'
import { PRESETS, matchPreset } from './presets'
import styles from './PresetsSection.module.css'
import { Section } from './Section'
import { usePersistedFlag } from './storage'
import ui from './ui.module.css'
import { useRecentPresets } from './useRecentPresets'

import type { Controls } from '../controls'
import type { PresetDef, PresetWeights } from './presets'
import type { CSSProperties } from 'react'

// Presets grouped under their labeled headers. Derived purely from the static
// PRESETS table, so it's computed once at module load, not every render.
const PRESET_GROUPS = PRESETS.reduce<{ name: string; defs: typeof PRESETS }[]>(
  (acc, p) => {
    const g = acc.find(x => x.name === p.group)
    if (g === undefined) acc.push({ name: p.group, defs: [p] })
    else g.defs.push(p)
    return acc
  },
  [],
)

// Click applies the preset outright; dragging sideways past a few pixels turns
// the button into a weight slider, mixing that preset onto the current look.
const DRAG_SLOP = 4
// Horizontal travel for the full 0→100% sweep. A fixed distance rather than the
// chip's own width, so a narrow chip ("clean") and a wide one ("vertical hold
// gone") scrub at the same rate, and the drag can run past the chip's edge —
// the pointer is captured, so it keeps tracking out there.
const DRAG_FULL = 120

// The preset gesture hint is shown until the user dismisses it with its ×;
// that choice persists, so it teaches once and then stops costing a row. It
// carries the drag and nothing else: it used to run four unrelated facts
// together, which spent the row's attention four ways and let one × dismiss
// tips the reader hadn't read. The rest are all in the help dialog, and the
// drag is the only one nothing else on screen can show you.
const HINT_STORE = 'video_feedback_preset_hint_dismissed'
// Whether the full grouped catalog is unfolded below the shortlist.
const ALL_STORE = 'video_feedback_presets_expanded'

// The shortlist a first visit opens on: one memorable look per family, so the
// row spans the range of the thing before you've used it enough to have
// habits. Recents displace these as they accumulate.
const STARTERS = [
  'vhs',
  'broadcast',
  'vertical hold gone',
  'mixer loop',
  'rainbow storm',
  'neon tube',
  // The one that is not a single mechanism. It sits last because the others
  // teach what the board does one fault at a time, and this one is the argument
  // for why that is worth doing — every stage at once, interfering.
  'deep end',
]
const SHORTLIST_MAX = 8

// The one explainer for the whole feature (behind the ? by the section title),
// so the compact chips carry no per-preset help of their own — each chip's blurb
// stays on hover.
function PresetsHelpDialog(props: { onClose: () => void }) {
  return (
    <Dialog title="Presets" size="prose" onClose={props.onClose}>
      <p className={ui.helpText}>
        A preset is not one switch. Each one is a named look that sets a whole
        bank of controls at once — five for a simple fault, thirty-odd for “deep
        end” — spread across every stage of the chain, because that is what it
        takes to recreate a particular signal fault or device. Hover one for
        what it does and how many controls it moves; “This look”, right below
        this section, then lists every one of them as a live row you can drag.
      </p>
      <p className={ui.helpText}>
        Every preset but “clean” is also a fader: click to dial it fully in, or
        drag sideways for a partial amount. Either way it layers onto what’s
        already there rather than replacing it, and the fill shows how much is
        in — so stacking several accumulates their faults. “clean” is a plain
        reset: click it to clear them all.
      </p>
      <div className={ui.muted}>
        A mix lasts only until something else moves the look — a slider, mutate,
        a scene — and then the fills reset, since a blended look can’t be traced
        back to exact amounts.
      </div>
    </Dialog>
  )
}

function PresetButton(props: {
  def: PresetDef
  weight: number
  active: boolean
  edited: boolean
  onApply: (name: string, patch: Partial<Controls>) => void
  onMixStart: () => void
  onMix: (name: string, w: number) => void
  onHover: (name: string | null) => void
}) {
  // Gesture bookkeeping only — nothing here should cause a render. The weight
  // is integrated one pointer step at a time, so a clamp at either end can't
  // bank travel the weight didn't follow: run past 100%, reverse, and the fill
  // turns with the drag instead of after paying the overshoot back. `lastX` is
  // null until the press has travelled far enough to mean a drag rather than a
  // click, which is also what tells pointerup which of the two it was.
  // Reading the pointer's absolute position across the chip instead made the
  // result depend on where in the chip the press landed — a stray wobble during
  // an ordinary click would teleport the mix to ~50% with nothing to say why.
  const dragRef = useRef<{
    pressX: number
    lastX: number | null
    w: number
  } | null>(null)
  const fill: CSSProperties & Record<'--w', string> = {
    '--w': `${Math.round(props.weight * 100)}%`,
  }
  // How many controls the chip moves — the fact the catalog was not saying. A
  // preset reads as one switch until you know it is a bundle, and the number is
  // what makes stacking two of them, or dragging one halfway in, mean anything.
  const touches = Object.keys(props.def.patch).length
  // "clean" is the reset (an empty patch): blendPresets can never mix it in at
  // any weight, so the drag-to-mix gesture is dead for it — plain click only,
  // hence no resize cursor advertising a gesture that does nothing.
  const mixable = touches > 0
  return mixable ? (
    <button
      title={`sets ${touches} controls at once — ${props.def.blurb} Drag sideways to mix it in partially.`}
      style={fill}
      className={cx(
        ui.btn,
        ui.presetBtn,
        props.active && ui.active,
        props.edited && ui.edited,
      )}
      onPointerEnter={() => props.onHover(props.def.name)}
      onPointerLeave={() => props.onHover(null)}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId)
        // onMixStart rebaselines the mix onto whatever is live, which zeroes the
        // weights when the look has drifted — and props.weight already reads 0 in
        // exactly that case, so this stays the right starting point either way.
        dragRef.current = { pressX: e.clientX, lastX: null, w: props.weight }
        props.onMixStart()
      }}
      onPointerMove={e => {
        const d = dragRef.current
        if (d !== null) {
          // The slop is spent getting here, so the sweep starts from this point
          // rather than jumping by however far the press had already drifted.
          const from =
            d.lastX === null && Math.abs(e.clientX - d.pressX) > DRAG_SLOP
              ? e.clientX
              : d.lastX
          if (from !== null) {
            d.w = clamp01(d.w + (e.clientX - from) / DRAG_FULL)
            d.lastX = e.clientX
            props.onMix(props.def.name, d.w)
          }
        }
      }}
      onPointerUp={() => {
        const d = dragRef.current
        dragRef.current = null
        if (d !== null && d.lastX === null)
          props.onApply(props.def.name, props.def.patch)
      }}
      // Keyboard activation fires a bare click with no pointer events, so the
      // press path above never sees it. detail === 0 is what separates it from
      // the click that trails a mouse release, which pointerup already applied.
      onClick={e => {
        if (e.detail === 0) props.onApply(props.def.name, props.def.patch)
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
    >
      {props.def.name}
      {props.edited ? ' •' : ''}
    </button>
  ) : (
    <button
      title={props.def.blurb}
      className={cx(
        ui.btn,
        props.active && ui.active,
        props.edited && ui.edited,
      )}
      onPointerEnter={() => props.onHover(props.def.name)}
      onPointerLeave={() => props.onHover(null)}
      onClick={() => props.onApply(props.def.name, props.def.patch)}
    >
      {props.def.name}
      {props.edited ? ' •' : ''}
    </button>
  )
}

// The section is the catalog and nothing else. The verbs that used to close it
// out — compare, copy link, surprise, mutate, undo, redo — act on the whole
// board rather than on presets, and they moved to the LookBar under the
// masthead; this section had grown to a quarter of the sidebar, and they were
// the part of it that was not presets.
export function PresetsSection(props: {
  controls: Controls
  lastPreset: string | null
  weights: PresetWeights
  onApplyPreset: (name: string, patch: Partial<Controls>) => void
  onMixStart: () => void
  onMix: (name: string, w: number) => void
}) {
  const [showHelp, setShowHelp] = useState(false)
  const [hintDismissed, setHintDismissed] = usePersistedFlag(HINT_STORE)
  const [showAll, setShowAll] = usePersistedFlag(ALL_STORE)
  const { recent, noteUse } = useRecentPresets()
  // The hovered preset's blurb takes over the caption line: faster to browse
  // than the tooltip delay, and the only way touch users ever see the blurbs.
  const [hovered, setHovered] = useState<string | null>(null)
  const hoveredDef = PRESETS.find(p => p.name === hovered)
  const active = matchPreset(props.controls)
  const presetCaption = hoveredDef
    ? hoveredDef.blurb
    : active
      ? active.blurb
      : props.lastPreset === null
        ? 'a preset is a bundle of settings, not one switch — click one for an instant look, then tweak the sliders below.'
        : `modified from "${props.lastPreset}"`
  // The count rides the caption whenever the caption is describing a particular
  // preset, so browsing the chips teaches the thing the chips cannot say: this
  // is not a switch, it is N controls moving together. "clean" has an empty
  // patch and gets no badge — it is the reset, and "0 controls" would read as
  // broken rather than as "puts everything back".
  const captionDef = hoveredDef ?? active
  const captionTouches =
    captionDef === undefined ? 0 : Object.keys(captionDef.patch).length

  // The shortlist: the reset, whatever is currently dialed into the mix (so a
  // "surprise me" recipe stays legible with the catalog folded), then recents,
  // topped up from the starters. Rendered in table order rather than pick
  // order, so a chip doesn't move under the pointer as habits shift.
  const picked = new Set<string>()
  for (const name of [
    'clean',
    ...[...props.weights].filter(([, w]) => w > 0).map(([n]) => n),
    ...recent,
    ...STARTERS,
  ]) {
    if (picked.size < SHORTLIST_MAX) picked.add(name)
  }
  const renderButton = (p: PresetDef) => (
    <PresetButton
      key={p.name}
      def={p}
      weight={props.weights.get(p.name) ?? 0}
      active={active?.name === p.name}
      edited={active === undefined && props.lastPreset === p.name}
      onApply={(name, patch) => {
        noteUse(name)
        props.onApplyPreset(name, patch)
      }}
      onMixStart={props.onMixStart}
      onMix={(name, w) => {
        noteUse(name)
        props.onMix(name, w)
      }}
      onHover={setHovered}
    />
  )

  return (
    <Section
      title="Presets"
      help={
        <>
          <button
            className={cx(styles.allBtn, showAll && styles.allBtnOn)}
            aria-pressed={showAll}
            title={
              showAll
                ? 'fold the catalog back to your shortlist'
                : 'every preset, grouped by the kind of fault it models'
            }
            onClick={() => setShowAll(!showAll)}
          >
            all
            <span className={styles.allCount}>{PRESETS.length}</span>
          </button>
          <button
            className={styles.helpBtn}
            title="what are presets?"
            onClick={() => setShowHelp(true)}
          >
            ?
          </button>
        </>
      }
    >
      {hintDismissed ? null : (
        <div className={cx(ui.hint, ui.dismissHint)}>
          <span className={ui.hintIcon}>
            <BulbIcon />
          </span>
          <span>drag a preset sideways to mix it in partially</span>
          <button
            className={ui.hintX}
            title="dismiss this hint"
            aria-label="dismiss hint"
            onClick={() => setHintDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
      {showAll ? null : (
        <div>{PRESETS.filter(p => picked.has(p.name)).map(renderButton)}</div>
      )}
      {showAll
        ? PRESET_GROUPS.map(grp => (
            <div key={grp.name} className={styles.presetGroup}>
              <div className={styles.grpLabel}>{grp.name}</div>
              {grp.defs.map(renderButton)}
            </div>
          ))
        : null}
      {/* Clamped, and carrying the whole line as its tooltip: half the blurbs
          run past three lines in a panel this narrow, and letting the caption
          grow to five meant sweeping the chips pumped everything below it up
          and down by 60px. */}
      <div className={styles.caption} title={presetCaption}>
        {captionTouches === 0 ? null : (
          <span className={styles.captionCount}>
            {captionTouches} controls ·{' '}
          </span>
        )}
        {presetCaption}
      </div>
      {showHelp ? (
        <PresetsHelpDialog onClose={() => setShowHelp(false)} />
      ) : null}
    </Section>
  )
}
