// A minimal MP4 (ISOBMFF) writer for one H.264 track, at a constant frame rate.
//
// **Why this exists rather than a dependency.** The app had three runtime deps
// (react, react-dom, firebase) and this is not worth being the fourth: what an
// export of this needs is one video track, no audio, every sample the same
// duration, and a single chunk — which is the simplest shape the format has.
// The general-purpose muxers are general because they carry fragmented output,
// multiple tracks, B-frames and edit lists, none of which apply here.
//
// **Why MP4 and not WebM**, when the app has always written WebM. The point of
// this half of the editor is "an export an NLE will conform"
// (docs/EDITOR.md), and DaVinci Resolve does not import WebM at all while
// Premiere needs a plugin for it. H.264 in MP4 is the one thing every editor
// on the list opens. That the output format changes is the point, not a side
// effect.
//
// **What makes it constant-framerate** is `stts`: one entry saying "N samples,
// each `delta` long". There is no per-sample timing to drift, so an editor
// reads one frame rate off the header and conforms to it — which is exactly
// what `MediaRecorder` could not do, since it timestamps by wall clock and
// writes whatever the tab managed.
//
// Layout is `ftyp` / `mdat` / `moov`, samples in a single chunk. One chunk is
// what collapses `stsc` and `stco` to one entry each, and nothing here streams,
// so there is no reason to have more.

// Every box is a length, a four-character type, and a payload.
const box = (type: string, ...parts: Uint8Array[]): Uint8Array => {
  const size = parts.reduce((n, p) => n + p.length, 8)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, size)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  let at = 8
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// A box whose first payload byte is a version and three flag bytes.
const fullBox = (
  type: string,
  version: number,
  flags: number,
  ...parts: Uint8Array[]
): Uint8Array =>
  box(
    type,
    u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff),
    ...parts,
  )

const u8 = (...bytes: number[]): Uint8Array => Uint8Array.from(bytes)

const u16 = (v: number): Uint8Array => u8((v >> 8) & 0xff, v & 0xff)

const u32 = (v: number): Uint8Array =>
  u8((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)

const str = (s: string): Uint8Array =>
  Uint8Array.from(s, c => c.charCodeAt(0) & 0xff)

const join = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// The creation/modification stamp the three header boxes carry, in seconds
// since 1904. **Zero, meaning unset, rather than the wall clock**, and that is
// load-bearing rather than laziness: it is the last thing standing between a
// take and being a pure function of the frames in it.
//
// It was `Date.now()`, and `scripts/rendercheck.mjs` caught it the day the
// render started clearing its signal state — two renders of one take came back
// the same length to the byte and with different digests, and the whole of the
// difference was these six fields, twenty-four bytes of "when did you press the
// button". Nothing reads them (ffprobe reports no date either way), and a file
// that differs by when it was made is a file two takes can never be compared
// by.
const NO_DATE = u32(0)

// The unity matrix every writer emits, as 16.16 fixed point.
const MATRIX = join([
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x40000000),
])

