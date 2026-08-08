// The clip library: a shelf of the user's own footage that survives the reload,
// where "File…" only ever remembered the last one.
//
// The whole design follows from one fact about the browser. A `File` is a live
// reference to something on disk and costs nothing to hold, but it dies with the
// page — so a library is not a storage problem, it is a *re-opening* problem,
// and there are two answers depending on what the browser offers:
//
//   handles (Chromium) — a FileSystemFileHandle is structured-cloneable, so
//     IndexedDB remembers a clip by reference: no bytes copied, any size, edits
//     on disk show through. Read permission dies with the page and re-granting
//     needs a gesture, which is why a *folder* is the good shape here — one
//     grant covers every clip under it, where twenty loose files cost twenty
//     prompts. Clicking a clip is itself the gesture, so nothing needs unlocking
//     up front; the first click into a folder is the only one that asks.
//
//   names (Firefox, Safari — no disk picker) — nothing can be remembered by
//     reference, and copying the bytes is not an option a library can afford:
//     fileStash duplicates one file into OPFS and calls it cheap, but a shelf of
//     forty rips is forty duplicates against an evictable quota. So the *list*
//     persists and the bytes do not. A reload shows the whole shelf greyed, and
//     one re-pick of the same files (or the same folder, via webkitdirectory)
//     re-links every entry by name and puts them back. The list is the thing
//     worth keeping; the bytes are one click away.
//
// Everything above `── the store ──` is storage-agnostic list algebra, tested in
// clipLibrary.test.ts; below it is the part that talks to localStorage,
// IndexedDB and the pickers, in the same split savedProfiles.ts/cloud.ts uses.

import {
  grantRead,
  hasRead,
  isPickedDir,
  isPickedFile,
  mediaKind,
  pickFiles,
  pickFolder,
  scanFolder,
} from './fsAccess'
import { idbDelete, idbGetMany, idbPut } from './idb'
import { readRecord, writeJSON } from './storage'

import type {
  Grantable,
  PickedDirectoryHandle,
  PickedFileHandle,
} from './fsAccess'

// One clip on the shelf. `folder` is the id of the folder it was scanned out
// of, or '' for a file picked on its own — the distinction is not cosmetic, it
// is which grant reopens it.
export interface Clip {
  id: string
  name: string
  folder: string
  kind: 'video' | 'image'
  // Bytes, or 0 for a clip that came from a folder scan — reading the size
  // there would mean a getFile() per entry, which is what makes scanning a
  // hundred-clip folder slow. Only loose picks carry it, where it is the half
  // of the identity that tells two files of the same name apart.
  size: number
}

export interface ClipFolder {
  id: string
  name: string
}

export interface Library {
  clips: Clip[]
  folders: ClipFolder[]
  // Where the next id comes from. Ids have to be stable across sessions (they
  // key the IndexedDB records) and unique for the life of the library, and a
  // counter is the only way to get both without a clock or a random source.
  seq: number
}

export const EMPTY_LIBRARY: Library = { clips: [], folders: [], seq: 0 }

// A hard bound on the shelf, and on one scan of a folder. Not politeness: every
// entry is a row, a stored record and a permission to resolve, and a home
// directory picked by mistake would otherwise be tens of thousands of each.
export const CLIP_LIMIT = 500

// What makes two entries the same clip. Inside a folder a name is unique by
// construction, so the name is the identity and re-adding the folder recognises
// what is already there. A loose pick has no such guarantee — two folders can
// both hold `01.mp4` — so its size joins the key, which is as close to file
// identity as a picked File will admit to.
export const clipKey = (clip: {
  name: string
  folder: string
  size: number
}): string =>
  clip.folder === ''
    ? `\n${clip.name}\n${clip.size}`
    : `${clip.folder}\n${clip.name}`

// Add what is not already on the shelf. `added` pairs each new clip with its
// index in `incoming`, since the caller holds the handle or the File that goes
// with it and has no other way back to the pairing; `dropped` counts what the
// limit refused, which is the one loss worth reporting — a duplicate or a file
// the app cannot open is answered by `added.length` alone.
export function addClips(
  lib: Library,
  folder: string,
  incoming: readonly { name: string; size: number }[],
): { lib: Library; added: { clip: Clip; at: number }[]; dropped: number } {
  const seen = new Set(lib.clips.map(clipKey))
  const clips = [...lib.clips]
  const added: { clip: Clip; at: number }[] = []
  let seq = lib.seq
  let dropped = 0
  for (const [at, item] of incoming.entries()) {
    const kind = mediaKind(item.name)
    const draft = { name: item.name, folder, size: item.size }
    const key = clipKey(draft)
    if (kind === null || seen.has(key)) continue
    if (clips.length >= CLIP_LIMIT) {
      dropped += 1
      continue
    }
    seq += 1
    seen.add(key)
    const clip: Clip = { id: `c${seq}`, ...draft, kind }
    clips.push(clip)
    added.push({ clip, at })
  }
  return { lib: { ...lib, clips, seq }, added, dropped }
}

