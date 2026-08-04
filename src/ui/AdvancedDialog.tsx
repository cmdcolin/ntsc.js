import { cx } from './cx'
import { Dialog } from './Dialog'
import dlg from './dialog.module.css'
import { SelectRow } from './SelectRow'
import { SIGNAL_TAPS, tapFor } from './signalTap'
import { Slider } from './Slider'
import ui from './ui.module.css'

import type { MidiStatus } from './midi'

const TAP_OPTIONS = SIGNAL_TAPS.map(t => ({
  value: String(t.value),
  label: t.label,
}))

export function AdvancedDialog(props: {
  renderScale: number
  onScaleChange: (v: number) => void
  res: string
  // The tap on the glass. Owned above rather than here: the stage menu switches
  // it too, and the menu trigger badges it, so this dialog is one writer of a
  // shared value rather than the place it lives.
  tap: number
  onTapChange: (v: number) => void
  midiStatus: MidiStatus
  onEnableMidi: () => void
  onClose: () => void
}) {
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
        value={String(tapFor(props.tap).value)}
        options={TAP_OPTIONS}
        onChange={v => props.onTapChange(Number(v))}
      />
      <div className={ui.dim} style={{ margin: '2px 0 12px' }}>
        see what the TV sees: the raw waveform, or luma / chroma / burst
        mid-decode — the fastest way to understand what a control is doing. Also
        on the stage menu, which badges whichever tap is live.
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
