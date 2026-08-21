import { describe, expect, it } from 'vitest'

import {
  FETCH_START,
  MAX_SECONDS,
  contentType,
  fetchProgress,
  isFetchable,
  readFetchLine,
  seconds,
} from './vite-plugin-ytdlp'

// The endpoint shells out to yt-dlp, and yt-dlp reaches far past YouTube, so
// the guard is the scheme rather than a host list: a web address is fair game,
// anything that could name a local path or arrive as a flag is not.
describe('isFetchable', () => {
  it('accepts http(s) URLs, whoever hosts them', () => {
    for (const u of [
      'https://www.youtube.com/watch?v=x',
      'https://youtu.be/x',
      'https://vimeo.com/123456',
      'https://archive.org/details/some-reel',
      'http://example.com/clip.mp4',
    ]) {
      expect(isFetchable(u)).toBe(true)
    }
  })
  it('rejects schemes that are not the web', () => {
    for (const u of [
      'file:///etc/passwd',
      'ftp://example.com/clip.mp4',
      'data:video/mp4;base64,AAAA',
      '--config-location',
    ]) {
      expect(isFetchable(u)).toBe(false)
    }
  })
  it('rejects malformed input without throwing', () => {
    expect(isFetchable('not a url')).toBe(false)
    expect(isFetchable('')).toBe(false)
  })
})

// yt-dlp picks the container once arbitrary sites are in scope, and the app
// plays the reply off a blob url, so the served type has to follow the file.
describe('contentType', () => {
  it('follows the extension yt-dlp wrote', () => {
    expect(contentType('/tmp/x/abc.mp4')).toBe('video/mp4')
    expect(contentType('/tmp/x/abc.webm')).toBe('video/webm')
    expect(contentType('/tmp/x/abc.mkv')).toBe('video/x-matroska')
    expect(contentType('/tmp/x/abc.MOV')).toBe('video/quicktime')
  })
  it('falls back to mp4, which is what the format selector asked for', () => {
    expect(contentType('/tmp/x/abc.weird')).toBe('video/mp4')
    expect(contentType('/tmp/x/abc')).toBe('video/mp4')
  })
})

// The range is a request the caller makes, so what arrives is a query string
// somebody could have typed: 0 means the whole clip and so does nonsense.
describe('seconds', () => {
  it('takes a positive whole number of seconds', () => {
    expect(seconds('180')).toBe(180)
    expect(seconds('90.7')).toBe(90)
  })
  it('reads anything else as the whole clip', () => {
    expect(seconds(null)).toBe(0)
    expect(seconds('')).toBe(0)
    expect(seconds('0')).toBe(0)
    expect(seconds('-30')).toBe(0)
    expect(seconds('soon')).toBe(0)
  })
  it('caps a range that would be the whole thing anyway', () => {
    expect(seconds('999999')).toBe(MAX_SECONDS)
  })
})

// The caption is drawn from these numbers, so the property that matters is that
// they never go backwards — a merge downloads two streams, each counting up
// from zero, and the pair has to read as one fetch.
const run = (lines: readonly string[]) =>
  fetchProgress(lines.reduce(readFetchLine, FETCH_START))

describe('readFetchLine', () => {
  it('reads bytes so far against the total', () => {
    expect(run(['ntscjs downloading 1024 4096'])).toEqual({
      loaded: 1024,
      total: 4096,
      stage: 'downloading',
    })
  })
  it('carries a finished stream into the next one', () => {
    expect(
      run([
        'ntscjs downloading 2048 4096',
        'ntscjs finished 4096 4096',
        'ntscjs downloading 100 500',
      ]),
    ).toEqual({ loaded: 4196, total: 4596, stage: 'downloading' })
  })
  it('reports no total where yt-dlp has none to give', () => {
    expect(run(['ntscjs downloading 1024 NA'])).toEqual({
      loaded: 1024,
      total: 0,
      stage: 'downloading',
    })
  })
  it('reads a finished stream as complete rather than as unknown', () => {
    expect(
      run(['ntscjs downloading 2048 4096', 'ntscjs finished 4096 4096']),
    ).toEqual({ loaded: 4096, total: 4096, stage: 'downloading' })
  })
  it('follows the fetch into the merge, which reports no bytes', () => {
    const merged = run([
      'ntscjs finished 4096 4096',
      '[Merger] Merging formats into "abc.mp4"',
    ])
    expect(merged.stage).toBe('merging')
    expect(merged.loaded).toBe(4096)
  })
  it('ignores everything else yt-dlp says', () => {
    expect(
      run([
        '[youtube] abc: Downloading webpage',
        'ntscjs downloading 10 20',
        '[info] abc: Downloading 1 format(s): 18',
        '',
      ]),
    ).toEqual({ loaded: 10, total: 20, stage: 'downloading' })
  })
})