// Rebuild an `avcC` record from whatever the encoder handed over, because what
// Firefox hands over is malformed and ffmpeg says so.
//
// Measured on Nightly, `decoderConfig.description` for `avc1.42002a` comes back
//
//   01 42 c0 2a 03 01 00 18 67 67 42 c0 2a d9 …  01 00 05 68 68 cb 8c b2
//
// against the same stream written by ffmpeg, which is
//
//   01 42 c0 20 ff e1 00 18 67 42 c0 20 d9 …
//
// Two faults, and they are the browser's — the bytes above are dumped straight
// off the callback, before this file sees them. The reserved bits before
// `lengthSizeMinusOne` and `numOfSequenceParameterSets` are left clear where
// the spec fixes them at 1 (`0xFC`, `0xE0`), and **each parameter set carries a
// duplicate of its own NAL header byte** — `67 67`, `68 68`. ffmpeg decodes the
// picture anyway but reports `sps_id out of range` and `cpb_count 33 invalid`
// on every frame, because it is parsing the SPS one byte off; a stricter
// demuxer is entitled to refuse the file outright, and an editor is exactly the
// stricter demuxer this is for.
//
// So the sets are read out by their declared lengths, un-doubled, and re-emitted
// with the reserved bits on. Detecting the duplicate rather than always
// dropping a byte is what keeps this correct on a browser without the bug: a
// real SPS's second byte is `profile_idc` (0x42 here) and can never equal its
// own NAL header, so the two being identical is unambiguous.
export function normaliseAvcc(raw: Uint8Array): Uint8Array {
  // Too short to be a record at all — hand it back and let the file fail
  // visibly rather than inventing parameter sets nothing came from.
  if (raw.length < 7) return raw

  const sets: { type: number; data: Uint8Array }[] = []
  let at = 6
  const take = (count: number, expect: number) => {
    for (let i = 0; i < count && at + 2 <= raw.length; i++) {
      const len = (raw[at] << 8) | raw[at + 1]
      at += 2
      if (len === 0 || at + len > raw.length) return
      let data = raw.slice(at, at + len)
      at += len
      // The duplicate, if this browser writes one.
      if (
        data.length > 2 &&
        data[0] === data[1] &&
        (data[0] & 0x1f) === expect
      ) {
        data = data.slice(1)
      }
      sets.push({ type: expect, data })
    }
  }
  take(raw[5] & 0x1f, 7)
  if (at < raw.length) take(raw[at++], 8)

  const sps = sets.filter(s => s.type === 7)
  const pps = sets.filter(s => s.type === 8)
  if (sps.length === 0) return raw

  const lengths = (list: { data: Uint8Array }[]) =>
    list.flatMap(s => [u16(s.data.length), s.data])

  return join([
    // Version, and the profile/compat/level triplet, which are the first three
    // bytes of the SPS itself and are taken from there rather than from the
    // header — a browser that got the header wrong has not earned the benefit
    // of the doubt about these.
    u8(1, sps[0].data[1], sps[0].data[2], sps[0].data[3]),
    // Reserved bits set, and a four-byte NAL length, which is what `record.ts`
    // configures the encoder for.
    u8(0xff, 0xe0 | sps.length),
    ...lengths(sps),
    u8(pps.length),
    ...lengths(pps),
  ])
}

// One encoded frame, as it comes off `VideoEncoder`.
export interface Sample {
  data: Uint8Array
  // Whether an editor can cut here. Every frame the encoder marked a keyframe
  // goes in `stss`; with no `stss` at all a player assumes *every* frame is a
  // sync point, which is wrong the moment the encoder emits a P-frame.
  key: boolean
}

export interface Mp4Spec {
  width: number
  height: number
  // Frames per second, as a rational so 29.97 and 23.976 stay exact rather
  // than becoming a repeating decimal an editor then rounds differently.
  fps: { num: number; den: number }
  // The encoder's `decoderConfig.description` — the avcC record, which carries
  // the SPS and PPS. Without it a decoder has no parameter sets and the file is
  // unplayable; `VideoEncoder` hands it over on the first chunk's metadata.
  avcc: Uint8Array
  samples: readonly Sample[]
}

// Movie timescale. 1000 is conventional and is only used for the durations in
// `mvhd`/`tkhd`; the track's own timescale below is what carries the frame
// timing, and it is exact.
const MOVIE_TIMESCALE = 1000

