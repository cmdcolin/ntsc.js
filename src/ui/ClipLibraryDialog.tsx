import { useState } from 'react'

import { ORIGIN_LABEL, poolPageUrl } from '../sources/pools'
import {
  FILTER_FROM,
  YTDLP_LABEL,
  clipFetch,
  clipRef,
  filterLibrary,
  libraryGroups,
} from './clipLibrary'
import styles from './ClipLibrary.module.css'
import { cx } from './cx'
import { Dialog } from './Dialog'
import { MEDIA_ACCEPT } from './fsAccess'
import { CreditLink, OtherSlotButton } from './MediaRow'
import ui from './ui.module.css'

import type { Clip, ClipFolder, Library, LibraryAccess } from './clipLibrary'
import type { StashSlot } from './fileStash'
import type { RefObject } from 'react'

// The shelf. Files you have opened before, kept as a list you can click through
// mid-set instead of going back out to the OS dialog every time — and, in their
// own groups at the foot of it, the rolls you kept off the two public archives.
//
// Those used to have a dialog of their own, which was this one with the folders
// taken out. They belong here: what a user is doing at either is picking from
// the clips they have chosen to keep, and where a clip's bytes happen to live is
// a fact about how the row opens rather than about what the list is for.
//
// It is a dialog and not a panel section for the reason the saved-look library
// is a popover: browsing is a thing you do for a few seconds with your eye on a
// list, and a permanent fold of the sidebar would cost that height on every
// session including the ones that never open it. Unlike that library this one
// starts *useful* on a second visit even signed out — the whole point is that
// nothing here needs an account.

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
  // Append this clip to the rundown. Undefined when there is no strip to append
  // to — a fullscreen session, where the tray is deliberately not drawn.
  onAddRow: ((clip: Clip) => void) | undefined
}) {
  const { clip, slot } = props
  const fetched = clipFetch(clip)
  // Undefined is "not resolved yet", which reads as ready: the shelf opens
  // before IndexedDB answers, and a row that flashed ⊘ on the way to being
  // fine would be lying for exactly as long as anyone looks at it. A kept roll
  // is never resolved at all — it has no grant to lose — and lands here for the
  // same reason.
  const state = props.state ?? 'ready'
  const remote = clipRef(clip)
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
      <OtherSlotButton
        slot={slot}
        label={clip.name}
        onPlay={to => props.onPlay(clip, to)}
        className={styles.rowBtn}
      />
      {/* Into the rundown, rather than onto a deck.

          **A button and not a drag**, which is a substitution worth naming: the
          shelf is a modal dialog, so there is nothing to drag *to* — the tray is
          behind it and covered. A drag would also be the one way to reach this,
          which is the rule docs/EDITOR.md › _Interaction_ sets against: a drag
          is unreachable on a touchscreen and this app routes its verbs through
          things you can press.

          It is the better gesture here anyway. Building a rundown of eight
          clips means opening the shelf once and pressing this eight times,
          where a drag would mean opening and closing it eight times. */}
      {props.onAddRow === undefined ? null : (
        <button
          className={styles.rowBtn}
          title={`add ${clip.name} to the rundown as a new row`}
          aria-label={`add ${clip.name} to the rundown`}
          onClick={() => props.onAddRow?.(clip)}
        >
          ＋
        </button>
      )}
      {/* The credit, for the half of the shelf that is somebody else's work.
          Same link the caption carries while it is playing, kept on the row so a
          clip you kept months ago can still be traced to its licence. */}
      {remote === null ? null : (
        <CreditLink
          origin={remote.origin}
          href={poolPageUrl(remote)}
          label={clip.name}
          className={styles.rowBtn}
        />
      )}
      <button
        className={styles.rowBtn}
        title={
          remote !== null
            ? `take ${clip.name} off the shelf — it stays on ${ORIGIN_LABEL[remote.origin]}`
            : fetched !== null
              ? `take ${clip.name} off the shelf — the clip stays where ${YTDLP_LABEL} got it`
              : `take ${clip.name} off the shelf — the file itself is untouched`
        }
        aria-label={`remove ${clip.name}`}
        onClick={() => props.onForget(clip)}
      >
        ×
      </button>
    </div>
  )
}

// A group's heading, and the two things that can be done to a *folder* as a
// whole. Its own component so `folder` is narrowed once, as a const the click
// handlers can close over — the loose picks and the two kept-roll groups have a
// null folder and neither button, since there is nothing on disk to rescan and
// no grant to drop.
function GroupHead(props: {
  label: string
  folder: ClipFolder | null
  rescannable: boolean
  onRescan: (folder: ClipFolder) => void
  onForget: (folder: ClipFolder) => void
}) {
  const { folder } = props
  return (
    <div className={styles.head}>
      <span className={styles.headName}>{props.label}</span>
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
  // Append a clip to the rundown — see `ClipRow` for why this is a button and
  // not a drag. Undefined where there is no rundown on screen to append to.
  onAddRow?: (clip: Clip) => void
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
  // Which halves of the shelf are occupied, which is what decides the two
  // closing paragraphs: they say different things about what survives a reload,
  // and neither is true of the other half.
  const disk = props.lib.clips.filter(c => c.at === 'disk').length
  const fetched = props.lib.clips.filter(c => clipFetch(c) !== null).length
  const kept = props.lib.clips.length - disk - fetched
  // Pulled off the props object rather than read as `props.filesRef` at the
  // <input>: a ref read during render marks the whole props object as ref-ish
  // to the React Compiler, which then drops this component's memoization
  // entirely (the same note SourceSlot carries).
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
          browser that can hold a folder open, every session after this one. The
          ★ beside a rolled picture keeps that too, on the same shelf.
        </div>
      ) : groups.length === 0 ? (
        <div className={ui.hint}>no clip matches “{query}”</div>
      ) : (
        <div className={styles.list}>
          {groups.map(group => (
            <div key={group.id}>
              <GroupHead
                label={group.label}
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
                  onAddRow={props.onAddRow}
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

      {/* Only where there is footage on disk to say it about. Everything in that
          sentence — the grant, the re-pick, the folder — is about files the
          browser has to be given back, and a shelf holding nothing but kept
          rolls has none: those come back on their own, which is the line below
          it. Shown unconditionally it was a promise of work nobody had to do. */}
      {disk === 0 ? null : (
        <div className={ui.hint}>
          {props.canRemember
            ? 'a folder is one permission covering everything in it, so the next session asks once and the whole shelf opens. Only files directly inside the folder count — add each folder you want.'
            : 'this browser can’t hold a file open past a reload, so the shelf keeps the list and not the footage: next session, re-pick the folder once and every row comes back. Only files directly inside it count.'}
        </div>
      )}

      {kept === 0 ? null : (
        <div className={ui.hint}>
          a kept roll is the file’s name and not the picture, so it costs
          nothing on disk and comes back on its own next session — playing one
          asks the archive for it again, at whatever size this app wants today.
          Kept in this browser: a shared link carries the look, not the shelf.
        </div>
      )}

      {/* The third half of the shelf, and the one with a condition on it: a
          fetched clip is a URL, and the thing that turns a URL back into
          footage is the dev server's yt-dlp bridge. It still has the download
          it made, so a row clicked twice costs one fetch — but a build with no
          bridge behind it has nowhere to ask. */}
      {fetched === 0 ? null : (
        <div className={ui.hint}>
          a fetched clip is its address, so playing one asks {YTDLP_LABEL} for
          it again — instantly while the dev server still has the download, and
          not at all in a build without the bridge. A trimmed clip and the whole
          of the same clip are two rows, because they are two different files.
        </div>
      )}

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
