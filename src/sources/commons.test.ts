import { describe, expect, it } from 'vitest'

import { rngFor } from '../core/rng'
import {
  COMMONS_POOLS,
  choosePick,
  commonsCaption,
  commonsPageUrl,
  rollPlan,
  stillFrom,
  videoFrom,
} from './commons'
import { SOURCE_B_MODES, SOURCE_KIND, SOURCE_MODES } from './modes'

// The API hands back arbitrary JSON from another origin, and the reason these
// readers exist is that the search generator does not honour the filters
// perfectly — `filetype:bitmap` still lets the odd TIFF through, and `deepcat:`
// wanders into files whose transcodes were never rendered. Everything below is
// a shape that actually came back from commons.wikimedia.org.

describe('stillFrom', () => {
  const page = (info: Record<string, unknown>) => ({
    title: 'File:Ciceron Vaux.jpg',
    imageinfo: [info],
  })

  it('prefers the capped thumbnail over the original', () => {
    const got = stillFrom(
      page({
        mime: 'image/jpeg',
        url: 'https://upload.wikimedia.org/original.jpg',
        thumburl: 'https://upload.wikimedia.org/thumb/1024px-x.jpg',
        width: 2336,
        height: 3504,
      }),
    )
    expect(got?.url).toBe('https://upload.wikimedia.org/thumb/1024px-x.jpg')
    expect(got?.kind).toBe('photo')
  })

  // The thumbnailer returns no thumburl when the file is already smaller than
  // the requested width, and then the original *is* the capped version.
  it('falls back to the file when it was already small enough', () => {
    const got = stillFrom(
      page({
        mime: 'image/png',
        url: 'https://upload.wikimedia.org/small.png',
        width: 800,
        height: 600,
      }),
    )
    expect(got?.url).toBe('https://upload.wikimedia.org/small.png')
  })

  // A TIFF landed in a live sample of random namespace-6 files. Browsers do not
  // decode it, so it has to be dropped here rather than fail at createImageBitmap.
  it.each(['image/tiff', 'application/pdf', 'audio/wav', 'video/webm'])(
    'drops %s, which no <img> path can decode',
    mime => {
      expect(
        stillFrom(page({ mime, url: 'https://upload.wikimedia.org/x' })),
      ).toBeNull()
    },
  )

  it('drops a page the generator returned with no imageinfo at all', () => {
    expect(stillFrom({ title: 'File:x.jpg' })).toBeNull()
    expect(stillFrom({ title: 'File:x.jpg', imageinfo: [] })).toBeNull()
    expect(
      stillFrom({ imageinfo: [{ mime: 'image/jpeg', url: 'u' }] }),
    ).toBeNull()
  })
})

