import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from 'vite'

// Dev-only bridge: /yt?url=<youtube link> shells out to yt-dlp, caches the
// clip in a temp dir, and serves it as an mp4 the app's <video> path can play.
// The NTSC chain downscales to 480 lines, so we cap at 720p and let yt-dlp
// merge with ffmpeg only when no single-file mp4 exists at that height.
const CACHE_DIR = join(tmpdir(), 'phosphene-yt')
const FORMAT =
  'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[ext=mp4]/b'

export const isYouTube = (u: string): boolean => {
  try {
    const host = new URL(u).hostname.replace(/^www\./, '')
    return (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com' ||
      host === 'youtu.be'
    )
  } catch {
    return false
  }
}

// One download per URL: concurrent requests for the same clip share a promise,
// and a finished clip is reused from disk across reloads.
const inflight = new Map<string, Promise<string>>()

const fetchClip = (url: string): Promise<string> => {
  const key = createHash('sha1').update(url).digest('hex')
  const out = join(CACHE_DIR, `${key}.mp4`)
  const cached = existsSync(out) && statSync(out).size > 0
  const running = inflight.get(key)
  return cached
    ? Promise.resolve(out)
    : running ??
        (() => {
          const tmp = join(CACHE_DIR, `${key}.tmp.mp4`)
          const p = new Promise<string>((resolve, reject) => {
            mkdirSync(CACHE_DIR, { recursive: true })
            const child = spawn(
              'yt-dlp',
              [
                '-f',
                FORMAT,
                '--merge-output-format',
                'mp4',
                '--no-playlist',
                '--force-overwrites',
                '-o',
                tmp,
                url,
              ],
              { stdio: ['ignore', 'ignore', 'pipe'] },
            )
            let err = ''
            child.stderr.on('data', d => (err += String(d)))
            child.on('error', reject)
            child.on('close', code => {
              if (code === 0 && existsSync(tmp)) {
                renameSync(tmp, out)
                resolve(out)
              } else {
                reject(new Error(err.trim() || `yt-dlp exited with ${code}`))
              }
            })
          }).finally(() => inflight.delete(key))
          inflight.set(key, p)
          return p
        })()
}

export function ytdlp(): Plugin {
  return {
    name: 'phosphene-ytdlp',
    apply: 'serve',
    configureServer(server) {
      // Connect strips the '/yt' mount, so req.url here is '/?url=...'.
      server.middlewares.use('/yt', (req, res) => {
        const target =
          new URL(req.url ?? '', 'http://localhost').searchParams.get('url') ??
          ''
        if (isYouTube(target)) {
          server.config.logger.info(`[yt-dlp] ${target}`)
          fetchClip(target).then(
            file => {
              res.writeHead(200, {
                'content-type': 'video/mp4',
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
        } else {
          res.statusCode = 400
          res.end('not a YouTube URL')
        }
      })
    },
  }
}
