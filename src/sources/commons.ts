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

const API = 'https://commons.wikimedia.org/w/api.php'

// Width asked of the thumbnailer. Commons snaps a thumbnail request up to the
// next standard bucket, so asking for MAX_SRC_EDGE (1536) hands back a 1920px
// file that gpu/sources.ts then pays to scale down again. 1024 snaps to 1024,
// is still comfortably above the 754px active raster, and is a quarter of the
// bytes. Originals are never fetched: they run to 40 megapixels.
const THUMB_WIDTH = 1024

// Transcodes taller than this are ignored. Commons pre-renders a ladder for
// every video it holds, and the source of truth for "how big is this really" is
// the derivative list, not the original — the 4K Big Buck Bunny master is a
// 2.9 GB download whose 480p VP9 rendition is 1.2 Mbit/s. 480 lines is also
// exactly this app's raster height, so nothing above it survives compose.
const MAX_VIDEO_HEIGHT = 480

// A long lecture is not a video source, it is a download. Commons holds plenty
// of them and deepcat wanders into conference talks from almost anywhere.
const MAX_VIDEO_SECONDS = 20 * 60

export type CommonsKind = 'photo' | 'video'

interface Channel {
  label: string
  kind: CommonsKind
  // Rolled per pick, so one channel spans several pools without any of them
  // dominating. Every query here has been run against the live API.
  queries: readonly string[]
}

export const COMMONS_IDS = [
  'wiki-retro',
  'wiki-vapor',
  'wiki-nature',
  'wiki-people',
  'wiki-timelapse',
  'wiki-vapor-video',
  'wiki-nature-video',
] as const
export type CommonsId = (typeof COMMONS_IDS)[number]

const BITMAP = 'filetype:bitmap'

export const COMMONS: Record<CommonsId, Channel> = {
  // Fortepan is the anchor: ~67k donated Hungarian amateur photographs running
  // from the 1900s to the 1990s, which is the closest thing Commons has to a
  // shoebox of found snapshots. The rest are the environments that read as the
  // same era.
  'wiki-retro': {
    label: 'Commons: found photos — Fortepan, neon, malls, CRTs',
    kind: 'photo',
    queries: [
      `Fortepan ${BITMAP}`,
      `deepcat:"Neon signs" ${BITMAP}`,
      `deepcat:"Interiors of shopping malls" ${BITMAP}`,
      `VHS OR camcorder OR "cathode ray" ${BITMAP}`,
    ],
  },
  // Marble busts are the surprise here and the best single pool of the lot —
  // Gordian I, Agrippa, anonymous Greek heads, all shot against flat museum
  // backdrops, which is the exact look the aesthetic borrows.
  'wiki-vapor': {
    label: 'Commons: statuary, neon, dead malls, sunsets',
    kind: 'photo',
    queries: [
      `deepcat:"Marble busts" ${BITMAP}`,
      `deepcat:"Neon signs" ${BITMAP}`,
      `deepcat:"Interiors of shopping malls" ${BITMAP}`,
      `deepcat:"Sunsets" ${BITMAP}`,
    ],
  },
  'wiki-nature': {
    label: 'Commons: reefs, birds, sunsets',
    kind: 'photo',
    queries: [
      `deepcat:"Underwater photographs" ${BITMAP}`,
      `deepcat:"Quality images of birds" ${BITMAP}`,
      `deepcat:"Sunsets" ${BITMAP}`,
    ],
  },
  'wiki-people': {
    label: 'Commons: portrait and fashion photography',
    kind: 'photo',
    queries: [
      `deepcat:"Portrait photographs of women" ${BITMAP}`,
      `deepcat:"Fashion photographs" ${BITMAP}`,
    ],
  },
  // The only video pool that held up. "Videos of animals" sounds better and is
  // 23k files, but random-sorted it returns football highlights and animated
  // GIFs; time-lapse is a format rather than a subject, so the category stays
  // honest, and a 30-second clip of moving cloud is ideal material besides.
  'wiki-timelapse': {
    label: 'Commons: time-lapse video',
    kind: 'video',
    queries: ['deepcat:"Time-lapse videos"'],
  },
  // The moving half of the two photo channels above, as channels of their own
  // rather than a mode switch on those: a channel's `kind` decides which API
  // property is asked for and which reader vets the answer, so one entry that
  // could return either would be two channels wearing one name — and the
  // picker would have no way to say which one a click was about to get.
  //
  // Every pool here was rolled against the live API and returns clips with
  // transcodes. Named categories that sound better and return *nothing* are
  // worth recording so nobody adds them back: "Videos of cities at night",
  // "Videos of waves" and "Videos of aurorae" are all empty or non-existent,
  // which is why neither channel has the neon the photo ones lean on.
  'wiki-vapor-video': {
    label: 'Commons: fountains, cloud and water, moving',
    kind: 'video',
    queries: [
      'deepcat:"Videos of fountains"',
      'deepcat:"Videos of clouds"',
      'deepcat:"Underwater videos"',
    ],
  },
  'wiki-nature-video': {
    label: 'Commons: animals, fire, weather',
    kind: 'video',
    queries: [
      'deepcat:"Videos of animals"',
      'deepcat:"Videos of fire"',
      'deepcat:"Underwater videos"',
    ],
  },
}

const COMMONS_ID_SET: ReadonlySet<string> = new Set(COMMONS_IDS)
export const isCommonsId = (mode: string): mode is CommonsId =>
  COMMONS_ID_SET.has(mode)

