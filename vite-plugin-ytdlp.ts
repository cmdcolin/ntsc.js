import type { Plugin } from 'vite'

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

// Dev-only bridge: /yt?url=<link> shells out to yt-dlp, caches the clip in a
// temp dir, and serves it back for the app's <video> path to play. yt-dlp
// reaches well past YouTube, so the guard below is the scheme rather than a
// host list — anything it has an extractor for is a source here.
const CACHE_DIR = join(tmpdir(), 'ntsc.js-yt')

// The chain downscales to 480 lines, so height above that is bytes fetched to
// be thrown away, and the picture is decoded every frame, so h264 — hardware
// on everything — is worth asking for ahead of av1 at the same height. A
// single file already carrying its audio comes first because it needs no
// ffmpeg merge at all; the merges follow, and a bare `b` catches a site whose
// smallest form is still above the cap. Measured on Big Buck Bunny: 38 MB and
// one merge, against 102 MB and a merge for the 720p this used to pull.
//
// `<=?` rather than `<=` throughout: a format with no height at all — which is
// most of what a generic extractor hands back — passes the filter instead of
// being rejected by it, and that is what makes a non-YouTube URL work here.
const FORMAT =
  'b[height<=?480][ext=mp4][vcodec^=avc1]/b[height<=?480][ext=mp4]/b[height<=?480]/bv*[height<=?480][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=?480]+ba[ext=m4a]/bv*[height<=?480]+ba/b'

// The extension is yt-dlp's to choose once arbitrary sites are in scope: a
// generic extractor can hand back webm or mov, and the app plays what comes
// back off a blob url, so the type it is served under is the type the <video>
// is handed. mp4 is the fallback because the selector above asks for it first.
const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
}

export const contentType = (file: string): string =>
  CONTENT_TYPES[extname(file).slice(1).toLowerCase()] ?? 'video/mp4'

// How long a section fetch takes, at most. A range is the answer to a
// two-hour film and the wrong answer to a ten-minute one: `--download-sections`
// makes yt-dlp cut with ffmpeg over the HLS ladder rather than pull the format
// straight, and measured on Big Buck Bunny that is 39s for the first minute
// against 18.7s for the whole 38 MB clip. So it is asked for per request and
// never by default, and the dialog says which way round it is.
export const MAX_SECONDS = 3 * 60 * 60

export const seconds = (raw: string | null): number => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_SECONDS) : 0
}

const PROGRESS_MARK = 'ntscjs'
const PROGRESS_TEMPLATE = `${PROGRESS_MARK} %(progress.status)s %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s`

// What a fetch has got through, read off yt-dlp's own progress lines.
//
// `base` is what earlier streams weighed: a merge downloads video and then
// audio, each counting from zero, and a caption that ran to 38 MB and then
// started again at 0 of 300 KB would read as a fetch going backwards. Summing
// the finished ones keeps `loaded` monotonic and lets the total grow as the
// second stream announces itself, which is honest — nothing knows the pair's
// combined size until the second one starts.
export interface FetchState {
  base: number
  loaded: number
  total: number
  stage: 'downloading' | 'merging'
}

export const FETCH_START: FetchState = {
  base: 0,
  loaded: 0,
  total: 0,
  stage: 'downloading',
}

