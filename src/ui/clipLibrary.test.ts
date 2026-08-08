import { describe, expect, it } from 'vitest'

import {
  CLIP_LIMIT,
  EMPTY_LIBRARY,
  addClips,
  addFolder,
  clipKey,
  dropClip,
  dropFolder,
  filterLibrary,
  groupPicked,
  libraryGroups,
  matchPicked,
  readLibrary,
  syncFolder,
} from './clipLibrary'

import type { Library } from './clipLibrary'

// The list algebra above `── the store ──`, which is where every way the shelf
// can go wrong lives: an id minted twice keys two rows onto one IndexedDB
// record, a re-pick that fails to recognise what is already there doubles the
// list, and a re-link that matches the wrong file plays *another clip's*
// footage under the name you clicked. None of that needs a browser to test.

// A library built by putting names through the real adder, so ids and `seq`
// are whatever the code actually mints rather than what a fixture claims.
const shelf = (
  folders: readonly { name: string; files: readonly string[] }[],
  loose: readonly { name: string; size: number }[] = [],
): Library => {
  let lib = EMPTY_LIBRARY
  for (const f of folders) {
    const made = addFolder(lib, f.name)
    lib = syncFolder(made.lib, made.folder.id, f.files).lib
  }
  return addClips(lib, '', loose).lib
}

const names = (lib: Library): string[] => lib.clips.map(c => c.name)

describe('clipKey', () => {
  it('is the name alone inside a folder', () => {
    // A folder cannot hold two files of one name, so the name is identity —
    // which is what lets a rescan recognise every clip it already has.
    expect(clipKey({ name: 'a.mp4', folder: 'f1', size: 0 })).toBe(
      clipKey({ name: 'a.mp4', folder: 'f1', size: 4096 }),
    )
  })

  it('separates the same name in two folders', () => {
    expect(clipKey({ name: '01.mp4', folder: 'f1', size: 0 })).not.toBe(
      clipKey({ name: '01.mp4', folder: 'f2', size: 0 }),
    )
  })

  it('takes the size in for a loose pick, which has no folder to be unique in', () => {
    expect(clipKey({ name: '01.mp4', folder: '', size: 10 })).not.toBe(
      clipKey({ name: '01.mp4', folder: '', size: 11 }),
    )
  })
})

describe('addClips', () => {
  it('mints ids that are unique across folders and loose picks alike', () => {
    const lib = shelf(
      [
        { name: 'rips', files: ['a.mp4', 'b.mp4'] },
        { name: 'more', files: ['a.mp4'] },
      ],
      [{ name: 'c.mp4', size: 1 }],
    )
    const ids = lib.clips.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    // Folder ids come out of the same counter, so nothing can collide with a
    // clip's IndexedDB record either.
    expect(new Set([...ids, ...lib.folders.map(f => f.id)]).size).toBe(
      ids.length + 2,
    )
  })

  it('skips what the app cannot open', () => {
    const grown = addClips(EMPTY_LIBRARY, '', [
      { name: 'a.mp4', size: 0 },
      { name: 'a.srt', size: 0 },
      { name: '.DS_Store', size: 0 },
      { name: 'poster.png', size: 0 },
    ])
    expect(names(grown.lib)).toEqual(['a.mp4', 'poster.png'])
    expect(grown.lib.clips.map(c => c.kind)).toEqual(['video', 'image'])
  })

  it('pairs each addition with its index in the pick', () => {
    // The caller holds the File or the handle that goes with each entry and has
    // no other way back to the pairing — get this wrong and a clip is stored
    // under its neighbour's handle.
    const grown = addClips(EMPTY_LIBRARY, '', [
      { name: 'notes.txt', size: 0 },
      { name: 'a.mp4', size: 1 },
      { name: 'thumb.tiff', size: 0 },
      { name: 'b.mp4', size: 2 },
    ])
    expect(grown.added.map(a => [a.clip.name, a.at])).toEqual([
      ['a.mp4', 1],
      ['b.mp4', 3],
    ])
  })

  it('recognises what is already on the shelf rather than adding it twice', () => {
    const lib = shelf([{ name: 'rips', files: ['a.mp4'] }])
    const folder = lib.folders[0].id
    const again = addClips(lib, folder, [
      { name: 'a.mp4', size: 0 },
      { name: 'b.mp4', size: 0 },
    ])
    expect(again.added.map(a => a.clip.name)).toEqual(['b.mp4'])
    expect(names(again.lib)).toEqual(['a.mp4', 'b.mp4'])
  })

  it('stops at the limit and says how much it refused', () => {
    // A home directory picked by mistake is the case this exists for: the
    // refusal has to be counted, because "nothing happened" and "four hundred
    // clips did not fit" look identical from the dialog otherwise.
    const many = Array.from({ length: CLIP_LIMIT + 5 }, (_, i) => ({
      name: `${i}.mp4`,
      size: 0,
    }))
    const grown = addClips(EMPTY_LIBRARY, 'f1', many)
    expect(grown.lib.clips.length).toBe(CLIP_LIMIT)
    expect(grown.dropped).toBe(5)
  })
})

