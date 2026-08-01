// Reopening the file a slot held last session. A picked File is only a handle on
// the user's disk while the page lives, so something has to be kept behind. Two
// ways, and which one the browser offers decides which a pick uses:
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
// Which one a slot used is recorded alongside the name and mime type in
// localStorage, since neither backend remembers those on its own.

import { readRecord, writeJSON } from './storage'

// The disk-picker half of the File System Access API is Chromium-only and absent
// from lib.dom, and its permission methods hang off the handles it returns —
// which is exactly why they are typed here rather than onto FileSystemHandle
// globally: an OPFS handle in Firefox is the same interface without them.
interface ReadPermission {
  mode: 'read'
}
export interface PickedFileHandle extends FileSystemFileHandle {
  queryPermission(descriptor: ReadPermission): Promise<PermissionState>
  requestPermission(descriptor: ReadPermission): Promise<PermissionState>
}
declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean
      types?: { description?: string; accept: Record<string, string[]> }[]
    }) => Promise<PickedFileHandle[]>
  }
}

export type StashSlot = 'a' | 'b'

// What a slot can reopen. `open` does the re-grant when there is one to do, so a
// caller only has to know whether a click has to come first.
export interface Stashed {
  name: string
  needsGesture: boolean
  open: () => Promise<File>
}

interface Meta {
  name: string
  type: string
  kind: 'handle' | 'copy'
}

const NONE: Meta = { name: '', type: '', kind: 'copy' }

const metaKey = (slot: StashSlot) => `ntscythe.stash.${slot}`
const copyName = (slot: StashSlot) => `source-${slot}`

const opfsRoot = () => navigator.storage.getDirectory()

const idbError = (e: DOMException | null): Error =>
  e === null
    ? new Error('indexeddb failed')
    : new Error(`indexeddb: ${e.message}`)

const HANDLE_STORE = 'handles'

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('ntscythe', 1)
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(idbError(req.error))
  })

// One store operation, resolved on transaction *commit* — a put that is merely
// queued is not a put that survives the reload.
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, mode)
      const req = run(tx.objectStore(HANDLE_STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(idbError(tx.error))
      tx.onabort = () => reject(idbError(tx.error))
    })
  } finally {
    db.close()
  }
}

// A stored handle is whatever the last session put there, so check rather than
// trust: a schema change or another origin's leftovers must read as "no stash".
const isPickedHandle = (v: unknown): v is PickedFileHandle =>
  v instanceof FileSystemFileHandle && 'queryPermission' in v

export const canPickHandle = (): boolean =>
  window.showOpenFilePicker !== undefined

// Open the Chromium picker, resolving null when the user cancels it — the same
// nothing-happened the hidden <input> reports by never firing change.
export async function pickHandle(): Promise<{
  file: File
  handle: PickedFileHandle
} | null> {
  const picker = window.showOpenFilePicker
  let picked: { file: File; handle: PickedFileHandle } | null = null
  if (picker !== undefined) {
    const handles = await picker({
      multiple: false,
      types: [
        {
          description: 'Image or video',
          accept: {
            'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'],
            'video/*': ['.mp4', '.webm', '.mov', '.mkv', '.avi'],
          },
        },
      ],
    }).catch((e: unknown) => {
      // Cancelling the OS dialog rejects with AbortError, which is not a
      // failure. Anything else is, and belongs to the caller.
      if (e instanceof DOMException && e.name === 'AbortError') return []
      throw e
    })
    if (handles.length > 0) {
      const handle = handles[0]
      picked = { file: await handle.getFile(), handle }
    }
  }
  return picked
}

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
    await withStore('readwrite', store => store.put(handle, slot))
  }
  if (kept) writeJSON(metaKey(slot), { name: file.name, type: file.type, kind })
  return kept
}

// The slot no longer holds a picked file. Dropping the meta key alone would
// leave a copy's bytes charged against the origin's quota forever.
export async function clearStash(slot: StashSlot): Promise<void> {
  const meta = readRecord<Meta>(metaKey(slot), NONE)
  localStorage.removeItem(metaKey(slot))
  if (meta.kind === 'copy' && meta.name !== '') {
    const root = await opfsRoot()
    await root.removeEntry(copyName(slot))
  }
  if (meta.kind === 'handle') {
    await withStore('readwrite', store => store.delete(slot))
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
  const state = granted
    ? 'granted'
    : await handle.requestPermission({ mode: 'read' })
  if (state !== 'granted') throw new Error(`read permission ${state}`)
  return handle.getFile()
}

// What the slot can reopen, or null when it has nothing stashed.
export async function readStash(slot: StashSlot): Promise<Stashed | null> {
  const meta = readRecord<Meta>(metaKey(slot), NONE)
  let stashed: Stashed | null = null
  if (typeof meta.name === 'string' && meta.name !== '') {
    if (meta.kind === 'handle') {
      const stored = await withStore<unknown>('readonly', store =>
        store.get(slot),
      )
      if (isPickedHandle(stored)) {
        // Chromium can carry a grant across loads (an installed app, or "allow
        // on every visit"), and then the reopen needs no click at all.
        const granted =
          (await stored.queryPermission({ mode: 'read' })) === 'granted'
        stashed = {
          name: meta.name,
          needsGesture: !granted,
          open: () => openHandle(stored, granted),
        }
      }
    } else {
      stashed = {
        name: meta.name,
        needsGesture: false,
        open: () => openCopy(slot, meta),
      }
    }
  }
  return stashed
}
