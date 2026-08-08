import { useRef, useState } from 'react'

import { FILTER_FROM, filterLibrary, libraryGroups } from './clipLibrary'
import styles from './ClipLibrary.module.css'
import { cx } from './cx'
import { Popover } from './Popover'

import type { Clip, Library, LibraryAccess } from './clipLibrary'
import type { StashSlot } from './fileStash'

// The caption under a slot that is on the shelf, and — since it is already the
// thing you click to change clip — the shelf itself, in the smallest form that
// can be one.
//
// Swapping clips mid-set is the common act and the dialog is the wrong size for
// it: it is modal, it covers the picture you are choosing against, and it
// carries add/remove/rescan, none of which you are doing while the set is
// running. So the caption opens a menu instead — the names, a filter once there
// are enough of them to need one, and a way through to the full shelf for
// everything this deliberately leaves out.
//
// A native popover, like the saved-look menu: light dismiss, Escape and
// one-open-at-a-time come from the browser, and the top layer means the
// sidebar's own scrolling cannot clip it.
export function ClipPicker(props: {
  // Which deck this caption belongs to. Rows play into it and nowhere else —
  // sending a clip to the other deck is a two-deck act, and it stays in the
  // dialog with the rest of them.
  slot: StashSlot
  // What the slot is playing now, for the caption itself.
  name: string
  lib: Library
  access: LibraryAccess
  note: string
  onPlay: (clip: Clip, slot: StashSlot) => void
  onOpenShelf: () => void
}) {
  const [query, setQuery] = useState('')
  const fieldRef = useRef<HTMLInputElement>(null)
  const shown = libraryGroups(filterLibrary(props.lib, query))
  const filterable = props.lib.clips.length >= FILTER_FROM
  // Enter plays the first name in the narrowed list, so a clip three letters
  // into the filter costs no click at all.
  const first = shown[0]?.clips[0]

  const play = (clip: Clip) => {
    // A clip with nothing behind it cannot be played from here, and the reason
    // is a paragraph — the shelf outlived the session, re-pick the folder — so
    // the click goes where that paragraph is rather than failing quietly.
    if (props.access.clips.get(clip.id)?.state === 'lost') props.onOpenShelf()
    else props.onPlay(clip, props.slot)
  }

  return (
    <Popover
      // Every opening starts on the whole shelf. Nothing here holds open state,
      // so without this the query survives the dismissal and the menu reopens
      // narrowed to whatever was typed at it minutes ago — one row, and no clue
      // that the rest of the shelf is behind a filter you cannot see the effect
      // of until you clear it.
      //
      // Then the caret in the filter, the same gesture the saved-look menu makes
      // and with the same exception: on a touch screen the keyboard would come
      // up over the list every time somebody opened this to *read* it.
      onOpen={() => {
        setQuery('')
        const el = fieldRef.current
        const win = el?.ownerDocument.defaultView
        if (
          el !== null &&
          win?.matchMedia('(pointer: coarse)').matches !== true
        )
          el.select()
      }}
      trigger={attrs => (
        <button
          type="button"
          className={styles.trigger}
          popoverTarget={attrs.popoverTarget}
          style={attrs.style}
          title={`${props.name} — click for the rest of the shelf`}
        >
          {props.name === '' ? 'pick a clip…' : props.name}
        </button>
      )}
    >
      {id => (
        <>
          {filterable ? (
            <input
              ref={fieldRef}
              className={styles.filter}
              type="text"
              value={query}
              placeholder="filter"
              aria-label="filter the shelf"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && first !== undefined) {
                  play(first)
                  // Dismissed by hand: the field is not a row, so it carries
                  // none of the popoverTarget attributes that close this. Off
                  // the field's own document, since the panel may be living in
                  // the popped-out window.
                  e.currentTarget.ownerDocument
                    .getElementById(id)
                    ?.hidePopover()
                }
              }}
            />
          ) : null}

          <div className={styles.pickList}>
            {props.lib.clips.length === 0 ? (
              <div className={styles.pickEmpty}>
                nothing on the shelf yet — open it to add a folder
              </div>
            ) : shown.length === 0 ? (
              <div className={styles.pickEmpty}>no clip matches “{query}”</div>
            ) : (
              shown.map(group => (
                <div key={group.folder?.id ?? 'loose'}>
                  {/* The folder is a heading only when there is more than one
                      thing to tell apart. A single folder's name over every row
                      of a shelf that is all one folder is a line spent saying
                      what the row below it already says. */}
                  {shown.length === 1 ? null : (
                    <div className={styles.pickHead}>
                      {group.folder === null
                        ? 'picked files'
                        : `${group.folder.name}/`}
                    </div>
                  )}
                  {group.clips.map(clip => {
                    const lost =
                      props.access.clips.get(clip.id)?.state === 'lost'
                    return (
                      <button
                        key={clip.id}
                        type="button"
                        className={cx(styles.pickRow, lost && styles.nameLost)}
                        popoverTarget={id}
                        popoverTargetAction="hide"
                        title={
                          lost
                            ? `${clip.name} — not open in this session, open the shelf to reconnect it`
                            : `play ${clip.name} on source ${props.slot.toUpperCase()}`
                        }
                        onClick={() => play(clip)}
                      >
                        {clip.name}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {props.note === '' ? null : (
            <div className={styles.pickNote}>{props.note}</div>
          )}

          {/* Everything this menu does not do. Named for the thing rather than
              the verb, because from here it is where you go to *add* clips as
              often as to tidy them. */}
          <button
            type="button"
            className={styles.pickFoot}
            popoverTarget={id}
            popoverTargetAction="hide"
            onClick={props.onOpenShelf}
            title="the whole shelf: add files and folders, rescan, and take things off it"
          >
            shelf…
          </button>
        </>
      )}
    </Popover>
  )
}
