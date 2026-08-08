import { describe, expect, it } from 'vitest'

import { COMMONS_IDS } from '../sources/commons'
import {
  FAVORITE_LIMIT,
  dropFavorite,
  favoriteGroups,
  favoriteLabel,
  favoriteOf,
  isStarred,
  readFavorites,
  toggleFavorite,
} from './wikiFavorites'

import type { WikiFavorite } from './wikiFavorites'

// The list is hand-editable localStorage and the only identity a favourite has is
// its title, which is also what gets handed to the API — so everything below is
// either "the same title twice cannot happen" or "a stored blob cannot become a
// request".

const fave = (
  title: string,
  channel: WikiFavorite['channel'] = 'wiki-vapor',
) => ({
  title,
  kind: 'photo' as const,
  channel,
})

const pick = (title: string) => ({
  title,
  url: 'https://upload/x.jpg',
  kind: 'photo' as const,
  page: 'https://commons/x',
})

describe('toggleFavorite', () => {
  it('stars what is not starred, newest first', () => {
    const one = toggleFavorite([], fave('File:a.jpg'))
    const two = toggleFavorite(one, fave('File:b.jpg'))
    expect(two.map(f => f.title)).toEqual(['File:b.jpg', 'File:a.jpg'])
  })

  it('unstars what is', () => {
    const list = [fave('File:a.jpg'), fave('File:b.jpg')]
    expect(toggleFavorite(list, fave('File:a.jpg')).map(f => f.title)).toEqual([
      'File:b.jpg',
    ])
  })

  // The same file rolled again out of a channel is the same favourite, whatever
  // else came back with it — the pick is a fresh resolve and carries a fresh
  // thumbnail url, and if that counted as a difference a re-roll would unstar
  // nothing and stack a duplicate instead.
  it('keys on the title alone, so a re-resolved pick toggles the same row', () => {
    const list = toggleFavorite(
      [],
      favoriteOf(pick('File:a.jpg'), 'wiki-retro'),
    )
    expect(
      toggleFavorite(list, favoriteOf(pick('File:a.jpg'), 'wiki-nature')),
    ).toEqual([])
  })

  it('holds the limit by dropping the oldest', () => {
    let list: WikiFavorite[] = []
    for (let i = 0; i < FAVORITE_LIMIT + 5; i += 1)
      list = toggleFavorite(list, fave(`File:${i}.jpg`))
    expect(list).toHaveLength(FAVORITE_LIMIT)
    expect(list[0].title).toBe(`File:${FAVORITE_LIMIT + 4}.jpg`)
    expect(isStarred(list, 'File:0.jpg')).toBe(false)
  })
})

describe('dropFavorite', () => {
  it('takes one row out and leaves the rest in order', () => {
    const list = [fave('File:a.jpg'), fave('File:b.jpg'), fave('File:c.jpg')]
    expect(dropFavorite(list, 'File:b.jpg').map(f => f.title)).toEqual([
      'File:a.jpg',
      'File:c.jpg',
    ])
  })

  it('is a no-op for a title that is not there', () => {
    expect(dropFavorite([fave('File:a.jpg')], 'File:z.jpg')).toHaveLength(1)
  })
})

describe('readFavorites', () => {
  it('takes a stored list back', () => {
    expect(
      readFavorites([
        { title: 'File:a.webm', kind: 'video', channel: 'wiki-timelapse' },
      ]),
    ).toEqual([
      { title: 'File:a.webm', kind: 'video', channel: 'wiki-timelapse' },
    ])
  })

  it('drops entries that could not be asked for or drawn', () => {
    expect(
      readFavorites([
        null,
        'File:a.jpg',
        { kind: 'photo' },
        { title: '', kind: 'photo' },
        { title: 'File:a.jpg' },
        { title: 'File:a.jpg', kind: 'audio' },
      ]),
    ).toEqual([])
  })

  it('reads anything that is not a list as an empty shelf', () => {
    expect(readFavorites(undefined)).toEqual([])
    expect(readFavorites({ title: 'File:a.jpg' })).toEqual([])
  })

  // A retired channel must not cost the star: the file is still on Commons and
  // still playable, and all that changes is which heading it sits under.
  it('keeps a favourite whose channel is no longer offered', () => {
    expect(
      readFavorites([
        { title: 'File:a.jpg', kind: 'photo', channel: 'wiki-gone' },
      ]),
    ).toEqual([{ title: 'File:a.jpg', kind: 'photo', channel: '' }])
  })

  // Two rows of one title would leave a star that cannot be cleared: the toggle
  // removes by title and the survivor would still be drawn as starred.
  it('de-duplicates a hand-edited list', () => {
    const list = readFavorites([
      { title: 'File:a.jpg', kind: 'photo', channel: 'wiki-vapor' },
      { title: 'File:a.jpg', kind: 'video', channel: 'wiki-retro' },
    ])
    expect(list).toHaveLength(1)
    expect(list[0].kind).toBe('photo')
  })
})

describe('favoriteGroups', () => {
  it('groups by channel, in the order the picker offers them', () => {
    const groups = favoriteGroups([
      fave('File:a.jpg', 'wiki-people'),
      fave('File:b.jpg', 'wiki-retro'),
      fave('File:c.jpg', 'wiki-people'),
    ])
    expect(groups.map(g => g.channel)).toEqual(
      COMMONS_IDS.filter(id => id === 'wiki-retro' || id === 'wiki-people'),
    )
    expect(groups.map(g => g.items.length)).toEqual([1, 2])
  })

  it('leaves out a channel nothing was starred from', () => {
    expect(favoriteGroups([fave('File:a.jpg', 'wiki-vapor')])).toHaveLength(1)
    expect(favoriteGroups([])).toEqual([])
  })

  it('gathers the channel-less into one group at the end', () => {
    const groups = favoriteGroups([
      fave('File:a.jpg', ''),
      fave('File:b.jpg', 'wiki-vapor'),
    ])
    expect(groups.map(g => g.channel)).toEqual(['wiki-vapor', ''])
  })

  it('names each group without repeating the word Commons', () => {
    for (const group of favoriteGroups(
      COMMONS_IDS.map(id => fave(`File:${id}.jpg`, id)),
    ))
      expect(group.label).not.toContain('Commons')
  })
})

describe('favoriteLabel', () => {
  it('reads as the caption a roll shows', () => {
    expect(favoriteLabel(fave('File:Sunset over Logan Square.jpg'))).toBe(
      'Sunset over Logan Square',
    )
  })

  // The extension is what used to say "this one moves", and stripping it takes
  // that with it.
  it('marks a clip, since the stripped name no longer says so', () => {
    expect(
      favoriteLabel({
        title: 'File:Clouds.webm',
        kind: 'video',
        channel: 'wiki-timelapse',
      }),
    ).toBe('▶ Clouds')
  })
})
