import { Fragment, useRef } from 'react'

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
// you are using rather than a flat list of sixteen headers. On the bench, where
// there is width for two columns, the same map heads every stage at once.
export function SignalPath(props: {
  nodes: PathNode[]
  // null = no stage picked, which is where exploration starts. Ignored while a
  // filter is live: then every stage with a match shows at once.
  open: string | null
  expandAll: boolean
  // Two columns of module cards, every stage mounted (see Bench).
  bench: boolean
  // Which feedback returns are carrying signal, for the map to mark.
  live: { camera: boolean; mixer: boolean }
  onOpen: (name: string) => void
  // Which group inside the open stage is unfolded — one at a time.
  openGroup: string | null
  onOpenGroup: (name: string) => void
}) {
  if (props.bench) {
    return (
      <Bench
        nodes={props.nodes}
        open={props.open}
        live={props.live}
        onOpen={props.onOpen}
      />
    )
  }
  const shown = props.nodes.filter(
    n => props.expandAll || props.open === n.name,
  )
  return (
    <>
      <ChainMap
        stages={props.nodes}
        open={props.open}
        live={props.live}
        onOpen={name => props.onOpen(name)}
      />
      {/* The empty state, and the panel's only door onto its own subject: with
          no stage picked the map renders five small boxes over nothing, and
          every one of the 132 controls is behind them. It said so in `title`
          attributes, which a first visit never hovers. Gone the moment a stage
          is open, since by then the answer is on screen. */}
      {shown.length > 0 ? null : (
        <div className={styles.door}>
          click a stage to open its controls —{' '}
          {props.nodes.reduce(
            (n, s) => n + s.groups.reduce((m, g) => m + g.sliders.length, 0),
            0,
          )}{' '}
          of them, in the order the picture travels
        </div>
      )}
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
            <div className={styles.stageBlurb} title={node.blurb}>
              {node.blurb}
            </div>
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

// Every stage at once, groups as module cards over two columns. Nothing folds a
// stage away, so the map stops being a fold and becomes an index: a click marks
// the stage and scrolls its heading to the top of the panel. No Accordion
// either — each group keeps its own persisted open state (Section falls back to
// selfOpen, default open), so the bench stays arranged the way you left it.
//
// The filter needs nothing here: app.tsx already drops the stages and groups it
// leaves empty, and each group's Section opens itself on a live query — which is
// also why `expandAll` has no bench equivalent.
function Bench(props: {
  nodes: PathNode[]
  open: string | null
  live: { camera: boolean; mixer: boolean }
  onOpen: (name: string) => void
}) {
  // The stage headings, by name, as scroll targets. Element-relative
  // scrollIntoView only: the panel also renders inside the popout's document,
  // where this window's scrolling APIs address the wrong realm.
  const heads = useRef(new Map<string, HTMLDivElement>())
  const jump = (name: string) => {
    props.onOpen(name)
    heads.current
      .get(name)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return (
    <>
      <ChainMap
        stages={props.nodes}
        open={props.open}
        live={props.live}
        onOpen={jump}
      />
      <div className={styles.bench}>
        {props.nodes.map(node => (
          <Fragment key={node.name}>
            <div
              className={styles.benchStage}
              ref={el => {
                if (el === null) heads.current.delete(node.name)
                else heads.current.set(node.name, el)
              }}
            >
              <div className={styles.stageHead}>
                <button
                  className={styles.stageName}
                  title={`${node.blurb} — click to mark this stage on the map`}
                  onClick={() => props.onOpen(node.name)}
                >
                  {node.name}
                </button>
                {node.touched === 0 ? null : (
                  <button
                    className={styles.phaseDot}
                    title={`${node.touched} control${node.touched === 1 ? '' : 's'} in this stage off stock — click to bring the stage up`}
                    onClick={() => jump(node.name)}
                  >
                    • {node.touched}
                  </button>
                )}
              </div>
              <div className={styles.stageBlurb} title={node.blurb}>
                {node.blurb}
              </div>
            </div>
            {node.groups.map(group => (
              <div key={group.name} className={styles.groupCard}>
                <NestedSections>
                  <ControlGroup group={group} />
                </NestedSections>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </>
  )
}
