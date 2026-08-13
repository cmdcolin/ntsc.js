// Random video pulled live from archive.org, as a source either slot can show.
// The same shape as commons.ts — a channel is a *search*, and picking one rolls
// a clip out of it — for a pool Commons cannot supply: tape openings,
// distributor idents, and 80s/90s broadcast advertising. Commons is an
// encyclopedia's warehouse and holds almost none of that; archive.org holds tens
// of thousands of them, which is the whole reason this second source exists.
// `docs/adr` has nothing to say here, but two measured facts below decide the
// design, and both are easy to undo by accident.
//
// **Only `/cors/` is reachable from the browser.** `/download/` and `/serve/`
// answer with a 302 to `dn######.us.archive.org`, and that storage node sends no
// `access-control-*` header at all — so with the `crossOrigin = 'anonymous'`
// that videoSlot.ts sets on every element, the video does not merely taint the
// texture upload, it refuses to load (`MEDIA_ERR_SRC_NOT_SUPPORTED`).
// `/cors/<id>/<file>` answers 200 with the request Origin echoed back and no
// redirect off-host, which works from a hosted build with no dev proxy.
//
// **`/cors/` ignores `Range`.** It answers a range request with 200 and the
// whole file, and sends no `accept-ranges`. A `<video>` pointed straight at it
// plays, but `seekable` only ever covers what has downloaded — measured on a
// 628s clip: `seekable [[0, 4.3]]`, and assigning `currentTime = 502` read back
// as `4.3`. The seek is *silently clamped*: no error, no `seeking`, playback
// just carries on. That would break the cue in/out loop (gpu/videopump.ts) and
// the scrub bar (ui/useEngine.ts) in a way nothing on screen would explain. So a
// roll here downloads the whole file and hands the slot a `blob:` url, which is
// same-origin and therefore fully seekable — measured `seekable [[0, 628]]`, a
// seek landing in 50ms. That is what the byte caps below are really capping: the
// wait before the clip appears.

import { randomIndex } from '../rng'
import { BROWSE_LIMIT, isRecord, num, rotate, str } from './pool'

import type { Rand } from '../rng'
import type { BrowseHit, OnProgress, PoolPick } from './pool'

const SEARCH = 'https://archive.org/advancedsearch.php'
const METADATA = 'https://archive.org/metadata/'
const CORS_FILES = 'https://archive.org/cors/'
const DETAILS = 'https://archive.org/details/'
// A poster for an item, at no part of the download's cost. This is what makes
// the browser dialog worth having on this source in particular: a roll here has
// to fetch the whole rendition before anything appears (see the head of this
// file), so until there was a thumbnail endpoint the only way to see a clip was
// to commit to it. Answers 200 image/jpeg for a bare identifier.
const ITEM_IMAGE = 'https://archive.org/services/img/'

// The whole file is fetched before it plays, so a byte cap here is a stopwatch
// rather than a disk budget. /cors/ was measured between 0.9 and 9.4 MB/s, most
// often 3-9, which puts 24 MB at roughly 3-8 seconds and 64 MB at 7-21. It is
// set per channel because the two ends of this source are not the same bargain —
// see SHORT_BYTES and LONG_BYTES on the channels below.
//
// A cap also decides how *often* a roll fails, since an item whose only
// rendition is over it is skipped. Measured over 11-13 random items a pool:
// tape openings 7/11 at 24 MB and 8/11 at 48 MB, commercials 7/11 and 8/11,
// classic commercials 9/13 and 10/13. Four points of hit rate is not worth
// doubling every wait, which is why the short channels stay at 24 MB and spend
// an extra request instead (ATTEMPTS).
const SHORT_BYTES = 24_000_000
// Not 80: that is 9 seconds on a good transfer and a minute and a half on the
// 0.9 MB/s one, and a roll that takes a minute and a half has already failed as
// far as anyone playing a set is concerned. Not 48 either, which is where this
// sat until Theora came out of PLAYABLE below — Prelinger's h.264 renditions of
// a ten-minute reel measured 48.1 and 57.4 MB, so a 48 MB cap left the channel
// reaching for a `.ogv` that no longer decodes. 64 clears the h.264 and still
// bounds the wait at roughly 7-21 seconds.
const LONG_BYTES = 64_000_000

// A two-hour tape rip is not a video source, it is a download, and every
// collection of tape rips is full of them. The same line commons.ts draws. The
// byte caps above almost always bind first — this is what catches the long clip
// that happens to be cheaply encoded.
const MAX_SECONDS = 20 * 60

// Renditions taller than this are ignored, and 480 is the height to aim for:
// that is exactly this app's active raster, so nothing above it survives
// compose, and archive.org's uploaded masters run to 1920x1080.
const IDEAL_HEIGHT = 480
const MAX_HEIGHT = 720

