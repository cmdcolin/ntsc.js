import { Fragment } from 'react'

import styles from '../app.module.css'
import { ChainMap, ChainParts } from './ChainMap'
import { Dialog } from './Dialog'

import type { ChainStage } from './ChainMap'

// The chain at full size, on the instrument's face, with what every stage can
// do listed under it. It lives in a dialog rather than in the panel because it
// wants the width — and it is reachable from two places (the panel and the
// stage menu), so the open state belongs to the app, not to either of them.
export function ChainDialog(props: {
  stages: ChainStage[]
  open: string | null
  onOpen: (name: string) => void
  onClose: () => void
}) {
  const touched = props.stages.reduce((n, s) => n + s.touched, 0)
  return (
    <Dialog title="Signal chain" size="diagram" onClose={() => props.onClose()}>
      <div className={styles.chainScreen}>
        <ChainMap
          stages={props.stages}
          open={props.open}
          onOpen={name => {
            props.onOpen(name)
            props.onClose()
          }}
        />
      </div>
      <ChainParts stages={props.stages} />
      <div className={styles.muted}>
        the picture travels left to right, module to module; feedback is the
        cable returning the end of the chain to its middle. click a stage — or
        one of its effects — to open it in the panel.
        {touched === 0
          ? ''
          : ` a lit lamp marks the ${touched} controls you have off stock.`}
      </div>
      <div className={styles.diagramLegend}>
        {props.stages.map(stage => (
          <Fragment key={stage.name}>
            <span className={styles.diagramLegendName}>{stage.name}</span>
            <span>{stage.blurb}</span>
          </Fragment>
        ))}
      </div>
    </Dialog>
  )
}
