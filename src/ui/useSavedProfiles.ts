import { useEffect, useState } from 'react'

import {
  fetchProfiles,
  putProfiles,
  signIn as cloudSignIn,
  signOut as cloudSignOut,
  wasSignedIn,
  watchAuth,
} from './cloud'
import { removeProfile, upsertProfile } from './savedProfiles'

import type { CloudUser } from './cloud'
import type { SavedProfile } from './savedProfiles'

// The profile library: who is signed in, what they have saved, and the verbs over
// it. Firestore is the only store — nothing is written to this device — so
// **signed out there is nothing to save into**, and that shapes the whole hook.
// `user === null` is not a degraded mode with a local fallback behind it; it is
// the state where saving does not exist yet, and the menu says so rather than
// taking a save that would go nowhere.
//
// What that buys: a profile named on the laptop is on the phone, and clearing
// site data no longer loses the library. What it costs: no saving offline, and
// none at all without an account. Recall, presets and the URL are all
// untouched by it — a session that never signs in is the app exactly as it was.
//
// Nothing is fetched until it is needed. `wasSignedIn()` is a localStorage hint,
// so a browser that has never signed in subscribes to nothing and downloads none
// of the SDK, while one that has picks its session back up on load.
export type CloudStatus =
  // No session, nothing loaded: the ordinary first visit.
  | 'signed-out'
  // Restoring a session, signing in, or fetching the list. The menu shows neither
  // the sign-in button nor an empty library while this is true — both would be a
  // lie that flickers.
  | 'loading'
  | 'ready'
  // Sign-in refused, or the network is gone. Kept apart from signed-out so the
  // menu can say what happened instead of silently offering the button again.
  | 'error'

// What the button in the look bar says for a moment after a save was attempted.
// One value rather than three flags, because the three states are exclusive and
// as separate booleans they could contradict each other on screen — a ✓ next to
// an amber `sign in` is a button claiming a save both did and did not happen.
//
// All three exist for the same reason: two of the three ways to save (ctrl+S and
// the ⌘K row) happen with the menu shut, so the button is the only surface that
// can answer. `failed` is the one that was missing, and it was the likeliest of
// the three — a rejected write, or no network — reported only inside a popover
// nobody had open.
export type ProfileFlash =
  | { kind: 'saved'; name: string }
  | { kind: 'needs-auth' }
  | { kind: 'failed' }