// Below this a rendition is worse than the raster rather than merely equal to
// it. archive.org's `512Kb MPEG4` ladder bottoms out around 240 lines, which is
// still usable through a signal path that is about to degrade it on purpose.
const MIN_HEIGHT = 200

// What archive.org calls a rendition a browser can play. Worth stating because
// getting this list wrong is silent: filtering on `h.264` alone — the obvious
// guess, and what archive.org's own docs lead with — matched 1 item in 5 across
// these pools, since the derivative most items actually carry is `h.264 IA` (the
// newer `.ia.mp4`) and plenty carry only the uploaded `MPEG4`. With `h.264 IA`
// in, the same pools measured 3-4 in 5. `h.264 IA` is also usually the *small*
// one: 3 MB against an 89 MB master of the same commercial.
const PLAYABLE: ReadonlySet<string> = new Set([
  'h.264 IA',
  'h.264',
  '512Kb MPEG4',
  'MPEG4',
  'HiRes MPEG4',
])

// `Ogg Video` is deliberately absent, and this is the one exclusion that has to
// be stated or it will be helpfully added back. archive.org renders a Theora
// `.ogv` for nearly every older item, and it is usually the *smallest* file in
// the ladder — exactly what the scoring below would reach for. **Browsers have
// removed Theora.** On Firefox Nightly `canPlayType('video/ogg')` is now the
// empty string, and Chrome dropped it too.
//
// What makes it dangerous rather than merely useless is how it fails: the
// element does not error. It fires `loadeddata` and reports
// `videoWidth`/`videoHeight` of 0 — measured on a real Prelinger `.ogv` — so a
// slot goes to a source that looks loaded and renders nothing at all, with
// nothing in the console. Two of three Prelinger rolls hit this before the
// format was dropped.
//
// The format name is archive.org's own label and not always honest about the
// container, so the extension is checked too — `MPEG4` has been seen on `.m4v`,
// and an `.mkv` under a format this list allows would load as nothing.
const PLAYABLE_EXT = /\.(mp4|m4v|webm)$/i

// One tested collection: a query that has been run against the live API, what to
// call it, and the longest download it is allowed to ask for.
//
// A flat list, for the reason commons.ts is one — the source dropdown offered a
// channel per mood and is now one entry, "Random archive.org", so the extra
// level of grouping was carrying nothing. The byte cap stays per pool rather
// than going global, because a 30-second ident and a 20-minute industrial film
// are not the same bargain: holding the film to the ident's cap does not make it
// arrive sooner, it makes the pool empty.
//
// Pinned to named collections rather than open `mediatype:movies`, for the same
// reason commons.ts pins to categories and one more besides: an open movies
// search returns plenty that nobody has cleared for redistribution, and a
// collection at least says who gathered it and why.
//
// The pools that did not survive being tested are worth recording, because they
// are the ones that sound right. `collection:vhskids`, `vhsmovies` and
// `machinima` all returned 0 usable in 5 — they are whole-tape and whole-film
// rips, an hour or more each, so every rendition is over both caps.
// `computerchronicles` is the same story at 28 minutes an episode, which is a
// shame: beige boxes and 1984 chyron are exactly the material. Free-text pools
// over `collection:vhsvault` (mall, muzak, "test pattern", infomercial) matched
// but returned long rips too — 1-2 in 5, median 350-700s. `educationalfilms`
// reads like Prelinger and is not: 0 usable in 11 at 24 MB and 2 in 11 at *any*
// larger cap, because its scans are 90 MB and up with no small derivative
// beside them. Short-form collections are what works here.
export interface Pool {
  label: string
  query: string
  maxBytes: number
}

export const ARCHIVE_POOLS: readonly Pool[] = [
  // The core of it: distributor logos, FBI warnings, "coming soon on videotape"
  // reels. 16.6k items, and what comes back is 15-30s at 0.1-5 MB, so a roll is
  // over almost as soon as it starts.
  {
    label: 'Tape openings',
    query: 'collection:vhsopenings',
    maxBytes: SHORT_BYTES,
  },
  // Two collections of the same thing kept separate upstream: 18.2k taped off
  // broadcast, 8k curated. 15-30s, 0.3-12 MB.
  {
    label: 'TV commercials',
    query: 'collection:vhscommercials',
    maxBytes: SHORT_BYTES,
  },
  {
    label: 'Classic commercials',
    query: 'collection:classic_tv_commercials',
    maxBytes: SHORT_BYTES,
  },
  // The long end, and the only pool here whose licence is unambiguous: Prelinger
  // is ephemeral and industrial film released to the public domain, which is the
  // footage the other three are advertising over. It pays for that twice — the
  // clips run to minutes rather than seconds, and the cap has to be LONG_BYTES to
  // reach their h.264 renditions at all (3 usable in 11 at the short cap). A roll
  // here can take twenty seconds, which is what the option label warns about.
  {
    label: 'Prelinger industrial film',
    query: 'collection:prelinger',
    maxBytes: LONG_BYTES,
  },
]

