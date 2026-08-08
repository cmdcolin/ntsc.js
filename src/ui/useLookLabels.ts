import { useEffect, useRef, useState } from 'react'

import { TAG_SET_VERSION, TAGS, lookId, readRating } from '../labels'
import { putRatings } from './cloud'
import { readArray, writeJSON } from './storage'

import type { Provenance, RatingRecord, TagName } from '../labels'

// Labelling looks from inside the instrument, rather than on a page built for it.
//
// The separate page is the cleaner experiment — blind, pinned source, pinned
// raster — but it only ever collects from someone who decided to go and label,
// which is one person on a good evening. The app is where looks are already being
// made and looked at, so the label costs a click at a moment somebody is already
// having an opinion. Volume wins, and the two objections that made the clean page
// look necessary both dissolve:
//
//   - "Not blind." The model's target is this user's taste, and knowing a look is
//     built on vhs is part of that taste rather than noise contaminating it.
//   - "Not a random sample." True of browsing, false of rolling: `surprise` draws
//     from the same distribution the labelling page samples, so a run of
//     surprise-rate-surprise is an unbiased sample sitting inside a biased
//     collection — and `provenance` on every row is what lets it be sliced back
//     out afterwards.
//
// What does not dissolve is that a rating has to be *cheaper than moving on*. If
// scoring a bad roll costs more than rolling again, nobody scores the bad ones and
// the dataset is all positives, which is the one shape a preference model cannot
// be fitted from. Hence one click to commit, and no confirm step.
//
// **Rating requires being signed in**, and the local store is an outbox rather than
// a collection point. The first version let a signed-out session rate freely and
// flushed the backlog when somebody eventually signed in, on the reasoning that a
// first session should not be wasted. That was wrong twice over. A rating that is
// never uploaded is worth exactly zero, so the button counted up to "tags 12"
// while nothing was being collected — and the backlog was filed under whichever
// account signed in next, which quietly misattributes labels when a browser is
// shared or an account is switched. Pressing a rating button is the moment someone
// has shown they want to contribute, which is the best moment to ask, not the
// worst. So the queue now only ever holds rows an author has already been
// identified for, and exists to survive a failed write rather than a missing
// account.

const PENDING_STORE = 'ntsc.js_pending_ratings'
const PENDING_MAX = 1000

const stamp = (r: RatingRecord) => `${r.look}:${r.at}`

const readPending = (): RatingRecord[] =>
  readArray<unknown>(PENDING_STORE, []).flatMap(raw => {
    const row = readRating(raw)
    return row === undefined ? [] : [row]
  })

// What the app knows about the look on screen when it is rated. Passed in rather
// than reached for, because everything here already exists at the call site and
// this hook has no business reaching into the mix.
export interface LookContext {
  // The resolved board as a share link — the app's own serializer, so a stored
  // row reopens as exactly this look.
  query: string
  // The preset recipe behind it, empty for a look with no mix in it.
  weights: Record<string, number>
  preset: string | null
  provenance: Provenance
  source: string
}

export function useLookLabels(uid: string | null) {
  const [tags, setTags] = useState<readonly TagName[]>([])
  const [saved, setSaved] = useState(0)
  const [pending, setPending] = useState(0)
  // When the current look went up, for the deliberation time. Reset by the caller
  // whenever the look changes, so a rating measures thought about *this* look
  // rather than how long the tab has been open.
  const openedAt = useRef(performance.now())

  // This author's unsent rows. Scoped to the uid for the same reason the flush is:
  // a browser two people have both signed into holds both their outboxes, and
  // neither should see the other's backlog as their own.
  const countPending = (who: string | null) =>
    setPending(
      who === null ? 0 : readPending().filter(r => r.by === who).length,
    )

  useEffect(() => {
    countPending(uid)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const flush = async (who: string | null) => {
    if (who === null) return
    // This author's rows only. A queue shared across accounts on one browser must
    // not let one person's sign-in carry another person's labels.
    const queued = readPending().filter(r => r.by === who)
    if (queued.length === 0) return
    const sent = await putRatings(who, queued)
    const gone = new Set(sent.map(stamp))
    writeJSON(
      PENDING_STORE,
      readPending().filter(r => !gone.has(stamp(r))),
    )
    countPending(who)
  }

  // Send anything a previous session left unsent — a write that failed on a flaky
  // connection, or a tab closed between filing and sending.
  useEffect(() => {
    void flush(uid)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const toggle = (name: TagName) => {
    setTags(prev =>
      prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name],
    )
  }

  // The look changed under us — clear the tags, since they described the old one,
  // and restart the clock.
  const reset = () => {
    setTags([])
    openedAt.current = performance.now()
  }

  const rate = (cool: number, look: LookContext) => {
    // Nothing to file without an author. The popover shows a sign-in button
    // instead of the rating strip in this state, so this is the belt to that
    // braces — a keyboard path or a stale render must not produce an orphan row.
    if (uid === null) return
    const record: RatingRecord = {
      v: 1,
      tagSet: TAG_SET_VERSION,
      look: lookId(look.query),
      query: look.query,
      weights: look.weights,
      preset: look.preset,
      provenance: look.provenance,
      // Ordered by the vocabulary rather than by the order the chips were
      // clicked, so two identical ratings compare equal in an export.
      tags: TAGS.filter(t => tags.includes(t.name)).map(t => t.name),
      cool,
      ms: Math.min(Math.round(performance.now() - openedAt.current), 600_000),
      source: look.source,
      at: Date.now(),
      by: uid,
    }
    const next = [...readPending(), record].slice(-PENDING_MAX)
    writeJSON(PENDING_STORE, next)
    countPending(uid)
    setSaved(n => n + 1)
    setTags([])
    openedAt.current = performance.now()
    void flush(uid)
  }

  return { tags, toggle, rate, reset, saved, pending, vocabulary: TAGS }
}
