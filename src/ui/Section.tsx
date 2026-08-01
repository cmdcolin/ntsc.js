import { useState } from 'react'

import styles from '../app.module.css'
import { cx } from './cx'
import { readRecord, writeJSON } from './storage'

import type { ReactNode } from 'react'

// Collapsed/open choices persist per title so a reload keeps your working set.
const STORE = 'video_feedback_sections'
type OpenMap = Partial<Record<string, boolean>>
const loadOpenMap = () => readRecord<OpenMap>(STORE, {})

export function Section(props: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  // Filtering: show contents regardless of the collapsed state.
  forceOpen?: boolean
  // Some control inside sits off its default.
  dot?: boolean
  // Optional accessory (e.g. a ? explainer) beside the title. It must stop its
  // own clicks from bubbling, or they toggle the section.
  help?: ReactNode
  // A group sitting inside another section rather than at the panel's top
  // level, styled a step quieter so the nesting is visible.
  nested?: boolean
  // Controlled mode: when onToggle is supplied the parent owns open/closed
  // (single-open phase browsing). Without it the section self-manages and
  // persists its own state, as the Input and Audio sections still do.
  open?: boolean
  onToggle?: () => void
}) {
  const [selfOpen, setSelfOpen] = useState(
    () => loadOpenMap()[props.title] ?? props.defaultOpen ?? true,
  )
  const open = props.onToggle === undefined ? selfOpen : props.open === true
  const shown = props.forceOpen === true || open
  const toggle = () => {
    if (props.onToggle === undefined) {
      const next = !selfOpen
      setSelfOpen(next)
      writeJSON(STORE, { ...loadOpenMap(), [props.title]: next })
    } else {
      props.onToggle()
    }
  }
  return (
    <div>
      <h3
        className={cx(styles.head, props.nested === true && styles.headSub)}
        onClick={() => toggle()}
      >
        <span>
          {props.title}
          {props.dot === true ? <span className={styles.dot}> •</span> : null}
          {props.help}
        </span>
        <span className={styles.caret}>{shown ? '▾' : '▸'}</span>
      </h3>
      {shown ? props.children : null}
    </div>
  )
}
