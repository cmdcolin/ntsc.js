import type { RefObject } from 'react'
import styles from '../app.module.css'
import {
  SOURCE_B_MODES,
  SOURCE_DESC,
  SOURCE_MODES,
  type SourceBMode,
  type SourceMode,
} from '../sources/modes'
import { Section } from './Section'

// The YouTube option is backed by the dev-only yt-dlp bridge, so hide it in
// production builds where the /yt endpoint doesn't exist.
const A_MODES = import.meta.env.DEV
  ? SOURCE_MODES
  : SOURCE_MODES.filter(m => m !== 'youtube')
const B_MODES = import.meta.env.DEV
  ? SOURCE_B_MODES
  : SOURCE_B_MODES.filter(m => m !== 'youtube')

// The source-name caption shows for loaded file/YouTube sources.
const namedMode = (m: SourceMode | SourceBMode): boolean =>
  m === 'file' || m === 'youtube'

export function InputSection(props: {
  sourceMode: SourceMode
  sourceName: string
  onSelectSource: (mode: SourceMode) => void
  sourceBMode: SourceBMode
  sourceBName: string
  onSelectSourceB: (mode: SourceBMode) => void
  webcamDeviceId: string
  videoDevices: MediaDeviceInfo[]
  onStartWebcam: (deviceId: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  fileInputBRef: RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
  onFileB: (file: File | undefined) => void
}) {
  return (
    <div>
      <Section title="Input" defaultOpen>
        <div className={styles.inputRow}>
        <span className={styles.tag} title="main source">
          A
        </span>
        <select
          className={styles.select}
          value={props.sourceMode}
          onChange={e => {
            const m = SOURCE_MODES.find(x => x === e.target.value)
            if (m !== undefined) props.onSelectSource(m)
          }}
        >
          {A_MODES.map(mode => (
            <option key={mode} value={mode}>
              {SOURCE_DESC[mode]}
            </option>
          ))}
        </select>
      </div>
      {namedMode(props.sourceMode) && props.sourceName !== '' ? (
        <div className={styles.fileName} title={props.sourceName}>
          {props.sourceName}
        </div>
      ) : null}
      {props.sourceMode === 'webcam' && props.videoDevices.length > 1 ? (
        <div className={styles.inputRow}>
          <span className={styles.tag} title="capture device">
            ◉
          </span>
          <select
            className={styles.select}
            value={props.webcamDeviceId}
            onChange={e => props.onStartWebcam(e.target.value)}
          >
            {props.videoDevices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label === '' ? `Device ${i + 1}` : d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className={styles.inputRow}>
        <span className={styles.tag} title="second source, mixed in dirty">
          B
        </span>
        <select
          className={styles.select}
          value={props.sourceBMode}
          onChange={e => {
            const m = SOURCE_B_MODES.find(x => x === e.target.value)
            if (m !== undefined) props.onSelectSourceB(m)
          }}
        >
          {B_MODES.map(mode => (
            <option key={mode} value={mode}>
              {SOURCE_DESC[mode]}
            </option>
          ))}
        </select>
      </div>
      {namedMode(props.sourceBMode) && props.sourceBName !== '' ? (
        <div className={styles.fileName} title={props.sourceBName}>
          {props.sourceBName}
        </div>
      ) : null}
        {props.sourceBMode === 'none' ? (
          <div className={styles.hint}>
            pick a source B above to mix a second signal in.
          </div>
        ) : (
          <div className={styles.hint}>
            mix controls are in the A/B Mix section below.
          </div>
        )}
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
