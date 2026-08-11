// Frame N of a clip, as a pure function of N — the thing docs/EDITOR.md's
// build order calls **frame-exact video pull**, and the last thing standing
// between a take and reproducing with a clip in it.
//
// **What is wrong with a `<video>`, stated as a measurement.** Everything below
// the video in this engine is already deterministic: artifacts clock off the
// frame counter, the modulation bay steps a fixed `DT`, and `startTake` puts the
// clock, the dice and the signal path back to a known frame zero. The video is
// not, because `VideoPump` asks an element what it happens to be showing and an
// element advances at wall rate. An offline loop faster than real time therefore
// renders the same input frame hundreds of times and one slower than real time
// skips.
//
// The obvious fix is to seek the element per rendered frame, and
// `scripts/pullstep.mjs` measured it dead: a forward seek of *one frame*
// restarts the decode from the previous keyframe exactly as a seek across the
// whole clip does — 38ms a frame on a 3s GOP and 183-607ms on a single-keyframe
// clip, against a 2-3ms decode floor. One second of 60fps take costs 2.3s of
// pull on the good clip and 6-11s on the bad one, and the bad one is
// `public/test.mp4`. `scripts/codeccheck.mjs` then measured this route at 0.53ms
// a frame and **flat in the keyframe spacing**, because nothing here ever seeks:
// the decoder is fed forward, in its own order, exactly once per frame.
//
// So the shape is: demux once (`mp4demux.ts`), hold a `VideoDecoder`, and walk
// it. Three things follow that are worth knowing before reading the code.
//
//   - **A frame is asked for by time, not by index.** The caller has a clip
//     position — a cue in-point, a row's `start`, `frame / fps` past it — and
//     what it wants is what a viewer would see there. That is the sample with
//     the greatest presentation time at or before it, which is not the same as
//     "the Nth sample" on any clip whose frame rate is not the take's.
//   - **Frames are kept, because a take asks for most of them twice.** A 30fps
//     clip under a 60fps take wants each source frame for two rendered frames,
//     and a decoded frame that was thrown away costs a decoder reset to get
//     back. The cache is small and forward-biased, which is the access pattern
//     a walk actually has.
//   - **Going backwards is expensive and going forwards is not**, which is the
//     whole asymmetry the design rests on. Forward is "feed the next sample";
//     backward is "reset the decoder and feed from the previous keyframe", which
//     is precisely the cost `pullstep.mjs` measured and the reason this is not
//     simply that harness with better bookkeeping. A render walks forward, so it
//     pays the reset once per cut rather than once per frame.
//
// **It hands back a `VideoFrame` and the caller closes it.** Not an
// `ImageBitmap`: whether one is needed is a capability question the engine
// already answers for the live path (`videopump.ts`'s `direct` mode), and on
// Firefox today the answer is yes at about 1ms — re-measured in `codeccheck.mjs`
// rather than assumed, because docs/EDITOR.md asks for exactly that. Deciding it
// here would put a browser policy in a module that has no other reason to know
// about browsers.

import { demuxMp4 } from './mp4demux'

import type { DemuxedTrack } from './mp4demux'

// How many decoded frames to keep. Sized for the access pattern rather than for
// memory: a walk wants the frame it just had (a 24 or 30fps clip under a 60fps
// take repeats), and a decoder that has run ahead through a reorder group has a
// few in hand that will be wanted next. Past that, holding frames is holding
// whole decoded pictures for a walk that is never coming back to them.
//
// **Comfortably more than `FEED_DEPTH`**, which the first cut of this got wrong
// by making them equal: a decoder topped up eight deep lands frames faster than
// the loop looks at them, so the frame being waited for was evicted by the ones
// behind it — and a missing frame that has already been output is
// indistinguishable from one the decoder never made, so the next pull reset and
// decoded the clip from its keyframe again. `scripts/pullcheck.mjs` measured
// that as 24ms a frame on a walk that should cost one, and as *six missing
// frames* at the tail.
const KEEP = 24

// How far ahead a wanted frame may be before it is cheaper to reset and seek
// than to feed through everything in between. Feeding is roughly a decode each,
// and a reset costs a decode from the previous keyframe — so the break-even is
// the keyframe spacing, and this is deliberately a little past a typical one.
// It only matters on a jump, which in a rundown is a cut.
const FEED_AHEAD_LIMIT = 240

