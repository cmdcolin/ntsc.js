import { cx } from './cx'
import { helpBlocks } from './helpProse'
import styles from './HelpProse.module.css'

import type { CSSProperties, ReactNode } from 'react'

// Renders a help string with the structure `helpProse.ts` finds in it —
// paragraphs, bullets, and the two inline marks. Both places a blurb is read
// go through here, so the hover card and the ? dialog can never disagree about
// what a piece of copy means.

// One pass for both marks, so a run is matched in the order it is written
// rather than bold winning wherever the two overlap.
const MARKS = /\*\*([^*]+)\*\*|`([^`]+)`/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(MARKS)) {
    if (m.index > at) out.push(text.slice(at, m.index))
    const [, bold, code] = m
    out.push(
      bold === undefined ? (
        <code key={m.index}>{code}</code>
      ) : (
        <b key={m.index}>{bold}</b>
      ),
    )
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

export function HelpProse(props: {
  text: string
  className?: string
  style?: CSSProperties
}) {
  const parts = helpBlocks(props.text)
  return (
    <div className={cx(styles.prose, props.className)} style={props.style}>
      {parts.map((b, i) =>
        b.list ? (
          <ul className={styles.list} key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.para} key={i}>
            {inline(b.items[0])}
          </p>
        ),
      )}
    </div>
  )
}
