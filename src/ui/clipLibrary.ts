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
// The shelf holds one other thing besides files on disk: rolls kept off
// Wikimedia Commons and archive.org. Those used to have a shelf of their own
// (ui/wikiFavorites.ts, deleted), and they do not need one — a remote entry is
// the *easy* case of everything above. There is no handle, no grant, no re-link
// and no reload problem, because the identity it stores is a Commons title or an
// archive.org identifier and resolving one is a request rather than a permission
// (sources/pool.ts says why an identity rather than a url). What made them look
// like a separate kind of thing was that the starred list was written first and
// for one of the two sources; what they actually are is a clip you keep, which
// is what this file is for.
//
// Everything above `── the store ──` is storage-agnostic list algebra, tested in
// clipLibrary.test.ts; below it is the part that talks to localStorage,
// IndexedDB and the pickers, in the same split savedProfiles.ts/cloud.ts uses.

import { ORIGIN_LABEL, refKey, sameRef } from '../sources/pools'
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

import type { PoolOrigin, PoolRef } from '../sources/pools'
import type {
  Grantable,
  PickedDirectoryHandle,
  PickedFileHandle,
} from './fsAccess'

// Where a clip's bytes come from, and the only field that decides how clicking
// its row opens it.
export type ClipAt = 'disk' | PoolOrigin

// One clip on the shelf.
export interface Clip {
  id: string
  // What the row reads: the file name on disk, the stripped caption upstream.
  name: string
  kind: 'video' | 'image'
  at: ClipAt
  // Disk only: the id of the folder it was scanned out of, or '' for a file
  // picked on its own — the distinction is not cosmetic, it is which grant
  // reopens it. Always '' for a remote clip, which has no grant to reopen by.
  folder: string
  // Disk only: bytes, or 0 for a clip that came from a folder scan — reading the
  // size there would mean a getFile() per entry, which is what makes scanning a
  // hundred-clip folder slow. Only loose picks carry it, where it is the half of
  // the identity that tells two files of the same name apart.
  size: number
  // Remote only: the Commons page title ("File:x.webm") or the archive.org
  // identifier that re-resolves this clip. '' on disk.
  ref: string
}

// A remote clip, as the thing that can be asked for again. Null for a clip on
// disk, which is the check every caller makes before reaching for a File.
export const clipRef = (clip: Clip): PoolRef | null =>
  clip.at === 'disk'
    ? null
    : {
        origin: clip.at,
        title: clip.ref,
        kind: clip.kind === 'image' ? 'photo' : 'video',
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
//
// A remote clip skips all of that: `origin + title` is an identity upstream
// already keys on, which is the whole reason it can be stored at all.
export const clipKey = (clip: {
  name: string
  folder: string
  size: number
  at: ClipAt
  ref: string
}): string =>
  clip.at !== 'disk'
    ? refKey({ origin: clip.at, title: clip.ref })
    : clip.folder === ''
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
    const draft = {
      name: item.name,
      folder,
      size: item.size,
      at: 'disk' as const,
      ref: '',
    }
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

// A roll worth keeping, onto the shelf. The whole of what starring one does: no
// bytes, no handle, no grant — a title and where it came from, which is the same
// entry the browser dialog adds and the same one a click resolves back
// (sources/pool.ts says why an identity rather than a url).
//
// Idempotent, because the ★ under the caption is a toggle and the browser's is a
// button, and pressing either twice must not shelve the same file twice.
export function addPick(
  lib: Library,
  ref: PoolRef,
  label: string,
): { lib: Library; clip: Clip } {
  const draft = {
    name: label,
    folder: '',
    size: 0,
    at: ref.origin,
    ref: ref.title,
  }
  const key = clipKey(draft)
  const existing = lib.clips.find(c => clipKey(c) === key)
  if (existing !== undefined) return { lib, clip: existing }
  const seq = lib.seq + 1
  const clip: Clip = {
    id: `c${seq}`,
    ...draft,
    kind: ref.kind === 'photo' ? 'image' : 'video',
  }
  // Newest first among the remote entries, because a star is a thing you do to
  // what is on screen right now and the one you just kept is the one you are
  // about to want. Disk clips keep their order, which is their folder's.
  return { lib: { ...lib, clips: [clip, ...lib.clips], seq }, clip }
}

// Whether this file is already on the shelf, which is what the ★ renders from.
const isPick = (clip: Clip, ref: PoolRef): boolean => {
  const own = clipRef(clip)
  return own !== null && sameRef(own, ref)
}

export const hasPick = (lib: Library, ref: PoolRef): boolean =>
  lib.clips.some(c => isPick(c, ref))

// Take a kept roll off the shelf again, by what it is rather than by its id —
// the ★ under a caption knows the file it is looking at and not which row of the
// shelf holds it.
export const dropPick = (lib: Library, ref: PoolRef): Library => ({
  ...lib,
  clips: lib.clips.filter(c => !isPick(c, ref)),
})

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
  // Remote entries are never in a folder and never go missing from one, so they
  // pass through untouched — without this a rescan would sweep the whole kept
  // half of the shelf away, since none of its names is on disk.
  const kept = lib.clips.filter(
    c => c.at !== 'disk' || c.folder !== folder || present.has(c.name),
  )
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
  clips: lib.clips.filter(c => c.at !== 'disk' || c.folder !== id),
})

