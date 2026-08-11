// Is the WebCodecs decode path open in this browser, and what does a frame off
// it cost?
//
//   node scripts/codeccheck.mjs
//
// `scripts/pullstep.mjs` measured the other route and closed it: seeking a
// `<video>` once per rendered frame costs 12x the decode on a well-keyframed
// clip and 40-200x on a sparse one, because a forward one-frame seek restarts
// the decode from the previous keyframe exactly as a random one does. So
// docs/EDITOR.md's frame-exact video pull has to come off `VideoDecoder`, and
// this is the spike that says whether it can — asked **before** the demuxer that
// would feed it is written, because two of the three answers below would change
// what gets built.
//
// Four questions, and the third is the one docs/EDITOR.md says to re-measure
// rather than trust:
//
//   1. Is `VideoDecoder` here at all, and which codecs does it admit? The
//      encoder half was already answered by `ui/record.ts` — Nightly reports
//      vp8, vp9, H.264 and AV1 — but the decoder is a separate registry.
//   2. What does a decoded frame cost, sequentially, with no seeking anywhere?
//      This is the number the whole route is being bought for, and it has to be
//      read against pullstep's `play` floor (2-3ms, the same `createImageBitmap`
//      on a rolling element) rather than against zero.
//   3. **Does the GPU take a `VideoFrame`?** `docs/handoffs/2026-08-05` found
//      `copyExternalImageToTexture` rejecting one outright and
//      `importExternalTexture` undefined (bug 1827116), which is why the engine
//      has a capability-gated `direct` mode at all. If that has changed, the
//      route is zero-copy; if it has not, every frame pays a
//      `createImageBitmap(frame)` conversion and question 4 is what it costs.
//   4. What does that conversion cost, if it is still needed?
//
// It makes its own chunks with `VideoEncoder` rather than demuxing a file,
// which is the whole reason it can run before the demuxer exists: what is under
// test is the decoder, and an `EncodedVideoChunk` does not care whether it came
// off a muxer or an encoder.
//
// **Measured, Firefox Nightly 151 / Linux:**
//
//   VideoDecoder               present; avc1, vp8, vp9, av1 all supported
//   per frame, pipelined       0.53ms
//   lockstep (feed 1, wait)    1.00ms median
//   importExternalTexture      undefined (bug 1827116 — unchanged)
//   copyExternalImageToTexture rejects a VideoFrame (unchanged)
//   createImageBitmap(frame)   1.00ms median
//
//   one second of 60fps take, in pull alone: 0.09s
//
// Against `pullstep.mjs`'s 2.3s (3s-GOP) to 11s (one keyframe) for the same
// second off the seek path, and **flat in the keyframe spacing** where the seek
// route is 5x worse on a sparse clip than a dense one. That is the decision.
//
// Two things it does *not* establish, and both shape what gets built on it:
//
//   - **Lockstep survived a baseline encode with no B-frames.** These chunks
//     are this harness's own, so decode order is display order and a decoder
//     never has to hold anything. Real footage reorders, and a puller that
//     feeds one chunk and waits for its frame will deadlock on the first B —
//     so the thing built on this decodes *ahead* and keeps frames by
//     timestamp, and the 1.00ms above is a floor rather than the design.
//   - **The Firefox constraint stands**, re-measured rather than assumed, so
//     every frame pays the `createImageBitmap(frame)` conversion. At 1ms
//     against a seek route costing 36-600ms that is not close, but it does mean
//     the route buys frame-exactness and not zero-copy — which is what
//     docs/EDITOR.md predicted and asked to have re-checked.

import puppeteer from 'puppeteer-core'

import { createServer } from 'node:http'
import process from 'node:process'

const FRAMES = 60
const W = 640
const H = 480

// **Over http://localhost, not about:blank.** WebCodecs is secure-context only,
// and `about:blank` is not one — so the first cut of this reported
// `VideoDecoder` MISSING on a browser that has it, and would have reported the
// same for the `VideoEncoder` the app already ships and `reccheck.mjs` already
// passes on. A capability probe that runs somewhere the app never does answers
// a question nobody asked.
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><meta charset=utf-8><title>codeccheck</title><body>')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  protocolTimeout: 300_000,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })
page.on('pageerror', e => console.error('pageerror', String(e).slice(0, 300)))
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await page.bringToFront()