describe('addFolder', () => {
  it('lands on the existing entry when the same folder is picked again', () => {
    // Re-picking is the ordinary way to rescan on a browser with no directory
    // handle to keep, so a second pick that minted a second folder would double
    // the whole shelf on every reconnect.
    const first = addFolder(EMPTY_LIBRARY, 'rips')
    const second = addFolder(first.lib, 'rips')
    expect(second.folder.id).toBe(first.folder.id)
    expect(second.lib.folders.length).toBe(1)
  })
})

describe('syncFolder', () => {
  it('adds what appeared and drops what has gone', () => {
    const lib = shelf([{ name: 'rips', files: ['a.mp4', 'b.mp4'] }])
    const folder = lib.folders[0].id
    const synced = syncFolder(lib, folder, ['a.mp4', 'c.mp4'])
    expect(names(synced.lib)).toEqual(['a.mp4', 'c.mp4'])
    expect(synced.added).toBe(1)
    expect(synced.gone).toBe(1)
  })

  it('leaves every other folder and the loose picks alone', () => {
    const lib = shelf(
      [
        { name: 'rips', files: ['a.mp4'] },
        { name: 'more', files: ['b.mp4'] },
      ],
      [{ name: 'c.mp4', size: 3 }],
    )
    const synced = syncFolder(lib, lib.folders[0].id, [])
    expect(names(synced.lib).toSorted()).toEqual(['b.mp4', 'c.mp4'])
    expect(synced.gone).toBe(1)
  })

  it('keeps an id stable across a rescan that dropped its neighbour', () => {
    // The id keys the stored handle, so a rescan that renumbered would point a
    // surviving row at a record that is no longer its own.
    const lib = shelf([{ name: 'rips', files: ['a.mp4', 'b.mp4'] }])
    const before = lib.clips.find(c => c.name === 'b.mp4')?.id
    const synced = syncFolder(lib, lib.folders[0].id, ['b.mp4'])
    expect(synced.lib.clips.find(c => c.name === 'b.mp4')?.id).toBe(before)
  })
})

describe('libraryGroups', () => {
  it('puts each folder with what is under it, loose picks last', () => {
    const lib = shelf(
      [{ name: 'rips', files: ['a.mp4'] }],
      [{ name: 'c.mp4', size: 3 }],
    )
    const groups = libraryGroups(lib)
    expect(groups.map(g => g.folder?.name ?? null)).toEqual(['rips', null])
    expect(groups[1].clips.map(c => c.name)).toEqual(['c.mp4'])
  })

  it('offers no loose group when there is nothing loose', () => {
    expect(libraryGroups(shelf([{ name: 'rips', files: ['a.mp4'] }]))).toEqual([
      expect.objectContaining({
        folder: expect.objectContaining({ name: 'rips' }),
      }),
    ])
  })

  it('shows a clip whose folder has gone rather than losing it', () => {
    // The shelf is hand-editable localStorage. A row you can see and delete
    // beats a row that is silently not drawn.
    const lib = shelf([{ name: 'rips', files: ['a.mp4'] }])
    const orphaned: Library = { ...lib, folders: [] }
    const groups = libraryGroups(orphaned)
    expect(groups.map(g => g.folder)).toEqual([null])
    expect(groups[0].clips.map(c => c.name)).toEqual(['a.mp4'])
  })
})