// What a roll hands back is a `PoolPick` (pool.ts), the shape Commons rolls too.
// The fields this half fills in: `title` is the item's own identifier — the
// picker names a pool, so it is the only thing on screen saying which clip came
// out of it, and unlike a Commons title it is already url-safe. `kind` is always
// 'video'; this app reads archive.org for footage. `owned` is always true, since
// `url` is a `blob:` holding the whole clip, which is why a pick that never
// reaches a slot has to be released rather than merely dropped.

// How long a search or a metadata read is given before it is abandoned.
//
// This is not belt-and-braces: `archive.org/metadata/<id>` intermittently takes
// **33 seconds** and then answers with no `files` at all. Timed over three
// Prelinger rolls, two of them hit one — 33.3s and 33.2s, both useless. Without
// a deadline those stack up behind each other, because a roll reads up to
// ATTEMPTS items in series, and a roll that would have succeeded on its second
// candidate instead sits for a minute and a half looking like a hang. Six
// seconds is far above the healthy case (search 0.5s, metadata 0.6-1.3s) and far
// below the stall, so it separates the two cleanly — and it bounds the whole
// candidate loop, which reads up to ATTEMPTS items, at a few seconds rather than
// a few minutes.
const READ_TIMEOUT_MS = 6_000

// The download gets its own, much longer, budget: it is the one request whose
// size is known to be large, and /cors/ has been measured anywhere from 0.9 to
// 9.4 MB/s. Long enough that a slow-but-working transfer of the biggest allowed
// file finishes; short enough that a dead one gives up rather than leaving the
// caption on `rolling…` for the length of a track.
const DOWNLOAD_TIMEOUT_MS = 60_000

// A timed fetch that says what timed out. `AbortSignal.timeout` rejects with a
// bare "The operation was aborted", which reaches the error banner verbatim and
// tells the user nothing about which of two very different waits gave up.
const timed = async (
  url: string,
  timeoutMs: number,
  what: string,
): Promise<Response> => {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new Error(
        `${what} timed out after ${Math.round(timeoutMs / 1000)}s`,
        { cause: e },
      )
    throw e
  }
}

