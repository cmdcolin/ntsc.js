import { useState } from 'react'

import { FILTER_FROM, filterLibrary, libraryGroups } from './clipLibrary'
import styles from './ClipLibrary.module.css'
import { cx } from './cx'
import { Dialog } from './Dialog'
import { MEDIA_ACCEPT } from './fsAccess'
import ui from './ui.module.css'

import type { Clip, ClipFolder, Library, LibraryAccess } from './clipLibrary'
import type { StashSlot } from './fileStash'
import type { RefObject } from 'react'

// The shelf. Files you have opened before, kept as a list you can click through
// mid-set instead of going back out to the OS dialog every time.
//
// It is a dialog and not a panel section for the reason the saved-look library
// is a popover: browsing is a thing you do for a few seconds with your eye on a
// list, and a permanent fold of the sidebar would cost that height on every
// session including the ones that never open it. Unlike that library this one
// starts *useful* on a second visit even signed out — the whole point is that
// nothing here needs an account.

const other = (slot: StashSlot): StashSlot => (slot === 'a' ? 'b' : 'a')

// A clip's state, as one character at the head of its row. Deliberately quiet:
// on a browser that remembers handles every row is `ready` and a column of
// glyphs saying so would be decoration. The two that are not ready are the ones
// worth a mark, and both mean "clicking this costs one more step".
const MARK = {
  ready: '',
  ask: '·',
  lost: '⊘',
}

const MARK_TITLE = {
  ready: '',
  ask: 'the browser will ask for permission before this plays',
  lost: 'this browser cannot reopen the file on its own — use “reconnect” below',
}

function ClipRow(props: {
  clip: Clip
  state: 'ready' | 'ask' | 'lost' | undefined
  slot: StashSlot
  onPlay: (clip: Clip, slot: StashSlot) => void
  onForget: (clip: Clip) => void
}) {
  const { clip, slot } = props
  // Undefined is "not resolved yet", which reads as ready: the shelf opens
  // before IndexedDB answers, and a row that flashed ⊘ on the way to being
  // fine would be lying for exactly as long as anyone looks at it.
  const state = props.state ?? 'ready'
  return (
    <div className={styles.row}>
      <span
        className={cx(styles.mark, state === 'lost' && styles.markLost)}
        title={MARK_TITLE[state]}
        aria-hidden
      >
        {MARK[state]}
      </span>
      <button
        className={cx(styles.name, state === 'lost' && styles.nameLost)}
        title={`play ${clip.name} on source ${slot.toUpperCase()}`}
        onClick={() => props.onPlay(clip, slot)}
      >
        {clip.name}
      </button>
      <button
        className={styles.rowBtn}
        title={`play ${clip.name} on source ${other(slot).toUpperCase()} instead`}
        onClick={() => props.onPlay(clip, other(slot))}
      >
        {other(slot).toUpperCase()}
      </button>
      <button
        className={styles.rowBtn}
        title={`take ${clip.name} off the shelf — the file itself is untouched`}
        aria-label={`remove ${clip.name}`}
        onClick={() => props.onForget(clip)}
      >
        ×
      </button>
    </div>
  )
}

// A folder's heading, and the two things that can be done to a folder as a
// whole. Its own component so `folder` is narrowed once, as a const the click
// handlers can close over — the loose group's heading is a null folder and has
// neither button.
function GroupHead(props: {
  folder: ClipFolder | null
  rescannable: boolean
  onRescan: (folder: ClipFolder) => void
  onForget: (folder: ClipFolder) => void
}) {
  const { folder } = props
  return (
    <div className={styles.head}>
      <span className={styles.headName}>
        {folder === null ? 'picked files' : `${folder.name}/`}
      </span>
      {folder === null || !props.rescannable ? null : (
        <button
          className={styles.rowBtn}
          title={`look at ${folder.name} again — clips added to it since show up, ones that have gone drop off`}
          aria-label={`rescan ${folder.name}`}
          onClick={() => props.onRescan(folder)}
        >
          ⟳
        </button>
      )}
      {folder === null ? null : (
        <button
          className={styles.rowBtn}
          title={`take ${folder.name} and everything under it off the shelf — the files themselves are untouched`}
          aria-label={`remove ${folder.name}`}
          onClick={() => props.onForget(folder)}
        >
          ×
        </button>
      )}
    </div>
  )
}

// `webkitdirectory` is prefixed in every engine that implements it, Firefox
// included, and is not in React's attribute types. Spread into the element so it
// reaches the DOM without a cast.
const DIRECTORY = { webkitdirectory: '' }

