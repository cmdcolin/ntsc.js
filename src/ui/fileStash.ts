// Reopening the file a slot held last session. A picked File is only a handle on
// the user's disk while the page lives, so something has to be kept behind.
// Three ways, and which one a pick uses is decided by where it came from and by
// what the browser offers:
//
//   handle — Chromium's showOpenFilePicker hands back a FileSystemFileHandle,
//     which is structured-cloneable, so IndexedDB remembers the file *by
//     reference*: nothing is copied, whatever its size, and edits on disk show
//     up next time. Read permission does not survive the reload though, and
//     re-granting it needs a user gesture, so reopening costs one click.
//
//   copy — no disk picker (Firefox, Safari), so the hidden <input type="file">
//     stays and we copy the bytes into the origin private file system. That
//     reopens with no gesture and no prompt, but it duplicates the file, so an
//     oversized pick is skipped rather than charged against the origin's quota.
//
//   lib — the source came off the clip library, which already remembers how to
//     reopen it and by which grant. Nothing is stored here but the entry's id:
//     a second copy of a clip the shelf is holding would be the one duplication
//     the library exists to avoid. This one covers the shelf's kept rolls too,
//     and they are the easy case — nothing on disk, nothing to grant, so the
//     slot comes back on its own at load with no click anywhere.
//
// Which one a slot used is recorded alongside the name and mime type in
// localStorage, since none of the three backends remembers those on its own.

import { openClipById } from './clipLibrary'
import { grantRead, isPickedFile } from './fsAccess'
import { idbDelete, idbGet, idbPut } from './idb'
import { readRecord, removeStored, storedFlag, writeJSON } from './storage'

import type { PoolRef } from '../sources/pools'
import type { PickedFileHandle } from './fsAccess'

export type StashSlot = 'a' | 'b'

// The deck a row's second button sends to. Every list of media in this app — the
// clip shelf, the media browser — plays into the deck it was opened for on a
// plain click and offers the other one beside it, so a two-deck set never has to
// reopen a dialog to load B. Written once here rather than at the top of each of
// those files, which is where two copies of it lived.
export const otherSlot = (slot: StashSlot): StashSlot =>
  slot === 'a' ? 'b' : 'a'

// What the slot can reopen. Two shapes, because the two differ in exactly the
// thing a caller has to act on: bytes that may need a click to re-grant read, or
// a name to ask an archive for.
//
// `mode` is which source mode the restored source lands on — a clip off the
// shelf goes back as a clip, not as a one-off pick, or the caption would offer
// the file dialog where the shelf belongs.
// `clip` is the shelf entry this came off, and '' for a one-off pick that never
// went on the shelf. It rides along because a strip row names clips by shelf id
// (`strip.RowClip`), and the deck that comes back at load has to be capturable
// as a row exactly like one loaded by hand — otherwise `+ row` records a clip
// on a fresh visit and silently does not after a reload, which is the shape of
// bug nobody reports because it looks like their own mistake.
export type Stashed =
  | {
      at: 'file'
      name: string
      mode: 'file' | 'library'
      clip: string
      needsGesture: boolean
      open: () => Promise<File>
    }
  | {
      at: 'pool'
      name: string
      mode: 'library'
      clip: string
      ref: PoolRef
    }

interface Meta {
  name: string
  type: string
  kind: 'handle' | 'copy' | 'lib'
  // The library entry, for kind 'lib' and empty otherwise.
  id: string
}

const NONE: Meta = { name: '', type: '', kind: 'copy', id: '' }

const metaKey = (slot: StashSlot) => `ntsc.js.stash.${slot}`
const copyName = (slot: StashSlot) => `source-${slot}`

// Whether a reload puts each deck back on what it was holding, which is a
// setting rather than a fact about the stash — hence the separate key, and hence
// the default: absent means yes, the way the app has always behaved.
//
// The switch is a preference and the stash is evidence, so turning it off must
// not throw the evidence away. A load with this off simply does not ask
// (`useEngine`'s boot), leaves both slots' entries where they are, and turning
// it back on picks last session's clips up again — where clearing them would
// make the switch a one-way door with no warning on it. Ejecting a deck is the
// gesture that means "and forget this one".
//
// The toggle that writes it is in the Advanced dialog and the read is here, so
// both go through `storedFlag`: with two spellings of "absent means yes" the two
// files could drift into an app that reopens clips under a switch reading "start
// empty", and nothing would fail.
export const REOPEN_KEY = 'ntsc.js.reopen'

export const reopensOnLoad = (): boolean => storedFlag(REOPEN_KEY, true)

const opfsRoot = () => navigator.storage.getDirectory()

