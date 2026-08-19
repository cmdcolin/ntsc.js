// Random media pulled live from Wikimedia Commons, as a source either slot can
// show. Unlike every other source here nothing ships with the app: a channel is
// a *search*, and picking one rolls a file out of it.
//
// Why channels rather than one "random Commons file": a genuinely random file
// from namespace 6 is not usable material. Sampling 40 of them returned scanned
// newspapers, PDF pages, church exteriors and — for about one in ten — an audio
// pronunciation clip with no image at all. Commons is an encyclopedia's
// warehouse, and the median file in it is documentation, not a picture.
//
// The pools below are the ones that survived being tested by hand. Each is
// tight enough that nearly every hit is on-vibe, which matters more than pool
// size for a reason worth stating: `srsort=random` samples uniformly from
// *everything the query matches*, so it discards relevance ranking entirely. A
// loose `neon OR sunset OR "palm tree"` matches 8,350 files on any one of those
// words appearing anywhere in the metadata, and sorted randomly it returns a
// Greek vase, a teaspoon, and a maize farm. Search terms that would be fine for
// a human reading ranked results are useless here. Narrow beats broad.
//
// `deepcat:` rather than `incategory:` because Commons categories are a deep
// tree and `incategory:` matches direct membership only — "1980s photographs"
// has 17 files directly in it and tens of thousands below it.
//
// The channels are not the only way in any more: ui/MediaBrowserDialog.tsx runs
// arbitrary queries through `browseCommons`, which is *ranked* rather than
// random and therefore does not have the problem the paragraph above describes.
// The pools stay because a channel is a one-click gesture mid-set and a dialog
// is not.

import { pickOne, randomIndex } from '../core/rng'
import { BROWSE_LIMIT, isRecord, num, rotate, str } from './pool'

import type { Rand } from '../core/rng'
import type { BrowseHit, PickKind, PoolPick, PoolRef } from './pool'

const API = 'https://commons.wikimedia.org/w/api.php'

// Width asked of the thumbnailer. Commons snaps a thumbnail request up to the
// next standard bucket, so asking for MAX_SRC_EDGE (1536) hands back a 1920px
// file that gpu/sources.ts then pays to scale down again. 1024 snaps to 1024,
// is still comfortably above the 754px active raster, and is a quarter of the
// bytes. Originals are never fetched: they run to 40 megapixels.
const THUMB_WIDTH = 1024

// Width asked for a browse result, which is a picture to *choose* by rather than
// one to show. Two dozen of these load at once, so the grid cell's width is the
// budget — 240 covers it at 2× and is a fortieth of the bytes a playable
// thumbnail costs.
const BROWSE_THUMB = 240

// Transcodes taller than this are ignored. Commons pre-renders a ladder for
// every video it holds, and the source of truth for "how big is this really" is
// the derivative list, not the original — the 4K Big Buck Bunny master is a
// 2.9 GB download whose 480p VP9 rendition is 1.2 Mbit/s. 480 lines is also
// exactly this app's raster height, so nothing above it survives compose.
const MAX_VIDEO_HEIGHT = 480

// A long lecture is not a video source, it is a download. Commons holds plenty
// of them and deepcat wanders into conference talks from almost anywhere.
const MAX_VIDEO_SECONDS = 20 * 60

// One tested pool: a query that has been run against the live API, what to call
// it, and which of the two readers vets what comes back.
//
// A flat list, where this was a two-level table of seven named "channels" each
// holding three or four of these. The nesting existed for one reason — the
// source dropdown offered a channel per mood, so the queries had to be grouped
// under names like "statuary, neon, dead malls, sunsets" — and that dropdown is
// now one entry, "Random Commons". The grouping was also lossy in both
// directions: three queries appeared in two channels each and so rolled at
// double weight, and no single pool could be reached deliberately even though
// the good ones (Fortepan; marble busts) are the reason the feature works.
//
// Flat, every pool is exactly one roll's worth of weight, and every one is a
// button in the browser dialog — which is where a name like "Marble busts"
// finally does something a mood label could not.
export interface Pool {
  label: string
  query: string
  kind: PickKind
}

