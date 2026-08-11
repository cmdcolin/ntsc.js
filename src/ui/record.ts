// Recording the canvas at a constant frame rate — the encoder half of
// docs/EDITOR.md › _Fixed-framerate export_, and the thing that separates a
// screen grab from an export an editor will conform.
//
// **What was wrong with what this replaces.** `MediaRecorder` over
// `captureStream()` timestamps by wall clock: a frame that took 40ms lands 40ms
// in, and the file records whatever the tab managed rather than what the
// simulation did. An NLE conforms that as variable-framerate and either drops
// or duplicates frames to fit a timeline — which is fatal for a piece cut to
// music, since the drift is not constant. Here every frame is handed over with
// `timestamp: i * 1e6 / fps` and the muxer writes one `stts` entry, so the file
// is constant by construction and indifferent to how long any frame took.
//
// **Firefox reads a WebGPU canvas here, which it will not do elsewhere.** The
// note in EDITOR.md — blank `toBlob`, no frames from `captureStream()` — is
// still true of those two APIs and is why the old path mirrored through a 2D
// canvas first. `new VideoFrame(canvas)` is a different path and works:
// measured on Nightly, a frame built straight off the WebGPU canvas comes back
// BGRA and full of picture. So the mirror is gone, and with it the extra copy
// per frame it cost.

import { writeMp4 } from './mp4'

import type { Sample } from './mp4'

// H.264 baseline at level 4.0 — the profile every editor and phone decodes.
// Not chosen for quality: what makes this file worth opening is its timing, and
// the bitrate below is what carries the picture.
const CODEC = 'avc1.42002a'

// Bits per pixel per frame. This content is worst-case for a codec — snow,
// grain and dot crawl, a new noise field every frame — and the same 0.4 the
// `MediaRecorder` path settled on for the same reason. Floor and ceiling keep a
// tiny canvas from being starved and a fullscreen 4K one from writing a
// gigabyte a minute.
const BITS_PER_PIXEL = 0.4
const MIN_BITRATE = 16_000_000
const MAX_BITRATE = 60_000_000

export const bitrateFor = (w: number, h: number, fps: number): number =>
  Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, w * h * fps * BITS_PER_PIXEL))

// How often a keyframe goes in. Two seconds is the usual compromise, and it is
// the one an editor cares about: a cut lands on the nearest one, so a long
// interval makes scrubbing coarse while a short one spends bitrate.
const KEYFRAME_SECONDS = 2

export interface RecorderSpec {
  width: number
  height: number
  fps: { num: number; den: number }
}

export interface Recorder {
  // Hand over one rendered frame. The timestamp is derived from how many have
  // been taken, never from the clock — that is the whole point.
  frame: (source: CanvasImageSource) => void
  // Flush the encoder and mux. Rejects if nothing was recorded.
  finish: () => Promise<Blob>
  // Give up without producing a file: an encoder is an OS resource, and a
  // recording abandoned by a device loss or an unmount has to let it go.
  abort: () => void
  frames: () => number
  // The last error the encoder reported, or ''. Encoding failures arrive on a
  // callback rather than as a rejected call, so they have nowhere else to go.
  error: () => string
}

export function isSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
  )
}

// H.264 is 4:2:0, so a chroma sample covers two luma samples in each direction
// and an odd dimension has nowhere to put the last one. Firefox accepts the
// `configure` and the `encode` and then fails the whole encoder on its *error
// callback* — asynchronously, with `NotSupportedError: Operation is not
// supported` and nothing naming the size — so this is worth doing here rather
// than trusting a caller to. Measured against a 440x573 canvas, which is what
// an ordinary window happens to produce.
//
// Rounded down and cropped rather than padded: a row of black at the bottom is
// a row an editor would have to be told to ignore, and one line off a 573-line
// picture is not a picture anybody can tell was cropped.
const even = (n: number): number => Math.max(2, n - (n % 2))