// A folder by name, adding it only if it is new. Re-picking a folder already on
// the shelf has to land on the same entry, or every re-pick would double the
// list — and re-picking is the ordinary way to rescan on a browser with no
// directory handle to keep.
export function addFolder(
  lib: Library,
  name: string,
): { lib: Library; folder: ClipFolder } {
  const existing = lib.folders.find(f => f.name === name)
  if (existing !== undefined) return { lib, folder: existing }
  const seq = lib.seq + 1
  const folder: ClipFolder = { id: `f${seq}`, name }
  return { lib: { ...lib, folders: [...lib.folders, folder], seq }, folder }
}

// The folder as it is on disk now: what has appeared since the last look is
// added, what has gone is dropped. Dropping is the half that needs stating —
// a row that cannot be opened because the file was moved is worse than no row,
// since the shelf's whole claim is that clicking a name plays it.
export function syncFolder(
  lib: Library,
  folder: string,
  names: readonly string[],
): { lib: Library; added: number; gone: number } {
  const present = new Set(names)
  const kept = lib.clips.filter(c => c.folder !== folder || present.has(c.name))
  const gone = lib.clips.length - kept.length
  const grown = addClips(
    { ...lib, clips: kept },
    folder,
    names.map(name => ({ name, size: 0 })),
  )
  return { lib: grown.lib, added: grown.added.length, gone }
}

export const dropClip = (lib: Library, id: string): Library => ({
  ...lib,
  clips: lib.clips.filter(c => c.id !== id),
})

export const dropFolder = (lib: Library, id: string): Library => ({
  ...lib,
  folders: lib.folders.filter(f => f.id !== id),
  clips: lib.clips.filter(c => c.folder !== id),
})

// The shelf as the dialog draws it: each folder with what is under it, then
// whatever was picked on its own. A clip naming a folder that is no longer
// there falls in with the loose ones rather than disappearing — the list is
// hand-editable localStorage, and a row you can see and delete beats a row that
// is silently gone.
export function libraryGroups(
  lib: Library,
): { folder: ClipFolder | null; clips: Clip[] }[] {
  const known = new Set(lib.folders.map(f => f.id))
  const groups = lib.folders.map(folder => ({
    folder,
    clips: lib.clips.filter(c => c.folder === folder.id),
  }))
  const loose = lib.clips.filter(c => !known.has(c.folder))
  return loose.length === 0
    ? groups
    : [...groups, { folder: null, clips: loose }]
}

// How many clips are worth a filter box. A field over four names is a control
// asking to be used where reading the list is faster, and it costs a row on
// both surfaces that show one. Shared so the dialog and the picker agree about
// when the shelf has stopped being scannable.
export const FILTER_FROM = 8

// The shelf narrowed to what someone typed. Every whitespace-separated term has
// to appear somewhere in "<folder> <name>", so `rips` alone brings up the whole
// of that folder and `rips 01` brings up one clip in it — the folder is part of
// what a clip is called here, not a heading it happens to sit under.
//
// A Library back rather than a list, so `libraryGroups` draws the narrowed shelf
// with no idea a filter happened. Folders left holding nothing go with their
// clips: an empty heading is worse than no heading, and dropping one can't
// orphan anything, since a folder only goes when none of its clips stayed.
export function filterLibrary(lib: Library, query: string): Library {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t !== '')
  if (terms.length === 0) return lib
  const folderNames = new Map(
    lib.folders.map(f => [f.id, f.name.toLowerCase()]),
  )
  const clips = lib.clips.filter(c => {
    const hay = `${folderNames.get(c.folder) ?? ''} ${c.name.toLowerCase()}`
    return terms.every(t => hay.includes(t))
  })
  const kept = new Set(clips.map(c => c.folder))
  return { ...lib, clips, folders: lib.folders.filter(f => kept.has(f.id)) }
}

