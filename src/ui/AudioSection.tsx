import styles from '../app.module.css'
import { Section } from './Section'

import type { Group } from './controls'
import type { ReactNode } from 'react'

export function AudioSection(props: {
  active: boolean
  group: Group
  renderGroup: (group: Group, defaultOpen: boolean) => ReactNode
  // A live filter reaches in here too, so a match isn't hidden behind a
  // collapsed section.
  forceOpen: boolean
}) {
  return (
    <Section title="Audio" dot={props.active} forceOpen={props.forceOpen}>
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