export function useSavedProfiles() {
  const [profiles, setProfiles] = useState<SavedProfile[]>([])
  const [user, setUser] = useState<CloudUser | null>(null)
  const [status, setStatus] = useState<CloudStatus>(() =>
    wasSignedIn() ? 'loading' : 'signed-out',
  )
  const [error, setError] = useState<string | null>(null)
  const [lastName, setLastName] = useState<string | null>(null)
  const [flash, setFlash] = useState<ProfileFlash | null>(null)

  // Show one for a beat, then take it down — but only if it is still the one this
  // call put up, compared by identity so a second save during the first flash
  // does not have its own answer cut short by the first timer. A failure holds
  // longer than a success: a ✓ confirms something you just asked for, while a ✕
  // has to survive being glanced at late.
  const showFlash = (next: ProfileFlash) => {
    setFlash(next)
    setTimeout(
      () => setFlash(cur => (cur === next ? null : cur)),
      next.kind === 'saved' ? 1600 : 2600,
    )
  }
  // Whether this session wants an auth subscription at all. It starts as "has
  // this browser signed in before", which is what keeps the SDK off an ordinary
  // visit — and a press on sign-in flips it, because the *first* sign-in of a
  // browser happens with no subscription installed. Without that flip the popup
  // would close on a successful sign-in and nothing would ever hear about it:
  // status would sit on `loading` forever, which is exactly how it behaved before
  // this line existed.
  const [wantAuth, setWantAuth] = useState(wasSignedIn)

  // Signing in, signing out and the restore-on-load all arrive here from the
  // subscription, so there is one path that fetches the list rather than one per
  // way in. Declared before the effect that installs it.
  const applyUser = (next: CloudUser | null) => {
    setUser(next)
    if (next === null) {
      // Signing out clears the rows as well as the session: leaving them up would
      // offer recall and overwrite against a document nobody may write any more.
      setProfiles([])
      setLastName(null)
      setStatus('signed-out')
      return
    }
    setStatus('loading')
    fetchProfiles(next.uid)
      .then(list => {
        setProfiles(list)
        setStatus('ready')
        setError(null)
      })
      .catch((e: unknown) => {
        console.error('loading saved profiles failed', e)
        setStatus('error')
        setError('could not load your saved profiles')
      })
  }

  // One subscription, and only for a browser that has signed in before — which is
  // what makes the SDK free for everyone else. Firebase resolves the unsubscribe
  // asynchronously, so teardown has to cover both the window before it exists and
  // the call after.
  useEffect(() => {
    if (!wantAuth) return undefined
    let cancelled = false
    let stop: (() => void) | undefined
    watchAuth(next => {
      if (!cancelled) applyUser(next)
    })
      .then(unsub => {
        stop = unsub
        if (cancelled) unsub()
      })
      .catch((e: unknown) => {
        console.error('auth subscribe failed', e)
        if (!cancelled) {
          setStatus('error')
          setError('could not reach the sign-in service')
        }
      })
    return () => {
      cancelled = true
      stop?.()
    }
    // Only on the transition into wanting auth: the callback reads setters, which
    // React keeps stable, so nothing else here needs to re-subscribe.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [wantAuth])

  // Every write is cloud-only, and the list moves when the document has been
  // accepted rather than before. An optimistic row is a row that looks saved and
  // is not — the one thing a save must never show.
  const write = (next: SavedProfile[], landed?: string) => {
    if (user === null) return
    putProfiles(user.uid, next)
      .then(() => {
        setProfiles(next)
        setError(null)
        if (landed !== undefined) {
          setLastName(landed)
          showFlash({ kind: 'saved', name: landed })
        }
      })
      .catch((e: unknown) => {
        console.error('saving profiles failed', e)
        setError('could not save — check your connection')
        // The half that was missing: the message above lands inside the popover,
        // and a ctrl+S is made with the popover shut. Without this the write went
        // to the network, failed, and the app looked exactly as it does after a
        // save that worked.
        showFlash({ kind: 'failed' })
      })
  }

  return {
    profiles,
    user,
    status,
    error,
    lastName,
    flash,
    // Signed out this is not merely inert but unreachable: the menu offers the
    // sign-in button in place of the name box, and ctrl+S says so on the button.
    canSave: status === 'ready',
    saveProfile: (name: string, query: string) => {
      if (status !== 'ready') {
        showFlash({ kind: 'needs-auth' })
        return
      }
      write(upsertProfile(profiles, name, query), name)
    },
    deleteProfile: (name: string) => {
      write(removeProfile(profiles, name))
      // Deleting the profile you were in frees its name again: the next save
      // should offer "my rig", not "my rig 2" against a row that is gone.
      setLastName(cur => (cur === name ? null : cur))
    },
    // A recall makes that profile the one you are in, so the next save offers its
    // name (with a counter) rather than falling back to whichever preset the
    // controls happen to still match.
    markRecalled: setLastName,
    signIn: () => {
      setStatus('loading')
      setError(null)
      // Installs the subscription if this is the browser's first sign-in; already
      // true for one that is picking a session back up.
      setWantAuth(true)
      cloudSignIn().catch((e: unknown) => {
        // A popup the user dismissed is not a failure worth a message: they
        // changed their mind, and the button they came from is the right thing to
        // be looking at again.
        const code =
          typeof e === 'object' && e !== null && 'code' in e ? e.code : ''
        if (
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request'
        ) {
          setStatus('signed-out')
        } else {
          console.error('sign-in failed', e)
          setStatus('error')
          setError('sign-in failed — try again')
        }
      })
    },
    signOut: () => {
      cloudSignOut().catch((e: unknown) => {
        console.error('sign-out failed', e)
      })
    },
  }
}
