import { useRef, useState } from 'react'

import { cx } from './cx'
import { Popover } from './Popover'
import { PROFILE_NAME_MAX, cleanProfileName } from './savedProfiles'
import styles from './SavedProfiles.module.css'
import ui from './ui.module.css'

import type { SavedProfile } from './savedProfiles'

// The profile library, as one button in the look bar: name what is on screen and
// get it back later. A synth's save/recall, in the row with the other verbs that
// act on the whole board.
//
// The button says `saved` rather than naming the noun. "Looks" was the first
// label and it read as a verb ("looks 3" — looks three what?); `saved` is what
// the press does and what the list holds, and it leaves "the look" meaning the
// live board everywhere else in the app.
//
// It is a popover rather than a section of the panel because saving is a thing
// you do for two seconds and recall is a list you open — neither wants a fold of
// permanent panel height, and the row it hangs off is already where "do
// something to the whole look" lives. Presets sit right below as chips because
// they are the app's own catalog, browsed by eye; this list is yours and starts
// empty, so a section for it would open onto nothing on every first session.
export function SavedProfiles(props: {
  profiles: readonly SavedProfile[]
  // What the name box offers when you type nothing: the name of the profile this
  // session is working in, or the board's own preset name, with a counter if that
  // is already taken. Decided outside (useSavedProfiles holds which profile was
  // last saved or recalled) so the ⌘K row and ctrl+S, which save without opening
  // this menu, offer exactly the same name.
  suggestedName: string
  onSave: (name: string) => void
  onRecall: (profile: SavedProfile) => void
  onDelete: (name: string) => void
  onCopyLink: (profile: SavedProfile) => void
  // The name a save just landed under, or null. Shown on the button, because two
  // of the three ways to save leave this menu shut.
  saved: string | null
}) {
  const [name, setName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  // Which row's link just went to the clipboard. A copy is otherwise silent —
  // nothing on screen changes — so the glyph answers for a second.
  const [copied, setCopied] = useState<string | null>(null)

  // Typing nothing saves under the suggestion, which is what the placeholder is
  // already showing. That is the whole "easy" of this: open, press save, done.
  const save = (given?: string) => {
    props.onSave(
      given ?? (cleanProfileName(name) === '' ? props.suggestedName : name),
    )
    setName('')
  }
  const copy = (profile: SavedProfile) => {
    props.onCopyLink(profile)
    setCopied(profile.name)
    setTimeout(() => setCopied(null), 1200)
  }

  return (
    <Popover
      // Caret straight in the name box, so opening the menu and typing a name is
      // one gesture. Not on a touch screen: there the keyboard would come up over
      // the list every time somebody opened this to *recall* something, which is
      // the more common half. `matchMedia` off the field's own window, since the
      // panel can be living in the popout.
      onOpen={() => {
        const el = nameRef.current
        const win = el?.ownerDocument.defaultView
        if (
          el !== null &&
          win?.matchMedia('(pointer: coarse)').matches !== true
        )
          el.select()
      }}
      trigger={attrs => (
        <button
          className={cx(
            styles.trigger,
            props.saved !== null && styles.justSaved,
          )}
          popoverTarget={attrs.popoverTarget}
          style={attrs.style}
          title="save this look as a named profile and bring it back later, like the voices on a synth (ctrl+S saves without opening this) — the list is yours and lives in this browser"
        >
          {/* A ✓ and the accent, not the name: the row this button sits in is
              332px with no slack (see LookBar.module.css), and a label that grew
              to `saved “worn tape”` for a second and a half would reflow the two
              buttons after it — twice, once each way. The count beside it moves
              on a new save anyway; the tick is what an overwrite has to say. */}
          saved{props.profiles.length === 0 ? '' : ` ${props.profiles.length}`}
          {props.saved === null ? '' : ' ✓'}
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
              ref={nameRef}
              className={styles.nameInput}
              type="text"
              value={name}
              maxLength={PROFILE_NAME_MAX}
              placeholder={props.suggestedName}
              aria-label="name for this profile"
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
          {props.profiles.length === 0 ? (
            <div className={ui.hint}>
              nothing saved yet — press save to keep this look under the name in
              the box, and it will be here next session
            </div>
          ) : (
            <>
              <div className={styles.list}>
                {props.profiles.map(profile => (
                  <div className={styles.row} key={profile.name}>
                    <button
                      className={styles.recall}
                      title={`recall “${profile.name}” — shift+click to overwrite it with the look on screen`}
                      onClick={e => {
                        if (e.shiftKey) save(profile.name)
                        else props.onRecall(profile)
                      }}
                    >
                      {profile.name}
                    </button>
                    <button
                      className={styles.rowBtn}
                      title={`copy a link to “${profile.name}”`}
                      aria-label={`copy a link to ${profile.name}`}
                      onClick={() => copy(profile)}
                    >
                      {copied === profile.name ? '✓' : '⧉'}
                    </button>
                    <button
                      className={styles.rowBtn}
                      title={`delete “${profile.name}”`}
                      aria-label={`delete ${profile.name}`}
                      onClick={() => props.onDelete(profile.name)}
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
