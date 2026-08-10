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
  // How many of this stage's controls sit off stock, for the hover text. A
  // number rather than a finished clause: both drawings phrased it identically
  // and both wrote it out, which is one more thing that had no reason to be
  // said twice.
  touched: number
  // What that number counts, where "off stock" is the wrong noun for it. One
  // box needs this — the modulation bay, which counts patched slots and a gate
  // rather than controls moved off their resting value — and it arrives as a
  // finished clause because only the caller knows whether the gate is in the
  // count (see bayLoad). Absent, both drawings say "N off stock" as before.
  touchedSay?: string
  // What the miniature adds on the end when a press will fold the stage back up
  // again. The only part of the hover text the two drawings genuinely differ on,
  // and the card passes nothing because it has no fold to describe.
  foldHint?: string
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
  // Named first either way — the name is what the box says on its face, and a
  // label that opened on the hint instead announced the Sound box as "no sound
  // reaching it". What follows is the part that differs: an inert box is
  // announced by what it is *for*, which is picking the input it is missing,
  // rather than by the blurb of controls that cannot act yet.
  const said = `${props.name} — ${off ? props.offHint : props.blurb}`
  // The hover text is that same sentence with the counts on it, and an inert box
  // has no counts worth reading — nothing in it is reaching the picture, which
  // is the whole of what its hint says.
  const count =
    props.touched === 0
      ? ''
      : ` (${props.touchedSay ?? `${props.touched} off stock`})`
  const title = off ? said : `${said}${count}${props.foldHint ?? ''}`
  return (
    <g
      className={props.className}
      role={opens ? 'button' : undefined}
      tabIndex={opens ? 0 : undefined}
      aria-expanded={props.expanded}
      aria-label={opens ? said : undefined}
      onClick={opens ? props.onOpen : undefined}
      onKeyDown={e => {
        if (opens && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          props.onOpen()
        }
      }}
    >
      <title>{title}</title>
      {props.children}
    </g>
  )
}