const BITMAP = 'filetype:bitmap'

export const COMMONS_POOLS: readonly Pool[] = [
  // Fortepan is the anchor: ~67k donated Hungarian amateur photographs running
  // from the 1900s to the 1990s, which is the closest thing Commons has to a
  // shoebox of found snapshots.
  { label: 'Fortepan snapshots', query: `Fortepan ${BITMAP}`, kind: 'photo' },
  // Marble busts are the surprise here and the best single pool of the lot —
  // Gordian I, Agrippa, anonymous Greek heads, all shot against flat museum
  // backdrops, which is the exact look the aesthetic borrows.
  {
    label: 'Marble busts',
    query: `deepcat:"Marble busts" ${BITMAP}`,
    kind: 'photo',
  },
  {
    label: 'Neon signs',
    query: `deepcat:"Neon signs" ${BITMAP}`,
    kind: 'photo',
  },
  {
    label: 'Dead malls',
    query: `deepcat:"Interiors of shopping malls" ${BITMAP}`,
    kind: 'photo',
  },
  {
    label: 'VHS and CRTs',
    query: `VHS OR camcorder OR "cathode ray" ${BITMAP}`,
    kind: 'photo',
  },
  { label: 'Sunsets', query: `deepcat:"Sunsets" ${BITMAP}`, kind: 'photo' },
  {
    label: 'Underwater',
    query: `deepcat:"Underwater photographs" ${BITMAP}`,
    kind: 'photo',
  },
  {
    label: 'Birds',
    query: `deepcat:"Quality images of birds" ${BITMAP}`,
    kind: 'photo',
  },
  {
    label: 'Portraits',
    query: `deepcat:"Portrait photographs of women" ${BITMAP}`,
    kind: 'photo',
  },
  {
    label: 'Fashion',
    query: `deepcat:"Fashion photographs" ${BITMAP}`,
    kind: 'photo',
  },
  // The moving half. Every one was rolled against the live API and returns clips
  // with transcodes; named categories that sound better and return *nothing* are
  // worth recording so nobody adds them back — "Videos of cities at night",
  // "Videos of waves" and "Videos of aurorae" are all empty or non-existent,
  // which is why there is no moving equivalent of the neon above.
  //
  // Time-lapse is the strongest of them. "Videos of animals" sounds better and
  // is 23k files, but random-sorted it returns football highlights and animated
  // GIFs; time-lapse is a format rather than a subject, so the category stays
  // honest, and a 30-second clip of moving cloud is ideal material besides.
  {
    label: 'Time-lapse',
    query: 'deepcat:"Time-lapse videos"',
    kind: 'video',
  },
  {
    label: 'Fountains',
    query: 'deepcat:"Videos of fountains"',
    kind: 'video',
  },
  { label: 'Clouds', query: 'deepcat:"Videos of clouds"', kind: 'video' },
  {
    label: 'Underwater, moving',
    query: 'deepcat:"Underwater videos"',
    kind: 'video',
  },
  { label: 'Animals', query: 'deepcat:"Videos of animals"', kind: 'video' },
  { label: 'Fire', query: 'deepcat:"Videos of fire"', kind: 'video' },
]

// What a roll hands back is a `PoolPick` (pool.ts), the shape archive.org rolls
// too. The fields this half fills in: `title` is the Commons page title, which
// is what the picker cannot say — two rolls of the same channel are different
// pictures, and the title is the only thing naming which one is up, as well as
// the identity a shelf entry keeps. `owned` is always false: these urls are
// upload.wikimedia.org's, not ours to revoke.

// `query.pages` is an object keyed by page id, and the generator returns them
// in no useful order.
const pagesOf = (body: unknown): Record<string, unknown>[] => {
  if (!isRecord(body)) return []
  const query = body.query
  if (!isRecord(query)) return []
  const pages = query.pages
  if (!isRecord(pages)) return []
  return Object.values(pages).filter(isRecord)
}

