// The single-view half of the labelling tool: what a look *is*, and how cool it is.
//
// Pairwise comparison answers one question well — which of these two would you
// keep — and that is a single scalar. It cannot answer "give me something dreamy",
// which is closer to how a look actually gets reached for mid-set. So there is a
// second mode, and it records two different kinds of thing about one candidate:
// a set of tags, and a rating.
//
// **The rule that decides the vocabulary: never record what the recipe already
// knows.** A tag like "vhs" or "feedback" is worthless here, because the candidate
// record already carries `{vhs: 1, 'fb bloom': 0.4}` and any model can read the
// mechanism straight off the weights. What the parameter vector does *not* encode
// is how the result reads — and that is the only information a human is adding.
//
// So every tag below is perceptual or affective, and each cuts across mechanism:
// two completely unrelated recipes can both be calm and warm, and learning that
// mapping is the whole point.

// Bumped when the vocabulary changes. Stored on every record, because the dataset
// outlives the list: a row tagged under v1 was shown ten choices, and a training
// script reading a mixed export has to know that the absence of a v2 tag on it
// means "was never offered" rather than "was rejected".
//
// Which is also the honest warning about this list. Adding an eleventh tag does not
// retroactively label the views already collected under v1 — those rows are simply
// silent about it. Cheap to represent, not cheap to fix, so the vocabulary is worth
// getting right before a few hundred views go by.
export const TAG_SET_VERSION = 1

// Ten, on the number keys, in opposing pairs — but recorded as ten independent
// flags rather than five axes, because a look can genuinely be neither calm nor
// violent, and forcing a midpoint would invent data. A pair that is never both is
// a fact the fit can discover; one that is sometimes both is a fact a forced axis
// would have destroyed.
export const TAGS = [
  { key: '1', name: 'calm', hint: 'settled, unhurried, nothing lurching' },
  { key: '2', name: 'violent', hint: 'aggressive, lurching, hostile' },
  { key: '3', name: 'warm', hint: 'reds and ambers, sunlit, aged paper' },
  { key: '4', name: 'cold', hint: 'blues and greens, clinical, moonlit' },
  { key: '5', name: 'geometric', hint: 'bands, grids, hard edges, repeats' },
  { key: '6', name: 'organic', hint: 'smeared, flowing, cloudy, blooming' },
  { key: '7', name: 'legible', hint: 'the source picture still reads through' },
  {
    key: '8',
    name: 'destroyed',
    hint: 'the source is gone; only the fault is left',
  },
  { key: '9', name: 'rhythmic', hint: 'moves on a pulse rather than drifting' },
  { key: '0', name: 'dreamy', hint: 'soft, floating, nostalgic, underwater' },
] as const

export type TagName = (typeof TAGS)[number]['name']

const TAG_NAMES = new Set<string>(TAGS.map(t => t.name))
export const isTagName = (v: unknown): v is TagName =>
  typeof v === 'string' && TAG_NAMES.has(v)

// How cool, 1-5, committed with the left hand while the right hand tags.
//
// Absolute ratings drift — what you called a 4 today is a 3 next week — which is
// exactly why the pairwise mode still exists rather than being replaced by this.
// The comparisons are scale-free and pin the ordering; these ratings are cheap
// coverage (one per view, rather than one per two views) that the comparisons
// calibrate. Fitting both together is standard, and neither alone is as good.
export const COOL_KEYS = [
  { key: 'z', cool: 1, label: 'no' },
  { key: 'x', cool: 2, label: 'meh' },
  { key: 'c', cool: 3, label: 'ok' },
  { key: 'v', cool: 4, label: 'good' },
  { key: 'b', cool: 5, label: 'yes!' },
] as const

export const COOL_MIN = 1
export const COOL_MAX = 5

export const isCool = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= COOL_MIN && v <= COOL_MAX

// How a rated look was arrived at.
//
// This field is what makes collecting labels from ordinary use safe. The looks a
// person navigates to are not a random sample of the space — but `surprise` rolls
// from the same distribution the labelling page samples, so a session of
// surprise-rate-surprise *is* an unbiased sample sitting inside a biased
// collection. Recording the provenance turns "this sample is not random" from a
// design constraint into a filter you apply afterwards: slice to 'surprise' for
// the clean subset, keep everything for volume.
//
// Best-effort classification, which is why the raw facts (`weights`, `preset`,
// `query`) are all stored beside it — a disagreement between this label and those
// is resolvable after the fact rather than lost.
export const PROVENANCES = [
  'surprise',
  'preset',
  'mutate',
  'hand',
  'compare',
] as const
export type Provenance = (typeof PROVENANCES)[number]
export const isProvenance = (v: unknown): v is Provenance =>
  typeof v === 'string' && PROVENANCES.some(p => p === v)