describe('videoFrom', () => {
  // The real derivative list for File:Big Buck Bunny 4K.webm, whose original is
  // a 2.9 GB 4000x2250 master — the case that makes taking the original wrong.
  const bigBuckBunny = {
    title: 'File:Big Buck Bunny 4K.webm',
    videoinfo: [
      {
        duration: 634.553,
        derivatives: [
          {
            src: 'https://upload.wikimedia.org/original.webm',
            type: 'video/webm; codecs="vp8, vorbis"',
            width: 4000,
            height: 2250,
          },
          {
            src: 'https://upload.wikimedia.org/240p.vp9.webm',
            transcodekey: '240p.vp9.webm',
            width: 426,
            height: 240,
          },
          {
            src: 'https://upload.wikimedia.org/480p.vp9.webm',
            transcodekey: '480p.vp9.webm',
            width: 854,
            height: 480,
          },
          {
            src: 'https://upload.wikimedia.org/1080p.vp9.webm',
            transcodekey: '1080p.vp9.webm',
            width: 1920,
            height: 1080,
          },
        ],
      },
    ],
  }

  it('takes the largest transcode inside the height cap', () => {
    const got = videoFrom(bigBuckBunny)
    expect(got?.url).toBe('https://upload.wikimedia.org/480p.vp9.webm')
    expect(got?.kind).toBe('video')
  })

  // The entry with no transcodekey is the original repeated back. Taking it is
  // the whole failure this filter exists to prevent.
  it('never takes the original, even when nothing else is offered', () => {
    expect(
      videoFrom({
        title: 'File:x.webm',
        videoinfo: [
          {
            duration: 10,
            derivatives: [
              {
                src: 'https://upload.wikimedia.org/original.webm',
                width: 320,
                height: 240,
              },
            ],
          },
        ],
      }),
    ).toBeNull()
  })

  // A 360p.mpeg4.mov derivative is offered for some files; it is inside the
  // height cap and still not something to hand a <video> when VP9 exists.
  it('ignores non-VP9 renditions inside the cap', () => {
    const got = videoFrom({
      title: 'File:x.webm',
      videoinfo: [
        {
          duration: 30,
          derivatives: [
            {
              src: 'https://upload.wikimedia.org/360p.mov',
              transcodekey: '360p.mpeg4.mov',
              width: 640,
              height: 360,
            },
            {
              src: 'https://upload.wikimedia.org/240p.vp9.webm',
              transcodekey: '240p.vp9.webm',
              width: 426,
              height: 240,
            },
          ],
        },
      ],
    })
    expect(got?.url).toBe('https://upload.wikimedia.org/240p.vp9.webm')
  })

  it('drops a lecture-length file whatever its transcodes', () => {
    expect(
      videoFrom({
        ...bigBuckBunny,
        videoinfo: [{ ...bigBuckBunny.videoinfo[0], duration: 90 * 60 }],
      }),
    ).toBeNull()
  })

  it('drops a file whose transcodes were never rendered', () => {
    expect(
      videoFrom({ title: 'File:x.webm', videoinfo: [{ duration: 5 }] }),
    ).toBeNull()
  })
})

// The credit has to survive being reduced to a title, since that is all a
// favourite keeps: the page url is derived, not fetched.
describe('the page a pick leads to', () => {
  it('takes the descriptionurl the API gave', () => {
    const got = stillFrom({
      title: 'File:x.jpg',
      imageinfo: [
        {
          mime: 'image/jpeg',
          url: 'https://upload.wikimedia.org/x.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
        },
      ],
    })
    expect(got?.page).toBe('https://commons.wikimedia.org/wiki/File:X.jpg')
  })

  it('builds one from the title when the API left it out', () => {
    const got = stillFrom({
      title: 'File:Warsaw Royal Castle GM (2).JPG',
      imageinfo: [{ mime: 'image/jpeg', url: 'https://upload/x.jpg' }],
    })
    expect(got?.page).toBe(
      'https://commons.wikimedia.org/wiki/File%3AWarsaw_Royal_Castle_GM_(2).JPG',
    )
  })

  it('escapes a title that would otherwise change the path', () => {
    expect(commonsPageUrl('File:A/B & C.jpg')).toBe(
      'https://commons.wikimedia.org/wiki/File%3AA%2FB_%26_C.jpg',
    )
  })
})