// Anonymous CORS on the Commons API needs `origin=*` in the query string; the
// response then carries `access-control-allow-origin: *`. No proxy and no
// dev-server bridge, which is why this works in a production build where the
// YouTube source does not. Deliberately no custom request header: an
// `Api-User-Agent` would turn every roll into a CORS preflight plus the real
// request, and the browser's own User-Agent already identifies the caller.
const query = (params: Record<string, string>): Promise<unknown> => {
  const search = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    ...params,
  })
  return fetch(`${API}?${search.toString()}`).then(r => {
    if (!r.ok) throw new Error(`commons ${r.status}`)
    return r.json() as Promise<unknown>
  })
}

// The head of a page, whichever prop it was asked for. `imageinfo` and
// `videoinfo` are the same shape down to here — a list holding one entry for the
// current version — and differ only in what hangs off it.
const infoOf = (
  page: Record<string, unknown>,
  prop: 'imageinfo' | 'videoinfo',
): { title: string; info: Record<string, unknown> } | null => {
  const title = str(page.title)
  const versions = page[prop]
  if (title === null || !Array.isArray(versions)) return null
  const first: unknown = versions[0]
  return isRecord(first) ? { title, info: first } : null
}

const WIKI_PAGE = 'https://commons.wikimedia.org/wiki/'

// Where a title's credit lives, derived rather than fetched: a Commons page path
// is the title with spaces as underscores. Which is what lets a favourite —
// stored as a title and nothing else — offer the licence and the photographer
// without spending a request to find out where they are.
export const commonsPageUrl = (title: string): string =>
  WIKI_PAGE + encodeURIComponent(title.replace(/ /g, '_'))

// The same page as the API gave it where it did. `descriptionurl` arrives with
// the `url` prop both kinds ask for.
const pageOf = (info: Record<string, unknown>, title: string): string =>
  str(info.descriptionurl) ?? commonsPageUrl(title)

// A page's usable still: the capped thumbnail where the thumbnailer made one,
// the file itself where it was already smaller than the request. Non-images are
// dropped — `filetype:bitmap` narrows the search but the odd TIFF still lands,
// and a TIFF is not something a browser will decode.
const OK_IMAGE = /^image\/(jpeg|png|gif|webp)$/

// The two fields every Commons pick answers the same way, filled in once.
const made = (fields: {
  url: string
  title: string
  kind: PickKind
  page: string
}): PoolPick => ({ ...fields, origin: 'commons', owned: false })

export const stillFrom = (page: Record<string, unknown>): PoolPick | null => {
  const head = infoOf(page, 'imageinfo')
  if (head === null) return null
  const { title, info } = head
  const mime = str(info.mime)
  if (mime === null || !OK_IMAGE.test(mime)) return null
  const url = str(info.thumburl) ?? str(info.url)
  return url === null
    ? null
    : made({ url, title, kind: 'photo', page: pageOf(info, title) })
}

// A page's usable rendition: the biggest VP9 WebM transcode within the height
// cap. Never the original — it can be 4K, it can be a 2.9 GB master, and where
// the upload was Ogg Theora the transcode is the only modern container on
// offer. `transcodekey` is what marks a derivative as a rendition rather than
// the source file repeated back.
export const videoFrom = (page: Record<string, unknown>): PoolPick | null => {
  const head = infoOf(page, 'videoinfo')
  if (head === null) return null
  const { title, info } = head
  const seconds = num(info.duration)
  if (seconds !== null && seconds > MAX_VIDEO_SECONDS) return null
  const derivatives = info.derivatives
  if (!Array.isArray(derivatives)) return null

  let best: { url: string; height: number } | null = null
  for (const d of derivatives) {
    if (!isRecord(d)) continue
    const key = str(d.transcodekey)
    const url = str(d.src)
    const height = num(d.height)
    if (key === null || url === null || height === null) continue
    if (!key.endsWith('.vp9.webm') || height > MAX_VIDEO_HEIGHT) continue
    if (best === null || height > best.height) best = { url, height }
  }
  return best === null
    ? null
    : made({ url: best.url, title, kind: 'video', page: pageOf(info, title) })
}

