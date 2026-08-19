import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../core/controls'
import { parseSessionParams } from '../ui/urlParams'
import { recipeControls, recipeId, sampleRecipe } from './candidates'
import {
  CHOICES,
  candidateRecord,
  clearQueued,
  queueVote,
  readPendingVotes,
  readVote,
  voteRecord,
} from './votes'

const A = sampleRecipe(11)
const B = sampleRecipe(12)

// The suite runs on bare node — there is no jsdom in this project and every other
// test here is pure logic — so the queue's one dependency gets a shim rather than
// the whole suite getting a DOM. Only the four methods storage.ts calls.
function installLocalStorage() {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    },
  })
}

const aVote = (over: Partial<ReturnType<typeof voteRecord>> = {}) => ({
  ...voteRecord({
    a: A,
    b: B,
    choice: 'a',
    ms: 1200,
    seed: 5,
    source: 'bars',
    now: 1_700_000_000_000,
    by: 'owner-uid',
  }),
  ...over,
})

describe('candidateRecord', () => {
  it('keys the document by what the recipe means, not by its seed', () => {
    const one = candidateRecord({ ...A, seed: 1 })
    const two = candidateRecord({ ...A, seed: 2 })
    expect(one.id).toBe(two.id)
    expect(one.id).toBe(recipeId(A))
  })

  // The property that makes a row in the training set inspectable: paste the
  // query onto the app's origin and you are looking at the candidate.
  //
  // `?set=` carries only the controls that departed from stock and the reader
  // hands back that patch, not a board — so the comparison is against defaults
  // plus the patch, which is exactly what the loader does with it.
  it('records a query the app reads back as the same board', () => {
    for (const seed of [1, 2, 3, 17, 99]) {
      const recipe = sampleRecipe(seed)
      const rec = candidateRecord(recipe)
      const parsed = parseSessionParams(`?${rec.query}`)
      expect(
        { ...DEFAULT_CONTROLS, ...parsed.controls },
        `seed ${seed}`,
      ).toEqual(recipeControls(recipe))
    }
  })

  // The id is a hash of the recipe and the document is immutable at that id, so
  // the record must not carry anything the id does not determine — the source is
  // a property of the comparison and lives on the vote.
  it('stores a source-agnostic link, so one id means one thing', () => {
    const rec = candidateRecord(A)
    expect(rec.query).not.toContain('src=')
    expect(Object.keys(rec)).not.toContain('source')
  })

  it('does not turn a rolled look into stock', () => {
    const rec = candidateRecord(A)
    expect(rec.query).toContain('set=')
    expect(rec.query).not.toBe('set=&mod=')
    expect(Object.keys(rec.weights).length).toBeGreaterThan(0)
  })
})

describe('voteRecord', () => {
  it('records the sides in the order they were shown', () => {
    const v = aVote()
    expect(v.a).toBe(recipeId(A))
    expect(v.b).toBe(recipeId(B))
  })

  it('clamps a deliberation time nobody actually spent', () => {
    expect(aVote({ ms: 0 }).ms).toBe(0)
    const long = voteRecord({
      a: A,
      b: B,
      choice: 'b',
      ms: 9_000_000,
      seed: 1,
      source: 'bars',
      now: 0,
      by: 'owner-uid',
    })
    expect(long.ms).toBe(600_000)
  })
})

describe('readVote', () => {
  it('round-trips every choice', () => {
    for (const choice of CHOICES) {
      const v = aVote({ choice })
      expect(readVote(JSON.parse(JSON.stringify(v)))).toEqual(v)
    }
  })

  it('drops anything that is not a vote', () => {
    for (const junk of [null, undefined, 3, 'a', [], {}]) {
      expect(readVote(junk)).toBeUndefined()
    }
  })

  it('drops a record missing or mistyped in any required field', () => {
    const bad: Record<string, unknown>[] = [
      { ...aVote(), a: undefined },
      { ...aVote(), a: '' },
      { ...aVote(), b: 4 },
      { ...aVote(), choice: 'maybe' },
      { ...aVote(), ms: 'fast' },
      { ...aVote(), ms: Number.NaN },
      { ...aVote(), seed: null },
      { ...aVote(), source: 7 },
      { ...aVote(), at: undefined },
      // An unattributed row. The queue is a per-author outbox now, so a vote with
      // nobody's name on it is one that could be filed under whoever signs in
      // next — which is exactly the misattribution the field exists to stop.
      { ...aVote(), by: undefined },
      { ...aVote(), by: '' },
    ]
    for (const raw of bad) {
      expect(readVote(raw), JSON.stringify(raw.choice)).toBeUndefined()
    }
  })

  it('accepts a record from a build that had no version field', () => {
    const { v: _v, ...noVersion } = aVote()
    expect(readVote(noVersion)?.v).toBe(0)
  })
})

describe('the pending queue', () => {
  beforeEach(() => {
    installLocalStorage()
  })

  it('starts empty and keeps what is queued', () => {
    expect(readPendingVotes()).toEqual([])
    const v = aVote()
    queueVote(v)
    expect(readPendingVotes()).toEqual([v])
  })

  it('survives a corrupt store rather than throwing at load', () => {
    localStorage.setItem('ntsc.js_pending_votes', '{not json')
    expect(readPendingVotes()).toEqual([])
    localStorage.setItem('ntsc.js_pending_votes', '{"nope":1}')
    expect(readPendingVotes()).toEqual([])
  })

  it('drops stale-schema entries and keeps the good ones beside them', () => {
    const good = aVote()
    localStorage.setItem(
      'ntsc.js_pending_votes',
      JSON.stringify([{ old: 'shape' }, good, 42]),
    )
    expect(readPendingVotes()).toEqual([good])
  })

  it("keeps each author's votes separable in a shared browser", () => {
    const mine = aVote({ at: 1, by: 'me' })
    const theirs = aVote({ at: 2, by: 'them' })
    queueVote(mine)
    queueVote(theirs)
    expect(readPendingVotes().filter(v => v.by === 'me')).toEqual([mine])
    expect(readPendingVotes().filter(v => v.by === 'them')).toEqual([theirs])
  })

  // A flush can partly fail, and a vote cast while one is in flight must not be
  // dropped by it — so clearing takes the votes that landed, not the whole store.
  it('clears only the votes that were sent', () => {
    const one = aVote({ at: 1 })
    const two = aVote({ at: 2 })
    const three = aVote({ at: 3 })
    queueVote(one)
    queueVote(two)
    queueVote(three)
    clearQueued([one, three])
    expect(readPendingVotes()).toEqual([two])
  })

  // Seeded in one write, then one vote queued on top of it. It used to be 1005
  // `queueVote` calls, and each of those reads the whole queue back and rewrites
  // it — so the loop was quadratic in the cap and took 1.5s on its own, which is
  // close enough to vitest's 5s timeout that the test failed intermittently when
  // the rest of the suite was competing for the machine. One enqueue over a
  // full queue is what the cap is about anyway.
  it('caps the queue at the newest votes', () => {
    localStorage.setItem(
      'ntsc.js_pending_votes',
      JSON.stringify(Array.from({ length: 1004 }, (_, i) => aVote({ at: i }))),
    )
    queueVote(aVote({ at: 1004 }))
    const kept = readPendingVotes()
    expect(kept).toHaveLength(1000)
    expect(kept[0].at).toBe(5)
    expect(kept.at(-1)?.at).toBe(1004)
  })
})

describe('the controls a candidate resolves to', () => {
  it('is not the stock board', () => {
    expect(recipeControls(A)).not.toEqual(DEFAULT_CONTROLS)
  })
})
