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
  learnSeconds,
  loadLibrary,
  removeClip,
  removeFolder,
  saveLibrary,
  syncFolder,
} from './clipLibrary'
import { probeDuration } from './duration'
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
        file => {
          load(slot, file, clip)
          // And learn how long it is on the way past, since the bytes are open
          // and the browser is about to read this header anyway. Auditioning a
          // clip and then adding it is the ordinary order, so this is usually
          // what makes the ＋ instant rather than a probe of its own.
          if (clip.seconds === 0 && clip.kind === 'video') {
            void probeDuration(file).then(seconds => {
              if (seconds > 0) remember(clip.id, seconds)
            })
          }
        },
        (e: unknown) => setNote(`${clip.name}: ${reason(e)}`),
      )
    }
  }

  // Write a measured duration down in both places it has to land: the stored
  // shelf, and this render's copy of it.
  //
  // Through `loadLibrary()` rather than the `lib` in hand, because a probe
  // resolves a moment after the click that started it and the shelf may have
  // been edited in between — saving a snapshot taken before that edit would
  // quietly undo it. `learnSeconds` is pure and only ever fills a blank, so
  // applying it to the stored list and to the state list separately cannot make
  // the two disagree.
  const remember = (id: string, seconds: number) => {
    saveLibrary(learnSeconds(loadLibrary(), id, seconds))
    setLib(prev => learnSeconds(prev, id, seconds))
  }

  // How long a clip runs, measuring it if nobody has yet.
  //
  // What wants it is a rundown: a row's `'clip'` hold is as long as its
  // picture, and until this existed the only thing that had ever read a
  // `duration` was a deck with the clip already playing on it — so a rundown
  // built by pressing ＋ down the shelf held every row for a bar count instead.
  //
  // **0 for a kept roll**, and deliberately: a remote clip has no bytes here,
  // and `sources/pool.ts` downloads whole, so measuring one would mean fetching
  // the entire file to read its header. That row keeps the bar-count fallback,
  // which is the same answer it had before and an honest one — the shelf knows
  // a title and where to ask for it, and neither says how long it is.
  //
  // **And 0 for a still**, which is not a failure to measure but the right
  // answer: an image has no length, so its row holds for a bar count the way a
  // look-only row does. Refused here rather than left to answer 0 the slow way,
  // because the slow way opens the file, hands it to a `<video>` that cannot
  // decode it and waits for the error — a round trip per ＋ press, every time,
  // since the 0 it comes back with is indistinguishable from "not asked yet"
  // and so is never written down.
  //
  // **It will ask for a lapsed grant, where `prerollClipOn` declines to**, and
  // the two are right to differ. A preroll is speculative — it runs off a timer,
  // for a row that may never arrive, and a browser prompt raised by a walk is
  // one nobody asked for. This runs inside a click on the clip itself, and the
  // alternative is worse than a prompt: on Chromium every shelf entry is `ask`
  // after a reload, so declining here would silently hand back a bar count for
  // every row added in a fresh session, which is the whole bug this exists to
  // fix. A folder is one grant for everything under it, so the ordinary shape
  // of a shelf makes it one prompt rather than one per ＋.
  //
  // The click that calls this is the gesture a lapsed grant needs, which is why
  // it opens the clip the way `play` does rather than awaiting anything first —
  // and why the caller must not await anything before calling it either.
  const measure = (clip: Clip): Promise<number> => {
    if (clip.seconds > 0 || clip.kind !== 'video')
      return Promise.resolve(clip.seconds)
    const how = access.clips.get(clip.id)
    if (how === undefined || how.open === null) return Promise.resolve(0)
    return how
      .open()
      .then(probeDuration)
      .then(seconds => {
        if (seconds > 0) remember(clip.id, seconds)
        return seconds
      })
      .catch(() => 0)
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
    measure,
    keep,
    kept: (ref: PoolRef) => hasPick(lib, ref),
    forgetClip,
    forgetFolder,
  }
}
