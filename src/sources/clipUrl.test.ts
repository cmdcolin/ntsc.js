import { describe, expect, it } from 'vitest'

import { clipLabel } from './clipUrl'

describe('clipLabel', () => {
  it('reads the v= param from a watch URL', () => {
    expect(clipLabel('https://www.youtube.com/watch?v=aqz-KE-bpKQ')).toBe(
      'aqz-KE-bpKQ',
    )
  })
  it('reads v= regardless of param position', () => {
    expect(clipLabel('https://youtube.com/watch?list=xyz&v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
  })
  it('reads the id from a youtu.be short link', () => {
    expect(clipLabel('https://youtu.be/aqz-KE-bpKQ?t=42')).toBe('aqz-KE-bpKQ')
  })
  it('names other sites by host and last path segment', () => {
    expect(clipLabel('https://vimeo.com/76979871')).toBe('vimeo.com/76979871')
    expect(clipLabel('https://archive.org/details/some-reel/')).toBe(
      'archive.org/some-reel',
    )
    expect(clipLabel('https://example.com')).toBe('example.com')
  })
  it('leaves a v= param on another site alone', () => {
    expect(clipLabel('https://example.com/play?v=notyoutube')).toBe(
      'example.com/play',
    )
  })
  it('falls back to the raw string when no id is present', () => {
    expect(clipLabel('not a url')).toBe('not a url')
  })
})
