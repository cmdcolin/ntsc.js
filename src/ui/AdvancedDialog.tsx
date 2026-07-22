import { useState } from 'react'

import styles from '../app.module.css'
import { Dialog } from './Dialog'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import { cx } from './cx'

import type { Engine } from '../gpu/pipeline'
import type { MidiStatus } from './midi'

// The decode-stage taps otherwise reachable only via ?dbg= in the URL.
const DBG_OPTIONS = [
  { value: '0', label: 'off — decoded picture' },
  { value: '2', label: 'composite waveform' },
  { value: '3', label: 'luma channel' },
  { value: '4', label: 'chroma (U/V energy)' },
  { value: '5', label: 'burst / decoder state' },
] as const

export function AdvancedDialog(props: {
  renderScale: number
  onScaleChange: (v: number) => void
  res: string
  midiStatus: MidiStatus
  onEnableMidi: () => void
  engine: Engine | null
  onClose: () => void
}) {
  const [dbg, setDbg] = useState(() => String(props.engine?.getDbgView() ?? 0))
  return (
    <Dialog title="Advanced" onClose={props.onClose}>
      <Slider
        label="render scale"
        unit="x"
        min={0.25}
        max={2}
        step={0.05}
        value={props.renderScale}
        defaultValue={1}
        onChange={props.onScaleChange}
      />
      <div className={styles.dim} style={{ margin: '2px 0 12px' }}>
        backing-store resolution · lower = faster · {props.res}
      </div>
      <div className={styles.subhead}>signal tap</div>
      <SelectRow
        tag="◫"
        title="view the signal mid-decode instead of the finished picture"
        value={dbg as (typeof DBG_OPTIONS)[number]['value']}
        options={DBG_OPTIONS}
        onChange={v => {
          setDbg(v)
          props.engine?.setDbgView(Number(v))
        }}
      />
      <div className={styles.dim} style={{ margin: '2px 0 12px' }}>
        see what the TV sees: the raw waveform, or luma / chroma / burst
        mid-decode — the fastest way to understand what a control is doing.
      </div>
      <div className={styles.subhead}>MIDI control</div>
      {props.midiStatus === 'idle' ? (
        <button
          className={cx(styles.btn, styles.btnFlush)}
          onClick={props.onEnableMidi}
        >
          enable MIDI
        </button>
      ) : null}
      {props.midiStatus === 'requesting' ? (
        <div className={styles.muted}>requesting access…</div>
      ) : null}
      {props.midiStatus === 'unsupported' ? (
        <div className={styles.warn}>
          Web MIDI not supported in this browser.
        </div>
      ) : null}
      {props.midiStatus === 'denied' ? (
        <div className={styles.err}>
          Access denied.{' '}
          <button
            className={cx(styles.btn, styles.btnFlush)}
            onClick={props.onEnableMidi}
          >
            retry
          </button>
        </div>
      ) : null}
      {props.midiStatus === 'ready' ? (
        <div className={styles.ok}>
          enabled — bind knobs from the MIDI panel in the sidebar.
        </div>
      ) : null}
      <div className={styles.dim} style={{ margin: '4px 0 0' }}>
        map a hardware controller to any slider; sync rates to MIDI clock.
      </div>
    </Dialog>
  )
}
