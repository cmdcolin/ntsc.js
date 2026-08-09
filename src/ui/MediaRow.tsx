import { ORIGIN_LABEL } from '../sources/pools'
import { otherSlot } from './fileStash'

import type { PoolOrigin } from '../sources/pools'
import type { StashSlot } from './fileStash'

// The two pieces of a media row that three surfaces draw the same way, and that
// are each one edit away from being subtly wrong.
//
// They take a className because the shelf, the browser and the caption row are
// styled differently and should be — what is shared here is the *logic*, not the
// look. A component that also owned the styling would have to grow a variant
// prop, which is how a shared component starts costing more than the duplication
// it replaced.

// Send this to the deck the surface was *not* opened for.
//
// The reason it is a component rather than three copies of an `<button>`: every
// copy has to derive the other deck, label itself with the other deck, and hand
// the other deck to `onPlay` — three uses of one value, and writing `slot` for
// any of them typechecks perfectly and quietly loads the wrong deck. Derived
// once here, that cannot be got wrong at a call site, which is the argument
// ui/slotView.ts makes at a larger scale.
export function OtherSlotButton(props: {
  slot: StashSlot
  // What the row is of, for the tooltip.
  label: string
  onPlay: (slot: StashSlot) => void
  className: string
}) {
  const target = otherSlot(props.slot)
  return (
    <button
      className={props.className}
      title={`show ${props.label} on source ${target.toUpperCase()} instead`}
      onClick={() => props.onPlay(target)}
    >
      {target.toUpperCase()}
    </button>
  )
}

// The way through to who made this and under what terms.
//
// Every surface that shows somebody else's file carries one — the caption under
// a playing source, a kept row on the shelf, a result in the browser — because
// this app composites other people's pictures into something recordable and
// nothing else in it leads to the credit. One definition so that "new tab, no
// referrer" cannot be forgotten on the fourth: a set is never navigated away
// from.
// `href` rather than a ref to derive it from: a pick that is playing carries the
// page the API itself gave (`descriptionurl`), and a shelf row works it out from
// the title (`poolPageUrl`). Those agree, but the first is the answer and the
// second is the reconstruction, so each caller passes the one it has.
export function CreditLink(props: {
  origin: PoolOrigin
  href: string
  label: string
  className: string
}) {
  return (
    <a
      className={props.className}
      href={props.href}
      target="_blank"
      rel="noreferrer"
      title={`open ${props.label} on ${ORIGIN_LABEL[props.origin]} — who made it, and under which licence`}
    >
      ↗
    </a>
  )
}
