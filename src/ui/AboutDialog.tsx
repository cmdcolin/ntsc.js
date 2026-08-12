import { gitSha, versionLabel } from '../version'
import { Dialog } from './Dialog'
import ui from './ui.module.css'

// Deliberately three lines: what this is, where to read about it, and which
// build you are looking at. Everything the old help dialog carried — the tour,
// the keyboard list — is on the guide, and a copy here was a second place to
// keep in step with the app that nobody remembered to edit.
export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="ntsc.js" size="form" onClose={onClose}>
      <p className={ui.helpText}>
        A real-time simulator of the analog NTSC signal path — camera, tape, RF,
        and CRT — rendered entirely in WebGPU compute shaders.
      </p>
      <p className={ui.helpText}>
        <a
          className={ui.link}
          href="https://cmdcolin.github.io/ntsc.js/"
          target="_blank"
          rel="noreferrer"
        >
          user guide ↗
        </a>{' '}
        ·{' '}
        <a
          className={ui.link}
          href="https://github.com/cmdcolin/ntsc.js"
          target="_blank"
          rel="noreferrer"
        >
          source on GitHub ↗
        </a>
      </p>
      {/* The sha as well as the tag: a bug report against "v0.26.2" cannot say
          which of the day's builds it was. */}
      <p className={ui.muted} style={{ margin: 0 }}>
        {versionLabel} ({gitSha})
      </p>
    </Dialog>
  )
}