export function writeMp4(spec: Mp4Spec): Uint8Array {
  const { width, height, fps, samples } = spec
  // The track's timescale *is* the frame rate's numerator, so one frame is
  // exactly `den` ticks and there is no rounding anywhere. 60fps becomes
  // timescale 60 delta 1; 29.97 becomes timescale 30000 delta 1001, which is
  // the pairing broadcast has used for fifty years and which every editor
  // recognises on sight.
  const timescale = fps.num
  const delta = fps.den
  const n = samples.length
  const trackDuration = n * delta
  const movieDuration = Math.round(
    (trackDuration / timescale) * MOVIE_TIMESCALE,
  )

  const mdatPayload = join(samples.map(s => s.data))
  const ftyp = box(
    'ftyp',
    str('isom'),
    u32(512),
    str('isom'),
    str('iso2'),
    str('avc1'),
    str('mp41'),
  )
  // Written before `moov` so the offsets in `stco` can be computed without
  // laying the movie box out twice: everything before the samples is `ftyp`
  // plus this box's own 8-byte header.
  const mdat = box('mdat', mdatPayload)
  const sampleStart = ftyp.length + 8

  const avc1 = box(
    'avc1',
    // Six reserved bytes and a data-reference index of 1.
    u8(0, 0, 0, 0, 0, 0),
    u16(1),
    // Version, revision, vendor, temporal and spatial quality: all zero for a
    // file nothing is streaming.
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(0),
    u16(width),
    u16(height),
    // 72dpi horizontal and vertical, as 16.16.
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1),
    // A 32-byte Pascal compressor name, empty.
    u8(0),
    new Uint8Array(31),
    u16(0x0018),
    // -1: no colour table.
    u16(0xffff),
    box('avcC', normaliseAvcc(spec.avcc)),
  )

  const stbl = box(
    'stbl',
    fullBox('stsd', 0, 0, u32(1), avc1),
    // The whole of what makes this constant: one entry for every sample.
    fullBox('stts', 0, 0, u32(1), u32(n), u32(delta)),
    // Which frames an editor may cut on. Omitted entirely when every frame is
    // one — that is what the format's absence means, and writing it out would
    // be a table the size of the movie saying nothing.
    ...(samples.every(s => s.key)
      ? []
      : [
          fullBox(
            'stss',
            0,
            0,
            u32(samples.filter(s => s.key).length),
            join(samples.flatMap((s, i) => (s.key ? [u32(i + 1)] : []))),
          ),
        ]),
    // One chunk holding every sample, so this is one entry rather than one per
    // frame: first chunk 1, N samples in it, description 1.
    fullBox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    // A sample size table rather than a single constant, because encoded frames
    // are not the same length. The 0 is "sizes are listed individually".
    fullBox(
      'stsz',
      0,
      0,
      u32(0),
      u32(n),
      join(samples.map(s => u32(s.data.length))),
    ),
    fullBox('stco', 0, 0, u32(1), u32(sampleStart)),
  )

  const moov = box(
    'moov',
    fullBox(
      'mvhd',
      0,
      0,
      NO_DATE,
      NO_DATE,
      u32(MOVIE_TIMESCALE),
      u32(movieDuration),
      // Rate 1.0, volume 1.0, then reserved.
      u32(0x00010000),
      u16(0x0100),
      u16(0),
      u32(0),
      u32(0),
      MATRIX,
      // Six predefined words, then the id the next track would take.
      new Uint8Array(24),
      u32(2),
    ),
    box(
      'trak',
      // Flags 3: enabled, and in the movie.
      fullBox(
        'tkhd',
        0,
        3,
        NO_DATE,
        NO_DATE,
        u32(1),
        u32(0),
        u32(movieDuration),
        u32(0),
        u32(0),
        // Layer, alternate group, volume (0 for video), reserved.
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        MATRIX,
        // Display size as 16.16, which is what a player letterboxes to.
        u32(width * 0x10000),
        u32(height * 0x10000),
      ),
      box(
        'mdia',
        fullBox(
          'mdhd',
          0,
          0,
          NO_DATE,
          NO_DATE,
          u32(timescale),
          u32(trackDuration),
          // 'und', packed five bits per letter, then predefined.
          u16(0x55c4),
          u16(0),
        ),
        fullBox(
          'hdlr',
          0,
          0,
          u32(0),
          str('vide'),
          u32(0),
          u32(0),
          u32(0),
          str('VideoHandler\0'),
        ),
        box(
          'minf',
          // Graphics mode 0 and an all-zero opcolor: copy, which is the only
          // sane answer for a track nothing is composited under.
          fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
          // The data is in this file, which is what the self-contained flag on
          // `url ` says — hence a `dref` with one entry and no actual URL.
          box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
          stbl,
        ),
      ),
    ),
  )

  return join([ftyp, mdat, moov])
}