// Match a fresh pick against what the shelf remembers — the re-link, and the
// whole of persistence on a browser with no handles.
//
// Greedy and scored rather than exact, because the only identity a picked File
// carries is its name: the folder it arrived under and its size are corroborating
// evidence, not keys. Each picked file answers for at most one clip, so a folder
// holding two files of the same name cannot re-link both to whichever one the
// pointer reached first.
export function matchPicked(
  lib: Library,
  picked: readonly { name: string; path: string; size: number }[],
): { id: string; at: number }[] {
  const folderNames = new Map(lib.folders.map(f => [f.id, f.name]))
  const used = new Set<number>()
  const out: { id: string; at: number }[] = []
  for (const clip of lib.clips) {
    let best = -1
    let bestScore = 0
    for (const [at, file] of picked.entries()) {
      if (used.has(at) || file.name !== clip.name) continue
      const slash = file.path.indexOf('/')
      const segment = slash === -1 ? '' : file.path.slice(0, slash)
      const score =
        1 +
        (segment !== '' && segment === folderNames.get(clip.folder) ? 2 : 0) +
        (clip.size !== 0 && clip.size === file.size ? 1 : 0)
      if (score > bestScore) {
        bestScore = score
        best = at
      }
    }
    if (best !== -1) {
      used.add(best)
      out.push({ id: clip.id, at: best })
    }
  }
  return out
}

// A pick from a <input webkitdirectory>, sorted into the folder it came from.
// Only the top level of the pick counts, so this and a directory handle agree
// about what a folder holds: `rips/a.mp4` is in `rips`, `rips/2019/b.mp4` is in
// nothing this shelf models, and a file with no relative path at all is a loose
// pick. Pure so the grouping is testable without a DOM.
export function groupPicked<T extends { name: string; path: string }>(
  files: readonly T[],
): { folder: string; files: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const file of files) {
    const parts = file.path === '' ? [] : file.path.split('/')
    if (parts.length > 2) continue
    const folder = parts.length === 2 ? parts[0] : ''
    const bucket = groups.get(folder)
    if (bucket === undefined) groups.set(folder, [file])
    else bucket.push(file)
  }
  return [...groups].map(([folder, under]) => ({ folder, files: under }))
}

// One stored entry, or undefined when it is not one. The shelf is JSON in
// localStorage, so its shape is a claim rather than a fact: a stale schema, a
// hand edit or another build's leftovers all arrive here, and every field below
// is one the dialog renders or the store keys on.
function readClip(raw: unknown): Clip | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const id = 'id' in raw ? raw.id : undefined
  const name = 'name' in raw ? raw.name : undefined
  const folder = 'folder' in raw ? raw.folder : undefined
  const kind = 'kind' in raw ? raw.kind : undefined
  const size = 'size' in raw ? raw.size : undefined
  return typeof id === 'string' &&
    id !== '' &&
    typeof name === 'string' &&
    name !== '' &&
    typeof folder === 'string' &&
    (kind === 'video' || kind === 'image') &&
    typeof size === 'number' &&
    Number.isFinite(size)
    ? { id, name, folder, kind, size }
    : undefined
}

function readFolder(raw: unknown): ClipFolder | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const id = 'id' in raw ? raw.id : undefined
  const name = 'name' in raw ? raw.name : undefined
  return typeof id === 'string' && id !== '' && typeof name === 'string'
    ? { id, name }
    : undefined
}

