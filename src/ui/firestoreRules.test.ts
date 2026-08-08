import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { documentId } from 'firebase/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'

import { readFileSync } from 'node:fs'

// firestore.rules, exercised against the real rules engine in the emulator.
//
// This is the only test in the suite that needs a process outside vitest, and it
// is the one test the app could not otherwise have: the signed-in path needs a
// Google account, which no headless run can complete, so until this existed the
// rules had been *compiled* and never *evaluated*. They are also the whole
// boundary — the web config is public (docs/adr/0005), so if these are wrong,
// nothing else is stopping a stranger.
//
// Run with `pnpm test:rules`, which wraps `firebase emulators:exec`. Under a bare
// `pnpm test` there is no emulator, so the suite skips itself rather than failing
// — a missing emulator is not a broken app, and `pnpm test` has to stay runnable
// on a machine with no Java.
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST
const PROJECT = 'ntscjs-rules-test'
const OWNER = 'owner-uid'
const STRANGER = 'stranger-uid'

// A profile as the app writes one, and a document holding some.
const entry = (name: string) => ({ name, query: 'set=noiseIre:4&mod=' })
const docOf = (...names: string[]) => ({ profiles: names.map(entry) })

describe.skipIf(EMULATOR === undefined)('firestore.rules', () => {
  let env: RulesTestEnvironment

  beforeAll(async () => {
    const [host, port] = (EMULATOR ?? '').split(':')
    env = await initializeTestEnvironment({
      projectId: PROJECT,
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
        host,
        port: Number(port),
      },
    })
  })

  afterAll(async () => {
    await env?.cleanup()
  })

  // Seeded through withSecurityRulesDisabled, so a read test is testing the read
  // rule rather than whichever write rule happened to put the data there.
  const seed = async (uid: string, data: object) => {
    await env.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc(`users/${uid}`).set(data)
    })
  }
  const asOwner = () => env.authenticatedContext(OWNER).firestore()
  const asStranger = () => env.authenticatedContext(STRANGER).firestore()
  const asAnon = () => env.unauthenticatedContext().firestore()

  it('lets the owner read and write their own document', async () => {
    // The app's whole happy path: save a list, read it back on the next load.
    await assertSucceeds(asOwner().doc(`users/${OWNER}`).set(docOf('vhs')))
    await assertSucceeds(asOwner().doc(`users/${OWNER}`).get())
    // ...and overwrite it, which is what every later save does.
    await assertSucceeds(
      asOwner().doc(`users/${OWNER}`).set(docOf('vhs', 'worn tape')),
    )
    // The document really holds what the app expects to read back.
    const snap = await asOwner().doc(`users/${OWNER}`).get()
    expect(snap.data()).toEqual(docOf('vhs', 'worn tape'))
  })

  it('lets the owner clear the list, and delete the document', async () => {
    // Deleting the last profile writes an empty list rather than removing the
    // document, so the empty list has to be a legal write.
    await assertSucceeds(asOwner().doc(`users/${OWNER}`).set({ profiles: [] }))
    await assertSucceeds(asOwner().doc(`users/${OWNER}`).delete())
  })

  it('refuses another signed-in user', async () => {
    await seed(OWNER, docOf('private look'))
    // The finding that would matter most: one account reading another's library.
    await assertFails(asStranger().doc(`users/${OWNER}`).get())
    await assertFails(asStranger().doc(`users/${OWNER}`).set(docOf('theirs')))
    await assertFails(asStranger().doc(`users/${OWNER}`).delete())
  })

  it('refuses an unauthenticated client', async () => {
    await seed(OWNER, docOf('private look'))
    await assertFails(asAnon().doc(`users/${OWNER}`).get())
    await assertFails(asAnon().doc(`users/${OWNER}`).set(docOf('theirs')))
  })

  it('refuses a query over the collection, even a scoped one', async () => {
    // The rules allow `get` and deliberately not `list`. Without that split, any
    // signed-in user could enumerate every user document in the project — the one
    // hole a per-document ownership check does not close by itself.
    await seed(OWNER, docOf('private look'))
    await assertFails(asOwner().collection('users').get())
    await assertFails(asStranger().collection('users').get())
    // The assertion that actually pins the get/list split, and the reason this
    // test is written in two halves. An *unconstrained* query is refused whatever
    // the rules say, because `request.auth.uid == uid` cannot hold across every
    // document it would match — so the two lines above pass just as happily
    // against `allow read`, which grants list. Binding the wildcard with a
    // documentId constraint makes the condition satisfiable, so this query is
    // allowed under `read` and refused under `get`: it fails only because list is
    // withheld. Verified by mutation — swapping `get` for `read` in the rules
    // turns exactly this line red and leaves the rest of the file green.
    await assertFails(
      asOwner().collection('users').where(documentId(), '==', OWNER).get(),
    )
  })

  it('refuses a document carrying anything but the profile list', async () => {
    // hasOnly(['profiles']): the document is this app's list and nothing else.
    // Somebody's own uid is not a place to park arbitrary data in the project.
    await assertFails(
      asOwner()
        .doc(`users/${OWNER}`)
        .set({ ...docOf('vhs'), admin: true }),
    )
    await assertFails(asOwner().doc(`users/${OWNER}`).set({ notes: 'hello' }))
  })

  it('refuses a profiles field that is not a list', async () => {
    await assertFails(asOwner().doc(`users/${OWNER}`).set({ profiles: 'vhs' }))
    await assertFails(asOwner().doc(`users/${OWNER}`).set({ profiles: 7 }))
    await assertFails(
      asOwner()
        .doc(`users/${OWNER}`)
        .set({ profiles: { vhs: 'x' } }),
    )
  })

  it('caps the list at 200 entries, on create and on update', async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => entry(`look ${i}`))
    await assertSucceeds(
      asOwner()
        .doc(`users/${OWNER}`)
        .set({ profiles: many(200) }),
    )
    await assertFails(
      asOwner()
        .doc(`users/${OWNER}`)
        .set({ profiles: many(201) }),
    )
    // The update path is checked separately on purpose: a cap enforced only on
    // create is a cap you get past by creating a small document and growing it,
    // which is the first thing the rules auditor's checklist asks about.
    await seed(OWNER, docOf('vhs'))
    await assertFails(
      asOwner()
        .doc(`users/${OWNER}`)
        .set({ profiles: many(201) }),
    )
    await assertFails(
      asOwner()
        .doc(`users/${OWNER}`)
        .update({ profiles: many(201) }),
    )
  })

  it('refuses every other collection in the project', async () => {
    // Default deny: firestore.rules names one path, so anything added later
    // without a rule of its own is closed rather than open.
    await assertFails(asOwner().doc('presence/anything').set({ x: 1 }))
    await assertFails(asOwner().doc('config/flags').get())
    await assertFails(asOwner().doc(`users/${OWNER}/extra/doc`).set({ x: 1 }))
  })
})