const out = await page.evaluate(
  async (frames, w, h) => {
    const log = []
    const median = xs => {
      if (xs.length === 0) return NaN
      const s = [...xs].sort((a, b) => a - b)
      return s[Math.floor((s.length - 1) / 2)]
    }

    // --- 1. what is here -----------------------------------------------------
    const present = typeof VideoDecoder !== 'undefined'
    const codecs = {}
    if (present) {
      for (const codec of [
        'avc1.42E01E',
        'vp8',
        'vp09.00.10.08',
        'av01.0.04M.08',
      ]) {
        try {
          const r = await VideoDecoder.isConfigSupported({
            codec,
            codedWidth: w,
            codedHeight: h,
          })
          codecs[codec] = r.supported === true
        } catch (e) {
          codecs[codec] = `threw: ${String(e).slice(0, 80)}`
        }
      }
    }
    if (!present) return { present, codecs, log }

    // --- make chunks ---------------------------------------------------------
    // A moving picture, so a decoder handing back a stale frame is visible in
    // the digests below rather than hidden by a static one.
    const cv = new OffscreenCanvas(w, h)
    const cx = cv.getContext('2d')
    const paint = i => {
      cx.fillStyle = '#111'
      cx.fillRect(0, 0, w, h)
      cx.fillStyle = '#fff'
      cx.fillRect((i * 7) % w, (i * 3) % h, 60, 60)
      cx.font = '96px monospace'
      cx.fillText(String(i), 20, 120)
    }

    const chunks = []
    let description = null
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (
          meta?.decoderConfig?.description !== undefined &&
          description === null
        ) {
          description = new Uint8Array(meta.decoderConfig.description).slice()
        }
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        chunks.push({ data, type: chunk.type, timestamp: chunk.timestamp })
      },
      error: e => log.push(`encoder: ${String(e)}`),
    })
    encoder.configure({
      codec: 'avc1.42E01E',
      width: w,
      height: h,
      framerate: 60,
      avc: { format: 'avc' },
    })
    for (let i = 0; i < frames; i++) {
      paint(i)
      const vf = new VideoFrame(cv, { timestamp: (i * 1e6) / 60 })
      encoder.encode(vf, { keyFrame: i === 0 })
      vf.close()
    }
    await encoder.flush()
    encoder.close()

    // --- 2. sequential decode ------------------------------------------------
    // Two arms, and which of them works is itself the finding.
    //
    //   lockstep  feed one chunk, wait for its frame, feed the next. This is
    //             the shape the offline render would *like*, because it needs
    //             frame N before it can step and nothing else is in flight.
    //   pipelined feed everything and count what comes back. What a decoder
    //             free to hold frames for reordering will actually do.
    //
    // **Bounded, both of them.** The first cut of this had no watchdog on the
    // lockstep arm, Firefox held the first frame rather than emitting it, and
    // the run hung inside `page.evaluate` until puppeteer's protocol timeout
    // fired — reported as a `ProtocolError` naming nothing. That is the rule
    // loopseek.mjs states in its own header and this file did not follow: a run
    // that cannot finish has to come back as a reading.
    //
    // **Awaited, never flushed per chunk.** The cut before *that* called
    // `flush()` after every chunk and Firefox answered `VideoDecoder needs a
    // key chunk`, which is the spec being right: a completed flush sets the
    // key-chunk requirement again, so flushing per frame turns one sequential
    // decode into sixty broken ones.
    const frameTimes = []
    let gpuTook = null
    let bitmapMs = []
    let land = null

    const mkDecoder = sink =>
      new VideoDecoder({
        output: vf => {
          sink(vf)
          vf.close()
        },
        error: e => log.push(`decoder: ${String(e)}`),
      })
    const config = {
      codec: 'avc1.42E01E',
      codedWidth: w,
      codedHeight: h,
      description,
      // Ask for frames as soon as they are decodable rather than when the
      // decoder feels like it. If the lockstep arm below works at all, this is
      // why; if it does not, this is the lever that was already pulled.
      optimizeForLatency: true,
    }
    const chunkOf = c =>
      new EncodedVideoChunk({
        type: c.type,
        timestamp: c.timestamp,
        data: c.data,
      })
    const within = (p, ms) =>
      Promise.race([p, new Promise(ok => setTimeout(() => ok('timeout'), ms))])

    // --- lockstep ---
    const lockstepMs = []
    let lockstep = 'ok'
    {
      const d = mkDecoder(() => land?.())
      d.configure(config)
      for (const c of chunks.slice(0, 10)) {
        const at = performance.now()
        const landed = new Promise(ok => {
          land = ok
        })
        d.decode(chunkOf(c))
        if ((await within(landed, 2000)) === 'timeout') {
          lockstep = `held after ${lockstepMs.length} frames`
          break
        }
        lockstepMs.push(performance.now() - at)
      }
      try {
        d.close()
      } catch {}
    }

    // --- pipelined ---
    const d = mkDecoder(vf => frameTimes.push(vf.timestamp))
    d.configure(config)
    const t0 = performance.now()
    for (const c of chunks) d.decode(chunkOf(c))
    const flushed = await within(
      d.flush().catch(e => log.push(`flush: ${e}`)),
      30000,
    )
    const totalMs = performance.now() - t0
    try {
      d.close()
    } catch {}
    if (flushed === 'timeout') log.push('pipelined flush timed out')

    // --- 3. does the GPU take a VideoFrame? ----------------------------------
    // Re-measured rather than believed: docs/EDITOR.md says so in as many words,
    // because it is a snapshot of one Nightly build and the whole route's cost
    // model turns on it.
    const gpu = {
      adapter: false,
      importExternalTexture: false,
      copyExternal: null,
    }
    if (navigator.gpu !== undefined) {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter !== null) {
        const device = await adapter.requestDevice()
        gpu.adapter = true
        gpu.importExternalTexture =
          typeof device.importExternalTexture === 'function'
        // A VideoFrame to hand it. Made from the canvas rather than from the
        // decoder so this stands alone if the decode above failed.
        paint(0)
        const vf = new VideoFrame(cv, { timestamp: 0 })
        const tex = device.createTexture({
          size: [w, h],
          format: 'rgba8unorm',
          usage:
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT,
        })
        try {
          device.queue.copyExternalImageToTexture(
            { source: vf },
            { texture: tex },
            [w, h],
          )
          gpu.copyExternal = 'accepted'
        } catch (e) {
          gpu.copyExternal = String(e).slice(0, 160)
        }
        // --- 4. and what the conversion costs, if it is still needed ---------
        const bt0 = performance.now()
        for (let i = 0; i < 20; i++) {
          const f = new VideoFrame(cv, { timestamp: i })
          const bt = performance.now()
          const bmp = await createImageBitmap(f)
          bitmapMs.push(performance.now() - bt)
          bmp.close()
          f.close()
        }
        gpuTook = performance.now() - bt0
        vf.close()
        tex.destroy()
      }
    }

    return {
      present,
      codecs,
      log,
      chunks: chunks.length,
      decoded: frameTimes.length,
      ordered: frameTimes.every((t, i) => i === 0 || t > frameTimes[i - 1]),
      lockstep,
      lockstepMedMs: median(lockstepMs),
      totalMs,
      perFrameMs: totalMs / chunks.length,
      gpu,
      bitmapMedMs: median(bitmapMs),
      gpuTook,
    }
  },
  FRAMES,
  W,
  H,
)