// A convenience copy has no business eating the origin's storage budget: the
// bytes are duplicated (a 4 GB clip costs 4 GB here, on top of the user's own
// copy), the write is a real disk copy on every pick, and an oversized stash is
// the first thing evicted under disk pressure anyway. Only the copy backend
// pays this — a handle costs nothing whatever the file's size.
async function fits(file: File): Promise<boolean> {
  const { quota, usage } = await navigator.storage.estimate()
  return quota === undefined || usage === undefined
    ? true
    : file.size * 2 < quota - usage
}

// Remember this pick as the slot's source across reloads, by reference when the
// picker gave us a handle and by copy otherwise. Resolves false when the file
// was too big to copy, so the caller can say so rather than assume it comes
// back.
export async function stashFile(
  slot: StashSlot,
  file: File,
  handle: PickedFileHandle | undefined,
): Promise<boolean> {
  // Exactly one thing is ever stashed per slot, so clear whichever backend the
  // previous pick used before writing this one.
  await clearStash(slot)
  const kind = handle === undefined ? 'copy' : 'handle'
  let kept = true
  if (handle === undefined) {
    kept = await fits(file)
    if (kept) {
      const root = await opfsRoot()
      const entry = await root.getFileHandle(copyName(slot), { create: true })
      const out = await entry.createWritable()
      // Writing the Blob itself streams it — no second copy in memory.
      await out.write(file)
      await out.close()
    }
  } else {
    await idbPut(slot, handle)
  }
  if (kept)
    writeJSON(metaKey(slot), { name: file.name, type: file.type, kind, id: '' })
  return kept
}

// The slot is on a clip off the shelf. One line of localStorage and no bytes
// anywhere: the library owns the handle, the grant and the folder it came from,
// and this only has to say which entry to ask it for.
export async function stashClip(
  slot: StashSlot,
  clip: { id: string; name: string },
): Promise<void> {
  await clearStash(slot)
  writeJSON(metaKey(slot), {
    name: clip.name,
    type: '',
    kind: 'lib',
    id: clip.id,
  })
}

// The slot no longer holds a picked file. Dropping the meta key alone would
// leave a copy's bytes charged against the origin's quota forever.
export async function clearStash(slot: StashSlot): Promise<void> {
  const meta = readRecord<Meta>(metaKey(slot), NONE)
  removeStored(metaKey(slot))
  if (meta.kind === 'copy' && meta.name !== '') {
    const root = await opfsRoot()
    await root.removeEntry(copyName(slot))
  }
  if (meta.kind === 'handle') {
    await idbDelete([slot])
  }
}

// Reopen the bytes we copied. Rejects when they are gone — cleared storage, or
// evicted under disk pressure — which reads to the caller as nothing to restore.
async function openCopy(slot: StashSlot, meta: Meta): Promise<File> {
  const root = await opfsRoot()
  const entry = await root.getFileHandle(copyName(slot))
  const stored = await entry.getFile()
  // Restore the identity OPFS does not keep. Wrapping a Blob copies no bytes.
  return new File([stored], meta.name, { type: meta.type })
}

// Re-grant read on a disk handle if the reload dropped it, then read the file.
// Called straight off the user's click: an await before requestPermission can
// spend the transient activation it needs.
async function openHandle(
  handle: PickedFileHandle,
  granted: boolean,
): Promise<File> {
  if (!granted && !(await grantRead(handle)))
    throw new Error('read permission denied')
  return handle.getFile()
}

// What the slot can reopen, or null when it has nothing stashed.
export async function readStash(slot: StashSlot): Promise<Stashed | null> {
  const meta = readRecord<Meta>(metaKey(slot), NONE)
  let stashed: Stashed | null = null
  if (typeof meta.name === 'string' && meta.name !== '') {
    if (meta.kind === 'lib') {
      const clip =
        typeof meta.id === 'string' ? await openClipById(meta.id) : null
      if (clip !== null)
        stashed =
          clip.at === 'pool'
            ? {
                at: 'pool',
                name: clip.name,
                mode: 'library',
                clip: meta.id,
                ref: clip.ref,
              }
            : { ...clip, at: 'file', mode: 'library', clip: meta.id }
    } else if (meta.kind === 'handle') {
      const stored = await idbGet(slot)
      if (isPickedFile(stored)) {
        // Chromium can carry a grant across loads (an installed app, or "allow
        // on every visit"), and then the reopen needs no click at all.
        const granted =
          (await stored.queryPermission({ mode: 'read' })) === 'granted'
        stashed = {
          at: 'file',
          name: meta.name,
          mode: 'file',
          clip: '',
          needsGesture: !granted,
          open: () => openHandle(stored, granted),
        }
      }
    } else {
      stashed = {
        at: 'file',
        name: meta.name,
        mode: 'file',
        clip: '',
        needsGesture: false,
        open: () => openCopy(slot, meta),
      }
    }
  }
  return stashed
}
