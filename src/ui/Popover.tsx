import { useId } from 'react'

import styles from './Popover.module.css'

import type { CSSProperties, ReactNode } from 'react'

// One row of a popover menu. The icon sits in a fixed slot so glyphs and svgs
// share a text column; a blank hint means the action has no shortcut. `closes`
// is the menu's id: picking a row runs its action and dismisses the menu, and
// the browser does the dismissing, so there is no close callback to thread.
// Omitted, the row leaves the menu up — for a row that is stepped rather than
// picked, and wants the picture changing under a menu that stays put.
//
// It lives here rather than beside either menu that builds one: the styles it
// wears are this module's, and a second menu copying the markup to reach them
// is exactly how the two drift apart.
export function MenuItem(props: {
  icon: ReactNode
  label: string
  hint: string
  closes?: string
  // What the row does, for a menu whose labels are two words and whose rows do
  // something to the whole board. A hint is a shortcut and has a column of its
  // own; this is the sentence that will not fit in it.
  title?: string
  onClick: () => void
}) {
  return (
    <button
      className={styles.menuItem}
      title={props.title}
      popoverTarget={props.closes}
      popoverTargetAction={props.closes === undefined ? undefined : 'hide'}
      onClick={() => props.onClick()}
    >
      <span className={styles.menuLabel}>
        <span className={styles.menuIcon}>{props.icon}</span>
        {props.label}
      </span>
      {props.hint === '' ? null : (
        <span className={styles.menuHint}>{props.hint}</span>
      )}
    </button>
  )
}

// Click-to-open menu anchored to its trigger, built on the native popover.
//
// There is no open state and no event listener here on purpose. `popover="auto"`
// gets light dismiss (click anywhere outside), Escape, and one-open-at-a-time
// from the browser, so the whole thing is a few attributes and a CSS rule
// rather than a useState, a useRef and a document-level pointerdown listener.
//
// The other half of the reason is the top layer: a popover renders there rather
// than in place, so no ancestor's `overflow` can clip it. This menu opens
// downward inside a stage that is only as tall as the picture, and used to lose
// its last items whenever the picture was short.
//
// The anchor is named per instance rather than left implicit: Firefox 151 does
// not resolve the implicit anchor `popovertarget` is meant to set up, and two
// menus sharing one name would both resolve to whichever trigger came last.
// React's useId is not a valid CSS ident (it wraps its counter in « »), hence
// the strip.
export function Popover(props: {
  // The trigger gets the attributes that open the menu and make it the thing
  // the menu hangs off. Anything inside the menu that should close on click
  // takes the id and pairs it with popoverTargetAction="hide" — clicks that
  // land inside and say nothing, like a drag along the zoom slider, leave it
  // open.
  trigger: (attrs: { popoverTarget: string; style: CSSProperties }) => ReactNode
  children: (id: string) => ReactNode
  // Called when the browser opens or closes the menu. The point of it is the
  // *open* edge: a menu with a text field in it wants the caret in that field,
  // and since nothing here holds open state, this event is the only place that
  // knows the menu just appeared. React's `autoFocus` cannot do it — the field is
  // mounted once, while hidden, and never mounts again.
  onOpen?: () => void
}) {
  const id = useId()
  const anchorName = `--pop-${id.replaceAll(/\W/g, '')}`
  const { onOpen } = props
  return (
    <>
      {props.trigger({ popoverTarget: id, style: { anchorName } })}
      <div
        id={id}
        popover="auto"
        className={styles.menu}
        style={{ positionAnchor: anchorName }}
        onToggle={e => {
          if (e.newState === 'open') onOpen?.()
        }}
      >
        {props.children(id)}
      </div>
    </>
  )
}
