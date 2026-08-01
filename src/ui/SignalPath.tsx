import { Fragment, useState } from 'react'

import styles from '../app.module.css'
import { ChainMap, ChainParts } from './ChainMap'
import { ControlGroup } from './ControlGroup'
import { cx } from './cx'
import { Dialog } from './Dialog'
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
// The diagram is the panel's trunk, so a copy of it is always on screen at the
// head of the path rather than parked behind a button: it is both the map and
// the only way in, and a grey bar reading "chain diagram" was neither found nor
// understood. The dialog is the same drawing with room for the effect lists.
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
  const [showDiagram, setShowDiagram] = useState(false)
  const shown = props.nodes.filter(
    n => props.expandAll || props.open === n.name,
  )
  const touched = props.nodes.reduce((n, node) => n + node.touched, 0)
  return (
    <>
      <div className={styles.chainStrip}>
        <div className={styles.chainHead}>
          <span className={styles.chainTitle}>the chain</span>
          <span className={styles.chainMeta}>
            {touched === 0
              ? `${props.nodes.length} stages`
              : `${touched} off stock`}
          </span>
          <button
            className={styles.chainExpand}
            title="the whole chain, big — every stage with the effects it can apply"
            onClick={() => setShowDiagram(true)}
          >
            expand ⤢
          </button>
        </div>
        <div className={styles.chainScreen}>
          <ChainMap
            stages={props.nodes}
            open={props.open}
            size="strip"
            onOpen={name => props.onOpen(name)}
          />
        </div>
        {props.open === null ? (
          <div className={styles.chainCaption}>
            click a stage to open its controls
          </div>
        ) : null}
      </div>
      {showDiagram ? (
        <Dialog
          title="Signal chain"
          size="diagram"
          onClose={() => setShowDiagram(false)}
        >
          <div className={cx(styles.chainScreen, styles.chainScreenBig)}>
            <ChainMap
              stages={props.nodes}
              open={props.open}
              size="card"
              onOpen={name => {
                props.onOpen(name)
                setShowDiagram(false)
              }}
            />
          </div>
          <ChainParts stages={props.nodes} />
          <div className={styles.muted}>
            the picture travels left to right; feedback returns the end of the
            chain to its middle. click a stage — or one of its effects — to open
            it in the panel.
            {touched === 0
              ? ''
              : ` amber marks the ${touched} controls you have off stock.`}
          </div>
          <div className={styles.diagramLegend}>
            {props.nodes.map(node => (
              <Fragment key={node.name}>
                <span className={styles.diagramLegendName}>{node.name}</span>
                <span>{node.blurb}</span>
              </Fragment>
            ))}
          </div>
        </Dialog>
      ) : null}
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
