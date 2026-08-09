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

const SEARCH = 'https://archive.org/advancedsearch.php'
const METADATA = 'https://archive.org/metadata/'
const CORS_FILES = 'https://archive.org/cors/'
const DETAILS = 'https://archive.org/details/'

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

interface Channel {
  label: string
  // Rolled per pick, so one channel spans several pools without any of them
  // dominating. Every query here has been run against the live API.
  queries: readonly string[]
  // The longest download this channel is allowed to ask for. Per channel rather
  // than global because a 30-second ident and a 20-minute industrial film are
  // not the same bargain: holding the film to the ident's cap does not make it
  // arrive sooner, it makes the channel empty.
  maxBytes: number
}

export const ARCHIVE_IDS = [
  'ia-openings',
  'ia-adverts',
  'ia-industrial',
] as const
export type ArchiveId = (typeof ARCHIVE_IDS)[number]

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
export const ARCHIVE: Record<ArchiveId, Channel> = {
  // The core of it: distributor logos, FBI warnings, "coming soon on videotape"
  // reels. 16.6k items, and what comes back is 15-30s at 0.1-5 MB, so a roll is
  // over almost as soon as it starts.
  'ia-openings': {
    label: 'Archive: tape openings — logos, idents, FBI warnings',
    queries: ['collection:vhsopenings'],
    maxBytes: SHORT_BYTES,
  },
  // Two collections of the same thing kept separate upstream, rolled as one:
  // 18.2k taped off broadcast, 8k curated. 15-30s, 0.3-12 MB.
  'ia-adverts': {
    label: 'Archive: TV commercials — 80s and 90s, taped off air',
    queries: ['collection:vhscommercials', 'collection:classic_tv_commercials'],
    maxBytes: SHORT_BYTES,
  },
  // The long end, and the only channel here whose licence is unambiguous:
  // Prelinger is ephemeral and industrial film released to the public domain,
  // which is the footage the other two channels are advertising over. It pays
  // for that twice — the clips run to minutes rather than seconds, and the cap
  // has to be LONG_BYTES to reach their h.264 renditions at all (3 usable in 11
  // at the short cap). A roll here can take twenty seconds, which is what the
  // band heading in modes.ts warns about.
  'ia-industrial': {
    label: 'Archive: industrial film — Prelinger, public domain',
    queries: ['collection:prelinger'],
    maxBytes: LONG_BYTES,
  },
}

const ARCHIVE_ID_SET: ReadonlySet<string> = new Set(ARCHIVE_IDS)
export const isArchiveId = (mode: string): mode is ArchiveId =>
  ARCHIVE_ID_SET.has(mode)

// What a roll hands back. `url` is a `blob:` url the <video> path takes as-is,
// which is why a pick has to be *released* rather than merely dropped — see
// `releaseArchivePick`. `title` is the item's own identifier: the picker names a
// pool, so this is the only thing on screen saying which clip came out of it,
// and unlike a Commons title it is already url-safe.
export interface ArchivePick {
  url: string
  title: string
  // The item's page: who uploaded it, and under what terms. Same argument as
  // CommonsPick.page — this app composites other people's footage into
  // something recordable, so the one link that leads to the credit travels
  // with it.
  page: string
}

// --- response narrowing -----------------------------------------------------
// Untyped JSON from another origin, walked with guards rather than asserted into
// a shape. Anything unexpected reads as "this item is not usable", which is the
// same branch a missing rendition takes.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

// Every numeric field in an archive.org file entry arrives as a *string* —
// `"size": "3214809"`, `"length": "30.65"` — and `length` is sometimes a
// timestamp (`"1:04:12"`) instead of seconds. Both read as absent rather than
// being half-parsed: `Number('1:04:12')` is NaN, and a NaN slipping past the
// caps is how a two-hour master would get downloaded.
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

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

// One item's usable rendition, or null. Everything here is a reason a roll skips
// to the next candidate rather than an error: an item with only a 1.3 GB master,
// an hour-long lecture, a `files` list holding nothing but a thumbnail and a
// subtitle track.
export const renditionFrom = (
  item: unknown,
  identifier: string,
  maxBytes = SHORT_BYTES,
): ArchivePick | null => {
  if (!isRecord(item)) return null
  const files = item.files
  if (!Array.isArray(files)) return null

  let best: { name: string; score: number } | null = null
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
    if (best === null || score < best.score) best = { name, score }
  }

  if (best === null) return null
  return {
    // Encoded per path segment: archive.org file names carry spaces, quotes and
    // parentheses as a matter of course ("'Dusty' Trailer (December 1983).mp4"),
    // and the identifier must not have its own slashes escaped away.
    url: `${CORS_FILES}${encodeURIComponent(identifier)}/${encodeURIComponent(best.name)}`,
    title: identifier,
    page: `${DETAILS}${encodeURIComponent(identifier)}`,
  }
}

