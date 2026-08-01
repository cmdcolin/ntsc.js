import { useId } from 'react'

import styles from '../app.module.css'
import { cx } from './cx'

import type { Phase } from './controls'
import type { CSSProperties } from 'react'

// The chain as a rack of modules, patched left to right in the order the
// picture travels: a small block per stage, a jack on each side of it, and a
// cable sagging between them. Feedback is the long cable looping back over the
// top. Clicking a module opens that stage; ChainParts lists what each can do.
//
// One committed palette, read as brightness rather than as hue: phosphor green
// throughout, one sharp amber for a stage carrying an edit, full-bright for the
// stage that is open.
//
// Nothing here is a pixel: the svg stretches to its container, so a unit is
// worth (container width / W) px and every size below is really a ratio.
const W = 426
const H = 48
// Gap between modules — the run each patch cable has to cross. Generous on
// purpose: a cable needs room to sag before it reads as a cable.
const GAP = 30

// The module row, with its names hung underneath.
const MID_Y = 26
const BOX_H = 15
const LABEL_Y = 43
// How far a cable droops between two jacks.
const SAG = 5
// The feedback cable's apex, above the row of modules.
const ARC_Y = 4
// Half-height of the loop's arrowhead.
const HEAD = 3.4

// A patch cable between two jacks on the same row: it leaves each jack level,
// then droops in the middle under its own weight.
function cable(x0: number, x1: number, y: number) {
  const pull = (x1 - x0) * 0.36
  return `M${x0} ${y}C${x0 + pull} ${y + SAG} ${x1 - pull} ${y + SAG} ${x1} ${y}`
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
  onOpen: (name: string) => void
}) {
  // The svg points at its own <defs> by id, and useId keeps that reference
  // unique. Its delimiters aren't valid inside a url(#…), hence the strip.
  const baseId = useId().replace(/[^a-z0-9]/gi, '')
  const glow = `${baseId}glow`

  const step = W / props.stages.length
  const boxW = step - GAP
  const centers = props.stages.map((_, i) => step * (i + 0.5))
  const top = MID_Y - BOX_H / 2
  const feedbackAt = props.stages.findIndex(s => s.name === 'Feedback')
  const last = props.stages.length - 1
  // Jack to jack down the rack, plus the lead in off the left edge and the lead
  // out off the right — so the chain reads as something fed and something
  // delivered, rather than as five modules that begin and end nowhere.
  const cables = [
    { key: 'in', d: cable(0, centers[0] - boxW / 2, MID_Y) },
    ...centers.slice(0, -1).map((c, i) => ({
      key: props.stages[i].name,
      d: cable(c + boxW / 2, centers[i + 1] - boxW / 2, MID_Y),
    })),
    { key: 'out', d: cable(centers[last] + boxW / 2, W, MID_Y) },
  ]
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
      className={styles.map}
      viewBox={`0 0 ${W} ${H}`}
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
      {/* The patch: a cable from each module's out jack to the next one's in,
          plus the leads off either edge of the rack. Each is drawn twice — the
          rubber, then the signal travelling inside it — off the same path, so
          the flow follows the droop instead of cutting across it. */}
      {cables.map(({ key, d }) => (
        <g key={key}>
          <path className={styles.mapCable} d={d} />
          <path
            className={cx(styles.mapCable, styles.mapFlow)}
            d={d}
            filter={`url(#${glow})`}
          />
          {/* a second, sparser train at its own speed: one dash pattern reads
              as a marching-ants border, two read as something travelling */}
          <path
            className={cx(styles.mapCable, styles.mapFlow, styles.mapFlowFast)}
            d={d}
            filter={`url(#${glow})`}
          />
        </g>
      ))}
      {loop === null ? null : (
        <>
          <path
            className={cx(styles.mapCable, styles.mapLoop)}
            d={`M${loop.from} ${top}C${loop.from} ${ARC_Y} ${loop.to} ${ARC_Y} ${loop.to} ${top}`}
          />
          <path
            className={cx(
              styles.mapCable,
              styles.mapLoop,
              styles.mapFlow,
              loop.lit && styles.mapLoopOn,
            )}
            d={`M${loop.from} ${top}C${loop.from} ${ARC_Y} ${loop.to} ${ARC_Y} ${loop.to} ${top}`}
            filter={loop.lit ? `url(#${glow})` : undefined}
          />
          <path
            className={cx(styles.mapLoopHead, loop.lit && styles.mapLoopOn)}
            d={`M${loop.to - HEAD} ${top - HEAD * 1.5}L${loop.to} ${top}L${loop.to + HEAD} ${top - HEAD * 1.5}Z`}
          />
        </>
      )}
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
            height={BOX_H}
            rx="1.5"
            filter={props.open === stage.name ? `url(#${glow})` : undefined}
          />
          {/* the jacks the cables plug into, one each side */}
          <circle
            className={styles.mapJack}
            cx={centers[i] - boxW / 2}
            cy={MID_Y}
            r="2"
          />
          <circle
            className={styles.mapJack}
            cx={centers[i] + boxW / 2}
            cy={MID_Y}
            r="2"
          />
          {/* the module's lamp: lit amber the moment the stage carries an edit,
              so the rack reads as a status map at a glance */}
          <circle
            className={cx(styles.mapLed, stage.touched > 0 && styles.mapLedOn)}
            cx={centers[i]}
            cy={top + BOX_H / 2}
            r="2.4"
          />
          <text
            className={styles.mapLabel}
            x={centers[i]}
            y={LABEL_Y}
            textAnchor="middle"
          >
            {stage.name}
          </text>
        </g>
      ))}
    </svg>
  )
}

// What each stage can do, in a column under its box — same column count as the
// diagram, so an effect sits beneath the stage that applies it. Only the dialog
// has room for this.
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
