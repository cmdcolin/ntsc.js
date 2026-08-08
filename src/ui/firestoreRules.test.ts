import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { documentId, serverTimestamp } from 'firebase/firestore'
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
    // Default deny: firestore.rules names the paths it grants, so anything added
    // later without a rule of its own is closed rather than open.
    await assertFails(asOwner().doc('presence/anything').set({ x: 1 }))
    await assertFails(asOwner().doc('config/flags').get())
    await assertFails(asOwner().doc(`users/${OWNER}/extra/doc`).set({ x: 1 }))
  })

  // The vote page's two collections. Unlike saved profiles these are shared —
  // anyone signed in contributes to one dataset — so the rules bound what a bad
  // contributor can do rather than who can contribute. Every assertion below is
  // one of those bounds.
  describe('the vote collections', () => {
    const CID = 'abc1234'
    const candidate = (over: object = {}) => ({
      v: 1,
      id: CID,
      seed: 42,
      kind: 'mix',
      weights: { vhs: 1, 'fb bloom': 0.4 },
      query: 'set=noiseIre:4&mod=',
      by: OWNER,
      sat: serverTimestamp(),
      ...over,
    })
    const vote = (over: object = {}) => ({
      v: 1,
      a: 'abc1234',
      b: 'def5678',
      choice: 'a',
      ms: 1800,
      seed: 21,
      source: 'bars',
      at: 1_700_000_000_000,
      by: OWNER,
      sat: serverTimestamp(),
      ...over,
    })
    const seedDoc = async (path: string, data: object) => {
      await env.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().doc(path).set(data)
      })
    }

    it('lets a signed-in voter add a candidate and a vote', async () => {
      await assertSucceeds(asOwner().doc(`candidates/${CID}`).set(candidate()))
      await assertSucceeds(asOwner().collection('votes').add(vote()))
    })

    it('lets any signed-in voter read a candidate somebody else rolled', async () => {
      // The point of a shared pool: a look one person rolled gets judged by
      // another person's eyes.
      await seedDoc(`candidates/${CID}`, candidate())
      await assertSucceeds(asStranger().doc(`candidates/${CID}`).get())
    })

    it('refuses an unauthenticated client entirely', async () => {
      await seedDoc(`candidates/${CID}`, candidate())
      await assertFails(asAnon().doc(`candidates/${CID}`).get())
      await assertFails(asAnon().doc('candidates/zzz').set(candidate()))
      await assertFails(asAnon().collection('votes').add(vote()))
    })

    it('makes a candidate immutable, even to whoever wrote it', async () => {
      // The id is a hash of the recipe, so a document that could change would be
      // lying about its own name — and every vote already cast refers to it.
      await seedDoc(`candidates/${CID}`, candidate())
      await assertFails(
        asOwner().doc(`candidates/${CID}`).update({ query: 'set=&mod=' }),
      )
      await assertFails(asOwner().doc(`candidates/${CID}`).delete())
      await assertFails(asStranger().doc(`candidates/${CID}`).delete())
    })

    it('refuses a candidate whose id does not match its own key', async () => {
      // Without this the id stops determining the contents, and create-only stops
      // being a safe way to store a hash-addressed document.
      await assertFails(
        asOwner()
          .doc('candidates/wrongkey')
          .set(candidate({ id: CID })),
      )
    })

    it('makes a vote immutable and undeletable', async () => {
      // A dataset whose rows can be rewritten after the fact is not evidence of
      // anything. Changing your mind means casting another vote.
      await seedDoc('votes/v1', vote())
      await assertFails(asOwner().doc('votes/v1').update({ choice: 'b' }))
      await assertFails(asOwner().doc('votes/v1').delete())
      await assertFails(asStranger().doc('votes/v1').update({ choice: 'b' }))
    })

    it('shows a voter their own votes and nobody else theirs', async () => {
      await seedDoc('votes/mine', vote())
      await seedDoc('votes/theirs', vote({ by: STRANGER }))
      await assertSucceeds(asOwner().doc('votes/mine').get())
      await assertFails(asOwner().doc('votes/theirs').get())
    })

    it('refuses a forged author on either collection', async () => {
      // `by` is what a training script filters on when a run of votes turns out
      // to be junk, so it must not be something a client can choose.
      await assertFails(
        asOwner()
          .doc('candidates/zzz')
          .set(candidate({ by: STRANGER })),
      )
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ by: STRANGER })),
      )
    })

    it('refuses a client-chosen timestamp', async () => {
      // `sat == request.time` is what forces a real server stamp. The client's
      // own clock rides along in `at`, and the gap between them is what makes a
      // vote cast offline and flushed hours later visible as exactly that.
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ sat: 1_700_000_000_000 })),
      )
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ sat: new Date('2020-01-01') })),
      )
      await assertFails(
        asOwner()
          .doc('candidates/zzz')
          .set(candidate({ sat: 12345 })),
      )
    })

    it('refuses a query over either collection', async () => {
      // Same get/list split the users collection makes, for the same reason:
      // exporting the dataset for training is an admin job, and a client query
      // would let any signed-in user pull the whole pool down. Constrained by
      // documentId so the query is satisfiable and fails only because list is
      // withheld — see the users test above for why that distinction matters.
      await seedDoc(`candidates/${CID}`, candidate())
      await seedDoc('votes/mine', vote())
      await assertFails(asOwner().collection('candidates').get())
      await assertFails(asOwner().collection('votes').get())
      await assertFails(
        asOwner().collection('candidates').where(documentId(), '==', CID).get(),
      )
      await assertFails(
        asOwner().collection('votes').where(documentId(), '==', 'mine').get(),
      )
    })

    it('refuses a candidate carrying an unbounded map or extra fields', async () => {
      const many = Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`preset ${i}`, 0.5]),
      )
      await assertFails(
        asOwner()
          .doc('candidates/zzz')
          .set(candidate({ weights: many })),
      )
      await assertFails(
        asOwner()
          .doc('candidates/zzz')
          .set(candidate({ weights: 'vhs' })),
      )
      await assertFails(
        asOwner()
          .doc('candidates/zzz')
          .set(candidate({ query: 'x'.repeat(8001) })),
      )
      await assertFails(
        asOwner()
          .doc('candidates/zzz')
          .set(candidate({ admin: true })),
      )
      await assertFails(
        asOwner()
          .doc('candidates/zzz')
          .set(candidate({ kind: 'whatever' })),
      )
    })

    it('refuses a vote that is not a comparison', async () => {
      // A vote between a candidate and itself carries no preference, and a choice
      // outside the four the page can send is a hand-rolled request.
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ b: 'abc1234' })),
      )
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ choice: 'maybe' })),
      )
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ ms: -1 })),
      )
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ ms: 600_001 })),
      )
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ source: 'x'.repeat(65) })),
      )
      await assertFails(
        asOwner()
          .collection('votes')
          .add(vote({ extra: 'field' })),
      )
    })

    const rating = (over = {}) => ({
      v: 1,
      tagSet: 1,
      look: 'abc1234',
      query: 'set=noiseIre:4&mod=',
      weights: { vhs: 1 },
      preset: null,
      provenance: 'surprise',
      tags: ['calm', 'warm'],
      cool: 4,
      ms: 2200,
      source: 'bars',
      at: 1_700_000_000_000,
      by: OWNER,
      sat: serverTimestamp(),
      ...over,
    })

    it('accepts a rated look from the app and from the page', async () => {
      await assertSucceeds(asOwner().collection('ratings').add(rating()))
      // A look dialled in by hand has no recipe behind it — empty weights and no
      // preset — and still has to be ratable, since that is most of what the app
      // will send.
      await assertSucceeds(
        asOwner()
          .collection('ratings')
          .add(rating({ weights: {}, preset: null, provenance: 'hand' })),
      )
      await assertSucceeds(
        asOwner()
          .collection('ratings')
          .add(rating({ tags: [], preset: 'vhs', provenance: 'preset' })),
      )
    })

    it('refuses a rating with a forged author, clock or score', async () => {
      await assertFails(
        asOwner()
          .collection('ratings')
          .add(rating({ by: STRANGER })),
      )
      await assertFails(
        asOwner()
          .collection('ratings')
          .add(rating({ sat: 1_700_000_000_000 })),
      )
      await assertFails(
        asOwner()
          .collection('ratings')
          .add(rating({ cool: 0 })),
      )
      await assertFails(
        asOwner()
          .collection('ratings')
          .add(rating({ cool: 6 })),
      )
      await assertFails(
        asOwner()
          .collection('ratings')
          .add(rating({ cool: 3.5 })),
      )
      await assertFails(
        asOwner()
          .collection('ratings')
          .add(rating({ provenance: 'somewhere' })),
      )
      await assertFails(
        asOwner()
          .collection('ratings')
          .add(rating({ extra: 'field' })),
      )
    })

    it('keeps ratings private, immutable and unqueryable', async () => {
      await seedDoc('ratings/mine', rating())
      await seedDoc('ratings/theirs', rating({ by: STRANGER }))
      await assertSucceeds(asOwner().doc('ratings/mine').get())
      await assertFails(asOwner().doc('ratings/theirs').get())
      await assertFails(asOwner().doc('ratings/mine').update({ cool: 1 }))
      await assertFails(asOwner().doc('ratings/mine').delete())
      await assertFails(asOwner().collection('ratings').get())
      await assertFails(asAnon().collection('ratings').add(rating()))
    })

    it('accepts every choice the page can actually send', async () => {
      for (const choice of ['a', 'b', 'skip', 'neither']) {
        await assertSucceeds(
          asOwner().collection('votes').add(vote({ choice })),
        )
      }
    })
  })
})
