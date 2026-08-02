import logoUrl from '../../docs/logo.svg'
import styles from '../app.module.css'
import { Dialog } from './Dialog'

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="ntscythe" size="prose" onClose={onClose}>
      <img
        className={styles.helpLogo}
        src={logoUrl}
        alt="One NTSC line of 75% color bars on a waveform monitor: horizontal sync, color burst, then the luma staircase with the chroma subcarrier riding on each bar"
      />
      <p className={styles.helpText}>
        A real-time simulator of the analog NTSC signal path — camera, tape, RF,
        and CRT — rendered entirely in WebGPU compute shaders. Feed it a
        pattern, image, video, or your webcam and degrade it however you like.
      </p>
      <div className={styles.helpHead}>getting started</div>
      <ol className={styles.helpList}>
        <li>
          Click a <b>Preset</b> for an instant look — or drag one sideways to
          mix it in partially, stacking its faults onto what’s already there.
        </li>
        <li>
          Pick an <b>Input</b> (A is the main source; B mixes a second in).
        </li>
        <li>
          Below that is the path itself — <b>source</b>, <b>feedback</b>,{' '}
          <b>tape</b>, <b>receiver</b>, <b>screen</b>, wired in the order the
          signal travels. Open a stage to reach its controls; the dot beside one
          counts what you’ve moved there.
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
      </ol>
      <div className={styles.helpHead}>keyboard</div>
      <ul className={styles.helpList}>
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
          <b>F</b> fullscreen · <b>Esc</b> close dialogs · <b>Ctrl/⌘+Z</b> undo
        </li>
        <li>
          <b>1–9</b> recall a scene · <b>shift+1–9</b> save the current look
        </li>
      </ul>
      <div className={styles.helpHead}>more</div>
      <p className={styles.muted} style={{ margin: 0 }}>
        The{' '}
        <a
          className={styles.link}
          href="https://cmdcolin.github.io/ntscythe/guide/"
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
          className={styles.link}
          href="https://github.com/cmdcolin/ntscythe"
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