export function ClipLibraryDialog(props: {
  // Which source the shelf was opened for. Every row plays into it on a plain
  // click, and into the other one from the second button — so a two-deck set
  // never has to reopen this to load B.
  slot: StashSlot
  lib: Library
  access: LibraryAccess
  note: string
  // Whether this browser can hold a file open across a reload. It decides one
  // sentence at the foot and nothing else: both halves of the UI work either
  // way, they just cost a different number of clicks next session.
  canRemember: boolean
  filesRef: RefObject<HTMLInputElement | null>
  folderRef: RefObject<HTMLInputElement | null>
  onAddFiles: () => void
  onAddFolder: () => void
  onAdopt: (files: FileList | null) => void
  onRescan: (folder: ClipFolder) => void
  onPlay: (clip: Clip, slot: StashSlot) => void
  onForgetClip: (clip: Clip) => void
  onForgetFolder: (folder: ClipFolder) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const groups = libraryGroups(filterLibrary(props.lib, query))
  // Counted over the whole shelf, not the narrowed view: what this warns about
  // is the state of the library, and it stays true while you are looking at
  // four rows of it.
  const lost = props.lib.clips.filter(
    c => props.access.clips.get(c.id)?.state === 'lost',
  ).length
  // Pulled off the props object rather than read as `props.filesRef` at the
  // <input>: a ref read during render marks the whole props object as ref-ish
  // to the React Compiler, which then drops this component's memoization
  // entirely (the same note InputSection carries).
  const { filesRef, folderRef } = props

  return (
    <Dialog
      title={`Clips — play into source ${props.slot.toUpperCase()}`}
      size="prose"
      onClose={props.onClose}
    >
      <div className={styles.tools}>
        <button
          className={cx(ui.btn, ui.btnFlush)}
          title="add one or more files to the shelf"
          onClick={props.onAddFiles}
        >
          add files…
        </button>
        <button
          className={cx(ui.btn, ui.btnFlush)}
          title="add a whole folder — every clip directly inside it lands on the shelf at once"
          onClick={props.onAddFolder}
        >
          add folder…
        </button>
        <span className={ui.dim}>
          {props.lib.clips.length === 0
            ? ''
            : `${props.lib.clips.length} clip${props.lib.clips.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {props.note === '' ? null : (
        <div className={cx(ui.hint, styles.note)}>{props.note}</div>
      )}

      {props.lib.clips.length < FILTER_FROM ? null : (
        <input
          className={styles.find}
          type="text"
          value={query}
          placeholder={`filter ${props.lib.clips.length} clips`}
          aria-label="filter the shelf"
          onChange={e => setQuery(e.target.value)}
        />
      )}

      {props.lib.clips.length === 0 ? (
        <div className={ui.hint}>
          nothing on the shelf yet. Add the folder your rips live in and every
          clip in it is one click away for the rest of the session — and, on a
          browser that can hold a folder open, every session after this one.
        </div>
      ) : groups.length === 0 ? (
        <div className={ui.hint}>no clip matches “{query}”</div>
      ) : (
        <div className={styles.list}>
          {groups.map(group => (
            <div key={group.folder?.id ?? 'loose'}>
              <GroupHead
                folder={group.folder}
                rescannable={
                  group.folder !== null &&
                  props.access.folders.has(group.folder.id)
                }
                onRescan={props.onRescan}
                onForget={props.onForgetFolder}
              />
              {group.clips.map(clip => (
                <ClipRow
                  key={clip.id}
                  clip={clip}
                  state={props.access.clips.get(clip.id)?.state}
                  slot={props.slot}
                  onPlay={props.onPlay}
                  onForget={props.onForgetClip}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* The one thing a shelf has to be able to say on a browser with no disk
          handles: the list outlived the session and the files did not, and one
          re-pick of the same folder puts every row back. Re-picking goes
          through the same two buttons above — a file already on the shelf is
          recognised by name rather than added twice — so this is a sentence
          rather than a third control. */}
      {lost === 0 ? null : (
        <div className={cx(ui.hint, ui.warn)}>
          {lost} clip{lost === 1 ? '' : 's'} on the shelf but not open in this
          session. Re-pick the same folder (or the same files) above and they
          reconnect by name — nothing is added twice.
        </div>
      )}

      <div className={ui.hint}>
        {props.canRemember
          ? 'a folder is one permission covering everything in it, so the next session asks once and the whole shelf opens. Only files directly inside the folder count — add each folder you want.'
          : 'this browser can’t hold a file open past a reload, so the shelf keeps the list and not the footage: next session, re-pick the folder once and every row comes back. Only files directly inside it count.'}
      </div>

      {/* Hidden pickers for the browsers with no disk dialog. `multiple` and
          `webkitdirectory` are the two shapes of the same fallback, and both
          land in the same handler — a directory pick differs only in what
          webkitRelativePath says about each file. */}
      <input
        ref={filesRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          props.onAdopt(e.target.files)
          e.target.value = '' // so the same pick can be made twice
        }}
      />
      <input
        ref={folderRef}
        type="file"
        {...DIRECTORY}
        style={{ display: 'none' }}
        onChange={e => {
          props.onAdopt(e.target.files)
          e.target.value = ''
        }}
      />
    </Dialog>
  )
}
