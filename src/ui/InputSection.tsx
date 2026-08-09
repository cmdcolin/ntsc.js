import { isCommonsId } from '../sources/commons'
import {
  SOURCE_B_MODES,
  SOURCE_DESC,
  SOURCE_MODES,
  sourceOptions,
} from '../sources/modes'
import { FileName, ReopenFile, WikiCaption } from './FileName'
import { CueRow, Scrub } from './Scrub'
import { Section } from './Section'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import { TeletypeRow } from './TeletypeRow'
import ui from './ui.module.css'
import { SPEED_DEFAULT } from './urlParams'

import type { SourceBMode, SourceMode } from '../sources/modes'
import type { AnySlotView, SlotView } from './slotView'
import type { ReactNode, RefObject } from 'react'

// The YouTube option is backed by the dev-only yt-dlp bridge, so hide it in
// production builds where the /yt endpoint doesn't exist.
const A_MODES = import.meta.env.DEV
  ? SOURCE_MODES
  : SOURCE_MODES.filter(m => m !== 'youtube')
const B_MODES = import.meta.env.DEV
  ? SOURCE_B_MODES
  : SOURCE_B_MODES.filter(m => m !== 'youtube')

// What the cue tooltips call the keys useShortcuts binds. Written beside the rows
// that mention them rather than imported from the shortcut table: that table maps
// keys to handlers and has no idea which slot a handler ended up on, so the two
// agree by convention either way — and this is the end that has to be read.
const CUE_KEYS = {
  a: { tap: 'i', retrigger: 'o' },
  b: { tap: 'shift+I', retrigger: 'shift+O' },
} as const

const A_OPTIONS = sourceOptions(A_MODES)
const B_OPTIONS = sourceOptions(B_MODES)

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
// menu — ClipPicker.tsx) and is still a named mode, because the folded header
// below reads the name from here.
const namedMode = (m: SourceMode | SourceBMode): boolean =>
  m === 'file' ||
  m === 'library' ||
  m === 'wiki-faves' ||
  m === 'youtube' ||
  m === 'screen' ||
  isCommonsId(m)

// What clicking the caption does, which is the one thing the named modes do not
// share: a channel rolls the next file out of the same pool, the starred list
// reopens on the row you would change to, and a file or a share goes back out to
// the browser's own picker.
const captionAction = (m: SourceMode | SourceBMode): string =>
  isCommonsId(m)
    ? 'roll another'
    : m === 'wiki-faves'
      ? 'open your favorites'
      : 'change'

// The header's reading of what is patched in, so the section can start folded.
// Input is set once a session and then costs 141px of the sidebar's most
// contested stretch — the three pickers, their captions and the hint — to show
// two dropdowns nobody is going to touch again. Folded it costs one line, and
// this is what makes that free: the thing you would have opened it to check is
// already on the header.
//
// SOURCE_DESC's options are written "short name — what it is", so the half
// before the dash is the name on its own. A loaded file or share carries its
// own name instead, which is the more useful of the two and the only one that
// distinguishes two files.
const shortName = (m: SourceMode | SourceBMode, name: string): string =>
  namedMode(m) && name !== ''
    ? name
    : SOURCE_DESC[m].split(' — ')[0].replace(/…$/, '')

// The ★ and the credit link a Commons pick carries, or null when the slot is on
// anything else. Built by the caller from the slot's own `wiki`, because it takes
// one fact from the engine and one from the favourites list and neither of those
// two can see the other.
export type WikiSlot = {
  page: string
  starred: boolean
  onStar: () => void
} | null

