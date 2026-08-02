import { useState } from 'react'

import { cx } from './cx'
import { Dialog } from './Dialog'
import dlg from './dialog.module.css'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import ui from './ui.module.css'

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

type DbgValue = (typeof DBG_OPTIONS)[number]['value']

// getDbgView() can report any number ?dbg= was set to, not just one of the
// options above — fall back to 'off' rather than asserting an unrecognized one.
function dbgValue(view: number | undefined): DbgValue {
  const s = String(view ?? 0)
  const found = DBG_OPTIONS.find(o => o.value === s)
  return found ? found.value : '0'
}

export function AdvancedDialog(props: {
  renderScale: number
  onScaleChange: (v: number) => void
  res: string
  midiStatus: MidiStatus
  onEnableMidi: () => void
  engine: Engine | null
  onClose: () => void
}) {
  const [dbg, setDbg] = useState(() => dbgValue(props.engine?.getDbgView()))
  return (
    <Dialog title="Advanced" size="form" onClose={props.onClose}>
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
      <div className={ui.dim} style={{ margin: '2px 0 12px' }}>
        backing-store resolution · lower = faster · {props.res}
      </div>
      <div className={dlg.subhead}>signal tap</div>
      <SelectRow
        tag="◫"
        title="view the signal mid-decode instead of the finished picture"
        value={dbg}
        options={DBG_OPTIONS}
        onChange={v => {
          setDbg(v)
          props.engine?.setDbgView(Number(v))
        }}
      />
      <div className={ui.dim} style={{ margin: '2px 0 12px' }}>
        see what the TV sees: the raw waveform, or luma / chroma / burst
        mid-decode — the fastest way to understand what a control is doing.
      </div>
      <div className={dlg.subhead}>MIDI control</div>
      {props.midiStatus === 'idle' ? (
        <button
          className={cx(ui.btn, ui.btnFlush)}
          onClick={props.onEnableMidi}
        >
          enable MIDI
        </button>
      ) : null}
      {props.midiStatus === 'requesting' ? (
        <div className={ui.muted}>requesting access…</div>
      ) : null}
      {props.midiStatus === 'unsupported' ? (
        <div className={ui.warn}>Web MIDI not supported in this browser.</div>
      ) : null}
      {props.midiStatus === 'denied' ? (
        <div className={ui.err}>
          Access denied.{' '}
          <button
            className={cx(ui.btn, ui.btnFlush)}
            onClick={props.onEnableMidi}
          >
            retry
          </button>
        </div>
      ) : null}
      {props.midiStatus === 'ready' ? (
        <div className={ui.ok}>
          enabled — bind knobs from the MIDI panel in the sidebar.
        </div>
      ) : null}
      <div className={ui.dim} style={{ margin: '4px 0 0' }}>
        map a hardware controller to any slider; sync rates to MIDI clock.
      </div>
    </Dialog>
  )
}
