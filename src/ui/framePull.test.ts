import { afterEach, describe, expect, it, vi } from 'vitest'

import { openPullFromUrl } from './framePull'

// What a puller does when it declines, which is most of what there is to test
// without a decoder. The interesting half of `framePull.ts` needs a real
// `VideoDecoder` and real frames, and that is `scripts/pullcheck.mjs`'s job —
// it reads each decoded frame's own index back out of the picture, which no
// unit test can do.
//
// What *is* testable here is every way in which it hands back `null`, and those
// matter more than they look: a decline is not an error path but the ordinary
// answer for a webcam, a generated mode, a YouTube embed and any file the
// demuxer will not read. Each one has to leave the caller on its element rather
// than throwing, because a take that fell over on an unusual source would be
// worse than a take that rendered it at wall rate.

const stubFetch = (res: {
  ok: boolean
  headers?: Headers
  body?: Uint8Array
}) => {
  const arrayBuffer = vi.fn(() =>
    Promise.resolve((res.body ?? new Uint8Array(0)).slice().buffer),
  )
  const fn = vi.fn(() =>
    Promise.resolve({ ...res, arrayBuffer } as unknown as Response),
  )
  vi.stubGlobal('fetch', fn)
  return { fetch: fn, arrayBuffer }
}

const okResponse = (bytes: Uint8Array, length: string | null = null) => ({
  ok: true,
  headers: {
    get: (k: string) => (k === 'content-length' ? length : null),
  } as Headers,
  body: bytes,
})

// **Node has no `VideoDecoder`, and `openPull` checks for it first.** Without
// this stub every case here comes back null on that line and three of the tests
// below pass without reaching the thing they name — which is the failure mode a
// decline-heavy module invites, since the right answer and the wrong reason
// look identical from outside.
const stubDecoder = (supported = true) => {
  vi.stubGlobal('VideoDecoder', {
    isConfigSupported: () => Promise.resolve({ supported }),
  })
}

describe('openPullFromUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('declines a response that is not ok, without throwing', () => {
    stubFetch({ ok: false })
    return expect(openPullFromUrl('http://x/clip.mp4')).resolves.toBeNull()
  })

  it('declines a fetch that throws, because a dead url is a fallback', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network')))
    return expect(openPullFromUrl('http://x/clip.mp4')).resolves.toBeNull()
  })

  it('declines bytes that are not an MP4', async () => {
    stubDecoder()
    const s = stubFetch(okResponse(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])))
    await expect(openPullFromUrl('http://x/clip.mp4')).resolves.toBeNull()
    // Reached the demuxer rather than stopping at the capability check, which
    // is the whole reason the decoder is stubbed.
    expect(s.arrayBuffer).toHaveBeenCalledTimes(1)
  })

  // The ceiling, from both ends. A declared length is the cheap check and the
  // one that matters — it refuses the file *before* holding it — and the read
  // length is the backstop for a server that declares nothing.
  it('refuses an oversized file on its declared length, before reading it', async () => {
    stubDecoder()
    const s = stubFetch(
      okResponse(new Uint8Array(8), String(512 * 1024 * 1024)),
    )
    await expect(openPullFromUrl('http://x/huge.mp4')).resolves.toBeNull()
    // The point of checking the header at all, and the assertion that makes
    // this test about the ceiling rather than about the file: the body was
    // never asked for, so the second copy was never allocated.
    expect(s.arrayBuffer).not.toHaveBeenCalled()
  })

  it('refuses an oversized file that declared nothing', async () => {
    stubDecoder()
    // A megabyte over the ceiling. Allocated rather than faked, because what is
    // under test is a length check and a stub that lied about its own size
    // would be testing the stub.
    stubFetch(okResponse(new Uint8Array(193 * 1024 * 1024)))
    await expect(openPullFromUrl('http://x/huge.mp4')).resolves.toBeNull()
  })

  it('reads a length header of null as unknown rather than as zero', async () => {
    stubDecoder()
    // A server that declares nothing must not be refused outright — it falls
    // through to the read-length check. Proof that it got that far is the body
    // having been read at all.
    const s = stubFetch(okResponse(Uint8Array.from([0, 0, 0, 0])))
    await expect(openPullFromUrl('http://x/small.bin')).resolves.toBeNull()
    expect(s.arrayBuffer).toHaveBeenCalledTimes(1)
  })

  it('declines when the browser has no decoder at all', async () => {
    // No `stubDecoder`, which is a browser without WebCodecs — and the answer
    // has to be the element rather than an exception.
    const s = stubFetch(okResponse(Uint8Array.from([0, 0, 0, 0])))
    await expect(openPullFromUrl('http://x/clip.mp4')).resolves.toBeNull()
    expect(s.fetch).toHaveBeenCalledTimes(1)
  })
})
