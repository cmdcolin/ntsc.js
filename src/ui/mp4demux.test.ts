import { describe, expect, it } from 'vitest'

import { writeMp4 } from './mp4'
import { demuxMp4 } from './mp4demux'

import type { Sample } from './mp4'

// **The muxer is the fixture generator**, which is the whole reason this is a
// vitest file and not a third browser harness. `writeMp4` already produces the
// exact shape a take's own export has, so a round trip asserts the two halves
// agree without a decoder, a network, or a GPU anywhere near it — and the day
// one of them drifts, the failure names which.
//
// What a round trip cannot cover is the half of the format `writeMp4` never
// emits: B-frames, several chunks, 64-bit offsets, a uniform sample size. Those
// are built by hand below, because they are exactly where a demuxer is wrong in
// a way that reads as correct — a file whose frames come out in the wrong order
// still decodes, still has the right count, and still plays.

// A valid-enough avcC: version, then the profile/compat/level triplet the codec
// string is read out of, then a length-size byte, one SPS and one PPS.
const avcc = Uint8Array.from([
  1, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xc0, 0x1e, 1, 0, 2, 0x68,
  0xcb,
])

const sample = (n: number, key: boolean): Sample => ({
  data: Uint8Array.from({ length: n }, (_, i) => (i + n) & 0xff),
  key,
})

describe('demuxMp4, against what writeMp4 writes', () => {
  const samples = [
    sample(40, true),
    sample(11, false),
    sample(12, false),
    sample(41, true),
    sample(13, false),
  ]
  const file = writeMp4({
    width: 640,
    height: 480,
    fps: { num: 60, den: 1 },
    avcc,
    samples,
  })
  const track = demuxMp4(file)

  it('reads the track back at all', () => {
    expect(track).not.toBeNull()
  })

  it('recovers the codec string from the parameter sets', () => {
    // Not from the box type: `avc1` alone is not something a decoder accepts,
    // and the three bytes that complete it live in the SPS.
    expect(track?.codec).toBe('avc1.42c01e')
  })

  it('recovers the geometry and the clock', () => {
    expect(track?.codedWidth).toBe(640)
    expect(track?.codedHeight).toBe(480)
    // `writeMp4` makes the timescale the fps numerator so a frame is exactly
    // `den` ticks — the property that makes its output constant-framerate.
    expect(track?.timescale).toBe(60)
  })

  it('recovers every sample, at the right byte range', () => {
    expect(track?.samples).toHaveLength(samples.length)
    for (const [i, s] of (track?.samples ?? []).entries()) {
      const want = samples[i].data
      expect(s.size).toBe(want.length)
      expect(file.slice(s.offset, s.offset + s.size)).toEqual(want)
    }
  })

  it('recovers which frames can be cut on', () => {
    expect(track?.samples.map(s => s.key)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ])
  })

  it('gives every frame the same duration, which is what CFR means', () => {
    const dts = track?.samples.map(s => s.dts) ?? []
    expect(dts).toEqual([0, 1, 2, 3, 4])
    // No `ctts`, so presentation is decode order.
    expect(track?.samples.map(s => s.cts)).toEqual(dts)
  })

  it('has nothing to decline, because writeMp4 emits no edit list', () => {
    expect(track?.unsupportedEdit).toBe(false)
  })
})

describe('demuxMp4, on an all-key file', () => {
  // `writeMp4` omits `stss` entirely when every frame is a keyframe, because
  // that is what the format's silence means. A demuxer that read the absence as
  // "no keyframes" would make every clip unseekable.
  const file = writeMp4({
    width: 320,
    height: 240,
    fps: { num: 30, den: 1 },
    avcc,
    samples: [sample(10, true), sample(10, true), sample(10, true)],
  })

  it('reads a missing stss as every frame being a sync point', () => {
    expect(demuxMp4(file)?.samples.map(s => s.key)).toEqual([true, true, true])
  })
})