// --- rolling ----------------------------------------------------------------

// The identifiers a search came back with, in the order the API gave them —
// which is already random, since every query below sorts that way.
export const identifiersIn = (body: unknown): string[] => {
  if (!isRecord(body)) return []
  const response = body.response
  if (!isRecord(response)) return []
  const docs = response.docs
  if (!Array.isArray(docs)) return []
  return docs.flatMap(d => {
    const id = isRecord(d) ? str(d.identifier) : null
    return id === null ? [] : [id]
  })
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

const rotate = <T>(xs: readonly T[], by: number): T[] => [
  ...xs.slice(by),
  ...xs.slice(0, by),
]

// Which pool of a channel this roll reads. Starting somewhere random keeps one
// channel spanning both its collections without the first dominating.
export const queryPlan = (queries: readonly string[], start: number): string =>
  rotate(queries, start)[0] ?? ''

export const searchUrl = (query: string, page: number): string => {
  // `fl[]` and `sort[]` repeat their key, which URLSearchParams handles, but the
  // brackets must survive — archive.org reads `fl[]`, not `fl`.
  const params = new URLSearchParams({
    q: `${query} AND mediatype:movies`,
    rows: String(CANDIDATES),
    page: String(page),
    output: 'json',
  })
  params.append('fl[]', 'identifier')
  // Random rather than relevance for the same reason `gsrsort=random` is right
  // on Commons: the channel is a pool, and the point is a different clip each
  // pick rather than the best match for a word nobody typed. It does not vary on
  // its own, though — see PAGE_SPAN, which is where the variation comes from.
  params.append('sort[]', 'random')
  return `${SEARCH}?${params.toString()}`
}

// Download the whole rendition and hand back a blob url. This is the seek fix
// described at the top of the file, and it is also why a roll here is slower
// than a Commons roll: nothing appears until the last byte lands. The caller
// keeps the old picture up meanwhile.
const fetchAsBlobUrl = async (url: string): Promise<string> => {
  const r = await timed(url, DOWNLOAD_TIMEOUT_MS, 'the download')
  if (!r.ok) throw new Error(`archive ${r.status}`)
  return URL.createObjectURL(await r.blob())
}

// A pick's blob url is a live allocation holding the whole clip in memory, so
// dropping the pick is not enough — an abandoned one leaks until the tab goes.
// stopSlot already revokes whatever `blob:` url is on the element it retires;
// this is for the roll that is *thrown away* before it ever reaches a slot,
// which is every roll that lands after the user has moved that deck on.
export const releaseArchivePick = (picked: ArchivePick): void => {
  URL.revokeObjectURL(picked.url)
}

// Roll one clip out of a channel. Two requests at best — a search and one
// item's metadata — plus the download, and up to ATTEMPTS metadata requests
// where the first items hold nothing playable.
export async function rollArchive(
  id: ArchiveId,
  avoid = '',
): Promise<ArchivePick> {
  const channel = ARCHIVE[id]
  const start = Math.floor(Math.random() * channel.queries.length)
  const query = queryPlan(channel.queries, start)
  const page = 1 + Math.floor(Math.random() * PAGE_SPAN)
  let found = identifiersIn(await request(searchUrl(query, page)))
  // A pool smaller than PAGE_SPAN pages answers a deep page with nothing. That
  // is a fact about the pool rather than a failed roll, so the first page —
  // which every non-empty pool has — is the fallback.
  if (found.length === 0 && page !== 1)
    found = identifiersIn(await request(searchUrl(query, 1)))
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
    const rendition = renditionFrom(meta, identifier, channel.maxBytes)
    if (rendition === null) continue
    return { ...rendition, url: await fetchAsBlobUrl(rendition.url) }
  }
  throw new Error('nothing playable came back — roll again')
}

// An identifier is a slug rather than a sentence, and the caption has one line.
// Underscores and hyphens are what archive.org's own uploads use as spaces, and
// the trailing `_202412` that its de-duplicator appends says nothing to anyone.
export const archiveCaption = (identifier: string): string =>
  identifier
    .replace(/_\d{6,8}$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
