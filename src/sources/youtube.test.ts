import { describe, expect, it } from 'vitest'
import { ytId } from './youtube'

describe('ytId', () => {
  it('reads the v= param from a watch URL', () => {
    expect(ytId('https://www.youtube.com/watch?v=aqz-KE-bpKQ')).toBe(
      'aqz-KE-bpKQ',
    )
  })
  it('reads v= regardless of param position', () => {
    expect(ytId('https://youtube.com/watch?list=xyz&v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
  })
  it('reads the id from a youtu.be short link', () => {
    expect(ytId('https://youtu.be/aqz-KE-bpKQ?t=42')).toBe('aqz-KE-bpKQ')
  })
  it('falls back to the raw string when no id is present', () => {
    expect(ytId('not a url')).toBe('not a url')
  })
})
