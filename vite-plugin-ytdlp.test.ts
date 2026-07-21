import { describe, expect, it } from 'vitest'

import { isYouTube } from './vite-plugin-ytdlp'

// The endpoint shells out to yt-dlp, so the host allowlist is the guard that
// keeps it from being pointed at arbitrary URLs.
describe('isYouTube', () => {
  it('accepts youtube.com and its subdomains/variants', () => {
    for (const u of [
      'https://www.youtube.com/watch?v=x',
      'https://youtube.com/watch?v=x',
      'https://m.youtube.com/watch?v=x',
      'https://youtu.be/x',
      'https://www.youtube-nocookie.com/embed/x',
    ]) {
      expect(isYouTube(u)).toBe(true)
    }
  })
  it('rejects other hosts and lookalikes', () => {
    for (const u of [
      'https://evil.com/x',
      'https://youtube.com.evil.com/x',
      'https://notyoutube.com/x',
      'https://vimeo.com/x',
    ]) {
      expect(isYouTube(u)).toBe(false)
    }
  })
  it('rejects malformed input without throwing', () => {
    expect(isYouTube('not a url')).toBe(false)
    expect(isYouTube('')).toBe(false)
  })
})