const request = async (
  url: string,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<unknown> => {
  const r = await timed(url, timeoutMs, 'archive.org')
  if (!r.ok) throw new Error(`archive ${r.status}`)
  return r.json() as Promise<unknown>
}

// --- picking a rendition ----------------------------------------------------

// How far a rendition is from the one worth downloading. Nearest to the raster
// height wins rather than tallest-that-fits, because the whole file is fetched
// before anything appears: a 640x480 `h.264 IA` at 3 MB beats the 1440x1080
// master of the same commercial at 89 MB, and after the signal path has had it
// nobody could tell them apart. Size breaks a tie for the same reason.
const distance = (height: number, bytes: number): number =>
  Math.abs(height - IDEAL_HEIGHT) * 1e9 + bytes

// Where an identifier's credit lives, derived rather than fetched — the same
// trick `commonsPageUrl` plays, and what lets a shelf entry offer the uploader
// and the terms without spending a request to find out where they are.
export const archivePageUrl = (identifier: string): string =>
  `${DETAILS}${encodeURIComponent(identifier)}`

// One item's chosen file, before anything has been downloaded. Not yet a
// `PoolPick`: its url is the `/cors/` one, which plays but cannot be seeked
// (the head of this file has the measurement), so it is a thing to *fetch*
// rather than a thing to show.
interface Rendition {
  url: string
  title: string
  page: string
  // What the download is about to cost, known from the metadata before a single
  // byte is asked for. This is the whole of "no surprises": the caption can name
  // the size the moment a clip is chosen rather than after it has arrived.
  bytes: number
}

// One item's usable rendition, or null. Everything here is a reason a roll skips
// to the next candidate rather than an error: an item with only a 1.3 GB master,
// an hour-long lecture, a `files` list holding nothing but a thumbnail and a
// subtitle track.
export const renditionFrom = (
  item: unknown,
  identifier: string,
  maxBytes = SHORT_BYTES,
): Rendition | null => {
  if (!isRecord(item)) return null
  const files = item.files
  if (!Array.isArray(files)) return null

  let best: { name: string; bytes: number; score: number } | null = null
  for (const f of files) {
    if (!isRecord(f)) continue
    const name = str(f.name)
    const format = str(f.format)
    const bytes = num(f.size)
    if (name === null || format === null || bytes === null) continue
    if (!PLAYABLE.has(format) || !PLAYABLE_EXT.test(name)) continue
    if (bytes <= 0 || bytes > maxBytes) continue

    const seconds = num(f.length)
    if (seconds !== null && seconds > MAX_SECONDS) continue

    // Height is missing on some entries. A rendition that will not say how tall
    // it is still plays, so it is judged at the ideal rather than dropped — the
    // byte cap is the real protection, and dropping these loses whole items
    // whose only rendition happens to be under-described.
    const height = num(f.height)
    if (height !== null && (height < MIN_HEIGHT || height > MAX_HEIGHT))
      continue

    const score = distance(height ?? IDEAL_HEIGHT, bytes)
    if (best === null || score < best.score) best = { name, bytes, score }
  }

  if (best === null) return null
  return {
    // Encoded per path segment: archive.org file names carry spaces, quotes and
    // parentheses as a matter of course ("'Dusty' Trailer (December 1983).mp4"),
    // and the identifier must not have its own slashes escaped away.
    url: `${CORS_FILES}${encodeURIComponent(identifier)}/${encodeURIComponent(best.name)}`,
    title: identifier,
    page: archivePageUrl(identifier),
    bytes: best.bytes,
  }
}

// --- rolling ----------------------------------------------------------------

// The identifiers a search came back with, in the order the API gave them —
// which is already random, since every query below sorts that way.
export const identifiersIn = (body: unknown): string[] =>
  docsIn(body).flatMap(d => {
    const id = str(d.identifier)
    return id === null ? [] : [id]
  })

const docsIn = (body: unknown): Record<string, unknown>[] => {
  if (!isRecord(body)) return []
  const response = body.response
  if (!isRecord(response)) return []
  const docs = response.docs
  return Array.isArray(docs) ? docs.filter(isRecord) : []
}

// `"24:54"`, `"1:04:12"` or `"1494.5"` — archive.org's runtime field is whatever
// the uploader or the deriver put there. Anything that is not one of those three
// reads as unknown, which is the same branch as the two items in three that do
// not carry the field at all.
export const runtimeSeconds = (raw: unknown): number | null => {
  const text = str(raw)
  if (text === null) return null
  const parts = text.split(':')
  if (parts.length > 3) return null
  let total = 0
  for (const part of parts) {
    const n = num(part)
    if (n === null || n < 0) return null
    total = total * 60 + n
  }
  return Number.isFinite(total) && total > 0 ? total : null
}

// Candidates to try, preferring anything that is not already on the slot. Same
// argument as commons.ts `choosePick`: a re-roll whose only visible effect is
// the same clip again reads as the click having failed. This one returns the
// whole list rather than one of them, because unlike a Commons search — which
// carries the transcode ladder inline — an archive.org search says only that the
// item exists, and whether it holds anything playable takes another request per
// candidate.
export function candidateOrder(
  identifiers: readonly string[],
  avoid: string,
): string[] {
  const fresh = identifiers.filter(id => id !== avoid)
  return fresh.length === 0 ? [...identifiers] : fresh
}

// How many identifiers a roll will open before giving up. Not one: an item is
// often unusable — it can easily hold nothing but the uploaded master — and a
// single attempt would fail a roll a third of the time on the short channels and
// three times in four on Prelinger, showing a banner where another request would
// have found something. Measured per-item rates are 7/11 (openings), 7/11
// (commercials), 9/13 (classic commercials) and 3/11 (Prelinger, whose reels sit
// just under the long cap).
//
// Six rather than four because the worst pool is the one that sets the number:
// at 3 in 11, four attempts still fail a roll about one time in four, and six
// bring that to one in eight. They are the cheap half of a roll — a metadata
// read is 0.6-1.3s against a download measured in tens of seconds — and a
// candidate that stalls is abandoned at READ_TIMEOUT_MS rather than waited on.
const ATTEMPTS = 6

// How many identifiers one search asks for. Larger than ATTEMPTS so `avoid` has
// something to choose between and a pool does not repeat itself, and cheap: the
// search returns identifiers only.
const CANDIDATES = 12

// How many pages deep a roll will land. This is the randomness, and it has to be
// because **archive.org's `sort[]=random` is stably seeded**: the same query
// returns the same order forever, verified by requesting one three times and
// getting the same four identifiers each time — with `cache-control: no-cache`
// on the response, so it is the search and not a cache. On its own that makes a
// channel a fixed clip rather than a pool: the first roll and the hundredth
// return the same tape opening, and re-picking — the whole feature — does
// nothing. `sort[]=random_<seed>`, the obvious next guess, is not supported and
// answers with an error page rather than JSON.
//
// So the page is what varies, over an order that is arbitrary but consistent,
// which gives each roll a disjoint dozen. 200 pages of 12 is 2,400 reachable
// items per pool, and every pool shipped above is far bigger than that (the
// smallest, classic_tv_commercials, holds 7,985 — 665 pages). A page past the
// end would come back empty, which `rollArchive` treats as a reason to fall back
// to the first page rather than to fail.
const PAGE_SPAN = 200

// Which pool this roll reads. Starting somewhere random keeps a roll spread over
// all of them without the first dominating. Unlike the Commons plan there is no
// retry list: a roll here already opens up to ATTEMPTS *items* out of the pool it
// landed on, which is the retry, and each one costs a metadata request.
export const chosenPool = (pools: readonly Pool[], start: number): Pool =>
  rotate(pools, start)[0] ?? pools[0]

// A search over the collections, ranked or shuffled. `rows` and `sort` differ
// between the two callers and nothing else does — a roll wants a disjoint dozen
// out of a fixed arbitrary order (see PAGE_SPAN), and a browse wants the best
// matches for words somebody actually typed.
export const searchUrl = (
  query: string,
  page: number,
  opts: { rows?: number; random?: boolean } = {},
): string => {
  // `fl[]` and `sort[]` repeat their key, which URLSearchParams handles, but the
  // brackets must survive — archive.org reads `fl[]`, not `fl`.
  const params = new URLSearchParams({
    q: `${query} AND mediatype:movies`,
    rows: String(opts.rows ?? CANDIDATES),
    page: String(page),
    output: 'json',
  })
  params.append('fl[]', 'identifier')
  params.append('fl[]', 'title')
  // Patchy — about one item in three carries it — but exact where it is there,
  // and it is the only thing either archive will say cheaply about how long a
  // clip runs. See `browseArchive` for what is deliberately *not* asked for.
  params.append('fl[]', 'runtime')
  // Random rather than relevance for the same reason `gsrsort=random` is right
  // on Commons: the channel is a pool, and the point is a different clip each
  // pick rather than the best match for a word nobody typed. It does not vary on
  // its own, though — see PAGE_SPAN, which is where the variation comes from.
  if (opts.random !== false) params.append('sort[]', 'random')
  return `${SEARCH}?${params.toString()}`
}

// How often a download is allowed to say where it has got to: every fiftieth of
// the file, so a caption ticks about fifty times over a wait of any length.
//
// Not per chunk. The body arrives in ~64 KB pieces, so a 24 MB clip would report
// nearly four hundred times, and each report is a caption write — engine state,
// which re-renders the panel. That is measured at 3ms with the stages folded and
// 19ms with them all mounted, so an unthrottled readout would spend several
// seconds of jank telling you how long you were waiting.
const PROGRESS_STEPS = 50

// Download the whole rendition, saying where it has got to as it goes. This is
// the seek fix described at the top of the file, and it is also why a roll here
// is slower than a Commons roll: nothing appears until the last byte lands. The
// caller keeps the old picture up meanwhile — and now has something to put under
// it.
const download = async (
  url: string,
  bytes: number,
  onProgress: OnProgress,
): Promise<Blob> => {
  const r = await timed(url, DOWNLOAD_TIMEOUT_MS, 'the download')
  if (!r.ok) throw new Error(`archive ${r.status}`)
  // `content-length` over the metadata's figure where both are there: it is what
  // this transfer will actually carry, and the two have been seen to disagree
  // where a derivative was re-encoded after the item was indexed.
  const total = num(r.headers.get('content-length')) ?? bytes
  const type = r.headers.get('content-type') ?? ''
  const body = r.body
  // No streams to read means no progress to report, which is a worse experience
  // and not a broken one.
  if (body === null) return r.blob()

  const chunks: BlobPart[] = []
  let loaded = 0
  let said = 0
  const step = total > 0 ? total / PROGRESS_STEPS : 1_000_000
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    // Sliced to its own ArrayBuffer rather than pushed as the view: a Uint8Array
    // over a SharedArrayBuffer is not a BlobPart, and the reader makes no promise
    // about which it hands back.
    chunks.push(value.slice().buffer)
    loaded += value.length
    if (loaded - said >= step) {
      said = loaded
      onProgress(loaded, total)
    }
  }
  // The type has to be carried over by hand. `r.blob()` takes it from the
  // response; a Blob built from chunks has none, and a `blob:` url with no type
  // is one a <video> will refuse to play rather than sniff.
  return new Blob(chunks, { type })
}

