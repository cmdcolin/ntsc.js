import { Section } from './Section'
import ui from './ui.module.css'

import type { ReactNode } from 'react'

// Named for what the knobs inside do, not for the signal they come from: the
// group they wrap is itself called "Audio", so calling this section that too
// stacked two collapsibles of the same name inside each other. Picking the
// source is Input's job; this is where sound reaches the picture.
// Folded to start. Open, this was 324px — the largest block in the sidebar, and
// bigger than Presets — while every knob in it is inert until an audio input is
// picked, which is off by default. The dot marks it once something is driving,
// and openOnFilter still reaches inside it, so folding costs nothing.
export function AudioSection(props: { active: boolean; children: ReactNode }) {
  return (
    <Section
      title="Sound into the picture"
      defaultOpen={false}
      dot={props.active}
      openOnFilter
    >
      <div className={ui.hint}>
        pick a mic or file under Input, then start with the top two knobs: they
        detune the hold oscillators, so sound knocks sync out of lock.
      </div>
      {props.children}
    </Section>
  )
}
