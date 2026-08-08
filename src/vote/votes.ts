import { TELETYPE_DEFAULT } from '../sources/teletype'
import { readArray, writeJSON } from '../ui/storage'
import {
  REVERB_DEFAULT,
  SPEED_DEFAULT,
  writeSessionParams,
} from '../ui/urlParams'
import { recipeControls, recipeId, recipeMod } from './candidates'

import type { SourceMode } from '../sources/modes'
import type { Recipe, RecipeKind } from './candidates'

// The two records the vote page writes, and the sanitizers that read them back.
//
// Split into candidates and votes rather than one fat vote document, because
// that is the shape a Bradley-Terry fit wants: a set of *items* and a set of
// *comparisons* between them. A candidate is written once, keyed by what it
// means (recipeId), and accumulates however many comparisons it appears in. One
// combined document per vote would store the same look a dozen times and leave
// the training script to dedupe it.

// What a voter said about a pair. Four answers rather than two, and the two extra
// ones are not politeness:
//
//   'skip'    — I cannot judge this pair (didn't watch it, misrendered, bored).
//               Carries no preference and is dropped from the fit.
//   'neither' — both of these are bad. This *is* signal, and it is the signal
//               the current surprise button most needs: a comparison only ever
//               says one look beat another, so a pool of uniformly awful rolls
//               produces confident rankings among awful things. 'neither' is
//               what marks a region of the space as not worth searching.
//
// A 'both' option was considered and left out. "Both are great" is a preference
// of zero between them, which is what a skip already contributes to a pairwise
// fit, and the extra key was one more thing to decide per pair at the cost of
// slowing every vote down.
export const CHOICES = ['a', 'b', 'skip', 'neither'] as const
export type Choice = (typeof CHOICES)[number]

// Bumped when either record's shape changes in a way an export has to know
// about. Every document carries it, because the dataset outlives the schema and
// a training script reading a mixed export needs to know which rows it has.
export const RECORD_VERSION = 1

export interface CandidateRecord {
  v: number
  // recipeId — the document id too, so re-rolling the same weighting writes the
  // same document instead of a duplicate.
  id: string
  seed: number
  kind: RecipeKind
  weights: Record<string, number>
  // The resolved board as a query string, from the app's own serializer.
  //
  // Redundant with `weights` today and kept anyway, for two reasons. It makes
  // the record self-describing: presets get renamed and retuned, and a dataset
  // that only stored `{vhs: 1, 'fb bloom': 0.4}` would silently start meaning
  // something else the day someone edits that preset. And it makes a candidate
  // openable — prefix the app's origin and the link *is* the look, so a row in
  // the training set can be inspected in the instrument.
  query: string
}

// Deliberately no `source` on a candidate, and it is worth saying why, because
// the obvious thing is wrong here.
//
// A candidate's id is a hash of its recipe, and the document is immutable at
// that id — which only holds together if the id determines the contents. The
// same look rolled over bars and over a cartoon is the same *recipe* and hashes
// the same, so a `source` field on the candidate would mean two different
// stimuli fighting over one document, and whichever was written first would
// silently describe the other.
//
// The recipe is also the right thing to rank: it is what a later search
// optimizes over, and it is what the app can be handed to reproduce a look. So
// the source is a property of the *comparison*, not of the candidate, and it
// lives on the vote — where it belongs anyway, since it is a nuisance variable a
// fit may want to condition on rather than part of what is being scored.
//
// This is also why `candidateRecord` serializes at 'bars': the app's default
// source is the one mode `writeSessionParams` omits from the query, so the
// stored link is source-agnostic and opens on whatever the reader has.

export interface VoteRecord {
  v: number
  // Candidate ids, in the order they were on screen. Left/right is recorded
  // as-is rather than normalized, so a left-hand bias is measurable after the
  // fact instead of baked in — the page already randomizes which side a recipe
  // lands on, and this is how that gets checked.
  a: string
  b: string
  choice: Choice
  // How long the pair was on screen before the key landed, in ms. A cheap
  // confidence proxy: a 400ms answer and a 12-second answer are not the same
  // claim, and a fit can weight or filter on it. Also the honest way to find
  // the votes cast while not really looking.
  ms: number
  // The pair seed, so the exact comparison can be regenerated even if the
  // candidate documents were never written.
  seed: number
  // A plain string rather than SourceMode, and that is the honest type: a vote
  // cast on a source this build has since renamed is still a vote, and this
  // field is a label in a dataset rather than something handed back to the
  // engine. `voteRecord` below only accepts a real mode, so nothing writes junk
  // here — it is the *reader* that has to stay permissive.
  source: string
  // Client clock, milliseconds. The server stamps its own time on write; this one
  // survives the pending queue below, where a vote can be cast offline and land
  // hours later, and the two together are what expose that gap.
  at: number
  // Who cast it, stamped when it is queued rather than when it is sent — so the
  // queue is a per-author outbox. It used to hold votes cast while signed out and
  // file them under whichever account signed in next, which misattributes labels
  // on a shared browser; voting now requires an account, and `by` is what keeps
  // two outboxes on one machine from bleeding into each other.
  by: string
}