// One heading and what sits under it. `folder` is the disk folder where there is
// one — only those can be rescanned or removed wholesale, so it is what the
// heading's two buttons are drawn from, and it is null for the loose picks and
// for the two remote groups.
export interface ClipGroup {
  id: string
  label: string
  folder: ClipFolder | null
  clips: Clip[]
}

// The shelf as the dialog draws it: each folder with what is under it, then
// whatever was picked on its own, then what was kept off each of the two public
// archives. A clip naming a folder that is no longer there falls in with the
// loose ones rather than disappearing — the list is hand-editable localStorage,
// and a row you can see and delete beats a row that is silently gone.
//
// Kept rolls go last and in their own groups rather than mixed through the disk
// clips, because what they cost to play is different: a click on one is a
// request to another origin (and, on archive.org, a download) where a click on a
// disk clip is a read. Grouping is where that gets said once instead of per row.
export function libraryGroups(lib: Library): ClipGroup[] {
  const known = new Set(lib.folders.map(f => f.id))
  const disk = lib.clips.filter(c => c.at === 'disk')
  const groups: ClipGroup[] = lib.folders.map(folder => ({
    id: folder.id,
    label: `${folder.name}/`,
    folder,
    clips: disk.filter(c => c.folder === folder.id),
  }))
  const loose = disk.filter(c => !known.has(c.folder))
  if (loose.length > 0)
    groups.push({
      id: 'loose',
      label: 'picked files',
      folder: null,
      clips: loose,
    })
  for (const origin of ORIGINS) {
    const kept = lib.clips.filter(c => c.at === origin)
    if (kept.length > 0)
      groups.push({
        id: origin,
        label: `kept from ${ORIGIN_LABEL[origin]}`,
        folder: null,
        clips: kept,
      })
  }
  return groups.filter(g => g.clips.length > 0)
}

const ORIGINS: readonly PoolOrigin[] = ['commons', 'archive']

// How many clips are worth a filter box. A field over four names is a control
// asking to be used where reading the list is faster, and it costs a row on
// both surfaces that show one. Shared so the dialog and the picker agree about
// when the shelf has stopped being scannable.
export const FILTER_FROM = 8

