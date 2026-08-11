// Reading an MP4 back into the samples a `VideoDecoder` will take — the other
// half of `mp4.ts`, and for the opposite reason.
//
// **Why this exists.** docs/EDITOR.md's frame-exact video pull cannot be built
// on a `<video>`: `scripts/pullstep.mjs` measured a forward one-frame seek and
// found it restarting the decode from the previous keyframe exactly as a random
// seek does — 38ms a frame on a well-keyframed clip and 183-607ms on a sparse
// one, against a 2-3ms decode floor. `scripts/codeccheck.mjs` measured the other
// route at 0.53ms a frame and flat in the keyframe spacing. So the frames have
// to come off `VideoDecoder`, and a `VideoDecoder` eats `EncodedVideoChunk`s
// rather than files. This is what turns one into the other.
//
// **Why not mp4box.js.** The same argument `mp4.ts` makes in the other
// direction, and it has got stronger rather than weaker: this repo has three
// runtime dependencies, and what a render needs is one video track's sample
// table out of a file it has already downloaded whole. The general-purpose
// demuxers are general because they stream, carry every track type, and rebuild
// fragmented input — none of which applies to a `blob:` the app is already
// holding in memory.
//
// **It is a reader, not a validator.** A file it cannot make sense of comes back
// as `null` and the caller falls back to the wall-rate `<video>` path, which is
// what every clip uses live anyway. That is the whole error strategy: there is
// always something to fall back *to*, so guessing is never worth it.
//
// **Edit lists are applied, and that was not the plan.** The first cut of this
// reported `hasEditList` and left the caller to decline, on the reasoning that
// honouring one half way is worse than not at all. Then `scripts/demuxcheck.mjs`
// ran it against the two clips in `public/` and **both** have one — every byte
// offset, size and sync flag agreed with ffprobe and every timestamp was out by
// a constant, 1024 ticks on one file and 266 on the other. That constant is the
// single edit's `media_time`, which is what a muxer writes to absorb the
// reordering delay B-frames introduce, and it is on ordinary output from
// ordinary tools rather than on anything exotic. Declining would have declined
// everything.
//
// So the one-entry case is subtracted, which is all it is, and the shapes that
// genuinely cannot be handled this way — more than one segment, a rate other
// than 1, a leading empty edit — set `unsupportedEdit` for the caller to decline
// on. That is the same split as before with the line drawn where the measurement
// put it instead of where caution guessed.
//
// What it deliberately does not do:
//
//   - **Fragmented MP4 (`moof`).** No `moov` sample table to read; a DASH or CMAF
//     source comes back null.
//   - **Audio.** The render's sound does not come from here.

// One encoded frame, located in the file rather than copied out of it. Byte
// ranges rather than slices because a whole clip's samples is the whole clip,
// and the caller already holds those bytes.
export interface DemuxedSample {
  offset: number
  size: number
  // **Two clocks, and they are not the same one.** `dts` is the order the
  // decoder must be fed in; `cts` is when the frame is shown. They differ
  // exactly when the encoder used B-frames, which is most real footage and none
  // of what `mp4.ts` writes — so a puller that indexes by `dts` looks correct on
  // this repo's own output and scrambles the first clip anybody imports.
  // In track timescale ticks.
  dts: number
  cts: number
  // A sync sample: the decoder can be reset and started here. Absent `stss`,
  // every sample is one, which is what the format's silence means.
  key: boolean
}

export interface DemuxedTrack {
  // A codec string in the shape `VideoDecoder.configure` wants.
  codec: string
  // The `avcC` / `vpcC` / `av1C` payload, which carries the parameter sets.
  // Null for codecs that keep them in-band.
  description: Uint8Array | null
  codedWidth: number
  codedHeight: number
  // Ticks per second on this track's own clock. Sample times divide by it.
  timescale: number
  duration: number
  // **Decode order, which is the file's own order and deliberately not sorted
  // by `cts`.** Sorting into presentation order reads as the tidier answer —
  // every question a caller asks is about what is *shown* — and it throws away
  // the one ordering a decoder cannot be fed without. The reorder is small and
  // local (a handful of frames inside a GOP), so the two look identical on any
  // file without B-frames, which includes everything `mp4.ts` writes and
  // therefore every test that does not go out of its way. `framePull.ts` reads
  // `cts` to decide *what* it wants and walks this array to feed for it.
  //
  // Times are **after** the edit list's shift, so the first frame shown sits at
  // `cts` 0 — which is what a `<video>`'s `currentTime` means, and therefore
  // what a cue point, an in-point and a row's `start` all already mean. A `dts`
  // before zero is the correct answer rather than a fault: those are frames the
  // decoder is fed and never shows.
  samples: DemuxedSample[]
  // An edit list this reader cannot express as one shift — several segments, a
  // rate other than 1, or a leading gap. The caller's cue to decline and fall
  // back to the element, rather than render a clip offset by whatever it said.
  unsupportedEdit: boolean
}