// --- holding on to what has already been fetched -----------------------------

// Two tiers over the network, because a wait of tens of seconds is worth
// avoiding twice over and the two ways of avoiding it cost different things.
// Measured in Firefox Nightly on this machine, per read:
//
//   memory  a Blob already in hand                          0ms
//   disk    caches.match 1ms, then .blob() at ~2.8ms/MB —   27ms at 3 MB,
//           111ms at 40, 176ms at 64
//   network the whole rendition off /cors/ at 0.9-9.4 MB/s  3-20s
//
// The disk tier is what makes "kept" mean ready rather than remembered: it
// survives the reload, so a clip starred last week plays at once today. The
// memory tier stays on top of it because the disk figures are per *play* and
// this is an instrument — 176ms of nothing after a key press is felt, and the
// long clips are exactly the ones that cost it.
//
// Neither is load-bearing. Every cache operation below degrades to the tier
// under it on any failure, so a browser with no `caches`, a private window, a
// full quota or a corrupt entry all end at the same place: it downloads.

// The memory tier's budget. Smaller than it was now that disk backs it up: this
// only has to cover what a set reaches for repeatedly, and anything it drops is
// a disk read rather than a download.
const MEMORY_BYTES = 96_000_000

// The disk tier's, and the reason it is not larger: the origin quota was
// measured at 1.6 GB on this machine, and it is shared with the file stash,
// which copies the user's own last-session clip into OPFS and needs room for it
// (ui/fileStash.ts `fits`). Their footage is worth more than a re-downloadable
// advert, so this takes a slice and leaves the rest.
const DISK_BYTES = 256_000_000

