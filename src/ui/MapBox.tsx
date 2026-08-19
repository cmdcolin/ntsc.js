import type { ReactNode } from 'react'

// What a target on a drawing of the chain *is to a hand*: whether it is a
// button, what it announces to a screen reader, and what Enter and Space do on
// it. Two kinds of target — a box on the trunk (MapBox) and a run over it
// (MapRun) — and two drawings of the same chain: the miniature at the head of
// the sidebar (ChainMap) and the full card (SignalPathDialog).
//
// It exists because that rule had drifted between the two drawings. When the
// source pickers moved inside the stages, `off` stopped meaning "opens
// nothing": a branch with nothing patched in is drawn inert and still opens,
// because the picker that ends that state is the first thing inside it. That was
// applied to the miniature and not to the diagram, which left SOURCE B pressable
// on one drawing and dead on the other, under a card whose own text says "click
// one to open its controls".
//
// The geometry stays with each drawing. The two are different pictures at
// different sizes, and nothing about a rect or a path is at risk of drifting in
// a way anybody would fail to notice — unlike a box that silently stops being a
// button.

// The `<g>` a press lives on. Both kinds of target below are this plus the
// sentence they assemble, which is the only part they differ in.
function MapPress(props: {
  // Whether pressing it opens anything. False leaves a plain group: no role, no
  // tab stop, no name and no click — which is the honest drawing of a box that
  // is a statement about the chain rather than a door.
  opens: boolean
  // How it is announced.
  label: string
  // The hover text: the same sentence with whatever counts and instructions the
  // drawing has room for.
  title: string
  // The drawing's own classes for this target, its state included.
  className: string
  // Only where a press can close the stage again is this a disclosure with a
  // state to report. Left undefined on the bench and on the card, where a press
  // marks or opens but never closes, and claiming an expanded state would
  // announce a fold that is not there.
  expanded?: boolean
  onOpen: () => void
  // Each drawing's own geometry.
  children: ReactNode
}) {
  const { opens } = props
  return (
    <g
      className={props.className}
      role={opens ? 'button' : undefined}
      tabIndex={opens ? 0 : undefined}
      aria-expanded={props.expanded}
      aria-label={opens ? props.label : undefined}
      onClick={opens ? props.onOpen : undefined}
      onKeyDown={e => {
        if (opens && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          props.onOpen()
        }
      }}
    >
      <title>{props.title}</title>
      {props.children}
    </g>
  )
}

// One box on the chain — a stage the picture passes through, or one wired to
// one that does.
//
//   off   — nothing is patched in, so this stage's controls have nothing to act
//           on. Colours the box, and nothing else. Callers pass their own class.
//   opens — pressing it opens the stage. Not the negation of `off`; see above.
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
  // What is standing in this box, on the three that can hold something. Both
  // drawings caption it under the name in their own type, and it is said here
  // so the sentence a reader hears is the one a reader sees: the stage, what is
  // in it, then what the stage does. Never the truncated caption — the drawing
  // cuts its own text to its own boxes, and a screen reader has no box.
  patched?: string
  // What the miniature adds on the end when a press will fold the stage back up
  // again. The only part of the hover text the two drawings genuinely differ on,
  // and the card passes nothing because it has no fold to describe.
  foldHint?: string
  className: string
  expanded?: boolean
  onOpen: () => void
  children: ReactNode
}) {
  const { off } = props
  // Named first either way — the name is what the box says on its face, and a
  // label that opened on the hint instead announced the Sound box as "no sound
  // reaching it". What follows is the part that differs: an inert box is
  // announced by what it is *for*, which is picking the input it is missing,
  // rather than by the blurb of controls that cannot act yet.
  // An inert box says nothing here: `patched` is undefined whenever nothing is
  // in it, and the hint it carries instead is about that emptiness.
  const holds = props.patched === undefined ? '' : ` — ${props.patched}`
  const said = `${props.name}${holds} — ${off ? props.offHint : props.blurb}`
  // The hover text is that same sentence with the counts on it, and an inert box
  // has no counts worth reading — nothing in it is reaching the picture, which
  // is the whole of what its hint says.
  const count = countSay(props.touched, props.touchedSay)
  return (
    <MapPress
      opens={props.opens}
      label={said}
      title={off ? said : `${said}${count}${props.foldHint ?? ''}`}
      className={props.className}
      expanded={props.expanded}
      onOpen={props.onOpen}
    >
      {props.children}
    </MapPress>
  )
}

// One feedback run drawn over the chain, which for a loop is the whole of the
// door: none of the three is a stage the picture passes through, so none of them
// has a box, and the wire is what you press. It has no *off* state — a loop is a
// patch, so unlike a branch there is nothing to be unpatched from — but a live
// query can still leave it with nothing to open, which is what `opens` is for.
export function MapRun(props: {
  // The loop's own stage name, which is also what the run carries on its face.
  name: string
  blurb: string
  // The state only a loop has: its mix is off zero, so this machine is actually
  // running. It is the thing you ask of a loop, which is why it is said before
  // the count of what you have touched in it.
  live: boolean
  touched: number
  // What a press does, spelled out at the end of the hover text. The miniature
  // folds and the card does not, and that is the whole difference between them.
  pressHint: string
  // Whether pressing it opens anything. Defaults to true, which is every case
  // but one: a run the live filter did not reach is drawn as context and has no
  // controls left behind it to show.
  opens?: boolean
  className: string
  expanded?: boolean
  onOpen: () => void
  children: ReactNode
}) {
  const said = `${props.name} — ${props.blurb}${props.live ? ' — running' : ''}${countSay(props.touched)}`
  return (
    <MapPress
      opens={props.opens ?? true}
      label={`${said} — open its controls`}
      title={`${said}${props.pressHint}`}
      className={props.className}
      expanded={props.expanded}
      onOpen={props.onOpen}
    >
      {props.children}
    </MapPress>
  )
}

// The bracketed clause both kinds of target end on, and neither draws when
// there is nothing in it.
const countSay = (touched: number, say?: string) =>
  touched === 0 ? '' : ` (${say ?? `${touched} off stock`})`
