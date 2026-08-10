import logoUrl from '../../docs/img/logo.svg'
import { Dialog } from './Dialog'
import dlg from './dialog.module.css'
import ui from './ui.module.css'

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="ntsc.js" size="prose" onClose={onClose}>
      <img
        className={dlg.helpLogo}
        src={logoUrl}
        alt="One NTSC line of 75% color bars on a waveform monitor: horizontal sync, color burst, then the luma staircase with the chroma subcarrier riding on each bar"
      />
      <p className={ui.helpText}>
        A real-time simulator of the analog NTSC signal path — camera, tape, RF,
        and CRT — rendered entirely in WebGPU compute shaders. Feed it a
        pattern, image, video, or your webcam and degrade it however you like.
      </p>
      <div className={dlg.helpHead}>getting started</div>
      <ol className={dlg.helpList}>
        <li>
          Click a <b>Preset</b> for an instant look — or drag one sideways to
          mix it in partially, stacking its faults onto what’s already there.
        </li>
        <li>
          Below that is the path itself — <b>source A</b>, <b>tape</b>,{' '}
          <b>receiver</b>, <b>screen</b>, wired in the order the signal travels,
          with <b>source B</b> joining from below at <b>mix</b>. Every box on
          the map is a button: opening a stage reaches its controls, and the dot
          beside one counts what you’ve moved there. The picker that decides
          what a source <i>is</i> — a file, a webcam, a screen share, a random
          clip — heads its own stage, so <b>source A</b> is both where you put a
          picture in and where you shape it. <b>diagram ⤢</b> draws the whole
          thing large, feeds and loops included.
        </li>
        <li>
          Every slider has a <b>?</b> explaining the hardware fault it models.
        </li>
        <li>
          The filter box searches those descriptions too — type an artifact like{' '}
          <i>rainbow</i>, <i>ghost</i>, or <i>tear</i> to find the sliders that
          cause it.
        </li>
        <li>
          A dim <b>“inert — needs …”</b> note under a slider means another
          control gates it; click the note to set the prerequisite.
        </li>
        <li>
          <b>saved</b> in the top row keeps the whole board as a named profile,
          the way a synth saves a voice — <b>Ctrl/⌘+S</b> does it in one
          keystroke. Saving asks you to sign in with Google, because a profile
          is stored on your account rather than in this browser: it follows you
          to another machine. Nothing else here needs an account. ⧉ beside a
          saved profile copies it as a link, which needs no account at either
          end.
        </li>
      </ol>
      <div className={dlg.helpHead}>keyboard</div>
      <ul className={dlg.helpList}>
        <li>
          <b>⌘K</b> / <b>Ctrl+K</b> jump to any preset, control, or action by
          name; <b>←→</b> nudges a control from the list
        </li>
        <li>
          <b>C</b> (hold) compare against the clean signal
        </li>
        <li>
          <b>R</b> record a clip · <b>S</b> save a still (both download)
        </li>
        <li>
          <b>F</b> fullscreen · <b>Esc</b> close dialogs
        </li>
        <li>
          <b>Ctrl/⌘+Z</b> step back through the looks you have been through ·{' '}
          <b>+shift</b> forward again
        </li>
        <li>
          <b>1–9</b> recall one of your first nine saved looks ·{' '}
          <b>shift+1–9</b> keep the board over it · <b>ctrl/⌘+S</b> save under a
          new name
        </li>
      </ul>
      <div className={dlg.helpHead}>more</div>
      <p className={ui.muted} style={{ margin: 0 }}>
        The{' '}
        <a
          className={ui.link}
          href="https://cmdcolin.github.io/ntsc.js/guide/"
          target="_blank"
          rel="noreferrer"
        >
          user guide ↗
        </a>{' '}
        walks through all of it with pictures. The <b>gear</b> icon holds render
        scale and MIDI setup. <b>⧉ pop out</b> moves the controls into their own
        window — handy with the stage fullscreen on a projector. Source code and
        notes on{' '}
        <a
          className={ui.link}
          href="https://github.com/cmdcolin/ntsc.js"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
        .
      </p>
    </Dialog>
  )
}