describe('choosePick', () => {
  const pick = (title: string) => ({
    title,
    url: `https://upload/${title}`,
    kind: 'photo' as const,
    page: 'https://commons/x',
    origin: 'commons' as const,
    owned: false,
  })

  it('never hands back the one that is already up', () => {
    const got = choosePick(
      [pick('File:a.jpg'), pick('File:b.jpg')],
      'File:a.jpg',
    )
    expect(got?.title).toBe('File:b.jpg')
  })

  // A pool that has genuinely narrowed to one file is not a failure to roll: the
  // same picture again beats a banner saying nothing came back.
  it('yields when the only candidate is the one to avoid', () => {
    expect(choosePick([pick('File:a.jpg')], 'File:a.jpg')?.title).toBe(
      'File:a.jpg',
    )
  })

  it('reads an empty page of candidates as nothing', () => {
    expect(choosePick([], '')).toBeNull()
  })

  // The seam docs/EDITOR.md › _Seeding_ asks for. It cannot promise the same
  // *file* — `gsrsort=random` means the twelve candidates are Commons' choice,
  // not this app's — but which of the twelve gets taken has to be reproducible,
  // because that is the decision a take replays.
  it('takes the same candidate from the same seed', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e'].map(t => pick(`File:${t}.jpg`))
    const once = choosePick(candidates, '', rngFor(7))
    const again = choosePick(candidates, '', rngFor(7))
    expect(once?.title).toBe(again?.title)
  })
})

describe('rollPlan', () => {
  // The retry has to be a *different* pool, because the failure it exists for —
  // a category whose files have no usable renditions — does not go away when the
  // same query is asked twice.
  it('starts where the roll said and moves on', () => {
    expect(rollPlan(['a', 'b', 'c'], 1)).toEqual(['b', 'c'])
    expect(rollPlan(['a', 'b', 'c'], 2)).toEqual(['c', 'a'])
  })

  it('spends the same number of requests wherever it starts', () => {
    for (let i = 0; i < COMMONS_POOLS.length; i += 1)
      expect(rollPlan(COMMONS_POOLS, i)).toHaveLength(2)
  })
})

describe('commonsCaption', () => {
  it.each([
    ['File:Sunset over Logan Square.webm', 'Sunset over Logan Square'],
    ['File:Warsaw Royal Castle GM (2).JPG', 'Warsaw Royal Castle GM (2)'],
    ["File:Busto di Beatrice d'Este 16.png", "Busto di Beatrice d'Este 16"],
  ])('%s reads as %s', (title, want) => {
    expect(commonsCaption(title)).toBe(want)
  })
})

describe('pools', () => {
  // One picker entry, not one per pool. The pools are what a roll draws from and
  // what the browser dialog offers as presets; neither of those is a source
  // mode, and eleven of them used to be.
  it('offers one random entry on both slots, banded with the archives', () => {
    for (const modes of [SOURCE_MODES, SOURCE_B_MODES])
      expect(modes).toContain('wiki-random')
    expect(SOURCE_KIND['wiki-random']).toBe('pool')
  })

  // Without filetype:bitmap a photo pool starts returning PDFs and the audio
  // pronunciation clips that make up a tenth of namespace 6 — stillFrom drops
  // them, but only after a request has been spent rolling nothing.
  it('constrains every photo pool to bitmaps', () => {
    for (const pool of COMMONS_POOLS) {
      if (pool.kind !== 'photo') continue
      expect(pool.query, pool.label).toContain('filetype:bitmap')
    }
  })

  it('gives every pool a label and a query', () => {
    for (const pool of COMMONS_POOLS) {
      expect(pool.label.length).toBeGreaterThan(0)
      expect(pool.query.length).toBeGreaterThan(0)
    }
  })

  // The flattening was worth doing partly because the nested version weighted
  // three queries double — they appeared in two "channels" each, and a roll
  // picked a channel first. A duplicate here would put that back.
  it('holds each query once, so every pool rolls at the same weight', () => {
    const queries = COMMONS_POOLS.map(p => `${p.kind}\n${p.query}`)
    expect(new Set(queries).size).toBe(queries.length)
  })

  it('names each pool once, so the browser has no two buttons alike', () => {
    const labels = COMMONS_POOLS.map(p => p.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  // Both kinds in one entry, which is new: a roll used to be a still *or* a clip
  // according to which of seven channels was picked, and there is one now.
  it('rolls stills and clips out of the same entry', () => {
    const kinds = new Set(COMMONS_POOLS.map(p => p.kind))
    expect(kinds).toEqual(new Set(['photo', 'video']))
  })
})
