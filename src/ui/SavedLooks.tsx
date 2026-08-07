import { useState } from 'react'

import { Popover } from './Popover'
import { LOOK_NAME_MAX, cleanLookName } from './savedLooks'
import styles from './SavedLooks.module.css'
import ui from './ui.module.css'

import type { SavedLook } from './savedLooks'

// The library, as one button in the look bar: name what is on screen and get it
// back later. A synth's save/recall, in the row with the other verbs that act on
// the whole board.
//
// It is a popover rather than a section of the panel because saving is a thing
// you do for two seconds and recall is a list you open — neither wants a fold of
// permanent panel height, and the row it hangs off is already where "do
// something to the whole look" lives. Presets sit right below as chips because
// they are the app's own catalog, browsed by eye; this list is yours and starts
// empty, so a section for it would open onto nothing on every first session.
export function SavedLooks(props: {
  looks: readonly SavedLook[]
  // What the name box offers when you type nothing: the name of the look this
  // session is working in, or the board's own preset name, with a counter if
  // that is already taken. Decided outside (useSavedLooks holds which look was
  // last saved or recalled) so the ⌘K row that saves without opening this menu
  // offers exactly the same name.
  suggestedName: string
  onSave: (name: string) => void
  onRecall: (look: SavedLook) => void
  onDelete: (name: string) => void
  onCopyLink: (look: SavedLook) => void
}) {
  const [name, setName] = useState('')
  // Which row's link just went to the clipboard. A copy is otherwise silent —
  // nothing on screen changes — so the glyph answers for a second.
  const [copied, setCopied] = useState<string | null>(null)

  // Typing nothing saves under the suggestion, which is what the placeholder is
  // already showing. That is the whole "easy" of this: open, press save, done.
  const save = (given?: string) => {
    props.onSave(
      given ?? (cleanLookName(name) === '' ? props.suggestedName : name),
    )
    setName('')
  }
  const copy = (look: SavedLook) => {
    props.onCopyLink(look)
    setCopied(look.name)
    setTimeout(() => setCopied(null), 1200)
  }

  return (
    <Popover
      trigger={attrs => (
        <button
          className={styles.trigger}
          popoverTarget={attrs.popoverTarget}
          style={attrs.style}
          title="save this look under a name and bring it back later, like the voices on a synth — the list is yours and lives in this browser"
        >
          looks{props.looks.length === 0 ? '' : ` ${props.looks.length}`}
        </button>
      )}
    >
      {() => (
        <>
          {/* Deliberately not a <form>: a form inside a popover submits and, in
              every engine, that means a navigation unless it is cancelled — and
              this button is one keystroke away from throwing the session away.
              Enter is wired straight to the same call instead. */}
          <div className={styles.saveRow}>
            <input
              className={styles.nameInput}
              type="text"
              value={name}
              maxLength={LOOK_NAME_MAX}
              placeholder={props.suggestedName}
              aria-label="name for this look"
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') save()
              }}
            />
            <button
              className={styles.saveBtn}
              title="save the current look — controls and motion — under this name (an existing name is overwritten in place)"
              onClick={() => save()}
            >
              save
            </button>
          </div>
          {props.looks.length === 0 ? (
            <div className={ui.hint}>
              nothing saved yet — press save to keep this look under the name in
              the box
            </div>
          ) : (
            <>
              <div className={styles.list}>
                {props.looks.map(look => (
                  <div className={styles.row} key={look.name}>
                    <button
                      className={styles.recall}
                      title={`recall “${look.name}” — shift+click to overwrite it with the look on screen`}
                      onClick={e => {
                        if (e.shiftKey) save(look.name)
                        else props.onRecall(look)
                      }}
                    >
                      {look.name}
                    </button>
                    <button
                      className={styles.rowBtn}
                      title={`copy a link to “${look.name}”`}
                      aria-label={`copy a link to ${look.name}`}
                      onClick={() => copy(look)}
                    >
                      {copied === look.name ? '✓' : '⧉'}
                    </button>
                    <button
                      className={styles.rowBtn}
                      title={`delete “${look.name}”`}
                      aria-label={`delete ${look.name}`}
                      onClick={() => props.onDelete(look.name)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {/* What a recall does and does not do, said once. It matters: the
                  saved query carries the source urls so a *link* opens on the
                  right clip, but a recall in a running session leaves whatever
                  is patched in alone — pulling the webcam out from under someone
                  mid-set to put a still back is never the intent. */}
              <div className={ui.hint}>
                a recall brings back the controls and the motion; the input
                stays whatever is patched in. ⧉ copies a link that carries both.
              </div>
            </>
          )}
        </>
      )}
    </Popover>
  )
}
