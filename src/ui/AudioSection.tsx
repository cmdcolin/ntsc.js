import styles from '../app.module.css'
import { Section } from './Section'

import type { Group } from './controls'
import type { ReactNode } from 'react'

// Named for what the knobs inside do, not for the signal they come from: the
// group they wrap is itself called "Audio", so calling this section that too
// stacked two collapsibles of the same name inside each other — and the inner
// one, holding every slider, looked exactly like the outer one you had just
// opened. Picking the source is Input's job; this is where sound reaches the
// picture.
export function AudioSection(props: {
  active: boolean
  group: Group
  renderGroup: (group: Group, defaultOpen: boolean) => ReactNode
  // A live filter reaches in here too, so a match isn't hidden behind a
  // collapsed section.
  forceOpen: boolean
}) {
  return (
    <Section
      title="Sound into the picture"
      dot={props.active}
      forceOpen={props.forceOpen}
    >
      <div className={styles.hint}>
        pick a mic or a file under Input, then start with the top two knobs:
        they detune the hold oscillators, so sound knocks sync out of lock and
        the picture lurches and tears back. the waveform knob is the literal
        patch-at-the-yoke version: honest, but a steady tone just traces a
        steady shape.
      </div>
      {props.renderGroup(props.group, true)}
    </Section>
  )
}