const bytes = (field: string): number => {
  const n = Number(field)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// One line of yt-dlp's stdout against the state so far. The progress lines are
// ours — `--progress-template` below names the three fields and the marker —
// and the merge is announced by yt-dlp in its own words, which is the one
// stage that reports no bytes at all because ffmpeg is doing the work.
export const readFetchLine = (state: FetchState, line: string): FetchState => {
  const fields = line.startsWith(`${PROGRESS_MARK} `)
    ? line.slice(PROGRESS_MARK.length + 1).split(' ')
    : []
  const [status, loaded, total] = fields
  return fields.length < 3
    ? line.startsWith('[Merger]')
      ? { ...state, stage: 'merging' }
      : state
    : status === 'finished'
      ? { ...state, base: state.base + bytes(loaded), loaded: 0, total: 0 }
      : { ...state, loaded: bytes(loaded), total: bytes(total) }
}

// What the caption is drawn from: bytes so far against bytes expected, or 0 for
// a total nothing upstream would say — the same pair `sources/pool.ts` hands
// the archive.org download, so both waits read alike.
export const fetchProgress = (state: FetchState) => ({
  loaded: state.base + state.loaded,
  // Three readings, and the middle one is the reason this is not one
  // expression: a stream in flight whose size nothing would say has a total of
  // 0, where a stream that has just finished has no current total *because* it
  // is done — and that one has to read as complete rather than as unknown.
  total:
    state.total > 0
      ? state.base + state.total
      : state.loaded === 0
        ? state.base
        : 0,
  stage: state.stage,
})

// The endpoint spawns a process, so the guard is that the target is a web
// address at all — no file:// reads, no scheme yt-dlp would take as a local
// path, and nothing that could arrive looking like a flag.
export const isFetchable = (u: string): boolean => {
  try {
    const { protocol } = new URL(u)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const clipsMatching = (match: (name: string) => boolean): string[] => {
  const names = existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR) : []
  return names
    .filter(match)
    .map(n => join(CACHE_DIR, n))
    .filter(f => statSync(f).size > 0)
}

const cachedAll = (key: string): string[] =>
  clipsMatching(n => n.startsWith(`${key}.`) && !n.startsWith(`${key}.tmp.`))

const cached = (key: string): string | undefined => cachedAll(key)[0]

// yt-dlp leaves its own working files beside the download — `.part` for the
// stream in flight, `.ytdl` for a fragment ledger — and they share the prefix,
// so the finished clip is the one that is neither.
const isWorkingFile = (name: string) =>
  name.endsWith('.part') || name.endsWith('.ytdl')

const downloaded = (key: string): string | undefined =>
  clipsMatching(n => n.startsWith(`${key}.tmp.`) && !isWorkingFile(n))[0]

// One download per URL: concurrent requests for the same clip share a promise,
// and a finished clip is reused from disk across reloads. The format selector
// and the range are in the key so that changing either fetches again rather
// than serving back whatever the previous run settled on.
const inflight = new Map<string, Promise<string>>()

// Where each running fetch has got to, for the progress stream below. Keyed the
// same way, so a second tab watching the same download watches the same numbers.
const fetching = new Map<string, FetchState>()

const cacheKey = (url: string, secs: number): string =>
  createHash('sha1').update(`${FORMAT}\n${secs}\n${url}`).digest('hex')

const startFetch = (
  key: string,
  url: string,
  secs: number,
): Promise<string> => {
  const p = new Promise<string>((resolve, reject) => {
    mkdirSync(CACHE_DIR, { recursive: true })
    for (const stale of clipsMatching(n => n.startsWith(`${key}.tmp.`))) {
      rmSync(stale)
    }
    fetching.set(key, FETCH_START)
    const child = spawn(
      'yt-dlp',
      [
        '-f',
        FORMAT,
        '--merge-output-format',
        'mp4',
        '--no-playlist',
        '--force-overwrites',
        '--newline',
        '--progress-template',
        PROGRESS_TEMPLATE,
        ...(secs === 0 ? [] : ['--download-sections', `*0-${secs}`]),
        '-o',
        join(CACHE_DIR, `${key}.tmp.%(ext)s`),
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    // Line-buffered by hand: `--newline` makes yt-dlp write one progress line
    // per update rather than redrawing one, but a chunk off the pipe still
    // splits wherever it likes, and half a line parses as a fetch that has
    // downloaded nothing.
    let pending = ''
    child.stdout.on('data', d => {
      const lines = (pending + String(d)).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const state = fetching.get(key)
        if (state !== undefined) fetching.set(key, readFetchLine(state, line))
      }
    })
    let err = ''
    child.stderr.on('data', d => (err += String(d)))
    child.on('error', reject)
    child.on('close', code => {
      fetching.delete(key)
      const got = downloaded(key)
      if (code === 0 && got !== undefined) {
        const out = join(CACHE_DIR, `${key}${extname(got)}`)
        // A finished clip under a different extension is the same URL fetched
        // when yt-dlp chose another container. Only one of them is the answer,
        // and `cached` takes whichever the directory lists first.
        for (const other of cachedAll(key)) {
          if (other !== out) rmSync(other)
        }
        renameSync(got, out)
        resolve(out)
      } else {
        reject(new Error(err.trim() || `yt-dlp exited with ${code}`))
      }
    })
  }).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

const fetchClip = (url: string, secs: number): Promise<string> => {
  const key = cacheKey(url, secs)
  const hit = cached(key)
  return hit === undefined
    ? (inflight.get(key) ?? startFetch(key, url, secs))
    : Promise.resolve(hit)
}

export function ytdlp(): Plugin {
  return {
    name: 'ntsc.js-ytdlp',
    apply: 'serve',
    configureServer(server) {
      // Connect strips the '/yt' mount, so req.url here is '/?url=...' for the
      // clip and '/progress?url=...' for the stream that says how it is going.
      server.middlewares.use('/yt', (req, res) => {
        const asked = new URL(req.url ?? '', 'http://localhost')
        const target = asked.searchParams.get('url') ?? ''
        const secs = seconds(asked.searchParams.get('secs'))
        if (!isFetchable(target)) {
          res.statusCode = 400
          res.end('not an http(s) URL')
        } else if (asked.pathname === '/progress') {
          // Server-sent events rather than a poll: the client opens this
          // alongside the fetch it has already started and closes it when that
          // settles, so the stream never has to decide on its own that a
          // download it cannot see yet is one that is never coming.
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          })
          const key = cacheKey(target, secs)
          let last = ''
          const timer = setInterval(() => {
            const state = fetching.get(key)
            const line =
              state === undefined ? '' : JSON.stringify(fetchProgress(state))
            if (line !== '' && line !== last) {
              last = line
              res.write(`data: ${line}\n\n`)
            }
          }, 250)
          req.on('close', () => clearInterval(timer))
        } else {
          server.config.logger.info(
            `[yt-dlp] ${target}${secs === 0 ? '' : ` (first ${secs}s)`}`,
          )
          fetchClip(target, secs).then(
            file => {
              res.writeHead(200, {
                'content-type': contentType(file),
                'content-length': String(statSync(file).size),
                'cache-control': 'no-store',
              })
              createReadStream(file).pipe(res)
            },
            (e: unknown) => {
              res.statusCode = 502
              res.end(`yt-dlp: ${e instanceof Error ? e.message : String(e)}`)
            },
          )
        }
      })
    },
  }
}