// A candidate as the page will store it. `writeSessionParams` is the app's own
// serializer — reused rather than reimplemented, because `?set=` is a contract
// the loader and every harness already share, and a second writer of that format
// would be a second thing to keep in step.
export function candidateRecord(recipe: Recipe): CandidateRecord {
  const query = writeSessionParams(new URLSearchParams(), {
    controls: recipeControls(recipe),
    mod: recipeMod(recipe),
    sourceMode: 'bars',
    sourceBMode: 'none',
    ytUrlA: '',
    ytUrlB: '',
    teletypeA: TELETYPE_DEFAULT,
    teletypeB: TELETYPE_DEFAULT,
    speedA: SPEED_DEFAULT,
    speedB: SPEED_DEFAULT,
    reverb: REVERB_DEFAULT,
  })
  return {
    v: RECORD_VERSION,
    id: recipeId(recipe),
    seed: recipe.seed,
    kind: recipe.kind,
    weights: recipe.weights,
    query: query.toString(),
  }
}

export function voteRecord(args: {
  a: Recipe
  b: Recipe
  choice: Choice
  ms: number
  seed: number
  source: SourceMode
  now: number
  by: string
}): VoteRecord {
  return {
    v: RECORD_VERSION,
    a: recipeId(args.a),
    b: recipeId(args.b),
    choice: args.choice,
    // Clamped and rounded: a tab left open over lunch would otherwise record a
    // deliberation time of four hours, and no fit has a use for that number
    // beyond "longer than anyone thinks about a pair".
    ms: Math.min(Math.round(args.ms), 600_000),
    seed: args.seed,
    source: args.source,
    at: args.now,
    by: args.by,
  }
}

const isChoice = (v: unknown): v is Choice =>
  typeof v === 'string' && CHOICES.some(c => c === v)

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined

// One stored vote, or undefined when it is not one.
//
// Every field is checked because the input is untrusted in the specific way a
// localStorage value is: it was written by *some* version of this page, possibly
// one that spelled the record differently, and the queue is read at load and
// handed straight to Firestore. Same rule readProfiles follows for saved looks —
// a stale-schema entry should be dropped, not thrown over.
export function readVote(raw: unknown): VoteRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  // Literal property access after an `in` narrowing, the way readProfile does
  // it: a `raw[name]` helper would need an index signature this object does not
  // have, and adding one would be a cast in a function whose whole job is to
  // avoid trusting the value.
  const a = 'a' in raw ? str(raw.a) : undefined
  const b = 'b' in raw ? str(raw.b) : undefined
  const choice = 'choice' in raw ? raw.choice : undefined
  const ms = 'ms' in raw ? num(raw.ms) : undefined
  const seed = 'seed' in raw ? num(raw.seed) : undefined
  const source = 'source' in raw ? str(raw.source) : undefined
  const at = 'at' in raw ? num(raw.at) : undefined
  const v = 'v' in raw ? num(raw.v) : undefined
  const by = 'by' in raw ? str(raw.by) : undefined
  if (a === undefined || b === undefined || source === undefined)
    return undefined
  if (by === undefined) return undefined
  if (ms === undefined || seed === undefined || at === undefined)
    return undefined
  if (!isChoice(choice)) return undefined
  return { v: v ?? 0, a, b, choice, ms, seed, source, at, by }
}

// Votes cast but not yet in Firestore — because nobody was signed in yet, or
// because the write failed.
//
// The queue exists so the first session is not wasted. Requiring sign-in before
// the first pair would put a Google popup in front of the one thing this page is
// for, and a labeller who votes fifty pairs and then signs in should keep all
// fifty. Nothing here is a substitute for the server: it is a buffer, and every
// flush empties it.
const PENDING_STORE = 'ntsc.js_pending_votes'

// Past this the queue is someone who has never signed in and never will, and the
// oldest records go rather than the newest — a 5MB localStorage quota is shared
// with everything else the app keeps, and blowing it throws on write.
const PENDING_MAX = 1000

// Both queues are the same three operations over different row types, so they are
// one implementation parameterised by the store and its sanitizer. `seed:at`
// identifies a row for removal: a pair seed plus a millisecond is unique per
// labeller, and neither queue is shared between people.
const stamp = (row: { seed: number; at: number }) => `${row.seed}:${row.at}`

function readQueue<T>(
  store: string,
  read: (raw: unknown) => T | undefined,
): T[] {
  return readArray<unknown>(store, []).flatMap(raw => {
    const row = read(raw)
    return row === undefined ? [] : [row]
  })
}

function enqueue<T extends { seed: number; at: number }>(
  store: string,
  read: (raw: unknown) => T | undefined,
  row: T,
): T[] {
  const next = [...readQueue(store, read), row].slice(-PENDING_MAX)
  writeJSON(store, next)
  return next
}

// Drop the rows that made it. Passed the ones to remove rather than clearing
// outright, because a flush can partially succeed and the survivors have to stay
// queued — and because a row written *during* an in-flight flush must not be
// dropped by it.
function dequeue<T extends { seed: number; at: number }>(
  store: string,
  read: (raw: unknown) => T | undefined,
  sent: readonly T[],
) {
  const gone = new Set(sent.map(stamp))
  writeJSON(
    store,
    readQueue(store, read).filter(row => !gone.has(stamp(row))),
  )
}

export const readPendingVotes = (): VoteRecord[] =>
  readQueue(PENDING_STORE, readVote)

export const queueVote = (vote: VoteRecord): VoteRecord[] =>
  enqueue(PENDING_STORE, readVote, vote)

export const clearQueued = (sent: readonly VoteRecord[]) => {
  dequeue(PENDING_STORE, readVote, sent)
}
