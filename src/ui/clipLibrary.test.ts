import { describe, expect, it } from 'vitest'

import {
  CLIP_LIMIT,
  EMPTY_LIBRARY,
  KEPT_LIMIT,
  addClips,
  addFolder,
  addPick,
  clipKey,
  clipRef,
  dropClip,
  dropFolder,
  dropPick,
  filterLibrary,
  groupPicked,
  hasPick,
  learnSeconds,
  libraryGroups,
  matchPicked,
  readLibrary,
  syncFolder,
} from './clipLibrary'

import type { PoolRef } from '../sources/pools'
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
    expect(
      clipKey({ name: 'a.mp4', folder: 'f1', size: 0, at: 'disk', ref: '' }),
    ).toBe(
      clipKey({ name: 'a.mp4', folder: 'f1', size: 4096, at: 'disk', ref: '' }),
    )
  })

  it('separates the same name in two folders', () => {
    expect(
      clipKey({ name: '01.mp4', folder: 'f1', size: 0, at: 'disk', ref: '' }),
    ).not.toBe(
      clipKey({ name: '01.mp4', folder: 'f2', size: 0, at: 'disk', ref: '' }),
    )
  })

  it('takes the size in for a loose pick, which has no folder to be unique in', () => {
    expect(
      clipKey({ name: '01.mp4', folder: '', size: 10, at: 'disk', ref: '' }),
    ).not.toBe(
      clipKey({ name: '01.mp4', folder: '', size: 11, at: 'disk', ref: '' }),
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

  it('counts what the limit turned away, like a fresh pick does', () => {
    // The one loss a rescan can suffer silently. scanFolder caps its own read
    // at CLIP_LIMIT, so this needs a shelf that is already partly full — which
    // is the ordinary state of one being rescanned. Swallowed, the note read
    // "N added" over a folder that had just lost most of itself.
    const full = Array.from({ length: CLIP_LIMIT - 1 }, (_, i) => `${i}.mp4`)
    const lib = shelf([
      { name: 'old', files: full },
      { name: 'rips', files: [] },
    ])
    const synced = syncFolder(lib, lib.folders[1].id, [
      'a.mp4',
      'b.mp4',
      'c.mp4',
    ])
    expect(synced.added).toBe(1)
    expect(synced.dropped).toBe(2)
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
        {
          id: 'c1',
          name: 'a.mp4',
          folder: '',
          kind: 'video',
          size: 1,
          at: 'disk',
          ref: '',
        },
        {
          id: 'c2',
          name: 'b.mp4',
          folder: '',
          kind: 'movie',
          size: 1,
          at: 'disk',
          ref: '',
        },
        {
          id: '',
          name: 'c.mp4',
          folder: '',
          kind: 'video',
          size: 1,
          at: 'disk',
          ref: '',
        },
        null,
      ],
      folders: [{ id: 'f1', name: 'rips' }, { name: 'nameless' }],
      seq: 2,
    })
    expect(names(got)).toEqual(['a.mp4'])
    expect(got.folders.map(f => f.id)).toEqual(['f1'])
  })

  // A kept roll is a title and where it came from, and a row missing either is
  // one the shelf cannot resolve — worse than absent, because it would spend a
  // request on whatever was there and fail with the archive's own error.
  it('drops a kept roll with nowhere to resolve to', () => {
    const got = readLibrary({
      clips: [
        {
          id: 'c1',
          name: 'Marble bust',
          folder: '',
          kind: 'image',
          size: 0,
          at: 'commons',
          ref: 'File:Bust.jpg',
        },
        {
          id: 'c2',
          name: 'no ref',
          folder: '',
          kind: 'image',
          size: 0,
          at: 'commons',
          ref: '',
        },
        {
          id: 'c3',
          name: 'no such archive',
          folder: '',
          kind: 'video',
          size: 0,
          at: 'youtube',
          ref: 'abc',
        },
      ],
      folders: [],
      seq: 3,
    })
    expect(names(got)).toEqual(['Marble bust'])
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

// A shelf entry that knows how long its clip runs, which is what makes a
// rundown of clips play at the lengths of its pictures rather than at a bar
// count somebody guessed.
describe('how long a clip runs', () => {
  const stored = (seconds: unknown) =>
    readLibrary({
      clips: [
        {
          id: 'c1',
          name: 'a.mp4',
          folder: '',
          kind: 'video',
          size: 1,
          at: 'disk',
          ref: '',
          seconds,
        },
      ],
      seq: 1,
    }).clips[0]

  it('arrives unmeasured, because measuring costs opening the file', () => {
    const added = addClips(EMPTY_LIBRARY, '', [{ name: 'a.mp4', size: 1 }])
    expect(added.lib.clips[0].seconds).toBe(0)
    // And a kept roll stays that way: measuring one means downloading the
    // whole file, so it keeps the bar-count fallback.
    expect(addPick(EMPTY_LIBRARY, ident, 'a clip').clip.seconds).toBe(0)
  })

  it('round-trips', () => {
    expect(stored(12.5).seconds).toBe(12.5)
  })

  // An entry written before the field existed is not a broken entry — it is an
  // ordinary one nobody has measured, which is the state a fresh one is in.
  it('reads an older entry as unmeasured rather than dropping it', () => {
    const got = readLibrary({
      clips: [
        {
          id: 'c1',
          name: 'a.mp4',
          folder: '',
          kind: 'video',
          size: 1,
          at: 'disk',
          ref: '',
        },
      ],
      seq: 1,
    })
    expect(got.clips.map(c => c.seconds)).toEqual([0])
  })

  // `duration` reads NaN before metadata lands and Infinity on a stream, and
  // either one through `holdFrames` is a row that never ends.
  it('refuses anything that is not a real length', () => {
    for (const bad of [0, -3, 'ages', null, Infinity, NaN])
      expect(stored(bad).seconds).toBe(0)
  })

  it('is learned once and then left alone', () => {
    const lib = addClips(EMPTY_LIBRARY, '', [{ name: 'a.mp4', size: 1 }]).lib
    const known = learnSeconds(lib, 'c1', 12)
    expect(known.clips[0].seconds).toBe(12)
    // A second measurement does not overwrite the first, and a shelf with
    // nothing to learn is the same object — this list is React state, and a new
    // one re-renders every row on it.
    expect(learnSeconds(known, 'c1', 30)).toBe(known)
    expect(learnSeconds(lib, 'c1', 0)).toBe(lib)
    expect(learnSeconds(lib, 'nobody', 12)).toBe(lib)
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

// ── kept rolls ───────────────────────────────────────────────────────────────
// The half of the shelf that is not on disk. It had a file of its own until the
// two were folded together, and what that file could not do — because it was
// written for Commons alone and keyed on a Commons title — was hold an
// archive.org clip. Everything below is that asymmetry being gone.

const bust: PoolRef = {
  origin: 'commons',
  title: 'File:Marble bust of Agrippa.jpg',
  kind: 'photo',
}
const ident: PoolRef = {
  origin: 'archive',
  title: 'gold-key-logo-1971',
  kind: 'video',
}

describe('addPick', () => {
  it('keeps a roll off either archive, with no bytes and no folder', () => {
    const lib = addPick(
      addPick(EMPTY_LIBRARY, bust, 'Agrippa').lib,
      ident,
      'gold key',
    ).lib
    expect(lib.clips.map(c => c.at)).toEqual(['archive', 'commons'])
    expect(lib.clips.every(c => c.folder === '' && c.size === 0)).toBe(true)
  })

  // Newest first: keeping one is a thing you do to what is on screen right now,
  // and the one you just kept is the one you are about to want.
  it('puts the newest at the top', () => {
    const lib = addPick(
      addPick(EMPTY_LIBRARY, bust, 'Agrippa').lib,
      ident,
      'gold key',
    ).lib
    expect(lib.clips[0].ref).toBe(ident.title)
  })

  // The ★ under the caption is a toggle and the browser's is a button; either
  // pressed twice must not shelve one file twice.
  it('recognises what it already holds', () => {
    const once = addPick(EMPTY_LIBRARY, bust, 'Agrippa').lib
    const twice = addPick(once, bust, 'Agrippa')
    expect(twice.lib.clips).toHaveLength(1)
    expect(twice.clip.id).toBe(once.clips[0].id)
  })

  // Nothing stops an archive.org identifier from reading like a Commons title,
  // and the two namespaces are unrelated.
  it('tells the same title on two archives apart', () => {
    const lib = addPick(
      addPick(EMPTY_LIBRARY, { ...bust, title: 'same' }, 'a').lib,
      { ...ident, title: 'same' },
      'b',
    ).lib
    expect(lib.clips).toHaveLength(2)
  })

  it('reads back as the ref it was given', () => {
    const lib = addPick(EMPTY_LIBRARY, bust, 'Agrippa').lib
    expect(clipRef(lib.clips[0])).toEqual(bust)
  })
})

describe('hasPick / dropPick', () => {
  const lib = addPick(EMPTY_LIBRARY, bust, 'Agrippa').lib

  it('answers what the ★ renders from', () => {
    expect(hasPick(lib, bust)).toBe(true)
    expect(hasPick(lib, ident)).toBe(false)
  })

  it('takes one off by what it is, not by which row holds it', () => {
    expect(hasPick(dropPick(lib, bust), bust)).toBe(false)
  })

  // A disk clip whose name happens to match must not answer for a kept roll —
  // `clipRef` is null for it, so it cannot be compared to one at all.
  it('never mistakes a file on disk for a kept roll', () => {
    const mixed = addClips(lib, '', [{ name: bust.title, size: 4 }]).lib
    expect(dropPick(mixed, bust).clips.map(c => c.at)).toEqual(['disk'])
  })
})

describe('libraryGroups with kept rolls', () => {
  it('puts each archive under its own heading, after the disk clips', () => {
    let lib = shelf([{ name: 'rips', files: ['a.mp4'] }])
    lib = addPick(lib, bust, 'Agrippa').lib
    lib = addPick(lib, ident, 'gold key').lib
    expect(libraryGroups(lib).map(g => g.id)).toEqual([
      lib.folders[0].id,
      'commons',
      'archive',
    ])
  })

  it('leaves out an archive nothing was kept from', () => {
    const lib = addPick(EMPTY_LIBRARY, bust, 'Agrippa').lib
    expect(libraryGroups(lib).map(g => g.id)).toEqual(['commons'])
  })
})

describe('filterLibrary with kept rolls', () => {
  let lib = shelf([{ name: 'rips', files: ['a.mp4'] }])
  lib = addPick(lib, bust, 'Marble bust of Agrippa').lib
  lib = addPick(lib, ident, 'gold key logo 1971').lib

  it('narrows on the caption', () => {
    expect(filterLibrary(lib, 'agrippa').clips.map(c => c.ref)).toEqual([
      bust.title,
    ])
  })

  // Where a clip lives is part of what it is called here, and for a kept roll
  // that is the archive rather than a folder.
  it('narrows on the archive it came from', () => {
    expect(filterLibrary(lib, 'archive.org').clips.map(c => c.ref)).toEqual([
      ident.title,
    ])
  })
})

describe('syncFolder with kept rolls', () => {
  // A rescan compares a folder's names against what is on disk. Kept rolls have
  // no name on disk at all, so without an explicit pass-through a single rescan
  // would sweep the whole kept half of the shelf away.
  it('leaves them alone', () => {
    let lib = shelf([{ name: 'rips', files: ['a.mp4', 'b.mp4'] }])
    lib = addPick(lib, bust, 'Agrippa').lib
    const after = syncFolder(lib, lib.folders[0].id, ['a.mp4'])
    expect(after.gone).toBe(1)
    expect(after.lib.clips.filter(c => c.at === 'commons')).toHaveLength(1)
  })
})

describe('matchPicked with kept rolls', () => {
  // The re-link matches a picked File by name. A kept roll has no file behind
  // it, so one whose caption happened to match would be quietly repointed at
  // somebody's disk.
  it('never re-links one to a file off the disk', () => {
    const lib = addPick(EMPTY_LIBRARY, bust, 'Agrippa').lib
    expect(matchPicked(lib, [{ name: 'Agrippa', path: '', size: 10 }])).toEqual(
      [],
    )
  })
})

describe('the kept rolls have a bound of their own', () => {
  const many = (n: number) => {
    let lib = EMPTY_LIBRARY
    for (let i = 0; i < n; i += 1)
      lib = addPick(lib, { ...bust, title: `File:${i}.jpg` }, `pic ${i}`).lib
    return lib
  }

  // Refusing would leave the ★ hollow after a click, which reads as a broken
  // button. The oldest goes instead — keeping one is a thing you do to the
  // picture in front of you, so the newest is the one that matters.
  it('drops the oldest rather than refusing the newest', () => {
    const lib = many(KEPT_LIMIT + 3)
    expect(lib.clips).toHaveLength(KEPT_LIMIT)
    expect(lib.clips[0].ref).toBe(`File:${KEPT_LIMIT + 2}.jpg`)
    expect(lib.clips.map(c => c.ref)).not.toContain('File:0.jpg')
    // And the one just kept is on the shelf, which is what the ★ renders from.
    expect(hasPick(lib, { ...bust, title: `File:${KEPT_LIMIT + 2}.jpg` })).toBe(
      true,
    )
  })

  // A shelf of somebody's own footage is not what the kept bound is for, and a
  // star must never cost them a row of it.
  it('never trims a file on disk to make room', () => {
    let lib = shelf([{ name: 'rips', files: ['a.mp4', 'b.mp4'] }])
    for (let i = 0; i < KEPT_LIMIT + 5; i += 1)
      lib = addPick(lib, { ...bust, title: `File:${i}.jpg` }, `pic ${i}`).lib
    expect(lib.clips.filter(c => c.at === 'disk').map(c => c.name)).toEqual([
      'a.mp4',
      'b.mp4',
    ])
    expect(lib.clips.filter(c => c.at !== 'disk')).toHaveLength(KEPT_LIMIT)
  })

  // The two halves are interleaved in one list and only the dialog separates
  // them, so trimming must not become a re-sort of somebody's folders.
  it('leaves the disk clips in the order they were in', () => {
    let lib = shelf([
      { name: 'rips', files: ['a.mp4', 'b.mp4'] },
      { name: 'more', files: ['c.mp4'] },
    ])
    const before = lib.clips.map(c => c.name)
    for (let i = 0; i < KEPT_LIMIT + 2; i += 1)
      lib = addPick(lib, { ...bust, title: `File:${i}.jpg` }, `pic ${i}`).lib
    expect(lib.clips.filter(c => c.at === 'disk').map(c => c.name)).toEqual(
      before,
    )
  })

  it('is well under the shelf-wide bound, which is about files on disk', () => {
    expect(KEPT_LIMIT).toBeLessThan(CLIP_LIMIT)
  })
})
