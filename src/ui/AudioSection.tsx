import type { ReactNode } from 'react'
import styles from '../app.module.css'
import { cx } from './cx'
import type { Group } from './controls'
import { Section } from './Section'

export function AudioSection(props: {
  active: boolean
  level: number
  hit: number
  error: string | null
  onEnableMic: () => void
  onDisable: () => void
  group: Group
  renderGroup: (group: Group, defaultOpen: boolean) => ReactNode
}) {
  return (
    <Section title="Audio" dot={props.active}>
      <>
        <div className={styles.hint}>
          the top two knobs detune the hold oscillators, so sound knocks sync out
          of lock and the picture lurches and tears back — start there. the
          waveform knob is the literal patch-at-the-yoke version: honest, but a
          steady tone just traces a steady shape.
        </div>
        <button
          className={cx(styles.btn, props.active ? styles.danger : undefined)}
          onClick={props.active ? props.onDisable : props.onEnableMic}
        >
          {props.active ? 'stop audio' : 'use microphone'}
        </button>
        {props.error === null ? null : (
          <div className={styles.hint}>{props.error}</div>
        )}
        {props.active ? (
          <div className={styles.meter}>
            <div
              className={styles.meterFill}
              style={{ width: `${Math.min(props.hit * 100, 100).toFixed(1)}%` }}
            />
          </div>
        ) : null}
        {props.renderGroup(props.group, true)}
      </>
    </Section>
  )
}
