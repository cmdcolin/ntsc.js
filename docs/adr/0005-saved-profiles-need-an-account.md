# 0005 — Saved profiles live in Firestore, and need an account

**Status:** accepted, 2026-08-07.

## Context

The app grew a saved-profile library: name the board, get it back later. The
first version kept it in `localStorage`, beside Scenes and the pinned-slider
list, because that is where every other durable thing in this app lives and it
needed no backend.

That store is the wrong shape for the one thing a saved profile promises. A
profile is worth naming because you want it _later_ — and "later" is usually a
different machine, a different browser, or after the day someone clears site
data. `localStorage` cannot promise any of those. It is per-origin, per-browser,
and it is the first thing a cleanup wipes. The library was the one feature in
the app whose value grew the longer it survived, stored in the one place that
guarantees it will not.

So: Firebase Authentication (Google) plus Cloud Firestore, project
`ntscjs-d4f56`, one document per user at `users/{uid}`.

## Decision

**Firestore is the only store for profiles, and saving requires being signed
in.** There is no local copy and no offline queue: signed out, the save box is
replaced by a sign-in button, `ctrl+S` refuses out loud (the button goes amber
and reads `sign in`), and the ⌘K row says why.

The alternative — local-first with the cloud as a mirror — was considered and
declined. It is friendlier in the moment and it is what ytshuffle2 does, but it
buys that friendliness with a merge: the same name saved on two devices, a
profile deleted on one and still present on the other, edits made signed out
that have to survive a later sign-in. ytshuffle2 shows the failure mode — its
`adoptCloudData` assigns the cloud library over the local one, so anything saved
while signed out is lost at the next sign-in, silently. One store has one truth
and needs no reconciliation, and a library that quietly loses entries is worse
than one that says "sign in first".

**What this does not touch.** Everything else in the app works exactly as it
did, signed out, offline, forever: presets, the 1–9 scenes, pinned sliders, the
URL that carries the whole look, the ⧉ link beside each saved profile. An
account buys the library and nothing else, and no feature was moved behind it.

## Consequences

- **The Firebase SDK is loaded on demand, never at startup.** `firebase/app` +
  `auth` + `firestore/lite` is ~78kB gzipped across four chunks, and this is a
  WebGPU app that is judged on its first frame. `cloud.ts` imports all three
  dynamically, and the auth subscription is installed only when a `localStorage`
  hint says this browser has signed in before. Measured on a signed-out session
  that also pressed ctrl+S: **zero** requests to any Firebase or Google host.
- **The web config is committed, not injected.** A Firebase web config is a set
  of public identifiers — it ships in the bundle of every deployed Firebase app
  — so `firestore.rules` and the authorized-domains list are what actually
  protect the project. Committing it is also what lets the GitHub Pages workflow
  build with no secrets; ytshuffle2 reads its config from `VITE_` vars that its
  CI does not set, so the bundle it deploys carries `undefined` for all seven
  fields.
- **`firebase.json`'s `auth.authorizedDomains` does not work.** The Firebase
  skill documents the field, and `firebase-tools` 15.26.0 rejects it as an
  unknown property while reporting the rest of the deploy as a success — so the
  provider was enabled and the domain list silently was not. The CLI-created
  auth config contained only `ntscjs-d4f56.firebaseapp.com` and
  `ntscjs-d4f56.web.app`: **not** `localhost`, which is why the first sign-in
  attempt failed with `auth/unauthorized-domain`. The list is now set through
  the Identity Toolkit admin API (`localhost`, both firebase domains, and
  `cmdcolin.github.io` for Pages). Anyone adding a deploy target has to add its
  host there too, and the CLI will not do it for them.
- **The rules cannot validate the list's contents.** `profiles` is a list, and
  rules cannot iterate one, so they check the document's shape and cap its size
  (200 entries) while the client sanitizes each entry on read. One document
  _per_ profile would let rules check every field, and was declined because a
  collection has no order — and the list's insertion order is what makes it
  readable by eye mid-set.
- **A popup, not a redirect.** A redirect would take the tab away and return to
  a cold page, which in this app means tearing down a `GPUDevice` and building
  another one to sign in — see
  [0004](0004-never-destroy-a-presenting-device.md).
- **Firestore is a dependency of one feature, not of the app.** If the project
  goes away, saving stops and everything else keeps working.