// How many chunks to keep in the decoder's queue. Enough that it is never idle
// waiting to be topped up, and small enough that a walk which finds its frame
// early has not paid for a long tail of decodes nothing wanted. One would be
// correct and would give up the pipelining that makes this route cheap.
const FEED_DEPTH = 8

// The largest file this will hold a second copy of, per deck.
//
// 192MB covers everything the app ships and the great majority of what an
// archive.org roll turns up, and refuses the hour-long transfer that would
// otherwise be held twice on each of two decks while a render ran. It is a
// memory ceiling and not a quality one — the clip still plays, it is simply
// pumped from its element at wall rate, which is what every clip did before
// frame-exact pull existed.
//
// Worth stating what it is *not* protecting against: the browser's own decoded
// picture buffers, which are the elements' and are not counted here. This
// bounds the compressed bytes this module allocates, because those are the ones
// it can be wrong about.
const MAX_PULL_BYTES = 192 * 1024 * 1024

export interface FramePull {
  // The frame shown at `seconds` on the clip's own timeline. **Ownership passes
  // to the caller**, which must `close()` it — a `VideoFrame` holds a decoded
  // picture and a decoder that runs out of them stalls rather than failing.
  //
  // Null means there is no frame there: before the first, past the last, or a
  // decoder that has given up. A render treats that the way it treats a clip
  // that has not loaded — it renders what is on the slot already — rather than
  // as an error, because a rundown that runs a row past its clip's end is an
  // ordinary thing for a rundown to do.
  frameAt: (seconds: number) => Promise<VideoFrame | null>
  // The clip's own length, so a caller can decide what running off the end
  // means without having to demux it a second time.
  duration: number
  codedWidth: number
  codedHeight: number
  close: () => void
}

// Open a clip for stepping. Null when the file is one this cannot pull from —
// not an MP4, a codec with no config string, an edit list that is not a shift,
// or a decoder that will not take the track. **Every one of those is a fallback
// rather than a failure**: the caller keeps the wall-rate element it already
// has, and the take is exactly as reproducible as it was before this existed.
export async function openPull(bytes: Uint8Array): Promise<FramePull | null> {
  if (typeof VideoDecoder === 'undefined') return null
  const track = demuxMp4(bytes)
  if (track === null || track.unsupportedEdit || track.samples.length === 0) {
    return null
  }
  const config: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: track.codedWidth,
    codedHeight: track.codedHeight,
    ...(track.description === null ? {} : { description: track.description }),
    // Ask for frames as they become decodable rather than when the decoder
    // feels like it. A walk wants each frame before it can step, so latency
    // here is the render's wall time.
    optimizeForLatency: true,
  }
  try {
    const support = await VideoDecoder.isConfigSupported(config)
    if (support.supported !== true) return null
  } catch {
    return null
  }
  return makePull(bytes, track, config)
}

// The same, from a url the app is already holding — a `blob:` for a pool pick
// or a bundled clip's path. Whole file, because that is what the demuxer reads
// and what `sources/pool.ts` already downloads for its own reasons.
//
// **And that whole file is a second copy**, which is the cost this function
// quietly carries and the reason for the ceiling below. A pool pick is already
// resident as a `Blob` — `sources/pool.ts` says why it downloads whole — and
// there is no way to reach that object from a `blob:` url, so reading it back
// through `fetch` allocates it again. Two decks under a take is four copies of
// two files, on top of whatever the `<video>` elements are holding.
//
// The bound is structural rather than a rule to remember, which is the same
// answer `videoSlot.ts` gives for preroll depth 1 and for the same reason: a
// budget nobody can see is one somebody eventually spends. Past the ceiling the
// deck stays on its element, which is the fallback every other decline here
// takes and is exactly as reproducible as every take was before this existed.
export async function openPullFromUrl(url: string): Promise<FramePull | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    // Asked before the body is read, so an oversized file is declined without
    // ever being held. A `blob:` reports its length; a server may not, and
    // `null` there means "unknown" rather than "small" — hence the check after
    // the read as well, which costs a peak that has already happened but stops
    // an unknown-length stream from being kept.
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > MAX_PULL_BYTES) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_PULL_BYTES) return null
    return await openPull(bytes)
  } catch {
    return null
  }
}

