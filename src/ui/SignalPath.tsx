import styles from '../app.module.css'
import { ControlGroup } from './ControlGroup'
import { cx } from './cx'
import { Accordion, NestedSections } from './Section'

import type { ChainStage } from './ChainMap'
import type { Group } from './controls'

// A stage as the panel needs it: what the diagram draws, plus its groups as
// data. Only the open stage builds sections — building all five to throw four
// away cost every control write a rebuild of all 121 rows.
export interface PathNode extends ChainStage {
  // Opens the stage at its first touched group.
  onJumpTouched: () => void
  groups: Group[]
}

// The signal path, navigated from the block diagram: the diagram picks a stage,
// and only that stage's groups render below — so the panel holds the knobs you
// are using rather than a flat list of sixteen headers.
//
// The diagram lives in its own dialog (ChainDialog), where it has the room to
// be read. What sits here is the door to it — and the same door is in the stage
// menu, since it is the only way into any control and one entry point buried in
// the panel was not enough to find.
export function SignalPath(props: {
  nodes: PathNode[]
  // null = no stage picked, which is where exploration starts. Ignored while a
  // filter is live: then every stage with a match shows at once.
  open: string | null
  expandAll: boolean
  onOpen: (name: string) => void
  // Which group inside the open stage is unfolded — one at a time.
  openGroup: string | null
  onOpenGroup: (name: string) => void
  onShowChain: () => void
}) {
  const shown = props.nodes.filter(
    n => props.expandAll || props.open === n.name,
  )
  const touched = props.nodes.reduce((n, node) => n + node.touched, 0)
  return (
    <>
      <div className={styles.chainStrip}>
        <button
          className={styles.btn}
          title="the whole chain as a rack of modules — a block per stage, patched in the order the picture travels, with every effect it can apply"
          onClick={() => props.onShowChain()}
        >
          signal chain
          <span
            className={cx(styles.chainMeta, touched > 0 && styles.chainMetaOn)}
          >
            {touched === 0
              ? `${props.nodes.length} stages`
              : `${touched} off stock`}
          </span>
        </button>
        {props.open === null ? (
          <div className={styles.chainCaption}>
            every control lives at a stage — open the chain to pick one
          </div>
        ) : null}
      </div>
      <div className={styles.stages}>
        {shown.map(node => (
          <div key={node.name} className={styles.stageRow}>
            <div className={styles.stageHead}>
              <button
                className={styles.stageName}
                title={`${node.blurb} — click to fold this stage`}
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
            <div className={styles.stageBlurb}>{node.blurb}</div>
            <NestedSections>
              <Accordion openId={props.openGroup} onToggle={props.onOpenGroup}>
                {node.groups.map(group => (
                  <ControlGroup key={group.name} group={group} />
                ))}
              </Accordion>
            </NestedSections>
          </div>
        ))}
      </div>
    </>
  )
}
