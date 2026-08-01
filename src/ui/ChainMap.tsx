import { useId } from 'react'

import styles from '../app.module.css'
import { cx } from './cx'

import type { Phase } from './controls'
import type { CSSProperties } from 'react'

// The chain as a block diagram: a labeled box per stage, wired left to right in
// the order the picture travels, with feedback looping back over the top, and
// the signal running the wire as travelling dashes. Clicking a box opens that
// stage. Beside the dialog copy, ChainParts lists what each stage can do.
//
// Nothing here is a pixel: the svg stretches to its container, so a unit is
// worth (container width / W) px and every size below is really a ratio.
const W = 426
// Gap between boxes, leaving room for the wire and its arrowhead.
const GAP = 14

// The same chain at two sizes — and they are not the same drawing. In the
// ~850px dialog a unit is ~2px, so an 8-unit name sits inside its box at ~16px.
// The panel is 332px, where a box is ~55px and an eight-letter name needs ~58px
// at the smallest type this UI allows: it cannot go inside. So the strip hangs
// the name under the box, where it gets the full ~85-unit column instead.
const LAYOUT = {
  card: { h: 55, midY: 34, boxH: 20, arcY: 4, head: 3.4, labelY: 36.9 },
  strip: { h: 47, midY: 22, boxH: 14, arcY: 3, head: 2.8, labelY: 42 },
}

export interface ChainStage {
  name: Phase
  blurb: string
  touched: number
  // The stage's effect groups, in chain order.
  parts: { name: string; touched: number; onOpen: () => void }[]
}

export function ChainMap(props: {
  stages: ChainStage[]
  open: string | null
  // 'strip' is the panel's always-visible copy, 'card' the full dialog.
  size: 'strip' | 'card'
  onOpen: (name: string) => void
}) {
  // The svg points at its own <defs> by id, and the strip and the dialog are on
  // screen at once whenever the dialog is up — useId keeps the two copies from
  // colliding. Its delimiters aren't valid in a url(#…), hence the strip.
  const baseId = useId().replace(/[^a-z0-9]/gi, '')
  const glow = `${baseId}glow`

  const { h, midY, boxH, arcY, head, labelY } = LAYOUT[props.size]
  const strip = props.size === 'strip'
  const step = W / props.stages.length
  const boxW = step - GAP
  const centers = props.stages.map((_, i) => step * (i + 0.5))
  const top = midY - boxH / 2
  const feedbackAt = props.stages.findIndex(s => s.name === 'Feedback')
  const last = props.stages.length - 1
  // The loop only reads as a loop if it comes back from somewhere downstream.
  const loop =
    feedbackAt >= 0 && feedbackAt < last
      ? {
          from: centers[last],
          to: centers[feedbackAt],
          lit: props.stages[feedbackAt].touched > 0,
        }
      : null

  return (
    <svg
      className={cx(styles.map, strip && styles.mapStrip)}
      viewBox={`0 0 ${W} ${h}`}
      role="group"
      aria-label="signal chain"
    >
      <defs>
        {/* phosphor bloom — what makes the live wire and the open stage read as
            emitting light rather than as a merely lighter gray */}
        <filter id={glow} x="-20%" y="-100%" width="140%" height="300%">
          <feGaussianBlur stdDeviation="1.1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* the wire, with the signal flowing along it behind the boxes */}
      <path className={styles.mapWire} d={`M0 ${midY}H${W}`} />
      <path
        className={cx(styles.mapWire, styles.mapFlow)}
        d={`M0 ${midY}H${W}`}
        filter={`url(#${glow})`}
      />
      {/* a second, sparser train at its own speed: one dash pattern reads as a
          marching-ants border, two read as something travelling */}
      <path
        className={cx(styles.mapWire, styles.mapFlow, styles.mapFlowFast)}
        d={`M0 ${midY}H${W}`}
        filter={`url(#${glow})`}
      />
      {loop === null ? null : (
        <>
          <path
            className={cx(
              styles.mapLoop,
              styles.mapFlow,
              loop.lit && styles.mapLoopOn,
            )}
            d={`M${loop.from} ${top}C${loop.from} ${arcY} ${loop.to} ${arcY} ${loop.to} ${top}`}
            filter={loop.lit ? `url(#${glow})` : undefined}
          />
          <path
            className={cx(styles.mapLoopHead, loop.lit && styles.mapLoopOn)}
            d={`M${loop.to - head} ${top - head * 1.5}L${loop.to} ${top}L${loop.to + head} ${top - head * 1.5}Z`}
          />
        </>
      )}
      {centers.slice(0, -1).map((c, i) => (
        <path
          key={props.stages[i].name}
          className={styles.mapArrow}
          d={`M${(c + centers[i + 1]) / 2 - head / 2} ${midY - head}l${head} ${head}l${-head} ${head}`}
        />
      ))}
      {props.stages.map((stage, i) => (
        <g
          key={stage.name}
          className={cx(
            styles.mapNode,
            stage.touched > 0 && styles.mapNodeTouched,
            props.open === stage.name && styles.mapNodeOn,
          )}
          role="button"
          tabIndex={0}
          aria-label={`${stage.name} — ${stage.blurb}`}
          onClick={() => props.onOpen(stage.name)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              props.onOpen(stage.name)
            }
          }}
        >
          <title>{`${stage.name} — ${stage.blurb}${stage.touched > 0 ? ` (${stage.touched} off stock)` : ''}`}</title>
          <rect
            className={styles.mapBox}
            x={centers[i] - boxW / 2}
            y={top}
            width={boxW}
            height={boxH}
            rx="3"
            filter={props.open === stage.name ? `url(#${glow})` : undefined}
          />
          <text
            className={cx(styles.mapLabel, strip && styles.mapLabelUnder)}
            x={centers[i]}
            y={labelY}
            textAnchor="middle"
          >
            {stage.name}
          </text>
          {/* a stage carrying edits says so on its box, so the strip reads as a
              status map at a glance rather than only on hover */}
          {stage.touched === 0 ? null : (
            <circle
              className={styles.mapDot}
              cx={centers[i] + boxW / 2 - 4}
              cy={top + 4}
              r="1.8"
            />
          )}
        </g>
      ))}
    </svg>
  )
}

// What each stage can do, in a column under its box — same column count as the
// diagram, so an effect sits beneath the stage that applies it. Only the dialog
// has room for this; the panel strip is the wire and its boxes alone.
export function ChainParts(props: { stages: ChainStage[] }) {
  const cols: CSSProperties & Record<'--cols', string> = {
    '--cols': String(props.stages.length),
  }
  return (
    <div className={styles.mapParts} style={cols}>
      {props.stages.map(stage => (
        <div key={stage.name}>
          {stage.parts.map(part => (
            <button
              key={part.name}
              className={cx(
                styles.mapPart,
                part.touched > 0 && styles.mapPartOn,
              )}
              title={
                part.touched > 0
                  ? `${part.name} — ${part.touched} control${part.touched === 1 ? '' : 's'} off stock; click to open`
                  : `${part.name} — click to open`
              }
              onClick={() => part.onOpen()}
            >
              {part.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