// Bumped when what is written changes shape, so a stale entry is never read
// back under new rules — the old cache is simply never opened again.
const DISK_CACHE = 'ntsc.js.archive.v1'

// The size of an entry, recorded on the way in. `cache.keys()` hands back
// requests and nothing else, so without this, totting up what is stored would
// mean reading every body — the one operation here that is not cheap.
const BYTES_HEADER = 'x-ntsc-bytes'

// Which held downloads have to go for a new one to fit, oldest first. Pure so
// the policy can be tested without a network or a browser, and shared by both
// tiers — they differ only in what "oldest" means, which is the caller's to
// know: least recently *played* in memory, least recently *downloaded* on disk.
export function evictionOrder(
  held: readonly { url: string; bytes: number }[],
  incoming: number,
  budget: number,
): string[] {
  let total = incoming + held.reduce((n, h) => n + h.bytes, 0)
  const out: string[] = []
  for (const h of held) {
    if (total <= budget) break
    total -= h.bytes
    out.push(h.url)
  }
  return out
}

// --- the disk tier -----------------------------------------------------------

// Absent in a non-secure context, and in the test runner. Everything below
// treats that as "no disk tier" rather than as an error.
const diskCache = (): Promise<Cache> | null =>
  typeof caches === 'undefined' ? null : caches.open(DISK_CACHE)

// Never throws. A cache read that fails is a cache miss, and the only thing a
// caller could do about it is what it was going to do anyway.
const fromDisk = async (url: string): Promise<Blob | null> => {
  try {
    const cache = await diskCache()
    const hit = await cache?.match(url)
    return hit === undefined ? null : await hit.blob()
  } catch {
    return null
  }
}

// Whether the origin has room to spare for this, on top of trimming our own
// entries to DISK_BYTES. The same shape ui/fileStash.ts uses before it copies a
// file: twice the size has to be free, so caching an advert can never be the
// reason somebody's own clip failed to stash.
const roomFor = async (bytes: number): Promise<boolean> => {
  const { quota, usage } = await navigator.storage.estimate()
  return quota === undefined || usage === undefined
    ? true
    : bytes * 2 < quota - usage
}

// Put it on disk, evicting oldest-first to stay inside the budget. Fire and
// forget from the caller's point of view: the clip is already playing by the
// time this matters, and a failure costs a re-download next session and nothing
// today.
//
// Oldest here is oldest *downloaded*, not oldest played: `cache.keys()` answers
// in insertion order, and moving an entry to the end on every play would mean
// rewriting tens of megabytes to record that they were read. For a shelf that
// is added to over time the two orders mostly agree, and the cost of them
// disagreeing is one download.
const toDisk = async (url: string, blob: Blob): Promise<void> => {
  try {
    const cache = await diskCache()
    if (cache === null || !(await roomFor(blob.size))) return
    const stored = await Promise.all(
      (await cache.keys()).map(async req => ({
        url: req.url,
        bytes: num((await cache.match(req))?.headers.get(BYTES_HEADER)) ?? 0,
      })),
    )
    for (const gone of evictionOrder(stored, blob.size, DISK_BYTES))
      await cache.delete(gone)
    await cache.put(
      url,
      new Response(blob, {
        headers: {
          'content-type': blob.type,
          [BYTES_HEADER]: String(blob.size),
        },
      }),
    )
  } catch {
    // A quota error, a cache evicted mid-write, a browser that declines to
    // store this much. All of them mean the same thing: next time, download it.
  }
}

// --- the memory tier ---------------------------------------------------------

// Keyed by the file's own `/cors/` url rather than the item's identifier: a roll
// and a shelf entry read the same item under different byte caps (a channel's
// against LONG_BYTES), so the two can legitimately choose different renditions
// of it, and keying on the item would hand one of them the other's file. The
// disk tier is keyed the same way, and has to be.
const held = new Map<string, Blob>()

