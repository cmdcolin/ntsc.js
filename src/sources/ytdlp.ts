import { isRecord, num } from './pool'

// The app's half of the dev-only yt-dlp bridge (`vite-plugin-ytdlp.ts`). Two
// requests rather than one: the clip itself, and a stream of how far its
// download has got — because the wait is the whole file arriving before a
// single frame can play, and it is the longest one in the app.
//
// `secs` is 0 for the whole clip and a number of seconds for the front of it.
// It travels on both requests because the bridge keys its cache on the pair, so
// asking about the wrong one would watch a download nobody started.
const endpoint = (path: string, url: string, secs: number): string =>
  `/yt${path}?url=${encodeURIComponent(url)}&secs=${secs}`

// The whole clip, which is what every path asks for unless somebody says
// otherwise in the dialog. A range is cut with ffmpeg over the site's own
// streaming ladder rather than pulled straight, so it is *slower per second* —
// on a ten-minute clip the first minute takes twice as long as the whole file.
// It earns its place on a two-hour film and nowhere else, which is why nothing
// reaches for it by default.
export const WHOLE_CLIP = 0

export const CLIP_RANGES: readonly { secs: number; label: string }[] = [
  { secs: WHOLE_CLIP, label: 'whole clip' },
  { secs: 60, label: 'first minute' },
  { secs: 180, label: 'first 3 minutes' },
  { secs: 600, label: 'first 10 minutes' },
]

export const rangeLabel = (secs: number): string => {
  const known = CLIP_RANGES.find(r => r.secs === secs)
  return known === undefined ? `first ${secs}s` : known.label
}

// What the shelf stores for a fetched clip, and reads back.
//
// A range is part of what the entry *is* rather than how it was once opened:
// clicking the row has to hand back the clip that was kept, and the same film
// trimmed and whole are two different files (the bridge caches them apart for
// the same reason). One string because a shelf entry has one identity field,
// and a space because that is the one character a URL cannot carry.
export const packClipRef = (url: string, secs: number): string =>
  secs === WHOLE_CLIP ? url : `${url} ${secs}`

export const unpackClipRef = (ref: string): { url: string; secs: number } => {
  const cut = ref.lastIndexOf(' ')
  const secs = cut === -1 ? 0 : Number(ref.slice(cut + 1))
  return Number.isInteger(secs) && secs > 0
    ? { url: ref.slice(0, cut), secs }
    : { url: ref, secs: WHOLE_CLIP }
}

export const fetchClipUrl = (url: string, secs: number): Promise<Blob> =>
  fetch(endpoint('', url, secs)).then(r =>
    r.ok
      ? r.blob()
      : r.text().then(t => Promise.reject(new Error(t || `${r.status}`))),
  )

// Bytes so far and bytes expected, plus the one stage that has neither: a merge
// is ffmpeg reading two finished files, and it reports no progress at all.
export interface ClipProgress {
  loaded: number
  total: number
  merging: boolean
}

// Follow a download that is already in flight. Returns the way to stop
// following it, which the caller owes on every path — the connection is a
// server-sent event stream and it does not close itself.
//
// The stream says nothing about whether the fetch succeeded: it is the caption
// while the clip comes down and nothing more, so a failure is still the fetch's
// rejection and an arrival is still its blob. An event that reports nothing yet
// is dropped rather than drawn, since "0 B" is a worse thing to read than the
// ellipsis it would replace.
export const watchClipUrl = (
  url: string,
  secs: number,
  onProgress: (at: ClipProgress) => void,
): (() => void) => {
  const events = new EventSource(endpoint('/progress', url, secs))
  events.addEventListener('message', e => {
    const data: unknown = JSON.parse(String(e.data))
    if (isRecord(data)) {
      const loaded = num(data.loaded)
      const total = num(data.total)
      if (loaded !== null && total !== null && loaded + total > 0)
        onProgress({ loaded, total, merging: data.stage === 'merging' })
    }
  })
  // Without this the browser reconnects on its own every few seconds, which is
  // what an EventSource is *for* and wrong here: the download it was watching
  // is over, and a retry loop against a dev server would outlive the clip.
  events.addEventListener('error', () => events.close())
  return () => events.close()
}
