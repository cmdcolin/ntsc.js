import { describe, expect, it } from 'vitest'

import { WHOLE_CLIP, packClipRef, rangeLabel, unpackClipRef } from './ytdlp'

// A shelf entry has one identity field, so a trimmed clip has to carry its range
// inside it — and read back as the same pair, since that is what clicking the
// row fetches.
describe('shelf refs', () => {
  it('round-trips a whole clip as the bare url', () => {
    const url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
    expect(packClipRef(url, WHOLE_CLIP)).toBe(url)
    expect(unpackClipRef(url)).toEqual({ url, secs: WHOLE_CLIP })
  })
  it('round-trips a range', () => {
    const url = 'https://vimeo.com/76979871'
    const ref = packClipRef(url, 180)
    expect(unpackClipRef(ref)).toEqual({ url, secs: 180 })
  })
  it('keeps the two apart, since they are different files', () => {
    const url = 'https://example.com/a.mp4'
    expect(packClipRef(url, 60)).not.toBe(packClipRef(url, WHOLE_CLIP))
  })
  it('reads a ref it did not write as a whole clip', () => {
    expect(unpackClipRef('https://example.com/a b.mp4')).toEqual({
      url: 'https://example.com/a b.mp4',
      secs: WHOLE_CLIP,
    })
  })
})

describe('rangeLabel', () => {
  it('names the offered ranges', () => {
    expect(rangeLabel(WHOLE_CLIP)).toBe('whole clip')
    expect(rangeLabel(180)).toBe('first 3 minutes')
  })
  it('says what an unoffered one is', () => {
    expect(rangeLabel(45)).toBe('first 45s')
  })
})
