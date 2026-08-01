import styles from '../app.module.css'
import { Section } from './Section'

import type { ReactNode } from 'react'

// Named for what the knobs inside do, not for the signal they come from: the
// group they wrap is itself called "Audio", so calling this section that too
// stacked two collapsibles of the same name inside each other. Picking the
// source is Input's job; this is where sound reaches the picture.
export function AudioSection(props: { active: boolean; children: ReactNode }) {
  return (
    <Section title="Sound into the picture" dot={props.active} openOnFilter>
      <div className={styles.hint}>
        pick a mic or file under Input, then start with the top two knobs: they
        detune the hold oscillators, so sound knocks sync out of lock.
      </div>
      {props.children}
    </Section>
  )
}
