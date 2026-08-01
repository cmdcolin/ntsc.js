import styles from '../app.module.css'
import { cx } from './cx'

import type { Phase } from './controls'
import type { CSSProperties } from 'react'

// The chain as a block diagram: a labeled box per stage, wired left to right in
// the order the picture travels, with feedback looping back over the top. Under
// each box, what that stage can do to the picture — its groups of effects, lit
// when something in them is off stock. Clicking a box or an effect opens there.
//
// The svg holds the boxes and the wiring, in viewBox units; the effect lists are
// html in a grid of the same column count, so they line up under their box at
// whatever width the dialog gives us.
//
// Nothing here is a pixel: the svg stretches to the card, so a unit is worth
// (card width / W) px and every size below is really a ratio. W is what sets the
// scale — at 426 units in the ~850px diagram card a unit is ~2px, which puts the
// 8-unit stage label at ~16px, a size you read rather than squint at.
const W = 426
const H = 55
const MID_Y = 34
const BOX_H = 20
// Gap between boxes, leaving room for the wire and its arrowhead.
const GAP = 14
// The loop-back arc's apex, above the row of boxes.
const ARC_Y = 4
// Half-height of the wire's direction chevrons and the loop's arrowhead.
const HEAD = 3.4

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
  const step = W / props.stages.length
  const boxW = step - GAP
  const centers = props.stages.map((_, i) => step * (i + 0.5))
  const top = MID_Y - BOX_H / 2
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

  const cols: CSSProperties & Record<'--cols', string> = {
    '--cols': String(props.stages.length),
  }
  return (
    <div>
      <svg
        className={styles.map}
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label="signal chain"
      >
        {/* the wire, with the signal flowing along it behind the boxes */}
        <path className={styles.mapWire} d={`M0 ${MID_Y}H${W}`} />
        <path
          className={cx(styles.mapWire, styles.mapFlow)}
          d={`M0 ${MID_Y}H${W}`}
        />
        {loop === null ? null : (
          <>
            <path
              className={cx(
                styles.mapLoop,
                styles.mapFlow,
                loop.lit && styles.mapLoopOn,
              )}
              d={`M${loop.from} ${top}C${loop.from} ${ARC_Y} ${loop.to} ${ARC_Y} ${loop.to} ${top}`}
            />
            <path
              className={cx(styles.mapLoopHead, loop.lit && styles.mapLoopOn)}
              d={`M${loop.to - HEAD} ${top - HEAD * 1.5}L${loop.to} ${top}L${loop.to + HEAD} ${top - HEAD * 1.5}Z`}
            />
          </>
        )}
        {centers.slice(0, -1).map((c, i) => (
          <path
            key={props.stages[i].name}
            className={styles.mapArrow}
            d={`M${(c + centers[i + 1]) / 2 - HEAD / 2} ${MID_Y - HEAD}l${HEAD} ${HEAD}l${-HEAD} ${HEAD}`}
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
              height={BOX_H}
              rx="3"
            />
            <text
              className={styles.mapLabel}
              x={centers[i]}
              y={MID_Y + 2.9}
              textAnchor="middle"
            >
              {stage.name}
            </text>
          </g>
        ))}
      </svg>
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
    </div>
  )
}
