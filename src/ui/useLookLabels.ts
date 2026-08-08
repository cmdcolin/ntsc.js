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

  useEffect(() => {
    setPending(readPending().length)
  }, [])

  const flush = async (who: string | null) => {
    if (who === null) return
    const queued = readPending()
    if (queued.length === 0) return
    const sent = await putRatings(who, queued)
    const gone = new Set(sent.map(stamp))
    writeJSON(
      PENDING_STORE,
      readPending().filter(r => !gone.has(stamp(r))),
    )
    setPending(readPending().length)
  }

  // Nothing leaves the browser until somebody signs in, which is what makes this
  // opt-in by construction rather than by a checkbox: a signed-out session queues
  // locally and never uploads, and signing in is the consent.
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
    }
    const next = [...readPending(), record].slice(-PENDING_MAX)
    writeJSON(PENDING_STORE, next)
    setPending(next.length)
    setSaved(n => n + 1)
    setTags([])
    openedAt.current = performance.now()
    if (uid !== null) void flush(uid)
  }

  return { tags, toggle, rate, reset, saved, pending, vocabulary: TAGS }
}