// A download that has gone out and not come back, and everyone waiting on it.
//
// The shared job is why this exists at all: two decks can be sent to the same
// kept clip at once — one per source, which is an ordinary thing to do here —
// and without it that is the same tens of megabytes twice, in parallel, racing
// each other into the cache.
//
// `waiting` is the other half of the same fact, and it is the half that was
// missing. A deck that joins an existing transfer is not a lesser case of one
// that started it: it is looking at the same blank slot for the same twenty
// seconds. Handed only the promise, its caption sat on `opening…` for the whole
// wait while the deck beside it counted the same bytes down — and this is the
// one wait in the app with no picture behind it, which is the entire reason
// there is a readout to miss.
interface Fetching {
  job: Promise<Blob>
  waiting: Set<OnProgress>
}
const inflight = new Map<string, Fetching>()

const keep = (url: string, blob: Blob): Blob => {
  for (const gone of evictionOrder(
    [...held].map(([key, b]) => ({ url: key, bytes: b.size })),
    blob.size,
    MEMORY_BYTES,
  ))
    held.delete(gone)
  held.set(url, blob)
  return blob
}

// Disk, then the network. Only reached when memory missed and nothing else is
// already fetching this, so it is the slow half of `blobFor` and the only half
// that can take time.
const fetchOrRead = async (
  url: string,
  bytes: number,
  onProgress: OnProgress,
): Promise<Blob> => {
  const stored = await fromDisk(url)
  if (stored !== null) return stored
  // Announced here and not before, so a clip that is already held says nothing
  // at all: there is no wait to announce, and a caption that flashed a size and
  // vanished would be reporting one that never happened.
  onProgress(0, bytes)
  const blob = await download(url, bytes, onProgress)
  void toDisk(url, blob)
  return blob
}

const blobFor = (
  url: string,
  bytes: number,
  onProgress: OnProgress,
): Promise<Blob> => {
  const ready = held.get(url)
  if (ready !== undefined) {
    // Re-inserted so the map's iteration order stays least-recently-played
    // first, which is the order `evictionOrder` reads.
    held.delete(url)
    held.set(url, ready)
    return Promise.resolve(ready)
  }
  const already = inflight.get(url)
  if (already !== undefined) {
    // Joining costs one entry in a set rather than a second transfer. The
    // announcement (`onProgress(0, bytes)`) has already been made to whoever
    // started it, so a joiner picks the readout up at the next tick — fifty of
    // those over a transfer of any length, so it is a caption arriving a
    // fiftieth late rather than one that never arrives.
    already.waiting.add(onProgress)
    return already.job
  }

  // One reader, however many are listening: the fan-out is here so `download`
  // and `fetchOrRead` go on knowing about exactly one callback. The set is read
  // per report rather than captured, so a deck that joins mid-transfer is heard.
  const waiting = new Set<OnProgress>([onProgress])
  const job = fetchOrRead(url, bytes, (loaded, total) => {
    for (const say of waiting) say(loaded, total)
  }).then(blob => keep(url, blob))
  inflight.set(url, { job, waiting })
  return job.finally(() => inflight.delete(url))
}

// A rendition, downloaded and turned into something showable. Every pick from
// this source goes through here, which is the one place `owned: true` is
// written — that flag is what tells `releasePick` there is a blob to hand back.
const fetchPick = async (
  rendition: Rendition,
  onProgress: OnProgress,
): Promise<PoolPick> => {
  const blob = await blobFor(rendition.url, rendition.bytes, onProgress)
  return {
    origin: 'archive',
    title: rendition.title,
    kind: 'video',
    page: rendition.page,
    // Still owned, and still revoked when the slot lets go of it: an object url
    // is a handle on a Blob and not the Blob, so revoking one costs the cache
    // nothing. That is the whole reason this holds Blobs rather than urls —
    // caching the url instead would have made `releasePick` destroy the very
    // thing it was meant to save, and only on the *second* play.
    owned: true,
    url: URL.createObjectURL(blob),
  }
}

