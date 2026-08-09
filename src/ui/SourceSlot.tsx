import { isArchiveId } from '../sources/archive'
import { isCommonsId } from '../sources/commons'
import { FileName, ReopenFile, WikiCaption } from './FileName'
import { CueRow, Scrub } from './Scrub'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import { TeletypeRow } from './TeletypeRow'
import ui from './ui.module.css'
import { SPEED_DEFAULT } from './urlParams'

import type { SourceBMode, SourceMode } from '../sources/modes'
import type { SlotView } from './slotView'
import type { ReactNode, RefObject } from 'react'

// What the cue tooltips call the keys useShortcuts binds. Written beside the rows
// that mention them rather than imported from the shortcut table: that table maps
// keys to handlers and has no idea which slot a handler ended up on, so the two
// agree by convention either way — and this is the end that has to be read.
const CUE_KEYS = {
  a: { tap: 'i', retrigger: 'o' },
  b: { tap: 'shift+I', retrigger: 'shift+O' },
} as const

// The source-name caption shows for loaded file/YouTube sources, and for a
// screen share — where it names the shared surface and, clicked, reopens the
// browser's picker, which is the only way back to a different window. Teletype
// carries something the picker can't say too, but its words are editable, so
// it gets a row of its own rather than a caption.
//
// The Commons entries join them for a different reason: the picker names a pool
// rather than a picture, so the caption is the only thing saying which file came
// back — and clicking it rolls another out of the same pool. The clip shelf and
// the starred rolls are that shape once more, the option naming a list and the
// caption naming what came off it. `library` draws its own caption instead (a
// menu — ClipPicker.tsx).
const namedMode = (m: SourceMode | SourceBMode): boolean =>
  m === 'file' ||
  m === 'library' ||
  m === 'wiki-faves' ||
  m === 'youtube' ||
  m === 'screen' ||
  isCommonsId(m) ||
  isArchiveId(m)

// What clicking the caption does, which is the one thing the named modes do not
// share: a channel rolls the next file out of the same pool, the starred list
// reopens on the row you would change to, and a file or a share goes back out to
// the browser's own picker.
const captionAction = (m: SourceMode | SourceBMode): string =>
  isCommonsId(m) || isArchiveId(m)
    ? 'roll another'
    : m === 'wiki-faves'
      ? 'open your favorites'
      : 'change'

// The credit link a rolled pick carries — and, where there is a shelf to keep it
// on, the ★ as well — or null when the slot is on anything else. Built by the
// caller from the slot's own pick, because it takes one fact from the engine and
// one from the favourites list and neither of those two can see the other.
export type WikiSlot = {
  page: string
  where: string
  star: { starred: boolean; onStar: () => void } | null
} | null

// The hidden file picker behind a slot's "file" mode. One component rather than
// three <input>s — A, B and the sound each have one — because the interesting
// line is the last one: without resetting `value`, picking the *same* file twice
// fires no change event and the second pick silently does nothing. That is
// exactly the kind of detail one of three copies loses.
//
// Mounted by the app outside the panel, never inside the stage whose picker it
// belongs to. Every one of these is fired programmatically — selecting 'file'
// calls `.click()` on the ref — and a stage that is folded away has unmounted
// its subtree, which would leave the ref null and the choice silently doing
// nothing. That was already the arrangement while the pickers lived in a
// section that started folded; the stages they live in now start folded too.
export function HiddenFilePicker(props: {
  inputRef: RefObject<HTMLInputElement | null>
  // Video and image for a picture slot; audio too for the sound.
  accept: string
  onFile: (file: File | undefined) => void
}) {
  const { inputRef } = props
  return (
    <input
      ref={inputRef}
      type="file"
      accept={props.accept}
      style={{ display: 'none' }}
      onChange={e => {
        props.onFile(e.target.files?.[0])
        e.target.value = '' // allow re-picking the same file
      }}
    />
  )
}