// One rated look. Separate from a vote (which is about a *pair*) because it is a
// different observation with a different shape, and merging them into one
// collection with half the fields null would make every query over either one
// filter the other out.
export interface RatingRecord {
  v: number
  // Which vocabulary was on offer. See TAG_SET_VERSION.
  tagSet: number
  // The look's id: a hash of the resolved control string, *not* of the preset
  // weights.
  //
  // It has to be the resolved board, because in the app the thing being rated is
  // whatever is on screen — possibly mutated, possibly dialled in by hand, with no
  // recipe behind it at all. Hashing the query is the one key that both a rolled
  // candidate and a hand-built look can have, which is what lets labels collected
  // in the app and on the labelling page land in the same key space.
  look: string
  // The board itself, as the app's own `?set=` serializer writes it. Prefix the
  // origin and the link *is* the look.
  query: string
  // The preset recipe behind it, when there was one — empty for a look with no
  // mix in it. Kept alongside `query` because it is the low-dimensional space a
  // preference model can actually be fitted in.
  weights: Record<string, number>
  // The preset this look was last set from, if any.
  preset: string | null
  provenance: Provenance
  // Only the tags that were toggled on. Absent means "not this", which is only
  // interpretable alongside `tagSet` — hence storing it.
  tags: TagName[]
  cool: number
  // Time from the look appearing to the commit. Same confidence proxy the votes
  // carry, and here it also separates a considered rating from a reflexive one.
  ms: number
  source: string
  at: number
  // Who made this rating, stamped when it is queued rather than when it is sent.
  //
  // The local queue used to hold rows made while signed out, and flush them under
  // whichever account signed in next — so two people sharing a browser, or one
  // person switching accounts, silently filed each other's labels. `by` is what
  // makes the queue a per-author outbox instead: a row is only ever sent by the
  // author it names, and rating now requires being signed in at all, so there is
  // no such thing as an unattributed row waiting for an owner.
  by: string
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined

// One stored rating, or undefined when it is not one. Same contract readVote
// follows, for the same reason: this reads back a localStorage queue that some
// older version of this page may have written, and it is handed straight to
// Firestore.
export function readRating(raw: unknown): RatingRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const look = 'look' in raw ? str(raw.look) : undefined
  const query = 'query' in raw ? raw.query : undefined
  const cool = 'cool' in raw ? raw.cool : undefined
  const ms = 'ms' in raw ? num(raw.ms) : undefined
  const source = 'source' in raw ? str(raw.source) : undefined
  const at = 'at' in raw ? num(raw.at) : undefined
  const rawTags = 'tags' in raw ? raw.tags : undefined
  const provenance = 'provenance' in raw ? raw.provenance : undefined
  const by = 'by' in raw ? str(raw.by) : undefined
  const rawWeights = 'weights' in raw ? raw.weights : undefined
  const preset = 'preset' in raw ? raw.preset : undefined
  if (look === undefined || source === undefined || by === undefined) {
    return undefined
  }
  if (ms === undefined || at === undefined) return undefined
  if (typeof query !== 'string') return undefined
  if (!isCool(cool) || typeof cool !== 'number') return undefined
  if (!Array.isArray(rawTags)) return undefined
  if (!isProvenance(provenance)) return undefined
  // Unknown tag names are dropped rather than failing the row: a rating whose
  // vocabulary has since been edited is still a rating, and `tagSet` says which
  // list it was made against.
  const tags = rawTags.filter(isTagName)
  // Weights are numbers keyed by preset name; anything else in there is dropped
  // rather than trusted, since this object goes straight to Firestore.
  const weights: Record<string, number> = {}
  if (typeof rawWeights === 'object' && rawWeights !== null) {
    for (const [name, w] of Object.entries(rawWeights)) {
      if (typeof w === 'number' && Number.isFinite(w)) weights[name] = w
    }
  }
  return {
    v: ('v' in raw ? num(raw.v) : undefined) ?? 0,
    tagSet: ('tagSet' in raw ? num(raw.tagSet) : undefined) ?? 0,
    look,
    query,
    weights,
    preset: typeof preset === 'string' ? preset : null,
    provenance,
    tags,
    cool,
    ms,
    source,
    at,
    by,
  }
}

// A stable id for a resolved look. FNV-1a over the query string — not
// cryptographic and it does not need to be: a collision costs two unrelated looks
// sharing a row in an export.
export function lookId(query: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < query.length; i++) {
    h ^= query.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36).padStart(7, '0')
}
