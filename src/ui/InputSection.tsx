import { SOURCE_B_MODES, SOURCE_DESC, SOURCE_MODES } from '../sources/modes'
import { FileName, ReopenFile } from './FileName'
import { Section } from './Section'
import { SelectRow } from './SelectRow'
import { TeletypeRow } from './TeletypeRow'
import ui from './ui.module.css'

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

const A_OPTIONS = A_MODES.map(m => ({ value: m, label: SOURCE_DESC[m] }))
const B_OPTIONS = B_MODES.map(m => ({ value: m, label: SOURCE_DESC[m] }))

// The source-name caption shows for loaded file/YouTube sources, and for a
// screen share — where it names the shared surface and, clicked, reopens the
// browser's picker, which is the only way back to a different window. Teletype
// carries something the picker can't say too, but its words are editable, so
// it gets a row of its own rather than a caption.
const namedMode = (m: SourceMode | SourceBMode): boolean =>
  m === 'file' || m === 'youtube' || m === 'screen'

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
  // Audio in is a source too, so its picker sits with A and B rather than in
  // the Audio section, which keeps only the knobs it drives. Its helper line
  // comes in separately: all three pickers stack first, then the hints.
  audioInput: ReactNode
  audioHint: ReactNode
}) {
  return (
    <div>
      <Section title="Input" defaultOpen>
        <SelectRow
          tag="A"
          title="main source"
          value={props.sourceMode}
          options={A_OPTIONS}
          onChange={props.onSelectSource}
        />
        {props.sourceMode === 'teletype' ? (
          <TeletypeRow
            text={props.teletypeA.text}
            onChange={props.onTeletypeA}
            onOpenDialog={() => props.onSelectSource('teletype')}
          />
        ) : null}
        {namedMode(props.sourceMode) ? (
          <FileName
            name={props.sourceName}
            onReopen={() => props.onSelectSource(props.sourceMode)}
          />
        ) : null}
        <ReopenFile
          name={props.pendingFileA}
          onReopen={() => props.onReopenFileA()}
        />
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
        <SelectRow
          tag="B"
          title="second source, mixed in dirty"
          value={props.sourceBMode}
          options={B_OPTIONS}
          onChange={props.onSelectSourceB}
        />
        {props.sourceBMode === 'teletype' ? (
          <TeletypeRow
            text={props.teletypeB.text}
            onChange={props.onTeletypeB}
            onOpenDialog={() => props.onSelectSourceB('teletype')}
          />
        ) : null}
        {namedMode(props.sourceBMode) ? (
          <FileName
            name={props.sourceBName}
            onReopen={() => props.onSelectSourceB(props.sourceBMode)}
          />
        ) : null}
        <ReopenFile
          name={props.pendingFileB}
          onReopen={() => props.onReopenFileB()}
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
        ref={props.fileInputRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: 'none' }}
        onChange={e => {
          props.onFile(e.target.files?.[0])
          e.target.value = '' // allow re-picking the same file
        }}
      />
      <input
        ref={props.fileInputBRef}
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
