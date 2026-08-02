import { ChainMap } from './ChainMap'
import { ControlGroup } from './ControlGroup'
import { Accordion, NestedSections } from './Section'
import styles from './SignalPath.module.css'

import type { ChainStage } from './ChainMap'
import type { Group } from './controls'

// A stage as the panel needs it: what the map draws, plus its groups as data.
// Only the open stage builds sections — building all five to throw four away
// cost every control write a rebuild of all 121 rows.
export interface PathNode extends ChainStage {
  // Opens the stage at its first touched group.
  onJumpTouched: () => void
  groups: Group[]
}

// The signal path, navigated from the map at its head: the map picks a stage,
// and only that stage's groups render below — so the sidebar holds the knobs
// you are using rather than a flat list of sixteen headers.
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
}) {
  const shown = props.nodes.filter(
    n => props.expandAll || props.open === n.name,
  )
  return (
    <>
      <ChainMap
        stages={props.nodes}
        open={props.open}
        onOpen={name => props.onOpen(name)}
      />
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