// What a roll hands back: a URL the <video>/image path can take as-is, plus the
// Commons page title for the caption. `title` is what the picker cannot say —
// two rolls of the same channel are different pictures, and this is the only
// thing that names which one is up. It is also the *identity* of a pick, which
// is what a favourite is stored as: a thumbnail url is a derivative that can be
// re-rendered at another width, and the title is what survives.
export interface CommonsPick {
  url: string
  title: string
  kind: CommonsKind
  // The file's own page: who shot it, and under which licence. Nothing else
  // here leads to the credit, and this app composites other people's pictures
  // into something recordable — so the one link that does travels with them.
  page: string
}

// --- response narrowing -----------------------------------------------------
// The API is untyped JSON from another origin, so it is walked with guards
// rather than asserted into a shape. Anything unexpected reads as "this file is
// not usable", which is the same branch a missing transcode takes.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

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

const pick = <T>(xs: readonly T[]): T | null =>
  xs.length === 0 ? null : (xs[Math.floor(Math.random() * xs.length)] ?? null)

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

export const stillFrom = (
  page: Record<string, unknown>,
): CommonsPick | null => {
  const head = infoOf(page, 'imageinfo')
  if (head === null) return null
  const { title, info } = head
  const mime = str(info.mime)
  if (mime === null || !OK_IMAGE.test(mime)) return null
  const url = str(info.thumburl) ?? str(info.url)
  return url === null
    ? null
    : { url, title, kind: 'photo', page: pageOf(info, title) }
}

// A page's usable rendition: the biggest VP9 WebM transcode within the height
// cap. Never the original — it can be 4K, it can be a 2.9 GB master, and where
// the upload was Ogg Theora the transcode is the only modern container on
// offer. `transcodekey` is what marks a derivative as a rendition rather than
// the source file repeated back.
export const videoFrom = (
  page: Record<string, unknown>,
): CommonsPick | null => {
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
    : { url: best.url, title, kind: 'video', page: pageOf(info, title) }
}

// What the API has to be asked for, per kind: a capped thumbnail for a still,
// the transcode ladder for a clip. A table rather than a branch at the one call
// site because there are two ways in now — rolling a channel, and resolving one
// file by name — and a favourite has to come back through exactly the reader
// that vetted it when it was rolled.
const WANTED: Record<CommonsKind, Record<string, string>> = {
  photo: {
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: String(THUMB_WIDTH),
  },
  video: { prop: 'videoinfo', viprop: 'derivatives|size|mime|url' },
}

const READ: Record<
  CommonsKind,
  (page: Record<string, unknown>) => CommonsPick | null
> = { photo: stillFrom, video: videoFrom }

const usableIn = (body: unknown, kind: CommonsKind): CommonsPick[] =>
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
  candidates: readonly CommonsPick[],
  avoid: string,
): CommonsPick | null {
  const fresh = candidates.filter(c => c.title !== avoid)
  return pick(fresh.length === 0 ? candidates : fresh)
}

// How many requests one roll will spend before giving up.
//
// One was not enough. `gsrsort=random` discards relevance ranking, so a page of
// candidates can come back holding nothing this app can use — every hit a TIFF,
// every video missing the transcodes — and the roll then failed with a banner
// where a second request would have found something. Two is the whole of the
// retry: a channel that answers nothing twice is a channel worth looking at.
const ATTEMPTS = 2

const rotate = <T>(xs: readonly T[], by: number): T[] => [
  ...xs.slice(by),
  ...xs.slice(0, by),
]

// Which pools this roll will try, in order. Starting somewhere random is what
// keeps one channel spanning several pools without the first one dominating;
// moving on rather than asking the same pool twice is what makes the retry worth
// having, since a pool whose transcodes are all missing stays that way. The
// doubling covers a one-pool channel, where the retry is the same query again —
// which is a different page of candidates, the sort being random.
export const queryPlan = (
  queries: readonly string[],
  start: number,
): string[] => {
  const order = rotate(queries, start)
  return [...order, ...order].slice(0, ATTEMPTS)
}

// Roll one file out of a channel. A single request does the whole job: a search
// generator feeding the imageinfo/videoinfo the caller actually needs, so
// there is no title round-trip in between.
//
// `gsrlimit` is 12 rather than 1 because the generator's own randomness is the
// cheap part — one request returns a dozen candidates, and picking among them
// locally is what lets a video roll skip the ones whose transcodes are missing
// without going back to the network, and what gives `avoid` something to choose
// between.
export async function rollCommons(
  id: CommonsId,
  avoid = '',
): Promise<CommonsPick> {
  const channel = COMMONS[id]
  const start = Math.floor(Math.random() * channel.queries.length)
  for (const search of queryPlan(channel.queries, start)) {
    const body = await query({
      generator: 'search',
      gsrsearch: search,
      gsrnamespace: '6',
      gsrlimit: '12',
      gsrsort: 'random',
      ...WANTED[channel.kind],
    })
    const chosen = choosePick(usableIn(body, channel.kind), avoid)
    if (chosen !== null) return chosen
  }
  throw new Error('nothing usable came back — roll again')
}

// One named file, fetched the same way and read by the same reader. This is what
// a favourite *is*: the title, resolved when it is played rather than a
// thumbnail url kept from the day it was starred. A derivative url is a promise
// about a rendering — the thumbnailer's buckets, a file overwritten by a better
// scan, a transcode ladder rebuilt — and none of that outlives a shelf that is
// meant to still work next year, where the title does.
export async function resolveCommons(
  title: string,
  kind: CommonsKind,
): Promise<CommonsPick> {
  const body = await query({ titles: title, ...WANTED[kind] })
  const found = usableIn(body, kind)[0]
  if (found === undefined)
    throw new Error(`${commonsCaption(title)} is no longer playable`)
  return found
}

// "File:Sunset over Logan Square.webm" is how Commons names a page; the prefix
// and the extension are scaffolding, and the caption has one line to work with.
export const commonsCaption = (title: string): string =>
  title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