// Whatever was stored under a list key, as a list. A stored blob can carry
// anything at all there — a string, a number, nothing — and every caller below
// is about to iterate it.
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// The counter has to outrun every id already in the shelf, not merely whatever
// number was written beside them. `seq` is editable localStorage, and one rolled
// back would mint ids that collide with live IndexedDB records — the single
// corruption here that shows up as *another clip's* footage playing.
const highestId = (ids: readonly string[]): number =>
  ids.reduce((max, id) => {
    const n = Number(id.slice(1))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)

// A stored blob, made safe to render and to key on.
export function readLibrary(raw: unknown): Library {
  // Each key read literally rather than through one `raw[key]` helper: `in`
  // narrows an unknown to something indexable only for a literal key, and the
  // two lines that costs are cheaper than the cast the general version needs.
  const known = typeof raw === 'object' && raw !== null
  const clips = list(known && 'clips' in raw ? raw.clips : []).flatMap(v => {
    const clip = readClip(v)
    return clip === undefined ? [] : [clip]
  })
  const folders = list(known && 'folders' in raw ? raw.folders : []).flatMap(
    v => {
      const folder = readFolder(v)
      return folder === undefined ? [] : [folder]
    },
  )
  const stored =
    typeof raw === 'object' && raw !== null && 'seq' in raw ? raw.seq : 0
  return {
    clips,
    folders,
    seq: Math.max(
      typeof stored === 'number' && Number.isFinite(stored) ? stored : 0,
      highestId(clips.map(c => c.id)),
      highestId(folders.map(f => f.id)),
    ),
  }
}

// ── the store ────────────────────────────────────────────────────────────────

const KEY = 'ntsc.js.clips'
const clipRecord = (id: string) => `clip:${id}`
const folderRecord = (id: string) => `folder:${id}`

// Files handed over by a pick, good until the page goes. On Chromium this is
// only a shortcut past a permission prompt the browser would grant anyway; on
// Firefox and Safari it is the entire supply of bytes, refilled by a re-link.
const session = new Map<string, File>()

export const loadLibrary = (): Library =>
  readLibrary(readRecord<object>(KEY, EMPTY_LIBRARY))

export const saveLibrary = (lib: Library): void => writeJSON(KEY, lib)

// How a clip opens right now. `ask` is a Chromium handle whose grant died with
// the page — it opens, but the browser interposes a prompt, so the click has to
// carry a gesture. `lost` is a shelf entry with no bytes behind it at all, which
// is every entry on Firefox after a reload until something re-links it.
export interface ClipAccess {
  state: 'ready' | 'ask' | 'lost'
  open: (() => Promise<File>) | null
}

export interface LibraryAccess {
  clips: ReadonlyMap<string, ClipAccess>
  // Only the folders this browser still holds a handle for, so the shelf offers
  // a rescan exactly where there is something to rescan with. Resolved ahead of
  // the click on purpose: `grantRead` wants the click's transient activation and
  // an IndexedDB read in front of it is an await that could spend it.
  folders: ReadonlyMap<string, { rescan: () => Promise<string[]> }>
}

// The reading before anything has been resolved — every clip unknown rather
// than lost, so a shelf does not flash a row of "reconnect me" on the way to
// finding out that it can open everything.
export const NO_ACCESS: LibraryAccess = { clips: new Map(), folders: new Map() }

// Read through a grant that may or may not be live. Nothing is asked for when
// it already is — which is what lets the mount-time restore reopen a clip with
// no user gesture anywhere in sight, and what keeps a browser prompt off the
// rescan of a folder the page can already see.
const through = <T>(
  handle: Grantable,
  granted: boolean,
  read: () => Promise<T>,
): Promise<T> =>
  granted
    ? read()
    : grantRead(handle).then(ok =>
        ok ? read() : Promise.reject(new Error('read permission denied')),
      )

async function folderAccess(
  lib: Library,
  ids: readonly string[],
): Promise<Map<string, { dir: PickedDirectoryHandle; granted: boolean }>> {
  const wanted = lib.folders.filter(f => ids.includes(f.id))
  const stored = await idbGetMany(wanted.map(f => folderRecord(f.id)))
  const out = new Map<
    string,
    { dir: PickedDirectoryHandle; granted: boolean }
  >()
  await Promise.all(
    wanted.map(async (folder, i) => {
      const dir = stored[i]
      if (isPickedDir(dir))
        out.set(folder.id, { dir, granted: await hasRead(dir) })
    }),
  )
  return out
}

// What the shelf can open, resolved in one pass: one IndexedDB transaction for
// the folders, one for the loose picks, and a permission query per grant rather
// than per clip — which is the difference between a folder costing one question
// and costing one per row.
export async function accessLibrary(
  lib: Library,
  only?: readonly Clip[],
): Promise<LibraryAccess> {
  const clips = only ?? lib.clips
  const dirs = await folderAccess(lib, [...new Set(clips.map(c => c.folder))])
  const loose = clips.filter(c => c.folder === '' && !session.has(c.id))
  const stored = await idbGetMany(loose.map(c => clipRecord(c.id)))
  const files = new Map<
    string,
    { handle: PickedFileHandle; granted: boolean }
  >()
  await Promise.all(
    loose.map(async (clip, i) => {
      const handle = stored[i]
      if (isPickedFile(handle))
        files.set(clip.id, { handle, granted: await hasRead(handle) })
    }),
  )

  const out = new Map<string, ClipAccess>()
  for (const clip of clips) {
    const cached = session.get(clip.id)
    const dir = dirs.get(clip.folder)
    const own = files.get(clip.id)
    if (cached !== undefined) {
      out.set(clip.id, { state: 'ready', open: () => Promise.resolve(cached) })
    } else if (dir !== undefined) {
      out.set(clip.id, {
        state: dir.granted ? 'ready' : 'ask',
        open: () =>
          through(dir.dir, dir.granted, () =>
            dir.dir.getFileHandle(clip.name).then(h => h.getFile()),
          ),
      })
    } else if (own !== undefined) {
      out.set(clip.id, {
        state: own.granted ? 'ready' : 'ask',
        open: () =>
          through(own.handle, own.granted, () => own.handle.getFile()),
      })
    } else {
      out.set(clip.id, { state: 'lost', open: null })
    }
  }
  return {
    clips: out,
    folders: new Map(
      [...dirs].map(([id, { dir, granted }]) => [
        id,
        {
          rescan: () =>
            through(dir, granted, () => scanFolder(dir, CLIP_LIMIT)),
        },
      ]),
    ),
  }
}

// One clip by id, for the slot that was left on it last session (fileStash).
// Null when the shelf no longer holds it, or holds nothing that can open it.
export async function openClipById(id: string): Promise<{
  name: string
  needsGesture: boolean
  open: () => Promise<File>
} | null> {
  const lib = loadLibrary()
  const clip = lib.clips.find(c => c.id === id)
  if (clip === undefined) return null
  const access = (await accessLibrary(lib, [clip])).clips.get(id)
  return access === undefined || access.open === null
    ? null
    : {
        name: clip.name,
        needsGesture: access.state === 'ask',
        open: access.open,
      }
}

const remember = (
  added: { clip: Clip; at: number }[],
  files: readonly File[],
) => {
  for (const { clip, at } of added) session.set(clip.id, files[at])
}

// A multi-pick through the disk picker: each file remembered by its own handle,
// and its bytes cached so this session never has to ask again.
export async function addPickedFiles(
  lib: Library,
): Promise<{ lib: Library; added: number; dropped: number }> {
  const picked = await pickFiles(true)
  const grown = addClips(
    lib,
    '',
    picked.map(p => ({ name: p.file.name, size: p.file.size })),
  )
  await Promise.all(
    grown.added.map(({ clip, at }) =>
      idbPut(clipRecord(clip.id), picked[at].handle),
    ),
  )
  remember(
    grown.added,
    picked.map(p => p.file),
  )
  if (grown.added.length > 0 || grown.dropped > 0) saveLibrary(grown.lib)
  return { lib: grown.lib, added: grown.added.length, dropped: grown.dropped }
}

// A whole folder, by directory handle: the one pick whose grant covers
// everything it holds, now and after the next reload. Null when the user backed
// out of the picker.
export async function addPickedFolder(
  lib: Library,
): Promise<{ lib: Library; added: number; gone: number } | null> {
  const dir = await pickFolder()
  if (dir === null) return null
  const { lib: withFolder, folder } = addFolder(lib, dir.name)
  const names = await scanFolder(dir, CLIP_LIMIT)
  const synced = syncFolder(withFolder, folder.id, names)
  await idbPut(folderRecord(folder.id), dir)
  saveLibrary(synced.lib)
  return synced
}

// The <input> path, which is both halves of the story on a browser with no disk
// picker: whatever matches the shelf re-links, and whatever does not joins it.
// In that order — matching against a list the same pick has already been added
// to would have every file re-link to itself.
export function adoptLocalFiles(
  lib: Library,
  files: readonly File[],
): { lib: Library; added: number; relinked: number; dropped: number } {
  const relinked = matchPicked(
    lib,
    files.map(f => ({
      name: f.name,
      path: f.webkitRelativePath,
      size: f.size,
    })),
  )
  for (const { id, at } of relinked) session.set(id, files[at])

  let next = lib
  let added = 0
  let dropped = 0
  for (const group of groupPicked(
    files.map(f => ({ name: f.name, path: f.webkitRelativePath, file: f })),
  )) {
    let folderId = ''
    if (group.folder !== '') {
      const made = addFolder(next, group.folder)
      next = made.lib
      folderId = made.folder.id
    }
    const picked = group.files.map(f => f.file)
    const grown = addClips(
      next,
      folderId,
      picked.map(f => ({ name: f.name, size: folderId === '' ? f.size : 0 })),
    )
    remember(grown.added, picked)
    next = grown.lib
    added += grown.added.length
    dropped += grown.dropped
  }
  if (added > 0 || relinked.length > 0) saveLibrary(next)
  return { lib: next, added, relinked: relinked.length, dropped }
}

export async function removeClip(lib: Library, id: string): Promise<Library> {
  const next = dropClip(lib, id)
  session.delete(id)
  saveLibrary(next)
  await idbDelete([clipRecord(id)])
  return next
}

export async function removeFolder(lib: Library, id: string): Promise<Library> {
  for (const clip of lib.clips) if (clip.folder === id) session.delete(clip.id)
  const next = dropFolder(lib, id)
  saveLibrary(next)
  await idbDelete([folderRecord(id)])
  return next
}
