import { cx } from './cx'

import type { ReactNode } from 'react'

// One pressable box on a drawing of the chain — the `<g>` around it, and the
// whole of what a box *is to a hand*: whether it is a button, what it announces
// to a screen reader, and what Enter and Space do on it.
//
// It exists because there are two drawings of the same chain — the miniature at
// the head of the sidebar (ChainMap) and the full card (SignalPathDialog) — and
// this rule had drifted between them. When the source pickers moved inside the
// stages, `off` stopped meaning "opens nothing": a branch with nothing patched
// in is drawn inert and still opens, because the picker that ends that state is
// the first thing inside it. That was applied to the miniature and not to the
// diagram, which left SOURCE B pressable on one drawing and dead on the other,
// under a card whose own text says "click one to open its controls".
//
// So the two questions live here together, where they cannot come apart again:
//
//   off   — nothing is patched in, so this stage's controls have nothing to act
//           on. Colours the box, and nothing else. Callers pass their own class.
//   opens — pressing it opens the stage. Not the negation of `off`; see above.
//
// The geometry stays with each drawing. The two are different pictures at
// different sizes, and nothing about a rect is at risk of drifting in a way
// anybody would fail to notice — unlike a box that silently stops being a
// button.
export function MapBox(props: {
  // The name on the box's face, which is also how it is announced.
  name: string
  // What it is, when something is patched in.
  blurb: string
  // What it is instead while it is off — which for the two boxes that open is
  // an instruction rather than a description, because pressing them is the fix.
  offHint: string
  off: boolean
  opens: boolean
  // The hover text. Passed in rather than built here: this is the one thing the
  // two drawings genuinely say differently — the miniature adds whether a click
  // will fold the stage back up, and the card has no fold to describe.
  title: string
  // The drawing's own classes for this box, its state included.
  className: string
  // Only where a press can close the stage again is the box a disclosure with a
  // state to report. Left undefined on the bench and on the card, where a press
  // marks or opens but never closes, and claiming an expanded state would
  // announce a fold that is not there.
  expanded?: boolean
  onOpen: () => void
  // The rect and the label — each drawing's own geometry.
  children: ReactNode
}) {
  const { opens, off } = props
  return (
    <g
      className={cx(props.className)}
      role={opens ? 'button' : undefined}
      tabIndex={opens ? 0 : undefined}
      aria-expanded={props.expanded}
      // Named first either way — the name is what the box says on its face, and
      // a label that opened on the hint instead announced the Sound box as "no
      // sound reaching it". What follows is the part that differs: an inert box
      // is announced by what it is *for*, which is picking the input it is
      // missing, rather than by the blurb of controls that cannot act yet.
      aria-label={
        opens
          ? `${props.name} — ${off ? props.offHint : props.blurb}`
          : undefined
      }
      onClick={opens ? () => props.onOpen() : undefined}
      onKeyDown={e => {
        if (opens && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          props.onOpen()
        }
      }}
    >
      {/* An inert box says the same sentence on both drawings, so that case is
          answered here rather than at each of them; the caller's `title` is
          only ever the live one. */}
      <title>{off ? props.offHint : props.title}</title>
      {props.children}
    </g>
  )
}