describe('demuxMp4, on what writeMp4 never writes', () => {
  // --- a hand-built file, so the awkward tables can be exercised -------------
  //
  // Only the boxes the demuxer reads are present. It is a reader rather than a
  // validator, so a file with no `ftyp` and a stub `avc1` entry is a perfectly
  // good probe of the sample table, and building the whole movie box by hand
  // here would test `writeMp4`'s job twice.
  const u32 = (v: number) => [
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ]
  const i32 = u32
  const fourcc = (s: string): number[] =>
    Array.from({ length: s.length }, (_, i) => s.charCodeAt(i))
  const box = (type: string, ...body: number[][]): number[] => {
    const payload = body.flat()
    return [...u32(payload.length + 8), ...fourcc(type), ...payload]
  }
  const full = (type: string, version: number, ...body: number[][]) =>
    box(type, [version, 0, 0, 0], ...body)

  // A visual sample entry: 78 fixed bytes, width and height at 24 and 26.
  const visual = (w: number, h: number) => {
    const fixed: number[] = Array.from({ length: 78 }, () => 0)
    fixed[24] = (w >> 8) & 0xff
    fixed[25] = w & 0xff
    fixed[26] = (h >> 8) & 0xff
    fixed[27] = h & 0xff
    return box('avc1', fixed, box('avcC', [...avcc]))
  }

  // A version-0 `elst` entry: segment duration, media time, then the rate as
  // two 16-bit halves of a 16.16 fixed point number.
  const elst = (entries: { duration: number; mediaTime: number }[], rate = 1) =>
    box(
      'edts',
      full(
        'elst',
        0,
        u32(entries.length),
        ...entries.flatMap(e => [
          u32(e.duration),
          i32(e.mediaTime),
          [0, rate, 0, 0],
        ]),
      ),
    )
  const trak = (
    handler: string,
    stbl: number[][],
    editList: number[] | null = null,
  ) =>
    box(
      'trak',
      ...(editList === null ? [] : [editList]),
      box(
        'mdia',
        full('mdhd', 0, u32(0), u32(0), u32(1000), u32(5000), [0, 0, 0, 0]),
        full('hdlr', 0, u32(0), fourcc(handler), u32(0), u32(0), u32(0)),
        box('minf', box('stbl', ...stbl)),
      ),
    )

  // A whole file, as a `moov` and nothing else: the demuxer reads byte ranges
  // out of the sample table rather than the samples themselves, so the media
  // data does not have to be there for any of this to be answerable.
  //
  // The `mvhd` is here for one field — the movie timescale, which is the clock
  // an empty edit's duration is on while everything else in a track is on the
  // track's own. 1000 against the track's 1000 below would make the two
  // interchangeable and hide exactly the mistake worth testing for, so they are
  // deliberately different.
  const MOVIE_TIMESCALE = 500
  const file = (...traks: number[][]) =>
    Uint8Array.from(
      box(
        'moov',
        full('mvhd', 0, u32(0), u32(0), u32(MOVIE_TIMESCALE), u32(0)),
        ...traks,
      ),
    )
  const build = (stbl: number[][], editList: number[] | null = null) =>
    file(trak('vide', stbl, editList))

  const stsd = full('stsd', 0, u32(1), visual(128, 96))

  it('applies ctts, so a reordered file is not read in the wrong order', () => {
    // Three frames, decoded I P B, shown I B P — the smallest file that tells a
    // demuxer honouring `ctts` apart from one ignoring it. Without it the B and
    // the P come back with each other's presentation times, which still decodes
    // and still plays and is one frame wrong forever.
    const bytes = build([
      stsd,
      full('stts', 0, u32(1), u32(3), u32(100)),
      // Offsets +100, +200, +0 against dts 0, 100, 200 → shown at 100, 300,
      // 200. So the file's second sample is shown *last*, which is what a B
      // frame between an I and a P looks like from the table.
      full(
        'ctts',
        0,
        u32(3),
        u32(1),
        u32(100),
        u32(1),
        u32(200),
        u32(1),
        u32(0),
      ),
      full('stsc', 0, u32(1), u32(1), u32(3), u32(1)),
      full('stsz', 0, u32(0), u32(3), u32(10), u32(20), u32(30)),
      full('stco', 0, u32(1), u32(0)),
    ])
    const t = demuxMp4(bytes)
    expect(t?.samples.map(s => s.dts)).toEqual([0, 100, 200])
    expect(t?.samples.map(s => s.cts)).toEqual([100, 300, 200])
  })

  it('keeps decode order rather than sorting into presentation order', () => {
    // The property the type's comment argues for, asserted rather than only
    // stated: the array a caller feeds from is still the order the decoder
    // needs, however the frames are shown.
    const bytes = build([
      stsd,
      full('stts', 0, u32(1), u32(3), u32(100)),
      full('ctts', 0, u32(3), u32(1), u32(200), u32(1), u32(0), u32(1), u32(0)),
      full('stsc', 0, u32(1), u32(1), u32(3), u32(1)),
      full('stsz', 0, u32(0), u32(3), u32(10), u32(20), u32(30)),
      full('stco', 0, u32(1), u32(0)),
    ])
    expect(demuxMp4(bytes)?.samples.map(s => s.size)).toEqual([10, 20, 30])
  })

  it('places samples across several chunks', () => {
    // Two chunks at unrelated offsets, two samples each. A demuxer that assumed
    // one chunk — which is all `writeMp4` ever produces — reads the third and
    // fourth samples out of the first chunk's bytes and gets garbage that still
    // has the right length.
    const bytes = build([
      stsd,
      full('stts', 0, u32(1), u32(4), u32(50)),
      full('stsc', 0, u32(1), u32(1), u32(2), u32(1)),
      full('stsz', 0, u32(0), u32(4), u32(10), u32(20), u32(30), u32(40)),
      full('stco', 0, u32(2), u32(1000), u32(9000)),
    ])
    expect(demuxMp4(bytes)?.samples.map(s => s.offset)).toEqual([
      1000, 1010, 9000, 9030,
    ])
  })

  it('follows a stsc that changes samples-per-chunk part way through', () => {
    // Chunk 1 holds one sample, chunks 2 and 3 hold two. This is what a real
    // muxer emits and what a single-entry reader silently truncates.
    const bytes = build([
      stsd,
      full('stts', 0, u32(1), u32(5), u32(50)),
      full('stsc', 0, u32(2), u32(1), u32(1), u32(1), u32(2), u32(2), u32(1)),
      full('stsz', 0, u32(100), u32(5)),
      full('stco', 0, u32(3), u32(10), u32(200), u32(400)),
    ])
    expect(demuxMp4(bytes)?.samples.map(s => s.offset)).toEqual([
      10, 200, 300, 400, 500,
    ])
  })

  it('reads a uniform sample size, where the table is absent', () => {
    const bytes = build([
      stsd,
      full('stts', 0, u32(1), u32(3), u32(50)),
      full('stsc', 0, u32(1), u32(1), u32(3), u32(1)),
      full('stsz', 0, u32(77), u32(3)),
      full('stco', 0, u32(1), u32(0)),
    ])
    expect(demuxMp4(bytes)?.samples.map(s => s.size)).toEqual([77, 77, 77])
  })

  it('reads 64-bit chunk offsets out of co64', () => {
    const bytes = build([
      stsd,
      full('stts', 0, u32(1), u32(2), u32(50)),
      full('stsc', 0, u32(1), u32(1), u32(2), u32(1)),
      full('stsz', 0, u32(10), u32(2)),
      full('co64', 0, u32(1), u32(0), u32(5_000_000_000 % 2 ** 32)),
    ])
    // The point is that it reads eight bytes rather than four; the value itself
    // is only interesting in that a 32-bit read would return the high word.
    expect(demuxMp4(bytes)?.samples[0].offset).toBe(5_000_000_000 % 2 ** 32)
  })

  // The three sample stbl used by the edit-list cases: dts 0, 100, 200.
  const three = [
    stsd,
    full('stts', 0, u32(1), u32(3), u32(100)),
    full('stsc', 0, u32(1), u32(1), u32(3), u32(1)),
    full('stsz', 0, u32(10), u32(3)),
    full('stco', 0, u32(1), u32(0)),
  ]

  it('subtracts a single edit segment, putting the first shown frame at 0', () => {
    // This is not an exotic case: **both** clips in `public/` have exactly this
    // list, and `scripts/demuxcheck.mjs` found every timestamp out by its
    // `media_time` — 1024 ticks on one file, 266 on the other — while every
    // byte offset and sync flag already agreed with ffprobe. A demuxer that
    // declines on any edit list declines this repo's own footage.
    const t = demuxMp4(build(three, elst([{ duration: 300, mediaTime: 100 }])))
    expect(t?.samples.map(s => s.dts)).toEqual([-100, 0, 100])
    expect(t?.unsupportedEdit).toBe(false)
  })

  it('nets a leading empty edit against the segment that follows it', () => {
    // The other shape ffmpeg writes, and what `public/demo-v2.mp4` has: an
    // empty edit delays the presentation while `media_time` advances it, so the
    // two pull opposite ways and the shift is the difference. **The gap is on
    // the movie clock and `media_time` is on the track's** — 50 movie ticks at
    // 500 against a track at 1000 is 100 track ticks, so a shift of 300 - 100.
    const t = demuxMp4(
      build(
        three,
        elst([
          { duration: 50, mediaTime: -1 },
          { duration: 300, mediaTime: 300 },
        ]),
      ),
    )
    expect(t?.unsupportedEdit).toBe(false)
    expect(t?.samples.map(s => s.dts)).toEqual([-200, -100, 0])
  })

  it('declines a list that cannot be said in one shift', () => {
    // Two *real* segments is a trim or a reorder, and a rate other than 1 is a
    // speed change. Both need a piecewise map from presentation time to media
    // time, and approximating either is how a render comes out silently offset.
    const twoSegments = elst([
      { duration: 100, mediaTime: 0 },
      { duration: 100, mediaTime: 200 },
    ])
    expect(demuxMp4(build(three, twoSegments))?.unsupportedEdit).toBe(true)
    const doubleRate = elst([{ duration: 300, mediaTime: 0 }], 2)
    expect(demuxMp4(build(three, doubleRate))?.unsupportedEdit).toBe(true)
  })

  it('declines an edit list that is nothing but a gap', () => {
    // An empty edit is a delay before the media starts; on its own there is no
    // media for it to delay, so there is nothing to shift and the file is not
    // one this reader understands.
    expect(
      demuxMp4(build(three, elst([{ duration: 100, mediaTime: -1 }])))
        ?.unsupportedEdit,
    ).toBe(true)
  })

  it('leaves times alone when there is no edit list at all', () => {
    const t = demuxMp4(build(three))
    expect(t?.samples.map(s => s.dts)).toEqual([0, 100, 200])
    expect(t?.unsupportedEdit).toBe(false)
  })

  it('skips a non-video track rather than demuxing the sound', () => {
    // An audio track has the same box shape all the way down, so a reader that
    // took the first `trak` rather than the first `vide` one would return it —
    // and would then be handing a render's video pull a stream of sound.
    // Deliberately first in the file, so position alone picks the wrong one.
    const stbl = [
      stsd,
      full('stts', 0, u32(1), u32(1), u32(50)),
      full('stsc', 0, u32(1), u32(1), u32(1), u32(1)),
      full('stsz', 0, u32(10), u32(1)),
      full('stco', 0, u32(1), u32(4242)),
    ]
    const both = file(trak('soun', stbl), trak('vide', stbl))
    const t = demuxMp4(both)
    // The video track's own timescale would be the sound track's 48000 if the
    // wrong one had been picked — they are built from one `stbl` precisely so
    // that the handler is the only thing telling them apart.
    expect(t).not.toBeNull()
    expect(t?.samples[0].offset).toBe(4242)
  })
})

describe('demuxMp4, on files it should decline', () => {
  it('returns null rather than throwing on bytes that are not an MP4', () => {
    expect(demuxMp4(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    expect(demuxMp4(new Uint8Array(0))).toBeNull()
  })

  it('returns null on a truncated box length rather than reading past the end', () => {
    const file = writeMp4({
      width: 64,
      height: 64,
      fps: { num: 30, den: 1 },
      avcc,
      samples: [sample(8, true)],
    })
    expect(demuxMp4(file.slice(0, file.length - 40))).toBeNull()
  })
})