// The hidden file picker behind a slot's "file" mode. One component rather than
// two <input>s, because the interesting line is the last one: without resetting
// `value`, picking the *same* file twice fires no change event and the second
// pick silently does nothing. That is exactly the kind of detail one of two
// copies loses.
//
// Mounted outside the collapsible Section by its caller, so a folded Input can
// still fire the dialog through the ref.
function HiddenFilePicker(props: {
  inputRef: RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
}) {
  const { inputRef } = props
  return (
    <input
      ref={inputRef}
      type="file"
      accept="video/*,image/*"
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
function SourceSlot<T extends SourceMode | SourceBMode>(props: {
  slot: SlotView<T>
  title: string
  options: readonly { value: T; label: string; group?: string | null }[]
  // This slot's clip menu, built by the app because the shelf's state is the
  // app's — the same arrangement `audioInput` below is passed in under.
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
                starred={wiki.starred}
                onStar={wiki.onStar}
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
    </>
  )
}

export function InputSection(props: {
  // The two slots, whole. Everything that used to arrive here as a `…A`/`…B`
  // pair is inside one of these; what remains beside them is the handful of
  // things the engine does not own.
  a: SlotView<SourceMode>
  b: SlotView<SourceBMode>
  webcamDeviceId: string
  videoDevices: MediaDeviceInfo[]
  onStartWebcam: (deviceId: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  fileInputBRef: RefObject<HTMLInputElement | null>
  // The clip menu and the Commons caption, as *functions of a slot* rather than
  // as two pairs. Both are the app's to build — the shelf and the favourites
  // list are its state — but asking for them one slot at a time is what keeps
  // the answer attached to the slot it was asked about: there is no second
  // argument to get the wrong way round.
  clipPicker: (slot: AnySlotView) => ReactNode
  wikiCaption: (slot: AnySlotView) => WikiSlot
  // Audio in is a source too, so its picker sits with A and B; the Sound branch
  // on the chain map keeps only the knobs it drives. Its helper line comes in
  // separately: all three pickers stack first, then the hints.
  audioInput: ReactNode
  audioHint: ReactNode
}) {
  // Pulled out rather than read as `props.fileInputRef` at each picker: a ref
  // read off the props object marks the whole object as ref-ish to the React
  // Compiler, which then refuses every other `props.x` read as a ref access
  // during render and drops this component's memoization entirely.
  const { fileInputRef, fileInputBRef, a, b } = props
  const summary =
    shortName(a.mode, a.name) +
    (b.mode === 'none' ? '' : ` + ${shortName(b.mode, b.name)}`)
  return (
    <div>
      <Section title="Input" defaultOpen={false} summary={summary}>
        <SourceSlot
          slot={a}
          title="main source"
          options={A_OPTIONS}
          clipPicker={props.clipPicker(a)}
          wiki={props.wikiCaption(a)}
        >
          {a.mode === 'webcam' && props.videoDevices.length > 1 ? (
            <SelectRow
              tag="◉"
              title="capture device"
              value={props.webcamDeviceId}
              options={props.videoDevices.map((d, i) => ({
                value: d.deviceId,
                label: d.label === '' ? `Device ${i + 1}` : d.label,
              }))}
              onChange={props.onStartWebcam}
            />
          ) : null}
        </SourceSlot>
        <SourceSlot
          slot={b}
          title="second source, mixed in dirty"
          options={B_OPTIONS}
          clipPicker={props.clipPicker(b)}
          wiki={props.wikiCaption(b)}
        />
        {props.audioInput}
        {/* Only while B is off, where it is onboarding for a feature nothing on
            screen is showing. With B running it used to read "mix controls are
            in A/B Mix below" — a line of prose pointing at the section directly
            underneath it, which is a row the panel was spending to say nothing
            the next header does not. */}
        {b.mode === 'none' ? (
          <div className={ui.hint}>
            pick a source B to mix a second signal in.
          </div>
        ) : null}
        {/* The one thing about a share the browser's picker can't tell you:
            pointing it at this very window closes an optical loop through the
            compositor — a camera on the tube, without the camera. */}
        {a.mode === 'screen' || b.mode === 'screen' ? (
          <div className={ui.hint}>
            share this window itself for a real feedback tunnel. stop sharing
            from the browser and the input goes to snow.
          </div>
        ) : null}
        {props.audioHint}
      </Section>
      {/* Hidden pickers stay mounted outside the collapsible Section, so a
          collapsed Input can still fire the file dialog through its ref. Each
          line carries both halves of its pair, which is the most a ref can be
          tied to its slot — refs cannot ride on the slot objects themselves
          without costing this component its memoization (see above). */}
      <HiddenFilePicker inputRef={fileInputRef} onFile={a.onFile} />
      <HiddenFilePicker inputRef={fileInputBRef} onFile={b.onFile} />
    </div>
  )
}