// The shelf narrowed to what someone typed. Every whitespace-separated term has
// to appear somewhere in "<where> <name>", so `rips` alone brings up the whole
// of that folder and `rips 01` brings up one clip in it — where a clip lives is
// part of what it is called here, not a heading it happens to sit under. For a
// kept roll "where" is the archive it came from, so `commons` narrows to those.
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
    const where =
      c.at === 'disk'
        ? (folderNames.get(c.folder) ?? '')
        : ORIGIN_LABEL[c.at].toLowerCase()
    const hay = `${where} ${c.name.toLowerCase()}`
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
  // Disk clips only: a kept roll has no file behind it to re-link to, and one
  // whose caption happened to match a picked file's name would be quietly
  // repointed at it.
  for (const clip of lib.clips.filter(c => c.at === 'disk')) {
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
  // A remote entry with no ref is dropped rather than kept as an unopenable row:
  // `ref` is the whole of its identity, and the API would otherwise be handed
  // whatever was there verbatim.
  const at = 'at' in raw ? raw.at : undefined
  const ref = 'ref' in raw ? raw.ref : ''
  const where: ClipAt | undefined =
    at === 'disk' || at === 'commons' || at === 'archive' ? at : undefined
  return typeof id === 'string' &&
    id !== '' &&
    typeof name === 'string' &&
    name !== '' &&
    typeof folder === 'string' &&
    (kind === 'video' || kind === 'image') &&
    typeof size === 'number' &&
    Number.isFinite(size) &&
    where !== undefined &&
    typeof ref === 'string' &&
    (where === 'disk' || ref !== '')
    ? { id, name, folder, kind, size, at: where, ref }
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
// Kept rolls are not in it at all rather than being in it as `ready`. They have
// no handle to query and no grant to lapse, and every reader here treats a
// missing entry as "fine, not resolved yet" already — so leaving them out is
// both the honest answer and one fewer branch on every row.
export async function accessLibrary(
  lib: Library,
  only?: readonly Clip[],
): Promise<LibraryAccess> {
  const clips = (only ?? lib.clips).filter(c => c.at === 'disk')
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

// How one clip reopens, for the slot that was left on it last session
// (fileStash). Two shapes because the shelf holds two kinds of thing, and the
// difference is the whole of what a caller has to do about it: a file on disk
// may need a click to re-grant read, and a kept roll needs a request and never a
// gesture — which makes it the one source that comes back on its own at load.
export type ClipOpen =
  | {
      at: 'disk'
      name: string
      needsGesture: boolean
      open: () => Promise<File>
    }
  | { at: 'pool'; name: string; ref: PoolRef }

// Null when the shelf no longer holds it, or holds nothing that can open it.
export async function openClipById(id: string): Promise<ClipOpen | null> {
  const lib = loadLibrary()
  const clip = lib.clips.find(c => c.id === id)
  if (clip === undefined) return null
  const ref = clipRef(clip)
  if (ref !== null) return { at: 'pool', name: clip.name, ref }
  const access = (await accessLibrary(lib, [clip])).clips.get(id)
  return access === undefined || access.open === null
    ? null
    : {
        at: 'disk',
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
  // Harmless for a kept roll, which never wrote one: idbDelete on a key that was
  // never put is a no-op, and branching on the clip's origin here would be one
  // more place that has to know the difference.
  await idbDelete([clipRecord(id)])
  return next
}

// Put a kept roll on the shelf, or take it off again — the ★ under the caption,
// and the browser dialog's own. Written through immediately, like every other
// change here: keeping one is a deliberate single click, and it has to survive
// the tab being closed straight afterwards.
export function keepPick(lib: Library, ref: PoolRef, label: string): Library {
  const next = hasPick(lib, ref)
    ? dropPick(lib, ref)
    : addPick(lib, ref, label).lib
  saveLibrary(next)
  return next
}

export async function removeFolder(lib: Library, id: string): Promise<Library> {
  for (const clip of lib.clips) if (clip.folder === id) session.delete(clip.id)
  const next = dropFolder(lib, id)
  saveLibrary(next)
  await idbDelete([folderRecord(id)])
  return next
}
