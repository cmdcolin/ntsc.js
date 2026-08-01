import { useState } from 'react'

import styles from '../app.module.css'
import { ChainMap } from './ChainMap'
import { Dialog } from './Dialog'

import type { ChainStage } from './ChainMap'
import type { ReactNode } from 'react'

// A stage as the panel needs it: what the diagram draws, plus its controls.
export interface PathNode extends ChainStage {
  // Opens the stage at its first touched group.
  onJumpTouched: () => void
  // The stage's group sections, rendered only while it's open.
  body: ReactNode
}

// The signal path, navigated from the block diagram: the dialog picks a stage,
// and only that stage's groups render below — so the panel holds the knobs you
// are using rather than a flat list of sixteen headers.
export function SignalPath(props: {
  nodes: PathNode[]
  // null = no stage picked, which is where exploration starts. Ignored while a
  // filter is live: then every stage with a match shows at once.
  open: string | null
  expandAll: boolean
  onOpen: (name: string) => void
}) {
  const [showDiagram, setShowDiagram] = useState(false)
  const shown = props.nodes.filter(
    n => props.expandAll || props.open === n.name,
  )
  const touched = props.nodes.reduce((n, node) => n + node.touched, 0)
  return (
    <>
      <button
        className={styles.barBtn}
        title="the whole chain as a block diagram — a box per stage, wired in the order the picture travels, with every effect it can apply"
        onClick={() => setShowDiagram(true)}
      >
        <span className={styles.barGlyph}>⧉</span>
        chain diagram
        <span className={styles.barCount}>
          {props.open === null
            ? `${props.nodes.length} stages`
            : props.open.toLowerCase()}
        </span>
      </button>
      {showDiagram ? (
        <Dialog title="Signal chain" wide onClose={() => setShowDiagram(false)}>
          <ChainMap
            stages={props.nodes}
            open={props.open}
            onOpen={name => {
              props.onOpen(name)
              setShowDiagram(false)
            }}
          />
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
              <div key={node.name}>
                <span className={styles.diagramLegendName}>{node.name}</span>
                {node.blurb}
              </div>
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
            {node.body}
          </div>
        ))}
      </div>
    </>
  )
}