describe('filterLibrary', () => {
  const lib = shelf(
    [
      { name: 'rips', files: ['01 opener.mp4', '02 bridge.mp4'] },
      { name: 'stock', files: ['02 bridge.mp4'] },
    ],
    [{ name: 'loose take.mp4', size: 7 }],
  )

  it('gives the shelf back untouched for an empty query', () => {
    expect(filterLibrary(lib, '   ')).toBe(lib)
  })

  it('matches on the folder name, so a folder narrows to itself', () => {
    const got = filterLibrary(lib, 'rips')
    expect(names(got)).toEqual(['01 opener.mp4', '02 bridge.mp4'])
    expect(got.folders.map(f => f.name)).toEqual(['rips'])
  })

  it('takes every term, across the folder and the name together', () => {
    expect(names(filterLibrary(lib, 'stock bridge'))).toEqual(['02 bridge.mp4'])
    expect(names(filterLibrary(lib, 'bridge'))).toEqual([
      '02 bridge.mp4',
      '02 bridge.mp4',
    ])
  })

  it('ignores case', () => {
    expect(names(filterLibrary(lib, 'OPENER'))).toEqual(['01 opener.mp4'])
  })

  it('drops a folder left holding nothing rather than heading an empty group', () => {
    // libraryGroups draws a group per folder, so a folder kept without its
    // clips would be a heading with no rows under it — and one dropped while it
    // still had a match would spill those clips into "picked files".
    const got = filterLibrary(lib, 'opener')
    expect(got.folders.map(f => f.name)).toEqual(['rips'])
    expect(libraryGroups(got).map(g => g.folder?.name ?? null)).toEqual([
      'rips',
    ])
  })

  it('narrows to nothing when nothing matches', () => {
    const got = filterLibrary(lib, 'nowhere')
    expect(libraryGroups(got)).toEqual([])
  })

  it('keeps a loose clip that matches, under no folder', () => {
    const got = filterLibrary(lib, 'take')
    expect(libraryGroups(got).map(g => g.folder)).toEqual([null])
    expect(names(got)).toEqual(['loose take.mp4'])
  })
})

describe('matchPicked', () => {
  const picked = (
    files: readonly { name: string; path?: string; size?: number }[],
  ) => files.map(f => ({ name: f.name, path: f.path ?? '', size: f.size ?? 0 }))

  it('re-links by name', () => {
    const lib = shelf([{ name: 'rips', files: ['a.mp4', 'b.mp4'] }])
    const got = matchPicked(
      lib,
      picked([{ name: 'b.mp4', path: 'rips/b.mp4' }]),
    )
    expect(got).toEqual([{ id: lib.clips[1].id, at: 0 }])
  })

  it('prefers the file whose folder segment matches', () => {
    const lib = shelf([
      { name: 'rips', files: ['01.mp4'] },
      { name: 'more', files: ['01.mp4'] },
    ])
    const got = matchPicked(
      lib,
      picked([
        { name: '01.mp4', path: 'more/01.mp4' },
        { name: '01.mp4', path: 'rips/01.mp4' },
      ]),
    )
    // Each clip takes the file from its own folder, whichever order they came
    // out of the picker in.
    expect(got).toEqual([
      { id: lib.clips[0].id, at: 1 },
      { id: lib.clips[1].id, at: 0 },
    ])
  })

  it('breaks a tie on size for a loose pick', () => {
    const lib = shelf([], [{ name: '01.mp4', size: 90 }])
    const got = matchPicked(
      lib,
      picked([
        { name: '01.mp4', size: 10 },
        { name: '01.mp4', size: 90 },
      ]),
    )
    expect(got).toEqual([{ id: lib.clips[0].id, at: 1 }])
  })

  it('answers for at most one clip with each picked file', () => {
    // Two shelf entries of one name against a single file: re-linking both
    // would leave two rows opening the same footage under different names.
    const lib = shelf([
      { name: 'rips', files: ['01.mp4'] },
      { name: 'more', files: ['01.mp4'] },
    ])
    const got = matchPicked(lib, picked([{ name: '01.mp4' }]))
    expect(got.length).toBe(1)
  })

  it('says nothing about a name the pick does not carry', () => {
    const lib = shelf([{ name: 'rips', files: ['a.mp4'] }])
    expect(matchPicked(lib, picked([{ name: 'z.mp4' }]))).toEqual([])
  })
})

