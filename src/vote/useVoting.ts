import { useEffect, useRef, useState } from 'react'

import { putCandidate, putVotes } from '../ui/cloud'
import { DEVELOP_MS, FLUSH_MS, flushEngines, showPair } from './prepare'
import {
  candidateRecord,
  clearQueued,
  queueVote,
  readPendingVotes,
  voteRecord,
} from './votes'

import type { EngineApi } from '../gpu/engineapi'
import type { LivePair, VoteSource } from './prepare'
import type { Choice } from './votes'

// The session: roll a pair onto the two engines, let it develop, take the answer,
// roll the next.
//
// Much smaller than it was when the pairs had to be recorded first — there is no
// queue, no prefetch, no blob urls and nothing to clean up, because a pair is now
// two uniform writes rather than eleven seconds of work to schedule ahead.

// What the page is doing with the pair on screen.
//   'flushing'   — stock signal, clearing the last pair out of the feedback loops
//   'developing' — the pair is up and blooming; voting is held off
//   'ready'      — old enough to judge
export type Phase = 'flushing' | 'developing' | 'ready'

const randomSeed = () => Math.floor(Math.random() * 0x7fffffff)

export function useVoting(args: {
  engines: readonly [EngineApi, EngineApi] | null
  source: VoteSource
  uid: string | null
}) {
  const { engines, source, uid } = args
  const [pair, setPair] = useState<LivePair | null>(null)
  const [phase, setPhase] = useState<Phase>('flushing')
  const [cast, setCast] = useState(0)
  const [pending, setPending] = useState(0)
  // Which pair to roll. Bumping this is how a vote asks for the next one — the
  // effect below owns the flush/develop sequence, so nothing else has to.
  const [round, setRound] = useState(0)
  // When the pair went up, for the deliberation time on the record.
  // performance.now rather than Date.now: it is a duration, and the wall clock can
  // step sideways under it.
  const shownAt = useRef(0)

  // This author's unsent rows. Scoped to the uid for the same reason the flush is:
  // a browser two people have both signed into holds both their outboxes.
  const countPending = (who: string | null) =>
    setPending(
      who === null ? 0 : readPendingVotes().filter(v => v.by === who).length,
    )

  useEffect(() => {
    countPending(uid)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  // Flush, then show, then arm. Timers rather than frame counts: two engines on
  // one device run at roughly half the rate one does, and a fixed frame count
  // would stretch the wait in proportion to how busy the GPU is. Both sides get
  // the same seconds either way, which is what the comparison needs.
  useEffect(() => {
    if (engines === null) return undefined
    setPhase('flushing')
    setPair(null)
    flushEngines(engines)
    const seed = randomSeed()
    const toShow = setTimeout(() => {
      setPair(showPair(engines, seed, source))
      setPhase('developing')
      shownAt.current = performance.now()
    }, FLUSH_MS)
    const toArm = setTimeout(() => {
      setPhase('ready')
    }, FLUSH_MS + DEVELOP_MS)
    return () => {
      clearTimeout(toShow)
      clearTimeout(toArm)
    }
  }, [engines, source, round])

  // Anything queued that has not reached Firestore, sent one at a time so a bad
  // row cannot take a whole session with it — a write that failed on a flaky
  // connection, or a tab closed between filing and sending.
  const flush = async (who: string | null) => {
    if (who === null) return
    // This author's rows only — a browser two people have signed into holds two
    // outboxes, and one sign-in must not carry the other's votes.
    const queued = readPendingVotes().filter(v => v.by === who)
    if (queued.length === 0) return
    const sent = await putVotes(who, queued)
    clearQueued(sent)
    countPending(who)
  }

  useEffect(() => {
    void flush(uid)
    // flush is recreated every render and reads everything it needs from its
    // argument, so its identity is not a dependency worth chasing.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const vote = (choice: Choice) => {
    // Held until the pair has had its develop window: an answer at frame three is
    // an answer about two looks that had not arrived yet.
    if (pair === null || phase !== 'ready') return
    // Nothing to file without an author. A vote nobody can be identified for would
    // either rot in this browser unsent or be filed under whoever signed in next;
    // the page asks for an account instead.
    if (uid === null) return
    const record = voteRecord({
      a: pair.left,
      b: pair.right,
      choice,
      ms: performance.now() - shownAt.current,
      seed: pair.seed,
      source: pair.source,
      now: Date.now(),
      by: uid,
    })
    // Queued locally first, always. The network is the unreliable part and the
    // label is the valuable part, so it is written down before anything is
    // attempted with it.
    queueVote(record)
    countPending(uid)
    setCast(n => n + 1)
    setRound(n => n + 1)
    // Both convenience rows for the export; the vote already carries the pair seed
    // that regenerates either side, which is why neither is awaited and neither
    // failing costs the label.
    void putCandidate(uid, candidateRecord(pair.left))
    void putCandidate(uid, candidateRecord(pair.right))
    void flush(uid)
  }

  // Roll a different pair without recording an opinion. Distinct from a 'skip'
  // vote: a skip says "I looked and cannot choose", which is a row in the dataset,
  // and this says nothing at all.
  const reroll = () => {
    setRound(n => n + 1)
  }

  return { pair, phase, vote, reroll, cast, pending }
}
