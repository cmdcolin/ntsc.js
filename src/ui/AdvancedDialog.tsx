import { cx } from './cx'
import { Dialog } from './Dialog'
import dlg from './dialog.module.css'
import {
  FRAME_LOCK_LABEL,
  FRAME_LOCK_LABELS,
  frameLockLabel,
} from './frameLock'
import { SelectRow } from './SelectRow'
import { SIGNAL_TAPS, tapFor } from './signalTap'
import { Slider } from './Slider'
import { ToggleButtonGroup } from './ToggleButtonGroup'
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
  // The tap on the glass. Owned above rather than here: the app menu switches
  // it too, and the menu trigger badges it, so this dialog is one writer of a
  // shared value rather than the place it lives.
  tap: number
  onTapChange: (v: number) => void
  // Same arrangement as the tap: the control lives in the panel and in the app
  // menu, and this dialog is the one surface with room to say what it is
  // for. It sits with render scale because the two are the same question —
  // whether to spend the frame on picture or on cadence.
  frameLock: number
  onFrameLockChange: (v: number) => void
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
      <div className={dlg.subhead}>{FRAME_LOCK_LABEL}</div>
      <ToggleButtonGroup
        label={FRAME_LOCK_LABEL}
        options={[...FRAME_LOCK_LABELS]}
        value={props.frameLock}
        onChange={props.onFrameLockChange}
      />
      <div className={ui.dim} style={{ margin: '4px 0 12px' }}>
        render every second, third or fourth refresh instead of chasing every
        one: a steady lower cadence reads as intentional where a rate wavering
        between full and half reads as stutter. The simulation steps once per
        rendered frame, so rolls and noise crawl proportionally slower under a
        lock. <b>auto</b> engages the half-rate lock only once refreshes are
        genuinely being missed, and retries full rate on its own. Also in the ☰
        menu
        {props.frameLock === 0
          ? ''
          : `, which is showing “${frameLockLabel(props.frameLock)}”`}
        .
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
        in the ☰ menu, which badges whichever tap is live.
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