describe('groupPicked', () => {
  it('sorts a directory pick into the folder it came from', () => {
    expect(
      groupPicked([
        { name: 'a.mp4', path: 'rips/a.mp4' },
        { name: 'b.mp4', path: 'rips/b.mp4' },
      ]),
    ).toEqual([
      {
        folder: 'rips',
        files: [
          { name: 'a.mp4', path: 'rips/a.mp4' },
          { name: 'b.mp4', path: 'rips/b.mp4' },
        ],
      },
    ])
  })

  it('drops anything below the top level, as a directory handle would', () => {
    // The two ways into a folder have to agree about what it holds, or a
    // rescan on Chromium would delete the rows a Firefox pick added.
    expect(
      groupPicked([
        { name: 'a.mp4', path: 'rips/a.mp4' },
        { name: 'b.mp4', path: 'rips/2019/b.mp4' },
      ]).flatMap(g => g.files.map(f => f.name)),
    ).toEqual(['a.mp4'])
  })

  it('treats a file with no relative path as a loose pick', () => {
    expect(groupPicked([{ name: 'a.mp4', path: '' }])).toEqual([
      { folder: '', files: [{ name: 'a.mp4', path: '' }] },
    ])
  })
})

describe('readLibrary', () => {
  it('reads nothing out of anything', () => {
    for (const junk of [null, 'shelf', 42, [], {}, { clips: 'no' }])
      expect(readLibrary(junk)).toEqual(EMPTY_LIBRARY)
  })

  it('keeps the entries that are whole and drops the ones that are not', () => {
    const got = readLibrary({
      clips: [
        { id: 'c1', name: 'a.mp4', folder: '', kind: 'video', size: 1 },
        { id: 'c2', name: 'b.mp4', folder: '', kind: 'movie', size: 1 },
        { id: '', name: 'c.mp4', folder: '', kind: 'video', size: 1 },
        null,
      ],
      folders: [{ id: 'f1', name: 'rips' }, { name: 'nameless' }],
      seq: 2,
    })
    expect(names(got)).toEqual(['a.mp4'])
    expect(got.folders.map(f => f.id)).toEqual(['f1'])
  })

  it('outruns every id it read, whatever the stored counter claims', () => {
    // A rolled-back `seq` is the one corruption here that shows up as another
    // clip's footage playing: the next id minted would collide with a live
    // IndexedDB record.
    const got = readLibrary({
      clips: [{ id: 'c9', name: 'a.mp4', folder: '', kind: 'video', size: 1 }],
      folders: [{ id: 'f14', name: 'rips' }],
      seq: 1,
    })
    expect(got.seq).toBe(14)
    const grown = addClips(got, '', [{ name: 'b.mp4', size: 0 }])
    expect(grown.added[0].clip.id).toBe('c15')
  })
})

describe('dropping', () => {
  it('takes one clip off and leaves the rest', () => {
    const lib = shelf([{ name: 'rips', files: ['a.mp4', 'b.mp4'] }])
    expect(names(dropClip(lib, lib.clips[0].id))).toEqual(['b.mp4'])
  })

  it('takes a folder and everything under it, and nothing else', () => {
    const lib = shelf(
      [
        { name: 'rips', files: ['a.mp4'] },
        { name: 'more', files: ['b.mp4'] },
      ],
      [{ name: 'c.mp4', size: 3 }],
    )
    const next = dropFolder(lib, lib.folders[0].id)
    expect(names(next).toSorted()).toEqual(['b.mp4', 'c.mp4'])
    expect(next.folders.map(f => f.name)).toEqual(['more'])
  })
})