function makePull(
  bytes: Uint8Array,
  track: DemuxedTrack,
  config: VideoDecoderConfig,
): FramePull {
  const { samples, timescale } = track
  // Presentation order, as indices into the decode-ordered sample list. The two
  // are the same list on any clip without B-frames, and this is the difference
  // between "the frame shown at t" and "the frame decoded at t" on every clip
  // with them — see `DemuxedTrack.samples` for why the sort lives here rather
  // than in the demuxer.
  const shown = samples.map((_, i) => i)
  shown.sort((a, b) => samples[a].cts - samples[b].cts)

  const tickToUs = (ticks: number) => Math.round((ticks * 1e6) / timescale)
  // What each sample's frame will come back stamped with. Matching in whole
  // microseconds rather than in seconds is what makes "is this the frame I
  // asked for" an equality rather than a tolerance.
  const stampOf = (i: number) => tickToUs(samples[i].cts)

  let decoder: VideoDecoder | null = null
  let broken = false
  // Next sample to feed, in decode order. -1 means the decoder is not in a
  // state that can be fed — freshly made, or past a flush, which sets the
  // key-chunk requirement again and so cannot be carried on from.
  let feed = -1
  const held = new Map<number, VideoFrame>()
  // The greatest stamp the decoder has produced. Frames come out in
  // presentation order, so this is what tells "still inside the decoder" apart
  // from "came out and was evicted" — the two cases that look identical from a
  // cache miss and want opposite answers.
  let lastOut = -1
  let closed = false
  // The stamp a `frameAt` is currently feeding for, so eviction cannot drop the
  // one thing the loop is waiting for. -1 when nothing is being waited on.
  let wanted = -1
  // Woken by every output. A list rather than one slot because `frameAt` can be
  // re-entered, and a resolver that gets overwritten is a caller that waits for
  // a frame which already arrived.
  let waiters: (() => void)[] = []

  const wake = () => {
    const woken = waiters
    waiters = []
    for (const w of woken) w()
  }
  const arrival = () =>
    new Promise<void>(resolve => {
      waiters.push(resolve)
    })

  const drop = (stamp: number) => {
    held.get(stamp)?.close()
    held.delete(stamp)
  }
  const clearHeld = () => {
    for (const f of held.values()) f.close()
    held.clear()
  }

  const reset = () => {
    try {
      decoder?.close()
    } catch {
      // A decoder already in an error state throws on close, which is not news
      // and not a reason to fail the reset that is replacing it.
    }
    clearHeld()
    lastOut = -1
    broken = false
    decoder = new VideoDecoder({
      output: frame => {
        if (closed) {
          frame.close()
          return
        }
        held.set(frame.timestamp, frame)
        if (frame.timestamp > lastOut) lastOut = frame.timestamp
        // Bounded from the front, which is the oldest insertion — frames come
        // out in presentation order and `Map` keeps insertion order, so the
        // front is what a forward walk has already gone past. Never the frame
        // being waited for, however far down the queue it has got.
        while (held.size > KEEP) {
          const oldest = [...held.keys()].find(k => k !== wanted)
          if (oldest === undefined) break
          drop(oldest)
        }
        wake()
      },
      error: () => {
        broken = true
        wake()
      },
    })
    // **The other thing that has to wake the loop.** A decoder holding frames
    // for reordering consumes chunks and produces nothing, so waiting only on
    // `output` deadlocks exactly when the queue drains with the wanted frame
    // still inside: nothing arrives, and nothing tops the queue up because the
    // topping up happens after a wake. `dequeue` is the event for that, and
    // between the two the loop always has something to be woken by.
    decoder.addEventListener('dequeue', wake)
    decoder.configure(config)
    feed = 0
  }

  // The sample shown at `ticks`: the greatest presentation time at or before it.
  // Binary search over presentation order, which is the one place the sort above
  // is spent.
  const shownAt = (ticks: number): number | null => {
    if (samples[shown[0]].cts > ticks) return null
    let lo = 0
    let hi = shown.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (samples[shown[mid]].cts <= ticks) lo = mid
      else hi = mid - 1
    }
    return shown[lo]
  }

  // The sync sample at or before `index`, in decode order — where the decoder
  // has to be started for `index` to come out of it.
  const keyAtOrBefore = (index: number): number => {
    for (let i = index; i >= 0; i--) {
      if (samples[i].key) return i
    }
    return 0
  }

  const chunkFor = (i: number): EncodedVideoChunk =>
    new EncodedVideoChunk({
      type: samples[i].key ? 'key' : 'delta',
      // **The presentation time, not the decode time.** It is what comes back
      // on the frame, so it is what "did I get the one I asked for" is answered
      // with; feeding `dts` here would look right on every clip without
      // B-frames and mismatch on every clip with them.
      timestamp: stampOf(i),
      data: bytes.subarray(
        samples[i].offset,
        samples[i].offset + samples[i].size,
      ),
    })

  const frameAt = async (seconds: number): Promise<VideoFrame | null> => {
    if (closed || broken) return null
    const ticks = Math.round(seconds * timescale)
    const want = shownAt(ticks)
    if (want === null) return null
    const stamp = stampOf(want)

    // **A clone goes out and the original stays.** Ownership has to pass — the
    // caller decides when it is done with a picture — but handing over the
    // cached frame itself empties the cache of exactly the entry that is about
    // to be asked for again: a 60fps take over a 30fps clip wants every source
    // frame twice, so removing it on the way out made the *second* pull of each
    // pair a decoder reset. `pullcheck.mjs` measured the repeat at 37ms against
    // 10ms for a cold walk, which is the cache making things worse.
    //
    // `clone()` shares the underlying picture rather than copying it, so this
    // is a reference and not a frame's worth of memory.
    const take = (): VideoFrame | null => held.get(stamp)?.clone() ?? null
    const ready = take()
    if (ready !== null) return ready

    // Three reasons to start the decoder again, and only the second is subtle.
    //
    //   - It is not in a feedable state (fresh, or past a flush).
    //   - The frame has already come out and been evicted, which `lastOut`
    //     tells apart from a frame still inside the decoder waiting on the
    //     samples after it. Feeding on for one of those is right and cheap;
    //     feeding on for one that is gone never produces it.
    //   - It is so far ahead that decoding the gap costs more than a reset.
    if (feed < 0 || stamp <= lastOut || want > feed + FEED_AHEAD_LIMIT) {
      reset()
      feed = keyAtOrBefore(want)
    }
    wanted = stamp
    try {
      return await feedFor(stamp)
    } finally {
      wanted = -1
    }
  }

  // The feed loop, split out only so `wanted` is cleared on every way out of it
  // — including a throw, which would otherwise leave one frame pinned in the
  // cache for the life of the puller.
  const feedFor = async (stamp: number): Promise<VideoFrame | null> => {
    const take = (): VideoFrame | null => held.get(stamp)?.clone() ?? null

    // Feed forward until it comes out. Bounded by the samples themselves: a
    // decoder that never produces the frame runs out of input and the flush
    // below is the last word on it, so there is no way to sit here forever.
    //
    // **Awaiting an arrival, never a microtask.** A decoder's `output` is a
    // task, so `await Promise.resolve()` between decodes yields to nothing that
    // can deliver a frame and the loop feeds the entire clip before the first
    // one lands. The queue is topped up to a depth and then waited on, which is
    // also what lets the decoder pipeline rather than answering one at a time.
    while (!broken) {
      while (feed < samples.length) {
        // Read out rather than tested in the condition: it is the queue that
        // moves here, not the decoder, and a loop condition naming the decoder
        // reads as though the decoder is what changes.
        if ((decoder?.decodeQueueSize ?? 0) >= FEED_DEPTH) break
        const at = feed
        feed++
        try {
          decoder?.decode(chunkFor(at))
        } catch {
          broken = true
          break
        }
      }
      if (broken) break
      const out = take()
      if (out !== null) return out
      if (feed >= samples.length) {
        // Nothing left to push the reorder tail out with, so ask for it. A
        // completed flush requires a key chunk next, which is why this is the
        // end of the road for this decoder rather than a step in the loop.
        try {
          await decoder?.flush()
        } catch {
          broken = true
          break
        }
        feed = -1
        return take()
      }
      await arrival()
    }
    return null
  }

  return {
    frameAt,
    duration: track.duration / timescale,
    codedWidth: track.codedWidth,
    codedHeight: track.codedHeight,
    close: () => {
      closed = true
      clearHeld()
      try {
        decoder?.close()
      } catch {
        // As in `reset`: an errored decoder throws here and there is nothing
        // left to do about it.
      }
      decoder = null
    },
  }
}
