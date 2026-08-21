import { useRef } from 'react'

import { cx } from './cx'
import styles from './MenuRow.module.css'
import { Popover } from './Popover'

// One entry in a picker. A `group` puts it under that heading, and every option
// after it carrying the same one joins it — so a banded list is expressed by
// ordering the array, the same way the options' own order is already the display
// order. A caller with nothing to band passes no `group` and gets a flat list.
export interface PickOption<T extends string> {
  value: T
  label: string
  group?: string | null
}

// Consecutive runs of one heading. Built rather than grouped by key so an option
// can never be lifted out of the order the caller chose.
function bandsOf<T extends string>(
  options: readonly PickOption<T>[],
): { group: string | null; options: PickOption<T>[] }[] {
  const bands: { group: string | null; options: PickOption<T>[] }[] = []
  for (const o of options) {
    const group = o.group ?? null
    const last = bands.at(-1)
    if (last !== undefined && last.group === group) last.options.push(o)
    else bands.push({ group, options: [o] })
  }
  return bands
}

// A leading tag glyph and a menu of everything a slot can be patched to: the
// source pickers' row, and a `<select>` in every respect but the one that
// matters.
//
// **A native select cannot say "that one again".** `change` fires when the value
// changes, so choosing the option already chosen fires nothing at all — and half
// of what a source picker offers is not a value but a *door*. File… opens the OS
// dialog, Clips… the shelf, Browse… the media search, the two archives roll a
// fresh file out of a pool, Screen… asks the browser. Re-picking one of those is
// the ordinary thing to want — open a different file — and it was the single
// gesture the picker could not make. The caption underneath (FileName.tsx) was
// built to carry it and still carries it, but a caption is a second surface you
// have to be told about; the option you just clicked doing nothing is what
// anyone meets first.
//
// So: a button, and a popover of buttons. Every row fires `onChange`, whether or
// not it is the row already lit. Everything else about the shape is the native
// select's — the tag column, the row height, the label text — because the
// panel's settings lists are still native selects (a settings list has no door
// in it, so it loses nothing) and the two sit inches apart.
//
// Built on the same native popover the app's menus are (Popover.tsx): light
// dismiss, Escape and one-open-at-a-time come from the browser rather than from
// a state and a document listener, and the top layer means neither the sidebar's
// scrolling nor a short stage can clip a list of twenty rows opened at the head
// of one.
//
// Plain buttons, not `role="listbox"`: that role promises arrow-key navigation,
// and the menus this app already has (the shelf's, the app's ☰) are tabbed
// through like the rest of the panel. Promising the keyboard contract without
// implementing it is worse than not claiming it.
export function MenuRow<T extends string>(props: {
  tag: string
  title: string
  value: T
  options: readonly PickOption<T>[]
  onChange: (value: T) => void
}) {
  // The label for what is on now. A value with no option — a capture device
  // unplugged since it was picked — falls back to the value itself rather than
  // drawing an empty button.
  const current = props.options.find(o => o.value === props.value)
  const listRef = useRef<HTMLDivElement>(null)
  // Cap the list at the room actually left under the row, measured when it
  // opens.
  //
  // **The rows past the fold are the ones a hand came for.** The menu opens
  // downward from wherever its row happens to be, source A's list is twenty
  // entries, and the band a session reaches for most — Your own, which is where
  // File… and Clips… are — is second from the bottom. Left to a fixed cap the
  // list simply ran off the screen at the panel's own bottom, scrollbox and all:
  // not clipped, since a popover is in the top layer, but with its last inch
  // below the viewport and nothing able to scroll to it.
  //
  // Measured rather than expressed in CSS because there is no CSS for it here:
  // `anchor()` is valid in inset properties and not in `max-height`, and the
  // engine this app is developed against honours neither `position-area` nor
  // `position-try` (Popover.tsx). A viewport fraction is not the same question —
  // the answer moves with how far the panel is scrolled.
  //
  // Off the list's own document, since the panel may be living in the popped-out
  // window, and floored so a row at the very bottom of a short window still
  // opens something rather than a sliver.
  const fitList = () => {
    const el = listRef.current
    if (el === null) return
    const win = el.ownerDocument.defaultView
    if (win === null) return
    const room = win.innerHeight - el.getBoundingClientRect().top - 12
    el.style.maxHeight = `${Math.max(140, room)}px`
  }
  return (
    <div className={styles.row}>
      <span className={styles.tag} title={props.title}>
        {props.tag}
      </span>
      <Popover
        onOpen={fitList}
        trigger={attrs => (
          <button
            type="button"
            className={styles.trigger}
            popoverTarget={attrs.popoverTarget}
            style={attrs.style}
            aria-label={props.title}
            title={current?.label ?? props.value}
          >
            <span className={styles.label}>
              {current?.label ?? props.value}
            </span>
            <span className={styles.caret}>▾</span>
          </button>
        )}
      >
        {id => (
          <div ref={listRef} className={styles.list}>
            {/* Keyed by position, which is what a band is: two runs of the same
                heading are two bands, and keying on the heading would collide
                the moment a list ever had one. */}
            {bandsOf(props.options).map((band, i) => (
              <div key={i}>
                {band.group === null ? null : (
                  <div className={styles.head}>{band.group}</div>
                )}
                {band.options.map(o => {
                  const on = o.value === props.value
                  return (
                    <button
                      key={o.value}
                      type="button"
                      className={cx(styles.item, on && styles.itemOn)}
                      popoverTarget={id}
                      popoverTargetAction="hide"
                      aria-current={on}
                      // The labels are sentences and the menu is capped at the
                      // width of the picture beside it, so the tail of a long
                      // one lives here.
                      title={o.label}
                      onClick={() => props.onChange(o.value)}
                    >
                      <span className={styles.mark}>{on ? '✓' : ''}</span>
                      <span className={styles.label}>{o.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </Popover>
    </div>
  )
}
