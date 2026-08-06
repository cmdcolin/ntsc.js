import { Fragment, useRef } from 'react'

import { ChainMap } from './ChainMap'
import { ControlGroup } from './ControlGroup'
import { Accordion, NestedSections } from './Section'
import styles from './SignalPath.module.css'

import type { ChainBranch, ChainStage } from './ChainMap'
import type { Group } from './controls'

// A stage as the panel needs it: what the map draws, plus its groups as data.
// Only the open stage builds sections — building all five to throw four away
// cost every control write a rebuild of all 121 rows.
export interface PathNode extends ChainStage {
  // Opens the stage at its first touched group.
  onJumpTouched: () => void
  groups: Group[]
}

// Input B's branch: a stage in every respect the panel cares about, plus
// whether there is a source patched into it. With `on` false it is drawn on the
// map and opens nothing — the groups under it would be a wall of controls that
// cannot move the picture.
export interface PathBranch extends PathNode, ChainBranch {}

// A stage's name, its off-stock count and its blurb. The two layouts below
// render exactly this and differ only in what the two buttons *do*: on the
// spine the name folds the stage and the count opens its first touched group,
// while on the bench nothing folds, so the name marks the stage on the map and
// the count scrolls to it. Kept as one component so the pair can't drift.
function StageHead(props: {
  node: PathNode
  nameHint: string
  countHint: string
  onName: () => void
  onCount: () => void
}) {
  const { node } = props
  return (
    <>
      <div className={styles.stageHead}>
        <button
          className={styles.stageName}
          title={`${node.blurb} — ${props.nameHint}`}
          onClick={props.onName}
        >
          {node.name}
        </button>
        {node.touched === 0 ? null : (
          <button
            className={styles.phaseDot}
            title={`${node.touched} control${node.touched === 1 ? '' : 's'} in this stage off stock — ${props.countHint}`}
            onClick={props.onCount}
          >
            • {node.touched}
          </button>
        )}
      </div>
      <div className={styles.stageBlurb} title={node.blurb}>
        {node.blurb}
      </div>
    </>
  )
}

// The map's own header, at the weight its peers in the panel are headed at.
// Without one the map was an unlabeled 37px strip sitting between two named
// sections while holding the route to 96% of the controls — the line of prose
// under it was doing a heading's work, and only until a stage was open.
//
// It is also where the full diagram is offered from. The miniature has room for
// the five trunk stages and B's branch and no more; the names on the two feeds,
// on the two loops, and on what each stage does need a card, so they get one.
function PathHead(props: { onShowDiagram: () => void }) {
  return (
    <div className={styles.pathHead}>
      <span className={styles.pathTitle}>Signal path</span>
      <button
        className={styles.pathDiagram}
        title="the whole path drawn large — both inputs, their feeds, the mixer and the two loops, each one a way into its controls"
        onClick={props.onShowDiagram}
      >
        diagram ⤢
      </button>
    </div>
  )
}

// The signal path, navigated from the map at its head: the map picks a stage,
// and only that stage's groups render below — so the sidebar holds the knobs
// you are using rather than a flat list of sixteen headers. On the bench, where
// there is width for two columns, the same map heads every stage at once.
export function SignalPath(props: {
  nodes: PathNode[]
  // Input B, drawn under the trunk. null when a live filter has left it
  // nothing to show.
  branch: PathBranch | null
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
  // Opens the full diagram, where there is room to draw both feeds and the
  // returns with their names on them.
  onShowDiagram: () => void
}) {
  // A filter can leave no stage standing, and there is no chain to draw then:
  // ChainMap divides the width by the stage count, so an empty spine came out as
  // wires between boxes that aren't there (NaN coordinates the browser rejects),
  // under a "click a stage to open its controls — 0 of them" door sitting right
  // above app.tsx's own "nothing matches" line.
  if (props.nodes.length === 0) {
    return null
  }
  // The branch is a stage like any other once B is patched in; with B off it
  // is drawn on the map and opens nothing.
  const openable =
    props.branch !== null && props.branch.on
      ? [...props.nodes, props.branch]
      : props.nodes
  if (props.bench) {
    return (
      <Bench
        nodes={props.nodes}
        openable={openable}
        branch={props.branch}
        open={props.open}
        live={props.live}
        onOpen={props.onOpen}
        onShowDiagram={props.onShowDiagram}
      />
    )
  }
  const shown = openable.filter(n => props.expandAll || props.open === n.name)
  return (
    <>
      <PathHead onShowDiagram={props.onShowDiagram} />
      <ChainMap
        stages={props.nodes}
        branch={props.branch}
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
          {openable.reduce(
            (n, s) => n + s.groups.reduce((m, g) => m + g.sliders.length, 0),
            0,
          )}{' '}
          of them, in the order the picture travels
        </div>
      )}
      <div className={styles.stages}>
        {shown.map(node => (
          <div key={node.name} className={styles.stageRow}>
            <StageHead
              node={node}
              nameHint="click to fold this stage"
              countHint="click to see"
              onName={() => props.onOpen(node.name)}
              onCount={() => node.onJumpTouched()}
            />
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
  // The trunk, which is what the map draws.
  nodes: PathNode[]
  // The trunk plus the branch when B is patched in — every stage the bench
  // mounts a heading and a set of cards for.
  openable: PathNode[]
  branch: PathBranch | null
  open: string | null
  live: { camera: boolean; mixer: boolean }
  onOpen: (name: string) => void
  onShowDiagram: () => void
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
      <PathHead onShowDiagram={props.onShowDiagram} />
      <ChainMap
        stages={props.nodes}
        branch={props.branch}
        open={props.open}
        live={props.live}
        onOpen={jump}
      />
      <div className={styles.bench}>
        {props.openable.map(node => (
          <Fragment key={node.name}>
            <div
              className={styles.benchStage}
              ref={el => {
                if (el === null) heads.current.delete(node.name)
                else heads.current.set(node.name, el)
              }}
            >
              <StageHead
                node={node}
                nameHint="click to mark this stage on the map"
                countHint="click to bring the stage up"
                onName={() => props.onOpen(node.name)}
                onCount={() => jump(node.name)}
              />
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
