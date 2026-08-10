import { useRef, useState } from 'react'

import { cx } from './cx'
import { Popover } from './Popover'
import {
  PROFILE_NAME_MAX,
  PROFILE_SLOTS,
  cleanProfileName,
} from './savedProfiles'
import styles from './SavedProfiles.module.css'
import ui from './ui.module.css'

import type { CloudUser } from './cloud'
import type { SavedProfile } from './savedProfiles'
import type { CloudStatus, ProfileFlash } from './useSavedProfiles'

// The profile library, and the account it lives on: one button in the
// masthead's top-right corner, beside the ⌕ and the ⋮. A synth's save/recall,
// plus who it belongs to.
//
// It moved here from a slot in the LookBar row, among compare/mutate/undo,
// because those are verbs that act on the look that's on screen right now and
// this isn't one — it's a fact about the session, the same kind of fact the ⋮
// answers for the app as a whole. Buried a verb-width away from "mutate" it
// also read as one more thing to press to change the picture, when its whole
// job signed-out is the opposite: say there is an account to sign into at all.
//
// Signing in lives *here* rather than folded into the ⋮ menu's list, because
// this is the only thing in the app an account is for. A row in that menu would
// be an account prompt with no visible purpose; in this popover it is the
// answer to the question the popover just raised — where would a save go?
//
// The button says `saved` rather than naming the noun. "Looks" was the first
// label and it read as a verb ("looks 3" — looks three what?); `saved` is what
// the press does and what the list holds, and it leaves "the look" meaning the
// live board everywhere else in the app.
//
// It is a popover rather than a section of the panel because saving is a thing
// you do for two seconds and recall is a list you open — neither wants a fold of
// permanent panel height. Presets sit further down as chips because they are the
// app's own catalog, browsed by eye; this list is yours and starts empty, so a
// section for it would open onto nothing on every first session.
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
  // Resolves false when the clipboard refused the write, so the ✓ below stands
  // for something that happened rather than for something that was attempted.
  onCopyLink: (profile: SavedProfile) => Promise<boolean>
  // What just happened to a save, for a beat. Shown on the button, because two of
  // the three ways to save leave this menu shut — so this is the only surface
  // that can answer them.
  flash: ProfileFlash | null
  // Who the library belongs to, and whether it can be written to at all. Saving
  // is a signed-in act — Firestore is the only store — so `status` decides
  // whether this menu shows a name box or a sign-in button.
  status: CloudStatus
  user: CloudUser | null
  error: string | null
  onSignIn: () => void
  onSignOut: () => void
}) {
  const signedIn = props.status === 'ready'
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
    void props.onCopyLink(profile).then(ok => {
      // A refusal has already put itself on the stage banner; what matters here
      // is that the row does not also claim success.
      if (!ok) return
      setCopied(profile.name)
      setTimeout(() => setCopied(null), 1200)
    })
  }

  return (
    <Popover
      // Caret straight in the name box, so opening the menu and typing a name is
      // one gesture. Not on a touch screen: there the keyboard would come up over
      // the list every time somebody opened this to *recall* something, which is
      // the more common half. `matchMedia` off the field's own window, since the
      // panel can be living in the popout.
      onOpen={() => {
        // No box to focus while signed out — the sign-in button is what is there.
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
            props.flash?.kind === 'saved' && styles.justSaved,
            props.flash?.kind === 'needs-auth' && styles.needsAuth,
            props.flash?.kind === 'failed' && styles.failed,
          )}
          popoverTarget={attrs.popoverTarget}
          style={attrs.style}
          title={
            signedIn
              ? 'save this look as a named profile and bring it back later, like the voices on a synth (ctrl+S saves without opening this) — the list lives on your account'
              : 'sign in to save looks under a name — everything else in the app works signed out'
          }
        >
          {/* A glyph and a colour, never the name: this button sits beside the
              fixed-width ⌕ and ⋮ squares, and a label that grew to
              `saved “worn tape”` or `save failed` for two seconds would shove
              them sideways — twice, once each way. The count moves on a new
              save anyway; the ✓ is what an overwrite has to say, and the ✕ is
              what a rejected write has to.

              `sign in` is what this button says whenever there is no account
              behind it — loading, signed-out, or error — so the button itself
              is the answer to "am I signed in", rather than something you find
              out by opening the popover. */}
          {signedIn ? (
            <>
              saved
              {props.profiles.length === 0 ? '' : ` ${props.profiles.length}`}
              {props.flash?.kind === 'saved' ? ' ✓' : ''}
              {props.flash?.kind === 'failed' ? ' ✕' : ''}
            </>
          ) : (
            'sign in'
          )}
        </button>
      )}
    >
      {() => (
        <>
          {/* The two states of the head of this menu: a name box for a library
              you own, or the one button that gives you one. */}
          {signedIn ? null : (
            <SignInPane
              status={props.status}
              error={props.error}
              onSignIn={props.onSignIn}
            />
          )}
          {!signedIn ? null : (
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
                  nothing saved yet — press save to keep this look under the
                  name in the box. It is stored on your account, so it is there
                  on your next machine as well as your next session.
                </div>
              ) : (
                <>
                  <div className={styles.list}>
                    {props.profiles.map((profile, i) => (
                      <div className={styles.row} key={profile.name}>
                        <span
                          className={
                            i < PROFILE_SLOTS ? styles.slot : styles.slotNone
                          }
                          aria-hidden
                        >
                          {i < PROFILE_SLOTS ? i + 1 : ''}
                        </span>
                        <button
                          className={styles.recall}
                          title={
                            i < PROFILE_SLOTS
                              ? `recall “${profile.name}” — or press ${i + 1}. Shift+click (or shift+${i + 1}) overwrites it with the look on screen`
                              : `recall “${profile.name}” — shift+click to overwrite it with the look on screen`
                          }
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
                    the first nine are on the number keys — 1–9 recall,
                    shift+1–9 keeps the board over one. A recall brings back the
                    controls and the motion; the input stays whatever is patched
                    in. ⧉ copies a link that carries both.
                  </div>
                </>
              )}
              {/* Who the library belongs to, at the foot of it — the account is
                  the least interesting thing in this menu once you are in, so it
                  goes last and small, and it is the only place sign-out lives.
                  The avatar is there so "who am I signed in as" reads at a
                  glance, from the same photo every other Google surface shows —
                  not the initial-in-a-circle every account already has one. */}
              <div className={styles.acct}>
                <span className={styles.acctUser}>
                  {props.user?.photo === undefined ||
                  props.user.photo === null ? null : (
                    <img
                      className={styles.avatar}
                      src={props.user.photo}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span className={ui.dim}>
                    {props.user?.name ?? props.user?.uid.slice(0, 6) ?? ''}
                  </span>
                </span>
                <button
                  className={styles.acctBtn}
                  title="sign out — the library stays on your account, this browser just stops showing it"
                  onClick={props.onSignOut}
                >
                  sign out
                </button>
              </div>
              {props.error === null ? null : (
                <div className={cx(ui.hint, ui.err)}>{props.error}</div>
              )}
            </>
          )}
        </>
      )}
    </Popover>
  )
}

// The signed-out head of the menu: what an account is for here, and the button.
// One sentence, because the honest version is short — this is the only feature
// that needs one, and every other thing in the app works without it.
function SignInPane(props: {
  status: CloudStatus
  error: string | null
  onSignIn: () => void
}) {
  // Picking a session back up is not the same as being asked to start one: a
  // returning user would otherwise read the pitch for a feature they already
  // have, for as long as the SDK and the document take to arrive.
  if (props.status === 'loading') {
    return <div className={ui.hint}>checking your account…</div>
  }
  return (
    <div className={styles.signIn}>
      <div className={ui.hint}>
        sign in to keep looks under a name — they live on your Google account,
        so they follow you to another machine. Everything else here works signed
        out.
      </div>
      <button
        className={styles.saveBtn}
        title="sign in with Google — the app stores your saved looks and nothing else"
        onClick={props.onSignIn}
      >
        sign in with Google
      </button>
      {props.error === null ? null : (
        <div className={cx(ui.hint, ui.err)}>{props.error}</div>
      )}
    </div>
  )
}