// What the API has to be asked for, per kind: a capped thumbnail for a still,
// the transcode ladder for a clip. A table rather than a branch at the one call
// site because there are two ways in now — rolling a channel, and resolving one
// file by name — and a favourite has to come back through exactly the reader
// that vetted it when it was rolled.
const WANTED: Record<PickKind, Record<string, string>> = {
  photo: {
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: String(THUMB_WIDTH),
  },
  video: { prop: 'videoinfo', viprop: 'derivatives|size|mime|url' },
}

const READ: Record<
  PickKind,
  (page: Record<string, unknown>) => PoolPick | null
> = { photo: stillFrom, video: videoFrom }

const usableIn = (body: unknown, kind: PickKind): PoolPick[] =>
  pagesOf(body).flatMap(page => {
    const found = READ[kind](page)
    return found === null ? [] : [found]
  })

// One of the candidates, preferring anything that is not already on the slot.
// Twelve candidates a request and one file rolled out of them means a re-roll
// repeats itself about one time in twelve — and a click whose only visible
// effect would have been the same picture again reads as the click having
// failed. The preference yields rather than empties: a pool that has genuinely
// narrowed to one file is not a failure to roll.
export function choosePick(
  candidates: readonly PoolPick[],
  avoid: string,
  rand: Rand = Math.random,
): PoolPick | null {
  const fresh = candidates.filter(c => c.title !== avoid)
  return pickOne(fresh.length === 0 ? candidates : fresh, rand)
}

// How many requests one roll will spend before giving up.
//
// One was not enough. `gsrsort=random` discards relevance ranking, so a page of
// candidates can come back holding nothing this app can use — every hit a TIFF,
// every video missing the transcodes — and the roll then failed with a banner
// where a second request would have found something. Two is the whole of the
// retry: a channel that answers nothing twice is a channel worth looking at.
const ATTEMPTS = 2

// Which pools this roll will try, in order. Starting somewhere random is what
// spreads a roll over all of them without the first dominating; moving on rather
// than asking the same pool twice is what makes the retry worth having, since a
// pool whose transcodes are all missing stays that way.
export const rollPlan = <T>(pools: readonly T[], start: number): T[] =>
  rotate(pools, start).slice(0, ATTEMPTS)

// Roll one file out of Commons. A single request does the whole job: a search
// generator feeding the imageinfo/videoinfo the caller actually needs, so
// there is no title round-trip in between.
//
// `gsrlimit` is 12 rather than 1 because the generator's own randomness is the
// cheap part — one request returns a dozen candidates, and picking among them
// locally is what lets a video roll skip the ones whose transcodes are missing
// without going back to the network, and what gives `avoid` something to choose
// between.
//
// A roll can hand back a still or a clip, since the pools hold both and this is
// one entry in the picker rather than seven. `rollFromPool` below is what a
// browser preset uses to stay inside one of them.
// **A seed does not pin which file comes back, and cannot.** `gsrsort=random`
// below hands the choice of candidates to Commons, so what a seeded roll
// reproduces is which pools this app tried and which of the twelve it took —
// not what those twelve were. That is why a take records the resolved `PoolRef`
// alongside its seed (docs/EDITOR.md › _Seeding_) rather than trusting the seed
// to regenerate the pick: the seed reproduces the *decisions*, the ref
// reproduces the *file*.
export async function rollCommons(
  avoid = '',
  rand: Rand = Math.random,
): Promise<PoolPick> {
  const start = randomIndex(COMMONS_POOLS.length, rand)
  for (const pool of rollPlan(COMMONS_POOLS, start)) {
    const found = await rollFromPool(pool, avoid, rand)
    if (found !== null) return found
  }
  throw new Error('nothing usable came back — roll again')
}

