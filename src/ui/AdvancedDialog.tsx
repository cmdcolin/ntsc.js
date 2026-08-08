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
  // The tap on the glass. Owned above rather than here: the panel's View group
  // switches it too, and the menu trigger badges it, so this dialog is one
  // writer of a shared value rather than the place it lives — and the one
  // fullscreen/pop-out fall back to, since the panel isn't there to show it.
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
        see what the TV sees rather than what it drew — the fastest way to
        understand what a control is actually doing.
        <br />
        <b>composite waveform</b> — the whole 910-sample line as brightness,
        blanking and burst included, squeezed into the picture width: sync tip
        black at the far left, then burst, then the active line. Everything the
        decoder is handed.
        <br />
        <b>luma channel</b> — Y after Y/C separation, black to white. Residual
        subcarrier here is what dot crawl is made of.
        <br />
        <b>chroma (U/V energy)</b> — the demodulated colour difference axes as
        false colour: red is |U|, green is |V|. Grey areas carry no colour;
        which axis lights up says where the hue sits.
        <br />
        <b>burst / decoder state</b> — what the receiver measured rather than
        what it received: red is burst amplitude, green the phase error the hue
        correction is riding on, blue the chroma gain the ACC settled at. Bands
        mean the lock is chattering line to line.
        <br />
        <b>scope</b> — one line drawn the way the app's icon draws it: the whole
        line against an IRE graticule, sync tip and burst included, with the
        picture running dimmed above and a dashed cursor on the line being
        traced. Each column is filled between its lowest and highest sample, so
        flat luma is a thin line and anything carrying subcarrier is a block as
        tall as its swing, tinted the colour it carries, with its luma as the
        bright line through the middle.
        <br />
        The same picker sits in the panel's View group, and <code>
          ?dbg=
        </code>{' '}
        in the URL sets it at load. The ☰ menu has no tap row — its trigger
        only badges whichever tap is live, so a replaced picture always says so.
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