export async function startRecording(spec: RecorderSpec): Promise<Recorder> {
  const { fps } = spec
  const width = even(spec.width)
  const height = even(spec.height)
  const rate = fps.num / fps.den
  const samples: Sample[] = []
  let avcc: Uint8Array | null = null
  let count = 0
  let failure = ''
  let closed = false

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      // The parameter sets arrive once, on the first chunk. Kept rather than
      // re-read, because later chunks carry no metadata at all and a file
      // without an avcC record is a file nothing can decode.
      // `description` is typed as a union of every buffer-ish thing, because
      // the spec allows any of them. Copied rather than wrapped either way: it
      // belongs to the encoder, which is about to be closed.
      const description = meta?.decoderConfig?.description
      if (avcc === null && description !== undefined) {
        avcc = new Uint8Array(
          ArrayBuffer.isView(description)
            ? new Uint8Array(
                description.buffer,
                description.byteOffset,
                description.byteLength,
              )
            : new Uint8Array(description),
        )
      }
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      samples.push({ data, key: chunk.type === 'key' })
    },
    error: e => {
      failure = e instanceof Error ? e.message : String(e)
    },
  })

  encoder.configure({
    codec: CODEC,
    width,
    height,
    bitrate: bitrateFor(width, height, rate),
    framerate: rate,
    // Length-prefixed NAL units with the parameter sets out of band, which is
    // what an MP4 sample table wants; 'annexb' would inline them and the file
    // would need a different `stsd` entry.
    avc: { format: 'avc' },
    // The picture is a new noise field every frame, so there is little for a
    // realtime rate controller to work with and no reason to ask it to hit a
    // deadline: this is a file, not a stream.
    latencyMode: 'quality',
  })

  return {
    frames: () => count,
    error: () => failure,
    frame: source => {
      if (closed || encoder.state !== 'configured') return
      // Microseconds, off the count and never off a clock. A frame that took
      // 200ms to render still lands exactly one frame after its predecessor,
      // which is the property the whole file is for.
      const timestamp = Math.round((count * 1e6 * fps.den) / fps.num)
      const duration = Math.round((1e6 * fps.den) / fps.num)
      const frame = new VideoFrame(source, {
        timestamp,
        duration,
        // Cropped to the even size the encoder was configured with — see
        // `even` above. A frame whose size disagrees with the configuration is
        // the other way to fail this encoder asynchronously.
        visibleRect: { x: 0, y: 0, width, height },
      })
      encoder.encode(frame, {
        keyFrame:
          count % Math.max(1, Math.round(rate * KEYFRAME_SECONDS)) === 0,
      })
      // Closed at once rather than left to the collector: a VideoFrame holds a
      // GPU or system buffer, and a few unreleased ones stall the encoder
      // outright.
      frame.close()
      count++
    },
    abort: () => {
      closed = true
      if (encoder.state !== 'closed') encoder.close()
      samples.length = 0
    },
    finish: async () => {
      closed = true
      if (encoder.state === 'configured') await encoder.flush()
      if (encoder.state !== 'closed') encoder.close()
      if (failure !== '') throw new Error(failure)
      if (samples.length === 0) throw new Error('nothing was recorded')
      if (avcc === null) {
        throw new Error('the encoder produced no parameter sets')
      }
      // Copied into a fresh ArrayBuffer rather than asserted into one. A
      // `Uint8Array` is a `BlobPart` at runtime in every browser, but its
      // buffer is typed `ArrayBufferLike` — which could be shared — and the
      // cast that quiets that is the kind this codebase does not take. One copy
      // of a file already held whole in memory is not the cost worth arguing
      // over.
      const file = writeMp4({ width, height, fps, avcc, samples })
      const out = new ArrayBuffer(file.length)
      new Uint8Array(out).set(file)
      return new Blob([out], { type: 'video/mp4' })
    },
  }
}