// One input slot: its picker, and whatever that choice brings with it — the card
// editor for teletype, the name of a loaded file or share, a click to reopen last
// session's file, a seek bar for anything with a timeline.
//
// It sits at the head of that slot's own stage on the chain map, above the groups
// that shape what it brings in. It used to sit in a section called "Input", 60px
// above a map that was already drawing boxes named SOURCE A and SOURCE B — two
// surfaces for the same three things, where the box carrying the name opened the
// *signal* groups rather than the picker that decides what the signal is.
//
// A and B are the same rig twice, so they are one component twice rather than two
// near-identical blocks of markup. They had drifted into thirty-five mirrored
// lines each, which is the shape that lets one slot quietly gain an affordance the
// other lacks — the same argument controls.test.ts makes for the two feed groups.
//
// It takes the slot *whole* (ui/slotView.ts) rather than as eighteen unpacked
// props. The unpacked version put the pairing in the caller — eighteen chances to
// hand B's picker A's cue, each of which typechecks — and this component is the
// only reason those pairs existed. What is left beside `slot` is the two things
// the engine genuinely does not own: the option list for this slot's mode union,
// and the shelf menu, which is the app's state.
//
// Generic over the mode type so each slot keeps its own union: B can be 'none' and
// A can be 'webcam', and neither can be handed the other's value.
export function SourceSlot<T extends SourceMode | SourceBMode>(props: {
  slot: SlotView<T>
  title: string
  options: readonly { value: T; label: string; group?: string | null }[]
  // This slot's clip menu, built by the app because the shelf's state is the
  // app's — the same arrangement the sound's picker is passed in under.
  clipPicker: ReactNode
  // The ★ and credit line for a Commons pick, likewise assembled by the app.
  wiki: WikiSlot
  // The capture-device picker, which only A can have — a trailing row rather than
  // a prop this component understands, so the slot stays the same shape for both.
  children?: ReactNode
}) {
  const { slot, wiki } = props
  // The tooltips name this slot's own keys, looked up from the slot rather than
  // passed alongside it: one more pair that cannot now be crossed.
  const cueKeys = CUE_KEYS[slot.key]
  return (
    <>
      <SelectRow
        tag={slot.tag}
        title={props.title}
        value={slot.mode}
        options={props.options}
        onChange={slot.select}
      />
      {slot.mode === 'teletype' ? (
        <TeletypeRow
          text={slot.teletype.text}
          onChange={text => slot.retype({ text })}
          onOpenDialog={() => slot.select(slot.mode)}
        />
      ) : null}
      {/* The shelf gets a caption that is also a menu, so changing clip does not
          go through the dialog (ClipPicker.tsx). Everything else re-fires the
          source handler, which is the only way back to a picker the <select>
          cannot re-emit for. */}
      {slot.mode === 'library' ? (
        props.clipPicker
      ) : namedMode(slot.mode) ? (
        <FileName
          name={slot.name}
          action={captionAction(slot.mode)}
          extra={
            wiki === null ? null : (
              <WikiCaption
                page={wiki.page}
                where={wiki.where}
                star={wiki.star}
              />
            )
          }
          onReopen={() => slot.select(slot.mode)}
        />
      ) : null}
      <ReopenFile name={slot.pendingFile} onReopen={() => slot.reopenFile()} />
      {slot.duration === 0 ? null : (
        <>
          <Scrub
            time={slot.time}
            duration={slot.duration}
            cue={slot.cue}
            onSeek={slot.seek}
          />
          {/* Behind the same duration gate as the seek bar, and for the same
              reason: a cue is a position on a timeline, and a webcam or a share
              has not got one. */}
          <CueRow
            cue={slot.cue}
            onTap={slot.tapCue}
            onRetrigger={slot.retrigger}
            onClear={slot.clearCue}
            keys={cueKeys}
            wrapCost={slot.wrapCost}
          />
          {/* Playback rate, and the pitch that falls with it — a property of
              this deck and nothing else, which is why it sits under this slot's
              own transport rather than in a "Vaporwave" section that named the
              sound it makes instead of the thing it belongs to. Behind the same
              duration gate: an element backed by a MediaStream ignores
              playbackRate, so a rate slider over a webcam or a share is a lie
              the moment it moves. */}
          <Slider
            label="speed"
            unit="×"
            min={0.25}
            max={1.5}
            step={0.01}
            value={slot.speed}
            defaultValue={SPEED_DEFAULT}
            onChange={slot.changeSpeed}
          />
        </>
      )}
      {props.children}
      {/* The one thing about a share the browser's picker can't tell you:
          pointing it at this very window closes an optical loop through the
          compositor — a camera on the tube, without the camera. Per slot rather
          than once for either, now that each slot draws inside its own stage:
          the line is about the slot you are looking at. */}
      {slot.mode === 'screen' ? (
        <div className={ui.hint}>
          share this window itself for a real feedback tunnel. stop sharing from
          the browser and the input goes to snow.
        </div>
      ) : null}
    </>
  )
}
