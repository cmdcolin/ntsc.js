import styles from '../app.module.css'
import { cx } from './cx'

import type { ReactNode } from 'react'

export interface PathNode {
  name: string
  blurb: string
  // Controls in this stage sitting off their stock value.
  touched: number
  // Opens the stage at its first touched group.
  onJumpTouched: () => void
  // The stage's group sections, rendered only while it's open.
  body: ReactNode
}

// The signal path drawn as what it is: a chain the picture travels down, one
// node per stage, wired top to bottom. Only the open stage unfolds its groups,
// so the whole chain stays on screen instead of scrolling past as a flat list
// of sixteen headers.
export function SignalPath(props: {
  nodes: PathNode[]
  // null = the bare chain, which is where exploration starts. Ignored while a
  // filter is live: then every stage with a match shows at once.
  open: string | null
  expandAll: boolean
  onOpen: (name: string) => void
}) {
  return (
    <div className={styles.spine}>
      {props.nodes.map((node, i) => {
        const open = props.expandAll || props.open === node.name
        return (
          <div
            key={node.name}
            className={cx(
              styles.spineRow,
              open && styles.spineRowOn,
              i === props.nodes.length - 1 && styles.spineLast,
            )}
          >
            <span
              className={cx(
                styles.spineNode,
                open && styles.spineNodeOn,
                node.touched > 0 && styles.spineNodeTouched,
              )}
            />
            <div className={styles.spineHead}>
              <button
                className={cx(styles.spineName, open && styles.spineNameOn)}
                title={node.blurb}
                onClick={() => props.onOpen(node.name)}
              >
                {node.name}
              </button>
              {node.touched === 0 ? null : (
                <button
                  className={styles.phaseDot}
                  title={`${node.touched} control${node.touched === 1 ? '' : 's'} in this stage off stock — click to see`}
                  onClick={() => node.onJumpTouched()}
                >
                  • {node.touched}
                </button>
              )}
            </div>
            {open ? (
              <>
                <div className={styles.spineBlurb}>{node.blurb}</div>
                {node.body}
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
