import { readProfiles } from './savedProfiles'

import type { SavedProfile } from './savedProfiles'
import type { FirebaseApp } from 'firebase/app'
import type { Auth, User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore/lite'

// The whole Firebase surface: sign-in, and the one document a signed-in user
// keeps their saved profiles in. Nothing else in the app imports `firebase`.
//
// **Every firebase import in here is dynamic, and that is the point.** The three
// entry points come to ~110kB gzipped, which is most of a WebGPU app's budget
// before the first frame — and the overwhelming majority of sessions never sign
// in at all. So the SDK is fetched on the first call that actually needs it: a
// press on "sign in", or a page load that already knows this browser was signed
// in (see SIGNED_IN_HINT). A session that never does either downloads none of it.
//
// Type-only imports above are free — they are erased before the bundler sees
// them, so naming Auth or User here costs nothing at runtime.
//
// The config is committed on purpose. A Firebase web config is a set of public
// identifiers, not credentials: it ships inside the bundle of every Firebase web
// app that has ever been deployed, and the apiKey only identifies the project to
// Google's endpoints. What stops a stranger writing to the database is
// firestore.rules, and what stops one using the project as their own auth backend
// is the authorized-domains list. This is the same call phyloguessr makes, and it
// is what lets the GitHub Pages workflow build with no secrets — ytshuffle2 reads
// the config from VITE_ vars its CI does not set, so the bundle it deploys
// carries `undefined` for all seven fields.
const CONFIG = {
  apiKey: 'AIzaSyBHZnQdnaDc5BEYbqwKO8zs0t_wyzLaGFo',
  authDomain: 'ntscjs-d4f56.firebaseapp.com',
  projectId: 'ntscjs-d4f56',
  storageBucket: 'ntscjs-d4f56.firebasestorage.app',
  messagingSenderId: '881016589781',
  appId: '1:881016589781:web:9eabd469a30d89b6d7815c',
  measurementId: 'G-ZFH59EM495',
}

// Whether this browser has been signed in before. Not a credential and not
// trusted for anything — the real session lives in Firebase's own IndexedDB
// store, and this is only the hint that tells a fresh page load whether it is
// worth fetching the SDK to go and look. Wrong in the harmless direction either
// way: stale-true costs one wasted fetch, stale-false costs one click.
const SIGNED_IN_HINT = 'ntsc.js_signed_in'
export const wasSignedIn = () => localStorage.getItem(SIGNED_IN_HINT) === '1'

// What the panel needs to know about who is signed in. Deliberately not the
// firebase User: that object carries tokens and a dozen methods, and the only
// things any component here shows are a name and an avatar.
export interface CloudUser {
  uid: string
  name: string | null
  photo: string | null
}

const asCloudUser = (user: User): CloudUser => ({
  uid: user.uid,
  name: user.displayName,
  photo: user.photoURL,
})

interface Sdk {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  fs: typeof import('firebase/firestore/lite')
  authMod: typeof import('firebase/auth')
}

// One SDK per page, and one *load* per page even when several callers race for
// it: the promise is the singleton, not the resolved value. initializeApp throws
// on a second call with the same name, and the auth instance has to be the same
// object the sign-in popup resolved against.
let sdk: Promise<Sdk> | null = null

function loadSdk(): Promise<Sdk> {
  sdk ??= (async () => {
    const [appMod, authMod, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      // The `lite` build, as in both of the other projects here: it drops
      // onSnapshot and the offline queue, which this app has no use for. A
      // profile list is read once when a session signs in and written when the
      // user presses save — there is no live document to subscribe to, and a
      // second device's changes matter at the next load, not mid-set.
      import('firebase/firestore/lite'),
    ])
    const app = appMod.initializeApp(CONFIG)
    return {
      app,
      auth: authMod.getAuth(app),
      db: fs.getFirestore(app),
      fs,
      authMod,
    }
  })()
  return sdk
}

// Subscribe to who is signed in. Resolves to the unsubscribe once the SDK is up;
// the callback fires immediately after that with the restored session (or null),
// and again on every sign-in and sign-out.
export async function watchAuth(
  onUser: (user: CloudUser | null) => void,
): Promise<() => void> {
  const { auth, authMod } = await loadSdk()
  return authMod.onAuthStateChanged(auth, user => {
    if (user === null) localStorage.removeItem(SIGNED_IN_HINT)
    else localStorage.setItem(SIGNED_IN_HINT, '1')
    onUser(user === null ? null : asCloudUser(user))
  })
}

// A popup rather than a redirect, like both of the other projects. A redirect
// would take the tab away and come back to a cold page — which in this app means
// tearing down a GPUDevice and building another one to sign in, and every device
// this tab spends is one it does not get back (docs/adr/0004).
export async function signIn(): Promise<CloudUser> {
  const { auth, authMod } = await loadSdk()
  const provider = new authMod.GoogleAuthProvider()
  const result = await authMod.signInWithPopup(auth, provider)
  localStorage.setItem(SIGNED_IN_HINT, '1')
  return asCloudUser(result.user)
}

export async function signOut(): Promise<void> {
  const { auth } = await loadSdk()
  localStorage.removeItem(SIGNED_IN_HINT)
  await auth.signOut()
}

// The saved profiles on this account, or [] for an account that has never saved
// one. Read through the same sanitizer the list has always used, because a
// document is exactly as untrusted as a localStorage value was: it can carry a
// shape written by an older version of this app, or by a hand-rolled request.
export async function fetchProfiles(uid: string): Promise<SavedProfile[]> {
  const { db, fs } = await loadSdk()
  const snap = await fs.getDoc(fs.doc(db, 'users', uid))
  if (!snap.exists()) return []
  const raw: unknown = snap.data().profiles
  return Array.isArray(raw) ? readProfiles(raw) : []
}

// The whole list in one write. A document per profile would make two devices
// editing different profiles conflict-free, but it also turns one save into a
// write plus a delete-detection pass, and the case it protects — the same person
// on two devices inside the same second — costs a re-save. The list is small and
// it is one person's.
export async function putProfiles(
  uid: string,
  profiles: readonly SavedProfile[],
): Promise<void> {
  const { db, fs } = await loadSdk()
  await fs.setDoc(fs.doc(db, 'users', uid), {
    profiles: profiles.map(p => ({ name: p.name, query: p.query })),
  })
}
