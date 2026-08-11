// Does `ui/mp4demux.ts` agree with ffprobe about a real file?
//
//   node scripts/demuxcheck.mjs [file ...]
//
// `mp4demux.test.ts` covers the format by construction — a round trip against
// `writeMp4`, plus hand-built tables for the boxes it never emits. What no
// hand-built fixture can catch is a table this repo's own muxer happens not to
// produce and this file's author happened not to imagine, and the clips in
// `public/` are two of exactly that: one with a single keyframe in 180 frames
// and one at 5.3s spacing, neither written by anything in this tree.
//
// So this is the outside check, and it is cheap because ffprobe already knows
// the answers: the sample count, which of them are sync samples, and the byte
// range of every packet. Agreement on all three is the demuxer being right for
// the right reason rather than arriving at a plausible count.
//
// Node rather than a browser: nothing here needs a decoder, a GPU or a DOM,
// which is the point of the demuxer being pure.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

// The module is TypeScript, and this is node — so it is transpiled through the
// same vite the app uses rather than duplicated here.
const { createServer } = await import('vite')
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { demuxMp4 } = await vite.ssrLoadModule('/src/ui/mp4demux.ts')

const files =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['public/test.mp4', 'public/demo-v2.mp4']

const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}

for (const path of files) {
  console.log(`\n${path}`)
  const bytes = new Uint8Array(readFileSync(path))
  const track = demuxMp4(bytes)
  if (track === null) {
    check('demuxed at all', false, 'returned null')
    continue
  }

  // What ffprobe says about every packet in the video stream: where it starts,
  // how long it is, when it is shown, and whether it is a sync sample.
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_packets',
      '-show_entries',
      'packet=pos,size,pts,dts,flags',
      '-of',
      'json',
      path,
    ]).toString(),
  ).packets

  check(
    'sample count matches ffprobe',
    track.samples.length === probe.length,
    `${track.samples.length} vs ${probe.length}`,
  )

  const n = Math.min(track.samples.length, probe.length)
  let offsets = 0
  let sizes = 0
  let ptsBad = 0
  let dtsBad = 0
  for (let i = 0; i < n; i++) {
    if (track.samples[i].offset !== Number(probe[i].pos)) offsets++
    if (track.samples[i].size !== Number(probe[i].size)) sizes++
    if (track.samples[i].cts !== Number(probe[i].pts)) ptsBad++
    if (track.samples[i].dts !== Number(probe[i].dts)) dtsBad++
  }
  check('every byte offset matches', offsets === 0, `${offsets} differ`)
  check('every sample size matches', sizes === 0, `${sizes} differ`)
  // The one that a demuxer ignoring `ctts` passes on this repo's own output and
  // fails on anything with B-frames in it.
  check('every presentation time matches', ptsBad === 0, `${ptsBad} differ`)
  check('every decode time matches', dtsBad === 0, `${dtsBad} differ`)

  const mineKeys = track.samples.flatMap((s, i) => (s.key ? [i] : []))
  const theirKeys = probe.flatMap((p, i) =>
    String(p.flags).includes('K') ? [i] : [],
  )
  check(
    'the same frames are sync samples',
    mineKeys.length === theirKeys.length &&
      mineKeys.every((k, i) => k === theirKeys[i]),
    `${mineKeys.length} vs ${theirKeys.length}`,
  )

  const stream = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_streams',
      '-of',
      'json',
      path,
    ]).toString(),
  ).streams[0]
  check(
    'geometry matches',
    track.codedWidth === stream.width && track.codedHeight === stream.height,
    `${track.codedWidth}x${track.codedHeight} vs ${stream.width}x${stream.height}`,
  )
  check(
    'timescale matches the stream time base',
    `1/${track.timescale}` === stream.time_base,
    `1/${track.timescale} vs ${stream.time_base}`,
  )
  console.log(
    `        codec ${track.codec}  ${track.samples.length} samples  ` +
      `${mineKeys.length} keys  ${track.unsupportedEdit ? 'UNSUPPORTED EDIT' : 'edit ok'}`,
  )
}

await vite.close()
console.log(
  fail.length === 0
    ? '\nall good\n'
    : `\n${fail.length} failed: ${fail.join(', ')}\n`,
)
process.exit(fail.length === 0 ? 0 : 1)
