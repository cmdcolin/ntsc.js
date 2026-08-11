// Is the recording actually constant-framerate, and will a tool conform it?
//
//   node scripts/reccheck.mjs [port]
//
// The muxer is unit-tested (ui/mp4.test.ts) against its own box tree, which
// proves the file says what it means to say. What that cannot prove is that a
// *demuxer* agrees — so this records the real app through the real encoder and
// hands the result to ffprobe, which is the nearest thing to the editor this
// whole half of the project is for. Needs ffmpeg on PATH and a dev server on
// the given port.
//
// The assertion that matters is `r_frame_rate == avg_frame_rate`. That identity
// is what constant-framerate *is* to every tool downstream: MediaRecorder's
// output fails it, because it timestamps by wall clock and writes whatever the
// tab managed.
//
// Two browser facts this pins, both measured on Nightly and both surprising:
//
//   - `new VideoFrame(webgpuCanvas)` works and holds picture, where `toBlob`
//     and `captureStream()` on the same canvas come back blank. The old capture
//     path mirrored through a 2D canvas for that reason and no longer has to.
//   - Firefox's `decoderConfig.description` is a malformed avcC — see
//     `normaliseAvcc`. Before it was normalised, ffmpeg decoded the picture but
//     reported `sps_id out of range` on every frame, which is the shape of
//     failure a stricter demuxer would turn into a refusal.

import puppeteer from 'puppeteer-core'

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const port = process.argv[2] ?? '5199'
const FRAMES = 90
const FPS = 60

const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await new Promise(r => setTimeout(r, 6000))
await page.bringToFront()

// Driven straight at record.ts rather than through the menu: what is being
// judged is the file, and the hook's last act is a download this cannot catch.
const got = await page.evaluate(
  async (frames, fps) => {
    const mod = await import('/src/ui/record.ts')
    const cv = document.querySelector('canvas')
    const rec = await mod.startRecording({
      width: cv.width,
      height: cv.height,
      fps: { num: fps, den: 1 },
    })
    // Stepped by hand so the count is exact whatever rAF is doing — an
    // occluded window throttles it, which is the trap every harness here has.
    for (let i = 0; i < frames; i++) {
      window.vf?.step()
      rec.frame(cv)
      if (i % 15 === 0) await new Promise(r => setTimeout(r, 20))
    }
    const buf = new Uint8Array(await (await rec.finish()).arrayBuffer())
    let s = ''
    for (const b of buf) s += String.fromCharCode(b)
    return { b64: btoa(s), frames: rec.frames(), error: rec.error() }
  },
  FRAMES,
  FPS,
)
await browser.close()

check('the encoder reported no failure', got.error === '', got.error)
check('every frame was handed over', got.frames === FRAMES, String(got.frames))

const file = join(mkdtempSync(join(tmpdir(), 'reccheck-')), 'out.mp4')
writeFileSync(file, Buffer.from(got.b64, 'base64'))

const probe = (entries, streamOnly = true) =>
  execFileSync('ffprobe', [
    '-v',
    'error',
    ...(streamOnly ? ['-select_streams', 'v:0'] : []),
    '-show_entries',
    entries,
    '-of',
    'default=nw=1',
    file,
  ]).toString()

const info = Object.fromEntries(
  probe(
    'stream=codec_name,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt,width,height',
  )
    .trim()
    .split('\n')
    .map(l => l.split('=')),
)
check(
  'it is H.264 in 4:2:0',
  info.codec_name === 'h264' && info.pix_fmt === 'yuv420p',
  `${info.codec_name}/${info.pix_fmt}`,
)
check(
  'the dimensions are even, which 4:2:0 requires',
  Number(info.width) % 2 === 0 && Number(info.height) % 2 === 0,
  `${info.width}x${info.height}`,
)
// The one that matters.
check(
  'it is constant-framerate: r_frame_rate == avg_frame_rate',
  info.r_frame_rate === info.avg_frame_rate && info.r_frame_rate === `${FPS}/1`,
  `${info.r_frame_rate} vs ${info.avg_frame_rate}`,
)
check(
  'every frame survived the mux',
  Number(info.nb_frames) === FRAMES,
  info.nb_frames,
)

// Duration comes off the count and the rate, never off how long recording took.
const duration = Number(probe('format=duration', false).trim().split('=')[1])
check(
  'the duration is the frame count over the rate, exactly',
  Math.abs(duration - FRAMES / FPS) < 0.001,
  `${duration}s`,
)

// Every timestamp exactly one tick apart: no drift anywhere in the file.
const pts = probe('frame=pts')
  .trim()
  .split('\n')
  .map(l => Number(l.split('=')[1]))
const gaps = new Set(pts.slice(1).map((v, i) => v - pts[i]))
check(
  'and no two frames are unevenly spaced',
  gaps.size === 1,
  `${gaps.size} distinct gap(s): ${[...gaps].slice(0, 4).join(',')}`,
)

// A file that conforms perfectly and decodes to nothing would pass everything
// above. This is the arm that says there is a picture in it.
// spawnSync rather than execFileSync: the warnings are on stderr, and
// execFileSync hands back stdout only.
const decode = spawnSync('ffmpeg', [
  '-v',
  'warning',
  '-i',
  file,
  '-f',
  'null',
  '-',
])
const decoded = decode.stderr.toString().trim()
check(
  'it decodes without a single warning',
  decoded === '',
  decoded.split('\n')[0] ?? '',
)

// Sizes come back with a trailing field on some ffprobe builds, so the first
// column is taken and anything unparseable dropped rather than averaged into a
// NaN that reads as a failure.
const sizes = execFileSync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-show_entries',
  'frame=pkt_size',
  '-of',
  'csv=p=0',
  file,
])
  .toString()
  .trim()
  .split('\n')
  .map(l => Number(l.split(',')[0]))
  .filter(n => Number.isFinite(n))
const mean = sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length)
check(
  'and the frames hold real picture, not a flat field',
  sizes.length === FRAMES && mean > 2000,
  `${sizes.length} frames, ${Math.round(mean)} bytes each`,
)

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(fail.length === 0 ? '\nrecording ok' : `\n${fail.length} failed`)
process.exit(fail.length === 0 ? 0 : 1)