interface Box {
  type: string
  // Payload, exclusive of the header.
  start: number
  end: number
}

// Walk the boxes directly under `[start, end)`. Stops rather than throws on a
// length that does not fit: a truncated file is a file to fall back from, and
// what has been read so far is still the truth about the part that parsed.
function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let at = start
  while (at + 8 <= end) {
    let size = view.getUint32(at)
    let header = 8
    if (size === 1) {
      if (at + 16 > end) return
      // 64-bit sizes exist for `mdat` on files over 4GB. Number() is safe here
      // in a way it would not be for a general parser: anything this app has in
      // memory is far inside 2^53.
      size = Number(view.getBigUint64(at + 8))
      header = 16
    } else if (size === 0) {
      // "To the end of the enclosing box", which the spec allows for the last
      // one.
      size = end - at
    }
    if (size < header || at + size > end) return
    let type = ''
    for (let i = 0; i < 4; i++)
      type += String.fromCharCode(view.getUint8(at + 4 + i))
    yield { type, start: at + header, end: at + size }
    at += size
  }
}

const find = (view: DataView, b: Box, type: string): Box | null => {
  for (const child of boxes(view, b.start, b.end)) {
    if (child.type === type) return child
  }
  return null
}

// A path of nested types, because every table below sits four or five boxes
// deep and spelling that out each time is where a typo hides.
const seek = (view: DataView, from: Box, ...path: string[]): Box | null => {
  let at: Box | null = from
  for (const type of path) {
    if (at === null) return null
    at = find(view, at, type)
  }
  return at
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

// The `codec` string `VideoDecoder.configure` wants, built from the sample
// entry's own configuration record rather than from the box type alone —
// `avc1` on its own is not a codec a decoder will accept, and the three bytes
// that complete it are the first three of the SPS.
function codecString(
  entryType: string,
  description: Uint8Array | null,
): string | null {
  if (entryType === 'avc1' || entryType === 'avc3') {
    if (description === null || description.length < 4) return null
    return `${entryType}.${hex2(description[1])}${hex2(description[2])}${hex2(description[3])}`
  }
  if (entryType === 'vp09') {
    // vpcC is a full box: version and flags, then profile, level, and a byte
    // whose top five bits are the bit depth.
    if (description === null || description.length < 7) return null
    const profile = description[4]
    const level = description[5]
    const depth = description[6] >> 4
    return `vp09.${String(profile).padStart(2, '0')}.${String(level).padStart(2, '0')}.${String(depth).padStart(2, '0')}`
  }
  if (entryType === 'av01') {
    if (description === null || description.length < 4) return null
    const profile = description[1] >> 5
    const level = description[1] & 0x1f
    const tier = (description[2] >> 7) & 1
    const depth = (description[2] >> 6) & 1 ? 10 : 8
    return `av01.${profile}.${String(level).padStart(2, '0')}${tier === 1 ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`
  }
  // hvc1/hev1 and the rest: the string needs the whole general_profile_space /
  // compatibility-flags dance, and nothing this app produces or loads is HEVC.
  // Null rather than a guess, so the caller falls back to the element.
  return null
}

// The visual sample entry, whose first 78 payload bytes are fixed and whose
// remainder is the configuration box the codec string comes out of.
function readStsd(
  view: DataView,
  stsd: Box,
): {
  type: string
  width: number
  height: number
  description: Uint8Array | null
} | null {
  // Version, flags, entry count — then the first entry, which is the only one
  // this reads. A track with two sample descriptions changes codec part way
  // through, which is a file to fall back from rather than to follow.
  const first = boxes(view, stsd.start + 8, stsd.end).next()
  if (first.done === true) return null
  const entry = first.value
  if (entry.end - entry.start < 78) return null
  const width = view.getUint16(entry.start + 24)
  const height = view.getUint16(entry.start + 26)
  let description: Uint8Array | null = null
  for (const child of boxes(view, entry.start + 78, entry.end)) {
    if (
      child.type === 'avcC' ||
      child.type === 'vpcC' ||
      child.type === 'av1C' ||
      child.type === 'hvcC'
    ) {
      description = new Uint8Array(
        view.buffer,
        view.byteOffset + child.start,
        child.end - child.start,
      ).slice()
      break
    }
  }
  return { type: entry.type, width, height, description }
}

// How far the edit list shifts this track's media times, and whether it is a
// shape that can be said in one number at all.
//
// **The two shapes here are what ffmpeg writes, and both are in `public/`.**
//
//   - One segment at some `media_time`, which absorbs the reordering delay
//     B-frames introduce. `test.mp4`: `media_time` 1024, and every timestamp
//     was out by exactly that.
//   - A leading *empty* edit — `media_time` -1, a duration and nothing to show —
//     followed by the real segment. That is a delay rather than a skip, so the
//     two pull in opposite directions and the net shift is the segment's
//     `media_time` minus the gap. `demo-v2.mp4`: 512 minus 16ms of movie clock,
//     which at a 15360 track timescale is 246 ticks, for the 266 that
//     `scripts/demuxcheck.mjs` measured against ffprobe to the tick.
//
// The empty edit's duration is on the **movie** clock where `media_time` is on
// the track's, which is the one thing about this box that is easy to get wrong
// and impossible to notice: both are integers, both are "time", and mixing them
// is a shift that is right on any file whose two timescales happen to agree.
//
// Everything else is declined rather than approximated. Several real segments
// is a trim or a reorder and a rate other than 1 is a speed change; each needs a
// piecewise map from presentation time to media time, and neither is worth
// carrying before a file that has one turns up.
function readEdit(
  view: DataView,
  elst: Box | null,
  movieTimescale: number,
  trackTimescale: number,
): { shift: number; unsupported: boolean } {
  if (elst === null) return { shift: 0, unsupported: false }
  const v1 = view.getUint8(elst.start) === 1
  const count = view.getUint32(elst.start + 4)
  const stride = v1 ? 20 : 12
  if (count < 1 || elst.start + 8 + count * stride > elst.end) {
    return { shift: 0, unsupported: true }
  }
  let gap = 0
  for (let i = 0; i < count; i++) {
    const at = elst.start + 8 + i * stride
    // `segment_duration` first, then `media_time` — both 4 bytes at version 0
    // and 8 at version 1, which is the only thing the version changes.
    const duration = v1 ? Number(view.getBigUint64(at)) : view.getUint32(at)
    const mediaTime = v1
      ? Number(view.getBigInt64(at + 8))
      : view.getInt32(at + 4)
    // 16.16 fixed point; anything but 1.0 is a speed change.
    if (view.getUint16(at + stride - 4) !== 1) {
      return { shift: 0, unsupported: true }
    }
    if (mediaTime < 0) {
      // An empty edit, which is only meaningful before the media starts.
      if (i !== count - 1) {
        gap +=
          movieTimescale === 0
            ? 0
            : Math.round((duration * trackTimescale) / movieTimescale)
        continue
      }
      return { shift: 0, unsupported: true }
    }
    // The first real segment. Anything after it is a second one, which is the
    // case this declines.
    return i === count - 1
      ? { shift: mediaTime - gap, unsupported: false }
      : { shift: 0, unsupported: true }
  }
  return { shift: 0, unsupported: true }
}

// (count, value) run-length pairs, which is the shape `stts` and `ctts` share.
const readRuns = (
  view: DataView,
  b: Box,
  signed: boolean,
): { count: number; value: number }[] => {
  const runs: { count: number; value: number }[] = []
  const entries = view.getUint32(b.start + 4)
  let at = b.start + 8
  for (let i = 0; i < entries && at + 8 <= b.end; i++, at += 8) {
    runs.push({
      count: view.getUint32(at),
      value: signed ? view.getInt32(at + 4) : view.getUint32(at + 4),
    })
  }
  return runs
}

export function demuxMp4(bytes: Uint8Array): DemuxedTrack | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const top = { type: 'file', start: 0, end: bytes.byteLength }

  const moov = find(view, top, 'moov')
  if (moov === null) return null

  // The movie clock, which only the edit list needs — an empty edit's duration
  // is on it while everything else in a track is on the track's own.
  const mvhd = find(view, moov, 'mvhd')
  const movieTimescale =
    mvhd === null
      ? 0
      : view.getUint32(mvhd.start + (view.getUint8(mvhd.start) === 1 ? 20 : 12))

  // The first track with a video handler. A file's audio track has the same
  // box shape all the way down, so picking by position rather than by `hdlr`
  // works on most files and silently demuxes the sound on the rest.
  for (const trak of boxes(view, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue
    const hdlr = seek(view, trak, 'mdia', 'hdlr')
    if (hdlr === null) continue
    let handler = ''
    for (let i = 0; i < 4; i++) {
      handler += String.fromCharCode(view.getUint8(hdlr.start + 8 + i))
    }
    if (handler !== 'vide') continue

    const mdhd = seek(view, trak, 'mdia', 'mdhd')
    const stbl = seek(view, trak, 'mdia', 'minf', 'stbl')
    if (mdhd === null || stbl === null) return null
    // Version 1 moves the two 8-byte stamps ahead of the timescale.
    const v1 = view.getUint8(mdhd.start) === 1
    const timescale = view.getUint32(mdhd.start + (v1 ? 20 : 12))
    const duration = v1
      ? Number(view.getBigUint64(mdhd.start + 24))
      : view.getUint32(mdhd.start + 16)

    const stsdBox = find(view, stbl, 'stsd')
    if (stsdBox === null) return null
    const stsd = readStsd(view, stsdBox)
    if (stsd === null) return null
    const codec = codecString(stsd.type, stsd.description)
    if (codec === null) return null

    // --- sizes ---
    const stsz = find(view, stbl, 'stsz')
    if (stsz === null) return null
    const uniform = view.getUint32(stsz.start + 4)
    const count = view.getUint32(stsz.start + 8)
    const sizes: number[] = []
    for (let i = 0; i < count; i++) {
      // A single size for every sample is legal and means the table is absent.
      sizes.push(
        uniform !== 0 ? uniform : view.getUint32(stsz.start + 12 + i * 4),
      )
    }

    // --- where each sample sits ---
    // `stsc` says how many samples are in each *run* of chunks and `stco` says
    // where each chunk starts; between them they place every sample, and the
    // one-chunk file `mp4.ts` writes is the degenerate case of both.
    const stsc = find(view, stbl, 'stsc')
    const stco = find(view, stbl, 'stco') ?? find(view, stbl, 'co64')
    if (stsc === null || stco === null) return null
    const wide = find(view, stbl, 'stco') === null
    const chunkCount = view.getUint32(stco.start + 4)
    const chunkOffsets: number[] = []
    for (let i = 0; i < chunkCount; i++) {
      const at = stco.start + 8 + i * (wide ? 8 : 4)
      chunkOffsets.push(
        wide ? Number(view.getBigUint64(at)) : view.getUint32(at),
      )
    }
    const chunkRuns: { first: number; per: number }[] = []
    const stscEntries = view.getUint32(stsc.start + 4)
    for (let i = 0; i < stscEntries; i++) {
      const at = stsc.start + 8 + i * 12
      chunkRuns.push({ first: view.getUint32(at), per: view.getUint32(at + 4) })
    }
    const offsets: number[] = []
    let sample = 0
    // The runs are sorted by first chunk, so one index walks them alongside the
    // chunks rather than rescanning the table per chunk — which on a long clip
    // is the difference between linear and quadratic in a loop that runs once
    // per frame of the movie.
    let cur = 0
    for (let c = 0; c < chunkOffsets.length && sample < count; c++) {
      while (cur + 1 < chunkRuns.length && chunkRuns[cur + 1].first <= c + 1) {
        cur++
      }
      const per = chunkRuns.length === 0 ? 0 : chunkRuns[cur].per
      let at = chunkOffsets[c]
      for (let i = 0; i < per && sample < count; i++) {
        offsets.push(at)
        at += sizes[sample]
        sample++
      }
    }
    if (offsets.length < count) return null

    // --- when each sample is decoded, and when it is shown ---
    const sttsBox = find(view, stbl, 'stts')
    if (sttsBox === null) return null
    const dts: number[] = []
    let t = 0
    for (const run of readRuns(view, sttsBox, false)) {
      for (let i = 0; i < run.count && dts.length < count; i++) {
        dts.push(t)
        t += run.value
      }
    }
    while (dts.length < count) dts.push(t)

    // The composition offsets, if the encoder reordered anything. Version 1
    // makes them signed, which is how a file expresses a negative offset
    // without an edit list to shift the whole track.
    const cttsBox = find(view, stbl, 'ctts')
    const cts = dts.slice()
    if (cttsBox !== null) {
      const signed = view.getUint8(cttsBox.start) === 1
      let i = 0
      for (const run of readRuns(view, cttsBox, signed)) {
        for (let k = 0; k < run.count && i < count; k++, i++) {
          cts[i] = dts[i] + run.value
        }
      }
    }

    // --- which of them can be cut on ---
    const stss = find(view, stbl, 'stss')
    const keys = new Set<number>()
    if (stss !== null) {
      const n = view.getUint32(stss.start + 4)
      for (let i = 0; i < n; i++) {
        // 1-based in the file, 0-based here.
        keys.add(view.getUint32(stss.start + 8 + i * 4) - 1)
      }
    }

    const edit = readEdit(
      view,
      seek(view, trak, 'edts', 'elst'),
      movieTimescale,
      timescale,
    )
    const samples: DemuxedSample[] = []
    for (let i = 0; i < count; i++) {
      samples.push({
        offset: offsets[i],
        size: sizes[i],
        dts: dts[i] - edit.shift,
        cts: cts[i] - edit.shift,
        key: stss === null || keys.has(i),
      })
    }
    return {
      codec,
      description: stsd.description,
      codedWidth: stsd.width,
      codedHeight: stsd.height,
      timescale,
      duration,
      samples,
      unsupportedEdit: edit.unsupported,
    }
  }
  return null
}
