import { useEffect, useRef, useState } from 'react'

import {
  NO_ACCESS,
  accessLibrary,
  addPickedFiles,
  addPickedFolder,
  adoptLocalFiles,
  clipRef,
  hasPick,
  keepPick,
  loadLibrary,
  removeClip,
  removeFolder,
  saveLibrary,
  syncFolder,
} from './clipLibrary'
import { reason } from './format'
import { canPickFolder, canPickHandle } from './fsAccess'

import type { PoolRef } from '../sources/pools'
import type { Clip, ClipFolder, Library, LibraryAccess } from './clipLibrary'
import type { StashSlot } from './fileStash'

// The shelf, as the app holds it: the list itself, what the browser can open of
// it right now, and the verbs the dialog and the browser offer.
//
// It is its own hook rather than more of useEngine because none of it is the
// engine's business — the library is a list of names until the moment one is
// clicked. Two things cross into the engine and both are passed in: `load`, the
// File a disk clip opens to, and `show`, the name a kept roll resolves by. That
// second crossing is the whole difference between the two halves of the shelf,
// and it is one argument wide.

// What was picked, said once. Counts rather than prose because all four numbers
// can be non-zero at once — a re-pick of a folder on Firefox typically re-links
// most of it, adds the two clips that appeared since, and refuses nothing.
function report(r: {
  added: number
  relinked?: number
  gone?: number
  dropped?: number
}): string {
  const parts = [
    r.added > 0 ? `${r.added} added` : '',
    r.relinked !== undefined && r.relinked > 0
      ? `${r.relinked} reconnected`
      : '',
    r.gone !== undefined && r.gone > 0 ? `${r.gone} no longer there` : '',
    r.dropped !== undefined && r.dropped > 0
      ? `${r.dropped} over the limit`
      : '',
  ].filter(s => s !== '')
  return parts.length === 0 ? 'nothing new' : parts.join(', ')
}

export function useClipLibrary(
  open: boolean,
  load: (slot: StashSlot, file: File, clip: Clip) => void,
  show: (slot: StashSlot, ref: PoolRef) => void,
) {
  // Read once, from localStorage: the list is what the shelf *is*, and it costs
  // nothing to have on hand whether the dialog is open or not.
  const [lib, setLib] = useState(loadLibrary)
  const [access, setAccess] = useState<LibraryAccess>(NO_ACCESS)
  const [note, setNote] = useState('')
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  // Handles and permissions live in IndexedDB and in the browser's own grant
  // table, and nothing tells a page when a grant lapses — so they are re-read
  // every time the shelf is opened rather than cached from the last look. This
  // is an effect because it is genuinely a read of an external system, and it
  // keys on `lib` too: adding a folder is what makes its clips openable.
  useEffect(() => {
    let live = true
    if (open) {
      accessLibrary(lib).then(
        next => {
          if (live) setAccess(next)
        },
        (e: unknown) => {
          if (live) setNote(reason(e))
        },
      )
    }
    return () => {
      live = false
    }
  }, [open, lib])

  const settle = (next: Library, said: string) => {
    setLib(next)
    setNote(said)
  }

  // Add files. The disk picker where there is one — its handles are what make
  // the shelf survive a reload for free — and the hidden <input> otherwise,
  // which comes back through `adopt` below.
  const addFiles = () => {
    setNote('')
    if (canPickHandle())
      addPickedFiles(lib).then(
        r => settle(r.lib, report(r)),
        (e: unknown) => setNote(reason(e)),
      )
    else filesRef.current?.click()
  }

  const addFolder = () => {
    setNote('')
    if (canPickFolder())
      addPickedFolder(lib).then(
        r => {
          if (r !== null) settle(r.lib, report(r))
        },
        (e: unknown) => setNote(reason(e)),
      )
    else folderRef.current?.click()
  }

  // Whatever the hidden <input> came back with: the same call for one file, a
  // multi-pick and a whole directory, because on that path they differ only in
  // what webkitRelativePath says.
  const adopt = (picked: FileList | null) => {
    if (picked !== null && picked.length > 0) {
      const r = adoptLocalFiles(lib, [...picked])
      settle(r.lib, report(r))
    }
  }

  // Ask the folder what it holds now. Only offered where a directory handle
  // survived, so the button is absent rather than dead on a browser that cannot
  // do it; elsewhere re-picking the folder is the rescan.
  const rescan = (folder: ClipFolder) => {
    setNote('')
    const live = access.folders.get(folder.id)
    if (live !== undefined)
      live.rescan().then(
        names => {
          const r = syncFolder(lib, folder.id, names)
          saveLibrary(r.lib)
          settle(r.lib, report(r))
        },
        (e: unknown) => setNote(reason(e)),
      )
  }

  // Play a clip. The click is the gesture a lapsed grant needs, so `open` is
  // called with nothing awaited in front of it; a shelf entry with no bytes
  // behind it says so instead of failing silently.
  //
  // A kept roll takes neither path: there is nothing to grant and nothing to
  // reconnect, so it goes straight out as a request and the engine puts the
  // answer on the slot.
  const play = (clip: Clip, slot: StashSlot) => {
    const ref = clipRef(clip)
    if (ref !== null) {
      setNote('')
      show(slot, ref)
      return
    }
    const how = access.clips.get(clip.id)
    if (how === undefined || how.open === null) {
      setNote(`${clip.name} — reconnect this shelf to play it`)
    } else {
      setNote('')
      how.open().then(
        file => load(slot, file, clip),
        (e: unknown) => setNote(`${clip.name}: ${reason(e)}`),
      )
    }
  }

  // Keep a pick, or take it off again — the ★ under a caption and the browser's
  // own. Written through immediately, because keeping one is a deliberate single
  // click that has to survive the tab closing straight afterwards.
  const keep = (ref: PoolRef, label: string) => {
    setNote('')
    setLib(keepPick(lib, ref, label))
  }

  const forgetClip = (clip: Clip) => {
    removeClip(lib, clip.id).then(setLib, (e: unknown) => setNote(reason(e)))
  }

  const forgetFolder = (folder: ClipFolder) => {
    removeFolder(lib, folder.id).then(setLib, (e: unknown) =>
      setNote(reason(e)),
    )
  }

  return {
    lib,
    access,
    note,
    filesRef,
    folderRef,
    // Whether a folder can be picked *as* a folder. Firefox has no directory
    // picker but its <input> takes webkitdirectory, so the verb is offered
    // either way and only what backs it differs.
    canRemember: canPickHandle(),
    addFiles,
    addFolder,
    adopt,
    rescan,
    play,
    keep,
    kept: (ref: PoolRef) => hasPick(lib, ref),
    forgetClip,
    forgetFolder,
  }
}