// Roll one clip out of archive.org. Two requests at best — a search and one
// item's metadata — plus the download, and up to ATTEMPTS metadata requests
// where the first items hold nothing playable.
//
// What a seed pins here is the channel and the page, which is more than the
// Commons half can promise (see `rollCommons`) and still not the file: the
// ordering inside a page is archive.org's, and `candidateOrder` then walks it
// until something holds a playable rendition. The seed reproduces the
// decisions; the recorded `PoolRef` reproduces the clip.
export async function rollArchive(
  avoid = '',
  onProgress: OnProgress = () => {},
  rand: Rand = Math.random,
): Promise<PoolPick> {
  const pool = chosenPool(
    ARCHIVE_POOLS,
    randomIndex(ARCHIVE_POOLS.length, rand),
  )
  const page = 1 + randomIndex(PAGE_SPAN, rand)
  let found = identifiersIn(await request(searchUrl(pool.query, page)))
  // A pool smaller than PAGE_SPAN pages answers a deep page with nothing. That
  // is a fact about the pool rather than a failed roll, so the first page —
  // which every non-empty pool has — is the fallback.
  if (found.length === 0 && page !== 1)
    found = identifiersIn(await request(searchUrl(pool.query, 1)))
  for (const identifier of candidateOrder(found, avoid).slice(0, ATTEMPTS)) {
    // A candidate that will not answer in time is a candidate that is not
    // usable, which is the same branch as one holding nothing playable. Only the
    // metadata read is forgiven this way: a failed *download* has already picked
    // a clip and told the user it is coming, so it surfaces rather than moving
    // silently on to something else.
    let meta: unknown
    try {
      meta = await request(`${METADATA}${encodeURIComponent(identifier)}`)
    } catch {
      continue
    }
    const rendition = renditionFrom(meta, identifier, pool.maxBytes)
    if (rendition === null) continue
    return fetchPick(rendition, onProgress)
  }
  throw new Error('nothing playable came back — roll again')
}

// One named item, read by the same reader that vetted it when it was rolled.
// The archive.org half of what `resolveCommons` does, and the reason a clip from
// here can now be kept on the shelf at all.
//
// It was previously held that it could not be: a Commons entry is a title and an
// archive.org pick is a downloaded blob, so the two looked like different kinds
// of thing. They are not — the blob is the *playback* and the identifier is the
// identity, and re-reading one item's metadata is the same request a roll makes
// per candidate anyway. What it costs is the download again, which is exactly
// what a roll costs; what it buys is a clip you liked surviving the next roll.
//
// LONG_BYTES rather than the channel's own cap, since a shelf entry has no
// channel by the time it is played, and refusing to reopen a clip this app
// itself put on the shelf would be the worse failure.
export async function resolveArchive(
  identifier: string,
  onProgress: OnProgress = () => {},
): Promise<PoolPick> {
  const meta = await request(`${METADATA}${encodeURIComponent(identifier)}`)
  const rendition = renditionFrom(meta, identifier, LONG_BYTES)
  if (rendition === null)
    throw new Error(`${archiveCaption(identifier)} is no longer playable`)
  return fetchPick(rendition, onProgress)
}

// A page of results for an arbitrary query, as the browser dialog draws them.
//
// Ranked rather than shuffled, which is the difference between this and a roll —
// and cheap in a way a roll can never be: an item's poster comes off
// `services/img/` with none of the download behind it, so two dozen clips can be
// looked at for the price of one search. Until this existed the only way to see
// what a channel held was to commit to a clip and wait out its bytes.
//
// No metadata read per hit, so a result is not yet known to be playable, nor how
// big its rendition is. That is the deliberate half of the bargain: checking two
// dozen items would be two dozen requests against an endpoint measured stalling
// for 33 seconds, and the check happens anyway at the moment one is chosen.
//
// **`item_size` is deliberately not asked for**, and this has to be written down
// or it will be helpfully added: the search *will* return it, it looks exactly
// like the download estimate this dialog wants, and it is not one. It counts
// every file in the item — masters, thumbnails, derivatives, metadata — where a
// roll takes the smallest playable rendition. Measured against what a pick would
// actually download, over twelve random items: 1.0x, 1.1x and 2.1x on short
// idents, then 15.4x, 15.6x, 16.1x and 54.4x, and one Prelinger item reporting
// 363 GB against a 167 MB rendition. Shown in the grid it would frighten people
// off good clips and be wrong by three orders of magnitude while doing it. The
// honest number arrives with the metadata at pick time, which is where the
// caption says it (`Rendition.bytes`).
export async function browseArchive(query: string): Promise<BrowseHit[]> {
  const body = await request(
    searchUrl(query, 1, { rows: BROWSE_LIMIT, random: false }),
  )
  return docsIn(body).flatMap(doc => {
    const identifier = str(doc.identifier)
    if (identifier === null) return []
    return [
      {
        origin: 'archive' as const,
        title: identifier,
        kind: 'video' as const,
        // The item's own title where it has one, which reads far better than the
        // slug: "Gracie Films (Halloween) / 20th Television Logo 1992" against
        // "gracie films halloween 20th television logo 1992".
        label: str(doc.title) ?? archiveCaption(identifier),
        thumb: `${ITEM_IMAGE}${encodeURIComponent(identifier)}`,
        page: archivePageUrl(identifier),
        seconds: runtimeSeconds(doc.runtime),
      },
    ]
  })
}

// An identifier is a slug rather than a sentence, and the caption has one line.
// Underscores and hyphens are what archive.org's own uploads use as spaces, and
// the trailing `_202412` that its de-duplicator appends says nothing to anyone.
export const archiveCaption = (identifier: string): string =>
  identifier
    .replace(/_\d{6,8}$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
