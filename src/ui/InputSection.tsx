import { isCommonsId } from '../sources/commons'
import {
  SOURCE_B_MODES,
  SOURCE_DESC,
  SOURCE_MODES,
  sourceOptions,
} from '../sources/modes'
import { FileName, ReopenFile, WikiCaption } from './FileName'
import { Scrub } from './Scrub'
import { Section } from './Section'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import { TeletypeRow } from './TeletypeRow'
import ui from './ui.module.css'
import { SPEED_DEFAULT } from './urlParams'

import type { SourceBMode, SourceMode } from '../sources/modes'
import type { TeletypeCard } from '../sources/teletype'
import type { ReactNode, RefObject } from 'react'

// The YouTube option is backed by the dev-only yt-dlp bridge, so hide it in
// production builds where the /yt endpoint doesn't exist.
const A_MODES = import.meta.env.DEV
  ? SOURCE_MODES
  : SOURCE_MODES.filter(m => m !== 'youtube')
const B_MODES = import.meta.env.DEV
  ? SOURCE_B_MODES
  : SOURCE_B_MODES.filter(m => m !== 'youtube')

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
// anything else. Named because both slots take one and the caller builds them.
export type WikiSlot = {
  page: string
  starred: boolean
  onStar: () => void
} | null

// One input slot: its picker, and whatever that choice brings with it — the card
// editor for teletype, the name of a loaded file or share, a click to reopen last
// session's file, a seek bar for anything with a timeline.
//
// A and B are the same rig twice, so they are one component twice rather than two
// near-identical blocks of markup. They had drifted into thirty-five mirrored
// lines each, which is the shape that lets one slot quietly gain an affordance the
// other lacks — the same argument controls.test.ts makes for the two feed groups.
// Generic over the mode type so each slot keeps its own union: B can be 'none' and
// A can be 'webcam', and neither can be handed the other's value.
function SourceSlot<T extends SourceMode | SourceBMode>(props: {
  tag: string
  title: string
  mode: T
  name: string
  options: readonly { value: T; label: string; group?: string | null }[]
  onSelect: (mode: T) => void
  teletype: TeletypeCard
  onTeletype: (text: string) => void
  pendingFile: string
  onReopenFile: () => void
  // This slot's clip menu, built by the app because the shelf's state is the
  // app's — the same arrangement `audioInput` below is passed in under.
  clipPicker: ReactNode
  time: number
  duration: number
  onSeek: (time: number) => void
  // Playback rate, and the pitch that falls with it — a property of this deck
  // and nothing else, which is why it sits under this slot's own transport
  // rather than in a "Vaporwave" section that named the sound it makes instead
  // of the thing it belongs to. Gated on the same duration the seek bar is: an
  // element backed by a MediaStream ignores playbackRate, so a rate slider over
  // a webcam or a share is a lie the moment it moves.
  speed: number
  onSpeed: (v: number) => void
  // What this slot has off Commons, or null for anything else: the file's page,
  // whether it is starred, and the toggle. Assembled by the caller because it
  // takes one fact from the engine and one from the favourites list, and neither
  // of those two can see the other.
  wiki: WikiSlot
  // The capture-device picker, which only A can have — a trailing row rather than
  // a prop this component understands, so the slot stays the same shape for both.
  children?: ReactNode
}) {
  const { wiki } = props
  return (
    <>
      <SelectRow
        tag={props.tag}
        title={props.title}
        value={props.mode}
        options={props.options}
        onChange={props.onSelect}
      />
      {props.mode === 'teletype' ? (
        <TeletypeRow
          text={props.teletype.text}
          onChange={props.onTeletype}
          onOpenDialog={() => props.onSelect(props.mode)}
        />
      ) : null}
      {/* The shelf gets a caption that is also a menu, so changing clip does not
          go through the dialog (ClipPicker.tsx). Everything else re-fires the
          source handler, which is the only way back to a picker the <select>
          cannot re-emit for. */}
      {props.mode === 'library' ? (
        props.clipPicker
      ) : namedMode(props.mode) ? (
        <FileName
          name={props.name}
          action={captionAction(props.mode)}
          extra={
            wiki === null ? null : (
              <WikiCaption
                page={wiki.page}
                starred={wiki.starred}
                onStar={wiki.onStar}
              />
            )
          }
          onReopen={() => props.onSelect(props.mode)}
        />
      ) : null}
      <ReopenFile
        name={props.pendingFile}
        onReopen={() => props.onReopenFile()}
      />
      {props.duration === 0 ? null : (
        <>
          <Scrub
            time={props.time}
            duration={props.duration}
            onSeek={props.onSeek}
          />
          <Slider
            label="speed"
            unit="×"
            min={0.25}
            max={1.5}
            step={0.01}
            value={props.speed}
            defaultValue={SPEED_DEFAULT}
            onChange={props.onSpeed}
          />
        </>
      )}
      {props.children}
    </>
  )
}