// One roll out of one named pool, or null when that pool answered with nothing
// this app can use. The retry in `rollCommons` is a *different* pool rather
// than the same query twice, so this stays a single request — which is why it
// is a function at all and why it is not exported: it is that loop's body and
// has no caller of its own. A browser preset does not come through here; it
// runs a ranked *search* over the same query, which is a different request.
async function rollFromPool(
  pool: Pool,
  avoid = '',
  rand: Rand = Math.random,
): Promise<PoolPick | null> {
  const body = await query({
    generator: 'search',
    gsrsearch: pool.query,
    gsrnamespace: '6',
    gsrlimit: '12',
    gsrsort: 'random',
    ...WANTED[pool.kind],
  })
  return choosePick(usableIn(body, pool.kind), avoid, rand)
}

// One named file, fetched the same way and read by the same reader. This is what
// a shelf entry *is*: the title, resolved when it is played rather than a
// thumbnail url kept from the day it was kept. A derivative url is a promise
// about a rendering — the thumbnailer's buckets, a file overwritten by a better
// scan, a transcode ladder rebuilt — and none of that outlives a shelf that is
// meant to still work next year, where the title does.
export async function resolveCommons(ref: PoolRef): Promise<PoolPick> {
  const body = await query({ titles: ref.title, ...WANTED[ref.kind] })
  const found = usableIn(body, ref.kind)[0]
  if (found === undefined)
    throw new Error(`${commonsCaption(ref.title)} is no longer playable`)
  return found
}

// A page of results for an arbitrary query, as the browser dialog draws them.
//
// The other three requests in this file ask for what it takes to *play* a file;
// this one asks for what it takes to look at two dozen and choose. That is one
// `imageinfo` at 240px whatever the kind — Commons renders a poster frame for a
// clip as readily as a thumbnail for a still, verified against the live API — so
// browsing costs one query shape and no transcode ladders. `mime` is what says
// which kind a hit turned out to be, and the ref carries that through to
// `resolveCommons`, which then asks for the right thing.
//
// Ranked rather than random, which is the whole difference between this and a
// channel: `gsrsort=random` throws relevance away, so a typed query would answer
// with a Greek vase (see the head of this file). Sorted by relevance, an
// arbitrary query is finally worth offering.
export async function browseCommons(search: string): Promise<BrowseHit[]> {
  const body = await query({
    generator: 'search',
    gsrsearch: search,
    gsrnamespace: '6',
    gsrlimit: String(BROWSE_LIMIT),
    prop: 'imageinfo',
    // `size` is what carries `duration` for a clip, which is the one number
    // worth showing before a pick — verified against the live API. Its `size`
    // field comes along with it and is deliberately *not* shown: for a clip that
    // is the uploaded master, not the transcode the app would play, and the two
    // differ by an order of magnitude on anything large.
    iiprop: 'url|mime|size',
    iiurlwidth: String(BROWSE_THUMB),
  })
  return pagesOf(body).flatMap(page => {
    const head = infoOf(page, 'imageinfo')
    if (head === null) return []
    const { title, info } = head
    const mime = str(info.mime)
    const thumb = str(info.thumburl)
    // No poster and no readable mime means nothing to draw and nothing to say
    // it would play, which is the same branch as a PDF landing in the results.
    if (thumb === null || mime === null) return []
    const kind: PickKind | null = OK_IMAGE.test(mime)
      ? 'photo'
      : mime.startsWith('video/')
        ? 'video'
        : null
    if (kind === null) return []
    return [
      {
        origin: 'commons' as const,
        title,
        kind,
        label: commonsCaption(title),
        thumb,
        page: pageOf(info, title),
        seconds: num(info.duration),
      },
    ]
  })
}

// "File:Sunset over Logan Square.webm" is how Commons names a page; the prefix
// and the extension are scaffolding, and the caption has one line to work with.
export const commonsCaption = (title: string): string =>
  title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
