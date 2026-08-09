// What Wikimedia Commons and archive.org have in common, which is nearly
// everything.
//
// Both are *pools*: a channel is a search rather than a file, picking one rolls
// something out of it, and what comes back is a url to show plus enough identity
// to find it again. They were written a week apart as two files that shared no
// code, and the duplication was not the expensive part — the expensive part was
// that `CommonsPick` and `ArchivePick` were separate types, so the engine grew
// two of every state slot, two roll functions, two clears, and a four-branch
// `rollAgain`. One type collapses all of that.
//
// The two genuine differences survive as *fields* rather than as types:
//
//   `owned` — an archive.org url is a `blob:` this app allocated (archive.ts
//     says why the whole file has to be downloaded), and a pick that never
//     reaches a slot has to be released. A Commons url is upload.wikimedia.org
//     and costs nothing to drop.
//
//   `kind` — Commons holds stills and clips; archive.org, as this app reads it,
//     holds clips. That is a value, not a shape.
//
// Nothing is imported here. commons.ts and archive.ts take values from this
// file and pools.ts takes both of them, so the graph runs one way and a fourth
// source would slot in beside the two without touching either.

export type PickKind = 'photo' | 'video'
export type PoolOrigin = 'commons' | 'archive'

// Enough to find a file again, and nothing that can go stale.
//
// This is what a shelf entry stores, and the reason it stores this rather than a
// url: a url is a *rendering*. The Commons thumbnailer changes its width
// buckets, a file is overwritten by a better scan, a transcode ladder is
// rebuilt, an archive.org derivative is re-encoded — and the url that worked the
// day it was kept 404s a year later. `title` is what the upstream itself keys
// on: a Commons page title ("File:Sunset over Logan Square.webm") or an
// archive.org identifier ("dusty-trailer-1983"). Resolving one costs the same
// request a roll makes anyway.
export interface PoolRef {
  origin: PoolOrigin
  title: string
  kind: PickKind
}

// A ref, plus where its bytes are right now.
export interface PoolPick extends PoolRef {
  // Ready for <img>/<video> as it stands. Remote for Commons, `blob:` for
  // archive.org — see `owned`.
  url: string
  // The file's own page upstream: who made it, and under what licence. Nothing
  // else in this app leads to the credit, and it composites other people's
  // pictures into something recordable — so the one link that does travels with
  // them.
  page: string
  // Whether `url` is an allocation this app has to hand back. See releasePick.
  owned: boolean
}

// Drop a pick's bytes. Only ever a no-op or a revoke, but it has to be called on
// every path that throws a pick away, because the ones that matter are the rolls
// that lose their slot: the download has already been spent, and an abandoned
// blob url holds the whole clip until the tab goes.
export const releasePick = (picked: PoolPick): void => {
  if (picked.owned) URL.revokeObjectURL(picked.url)
}

// What makes two picks the same file. Origin joins the title because the two
// namespaces are unrelated — nothing stops an archive.org identifier from
// reading like a Commons title — and because a shelf holding both keys on this.
//
// `kind` is deliberately not part of it, and takes a looser argument than
// `PoolRef` so a caller with only the two fields can key on them: a Commons file
// is a still or a clip according to its own mime type, not according to what
// something in this app recorded, and a kind that had drifted would otherwise
// split one file into two shelf entries.
export const refKey = (ref: { origin: PoolOrigin; title: string }): string =>
  `${ref.origin}\n${ref.title}`

export const sameRef = (
  a: { origin: PoolOrigin; title: string },
  b: { origin: PoolOrigin; title: string },
): boolean => a.origin === b.origin && a.title === b.title

// --- response narrowing -----------------------------------------------------
// Both APIs are untyped JSON from another origin, so responses are walked with
// guards rather than asserted into a shape. Anything unexpected reads as "this
// file is not usable", which is the same branch a missing transcode takes.

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

export const str = (v: unknown): string | null =>
  typeof v === 'string' ? v : null

// Tolerant of the string form on purpose. Commons answers with real numbers;
// every numeric field in an archive.org file entry arrives as a *string* —
// `"size": "3214809"`, `"length": "30.65"` — and `length` is sometimes a
// timestamp (`"1:04:12"`) instead of seconds. Both read as absent rather than
// being half-parsed: `Number('1:04:12')` is NaN, and a NaN slipping past a byte
// cap is how a two-hour master would get downloaded.
export const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// How a download says where it has got to. `total` is 0 when nothing upstream
// would say — the caller then has bytes and no denominator, which is still
// better than a caption that has said `rolling…` for eighteen seconds.
//
// Only ever called by the archive.org half. A Commons transcode is streamed by
// the <video> element off upload.wikimedia.org with ordinary range requests, so
// there is no download step to report on: the picture starts when the first
// frames arrive. archive.org has to fetch the whole file first (see the head of
// archive.ts), which is the wait this exists for.
export type OnProgress = (loaded: number, total: number) => void

// --- rolling ----------------------------------------------------------------

// Start a list somewhere other than the beginning. Both sources roll several
// pools per channel, and starting at a random offset is what keeps one channel
// spanning all of them without the first dominating.
export const rotate = <T>(xs: readonly T[], by: number): T[] => [
  ...xs.slice(by),
  ...xs.slice(0, by),
]

export const randomIndex = (length: number): number =>
  Math.floor(Math.random() * length)

// --- browsing ---------------------------------------------------------------

// One result in the browser (ui/MediaBrowserDialog.tsx): enough to draw a
// thumbnail and a name, and the ref that turns it into something playable.
//
// Deliberately *not* a `PoolPick`. A browse listing is cheap on both sources —
// Commons renders a poster frame for a clip as readily as for a still, and
// archive.org has a thumbnail endpoint that costs no part of the download — and
// the whole point of the dialog is that you can look at two dozen of these
// before paying for one. Committing to one is `resolvePool(hit.ref)`.
export interface BrowseHit extends PoolRef {
  // The caption, already stripped of upstream scaffolding.
  label: string
  // A small image. Never the file itself.
  thumb: string
  page: string
  // How long the clip runs, or null when the listing would not say. The one
  // number worth showing before a pick, and the reason it is a *duration* and
  // not a size: a poster frame says nothing about whether this is a 15-second
  // ident or a twenty-minute reel, which is the surprise a grid of stills can
  // hand you. Commons answers it for free alongside the thumbnail; archive.org
  // has it on some items and not others (see `browseArchive`).
  seconds: number | null
}

// How many results a browse asks for. Two dozen fills the grid without the
// thumbnail requests behind it reading as a stampede, and both APIs answer this
// as cheaply as they answer one.
export const BROWSE_LIMIT = 24
