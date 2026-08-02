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
]
const SHORTLIST_MAX = 8

// The one explainer for the whole feature (behind the ? by the section title),
// so the compact chips carry no per-preset help of their own — each chip's blurb
// stays on hover.
function PresetsHelpDialog(props: { onClose: () => void }) {
  return (
    <Dialog title="Presets" size="prose" onClose={props.onClose}>
      <p className={ui.helpText}>
        Each preset is a named look — a bundle of control settings that
        recreates a particular signal fault or device. Hover one for what it
        does.
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
  // "clean" is the reset (an empty patch): blendPresets can never mix it in at
  // any weight, so the drag-to-mix gesture is dead for it — plain click only,
  // hence no resize cursor advertising a gesture that does nothing.
  const mixable = Object.keys(props.def.patch).length > 0
  return mixable ? (
    <button
      title={`${props.def.blurb} — drag sideways to mix it in partially`}
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

export function PresetsSection(props: {
  controls: Controls
  lastPreset: string | null
  weights: PresetWeights
  onApplyPreset: (name: string, patch: Partial<Controls>) => void
  onMixStart: () => void
  onMix: (name: string, w: number) => void
  comparing: boolean
  onStartCompare: () => void
  onEndCompare: () => void
  onCopyLink: () => void
  copied: boolean
  onMutate: () => void
  onSurprise: () => void
  canUndo: boolean
  onUndo: () => void
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
        ? 'click a preset for an instant look, then tweak the sliders below.'
        : `modified from "${props.lastPreset}"`

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
        <button
          className={styles.helpBtn}
          title="what are presets?"
          onClick={() => setShowHelp(true)}
        >
          ?
        </button>
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
      <button
        className={cx(styles.barBtn, showAll && styles.barBtnOn)}
        title={
          showAll
            ? 'fold the catalog back to your shortlist'
            : 'every preset, grouped by the kind of fault it models'
        }
        onClick={() => setShowAll(!showAll)}
      >
        <span className={styles.barCaret}>{showAll ? '▾' : '▸'}</span>
        {showAll ? 'hide the preset catalog' : 'browse all presets'}
        <span className={styles.barCount}>{PRESETS.length}</span>
      </button>
      {showAll
        ? PRESET_GROUPS.map(grp => (
            <div key={grp.name} className={styles.presetGroup}>
              <div className={styles.grpLabel}>{grp.name}</div>
              {grp.defs.map(renderButton)}
            </div>
          ))
        : null}
      <div className={styles.caption}>{presetCaption}</div>
      <button
        onPointerDown={props.onStartCompare}
        onPointerUp={props.onEndCompare}
        onPointerLeave={props.onEndCompare}
        className={cx(ui.btn, props.comparing && ui.active)}
        title="hold to preview the clean signal, release to return (or hold C)"
      >
        {props.comparing ? 'showing clean…' : 'hold to compare'}
      </button>
      <button
        className={cx(ui.btn, props.copied && ui.active)}
        onClick={props.onCopyLink}
      >
        {props.copied ? 'copied!' : 'copy link'}
      </button>
      <button
        className={ui.btn}
        onClick={props.onSurprise}
        title="stack a few random presets from different groups — a fresh look each roll, with the recipe shown in the chips above"
      >
        surprise me
      </button>
      <button
        className={ui.btn}
        onClick={props.onMutate}
        title="jitter every control around the current look, for a related variation (also happy accidents)"
      >
        mutate
      </button>
      <button
        className={cx(ui.btn, !props.canUndo && ui.slotEmpty)}
        onClick={props.onUndo}
        disabled={!props.canUndo}
        title="restore the look from before the last preset, scene, or mutate"
      >
        undo
      </button>
      {showHelp ? (
        <PresetsHelpDialog onClose={() => setShowHelp(false)} />
      ) : null}
    </Section>
  )
}