export function InputSection(props: {
  sourceMode: SourceMode
  sourceName: string
  onSelectSource: (mode: SourceMode) => void
  sourceBMode: SourceBMode
  sourceBName: string
  onSelectSourceB: (mode: SourceBMode) => void
  // Each slot's teletype card, shown and edited in place while that slot is on
  // teletype. Edits land on the card as they are typed.
  teletypeA: TeletypeCard
  teletypeB: TeletypeCard
  onTeletypeA: (text: string) => void
  onTeletypeB: (text: string) => void
  webcamDeviceId: string
  videoDevices: MediaDeviceInfo[]
  onStartWebcam: (deviceId: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  fileInputBRef: RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
  onFileB: (file: File | undefined) => void
  // Last session's file for each slot when it needs a click to come back, '' when
  // there is nothing waiting.
  pendingFileA: string
  pendingFileB: string
  onReopenFileA: () => void
  onReopenFileB: () => void
  // The clip menu per slot, shown in place of the caption while that slot is on
  // the shelf.
  clipPickerA: ReactNode
  clipPickerB: ReactNode
  // Playhead per slot, for the seek bar under each picker. A duration of 0 is
  // "this source has no timeline" — a pattern, a still, a webcam — and the bar
  // stays off, the same gate the audio file's transport uses.
  timeA: number
  durationA: number
  timeB: number
  durationB: number
  onSeekA: (time: number) => void
  onSeekB: (time: number) => void
  // Playback rate per slot, under that slot's own transport.
  speedA: number
  speedB: number
  onSpeedA: (v: number) => void
  onSpeedB: (v: number) => void
  // Per slot, what it has off Commons — the ★ and the credit link under its own
  // caption. Null for every other kind of source.
  wikiA: WikiSlot
  wikiB: WikiSlot
  // Audio in is a source too, so its picker sits with A and B; the Sound branch
  // on the chain map keeps only the knobs it drives. Its helper line comes in
  // separately: all three pickers stack first, then the hints.
  audioInput: ReactNode
  audioHint: ReactNode
}) {
  // Pulled out rather than read as `props.fileInputRef` at each <input>: a ref
  // read off the props object marks the whole object as ref-ish to the React
  // Compiler, which then refuses every other `props.x` read as a ref access
  // during render and drops this component's memoization entirely.
  const { fileInputRef, fileInputBRef } = props
  const summary =
    shortName(props.sourceMode, props.sourceName) +
    (props.sourceBMode === 'none'
      ? ''
      : ` + ${shortName(props.sourceBMode, props.sourceBName)}`)
  return (
    <div>
      <Section title="Input" defaultOpen={false} summary={summary}>
        <SourceSlot
          tag="A"
          title="main source"
          mode={props.sourceMode}
          name={props.sourceName}
          options={A_OPTIONS}
          onSelect={props.onSelectSource}
          teletype={props.teletypeA}
          onTeletype={props.onTeletypeA}
          pendingFile={props.pendingFileA}
          onReopenFile={props.onReopenFileA}
          clipPicker={props.clipPickerA}
          time={props.timeA}
          duration={props.durationA}
          onSeek={props.onSeekA}
          speed={props.speedA}
          onSpeed={props.onSpeedA}
          wiki={props.wikiA}
        >
          {props.sourceMode === 'webcam' && props.videoDevices.length > 1 ? (
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
          tag="B"
          title="second source, mixed in dirty"
          mode={props.sourceBMode}
          name={props.sourceBName}
          options={B_OPTIONS}
          onSelect={props.onSelectSourceB}
          teletype={props.teletypeB}
          onTeletype={props.onTeletypeB}
          pendingFile={props.pendingFileB}
          onReopenFile={props.onReopenFileB}
          clipPicker={props.clipPickerB}
          time={props.timeB}
          duration={props.durationB}
          onSeek={props.onSeekB}
          speed={props.speedB}
          onSpeed={props.onSpeedB}
          wiki={props.wikiB}
        />
        {props.audioInput}
        {/* Only while B is off, where it is onboarding for a feature nothing on
            screen is showing. With B running it used to read "mix controls are
            in A/B Mix below" — a line of prose pointing at the section directly
            underneath it, which is a row the panel was spending to say nothing
            the next header does not. */}
        {props.sourceBMode === 'none' ? (
          <div className={ui.hint}>
            pick a source B to mix a second signal in.
          </div>
        ) : null}
        {/* The one thing about a share the browser's picker can't tell you:
            pointing it at this very window closes an optical loop through the
            compositor — a camera on the tube, without the camera. */}
        {props.sourceMode === 'screen' || props.sourceBMode === 'screen' ? (
          <div className={ui.hint}>
            share this window itself for a real feedback tunnel. stop sharing
            from the browser and the input goes to snow.
          </div>
        ) : null}
        {props.audioHint}
      </Section>
      {/* Hidden pickers stay mounted outside the collapsible Section, so a
          collapsed Input can still fire the file dialog through its ref. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: 'none' }}
        onChange={e => {
          props.onFile(e.target.files?.[0])
          e.target.value = '' // allow re-picking the same file
        }}
      />
      <input
        ref={fileInputBRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: 'none' }}
        onChange={e => {
          props.onFileB(e.target.files?.[0])
          e.target.value = '' // allow re-picking the same file
        }}
      />
    </div>
  )
}
