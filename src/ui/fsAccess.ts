// Opening files off the user's disk: the half of the File System Access API
// that lib.dom does not carry, because only Chromium ships it, plus the table
// of what this app will open at all.
//
// Two properties of a handle are what the rest of the app is built on. A handle
// is structured-cloneable, so IndexedDB remembers a file *by reference*:
// nothing is copied, whatever its size, and an edit on disk shows through next
// session. And a *directory* handle is one grant covering everything under it,
// which is the only reason a clip library is affordable — twenty file handles
// cost twenty permission prompts on the next load, one folder costs one.
//
// The permission methods are typed onto the handles these pickers return rather
// than onto FileSystemHandle globally, and that is deliberate: an OPFS handle in
// Firefox is the same interface without them, so putting them on the global
// would let fileStash's copy backend compile a call that throws.

interface ReadPermission {
  mode: 'read'
}

// What a picked handle can be asked about. Its own name because `grantRead`
// takes either kind, and neither the file nor the folder half is special to it.
export interface Grantable {
  queryPermission(descriptor: ReadPermission): Promise<PermissionState>
  requestPermission(descriptor: ReadPermission): Promise<PermissionState>
}

export interface PickedFileHandle extends FileSystemFileHandle, Grantable {}
export interface PickedDirectoryHandle
  extends FileSystemDirectoryHandle, Grantable {}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean
      types?: { description?: string; accept: Record<string, string[]> }[]
    }) => Promise<PickedFileHandle[]>
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite'
    }) => Promise<PickedDirectoryHandle>
  }
}

// What the app will open, and how each one has to be decoded: a still goes
// through createImageBitmap, a clip through a <video>. One table, so the OS
// picker's filter and the folder scan cannot drift — a folder offering a .mkv
// the picker refuses (or the reverse) is two lists disagreeing about what this
// app plays.
const MEDIA_EXT = new Map<string, 'video' | 'image'>([
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['png', 'image'],
  ['webp', 'image'],
  ['avif', 'image'],
  ['gif', 'image'],
  ['mp4', 'video'],
  ['m4v', 'video'],
  ['webm', 'video'],
  ['mov', 'video'],
  ['mkv', 'video'],
  ['avi', 'video'],
  ['ogv', 'video'],
])

// Lowercased extension, or '' for a name without one. `lastIndexOf` and not a
// split: "the.dub.master.mp4" has three.
const ext = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

// How this name would be shown, or null for something the app cannot open. Used
// to decide a library entry's kind and to sieve a folder scan, which sees
// everything a directory holds — subtitles, thumbnails, an OS index file.
export const mediaKind = (name: string): 'video' | 'image' | null =>
  MEDIA_EXT.get(ext(name)) ?? null

const extsOf = (kind: 'video' | 'image'): string[] =>
  [...MEDIA_EXT].filter(([, k]) => k === kind).map(([e]) => `.${e}`)

const PICKER_TYPES = [
  {
    description: 'Image or video',
    accept: { 'image/*': extsOf('image'), 'video/*': extsOf('video') },
  },
]

// The `accept` attribute for the hidden <input> the browsers without a disk
// picker fall back to. Same table, so the two ways in offer the same files.
export const MEDIA_ACCEPT = 'video/*,image/*'

export const canPickHandle = (): boolean =>
  window.showOpenFilePicker !== undefined

export const canPickFolder = (): boolean =>
  window.showDirectoryPicker !== undefined

// Cancelling an OS dialog rejects with AbortError, which is not a failure —
// it is the user saying "nothing, thanks", and reads here as an empty pick.
const cancelled = (e: unknown): boolean =>
  e instanceof DOMException && e.name === 'AbortError'

// Open the Chromium picker. Resolves empty when the user cancels it — the same
// nothing-happened the hidden <input> reports by never firing change — and when
// there is no picker to open, so a caller can offer this first and fall back on
// an empty result.
export async function pickFiles(
  multiple: boolean,
): Promise<{ file: File; handle: PickedFileHandle }[]> {
  const picker = window.showOpenFilePicker
  if (picker === undefined) return []
  const handles = await picker({ multiple, types: PICKER_TYPES }).catch(
    (e: unknown) => {
      if (cancelled(e)) return []
      throw e
    },
  )
  return Promise.all(
    handles.map(handle => handle.getFile().then(file => ({ file, handle }))),
  )
}

// One file, for the single-slot pick. Null rather than an empty array because
// its caller's question is "did the user choose something", not "how many".
export const pickHandle = (): Promise<{
  file: File
  handle: PickedFileHandle
} | null> => pickFiles(false).then(picked => picked[0] ?? null)

export async function pickFolder(): Promise<PickedDirectoryHandle | null> {
  const picker = window.showDirectoryPicker
  if (picker === undefined) return null
  return picker({ mode: 'read' }).catch((e: unknown) => {
    if (cancelled(e)) return null
    throw e
  })
}

// A stored handle is whatever a previous session put there, so check rather
// than trust: a schema change or another origin's leftovers must read as
// "nothing stored". The `in` test is what separates a real disk handle from an
// OPFS one, which is the same interface without the permission methods.
export const isPickedFile = (v: unknown): v is PickedFileHandle =>
  v instanceof FileSystemFileHandle && 'queryPermission' in v

export const isPickedDir = (v: unknown): v is PickedDirectoryHandle =>
  v instanceof FileSystemDirectoryHandle && 'queryPermission' in v

// Ask for read, straight off the user's click. There is deliberately no
// queryPermission in front of it: requestPermission needs the click's transient
// activation, an await can spend it, and the call is already a no-op that
// resolves 'granted' when the grant is live. `hasRead` is the one to ask ahead
// of the click, for what the list should *look* like.
export const grantRead = (h: Grantable): Promise<boolean> =>
  h.requestPermission({ mode: 'read' }).then(state => state === 'granted')

export const hasRead = (h: Grantable): Promise<boolean> =>
  h.queryPermission({ mode: 'read' }).then(state => state === 'granted')

// The media files sitting directly in a folder, by name, in a stable order.
//
// Top level only. Walking down would mean remembering a path per clip and
// re-walking it to reopen one, and a folder of rips is flat; several folders is
// the answer to a tree, and the dialog says so. The cap is a real bound rather
// than politeness — every name here becomes a row and a stored record, and a
// home directory picked by mistake would otherwise be tens of thousands of both.
export async function scanFolder(
  dir: PickedDirectoryHandle,
  limit: number,
): Promise<string[]> {
  const names: string[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && mediaKind(entry.name) !== null) {
      names.push(entry.name)
      if (names.length === limit) break
    }
  }
  return names.toSorted((a, b) => a.localeCompare(b))
}