await browser.close()
server.close()

const say = (k, v) => console.log(`  ${k.padEnd(26)} ${v}`)
console.log('\nWebCodecs decode path, Firefox Nightly / Linux\n')
say('VideoDecoder', out.present ? 'present' : 'MISSING')
for (const [codec, ok] of Object.entries(out.codecs)) say(`  ${codec}`, ok)
if (!out.present) process.exit(1)

console.log('')
say('chunks encoded', out.chunks)
say(
  'frames decoded',
  `${out.decoded}${out.ordered ? ' (in order)' : ' OUT OF ORDER'}`,
)
say('per frame, pipelined', `${out.perFrameMs.toFixed(2)}ms`)
say(
  'lockstep (feed 1, wait)',
  out.lockstep === 'ok'
    ? `${out.lockstepMedMs.toFixed(2)}ms median`
    : out.lockstep,
)

console.log('')
say('GPU adapter', out.gpu.adapter ? 'yes' : 'no')
say(
  'importExternalTexture',
  out.gpu.importExternalTexture ? 'PRESENT' : 'undefined (bug 1827116)',
)
say('copyExternalImageToTexture', out.gpu.copyExternal)
say('createImageBitmap(frame)', `${out.bitmapMedMs.toFixed(2)}ms median`)

if (out.log.length > 0) {
  console.log('\n  errors:')
  for (const l of out.log) console.log(`    ${l}`)
}

// The line the design turns on, stated as the same unit pullstep.mjs reports:
// what one second of 60fps take costs in pull alone.
const perFrame =
  out.perFrameMs + (out.gpu.copyExternal === 'accepted' ? 0 : out.bitmapMedMs)
console.log(
  `\n  one second of 60fps take, in pull alone: ${((perFrame * 60) / 1000).toFixed(2)}s` +
    `  (decode ${out.perFrameMs.toFixed(1)}ms + ${out.gpu.copyExternal === 'accepted' ? 'zero-copy' : `bitmap ${out.bitmapMedMs.toFixed(1)}ms`})\n`,
)
