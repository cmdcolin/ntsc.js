import { Fragment, useRef } from 'react'

import { ChainMap } from './ChainMap'
import { ControlGroup } from './ControlGroup'
import { Accordion, NestedSections } from './Section'
import styles from './SignalPath.module.css'

import type { ChainStage } from './ChainMap'
import type { Group } from './controls'

// A stage as the panel needs it: what the map draws, plus its groups as data.
// Only the open stage builds sections — building all six to throw five away
// cost every control write a rebuild of all 121 rows.
//
// `off` (from ChainStage) is the one that opens nothing: input B with nothing
// patched into it, and the Mix stage beside it, whose groups would be a wall of
// controls that cannot move the picture.
export interface PathNode extends ChainStage {
  // Opens the stage at its first touched group.
  onJumpTouched: () => void
  groups: Group[]
}

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
  // The way back to the map alone, when there is one. The fold is already on
  // the stage name and on the map box the click came from, but neither *looks*
  // like a way out — a name reads as a label and the box you pressed to open a
  // stage does not announce that pressing it again closes one. Left off where
  // it would lie: the bench folds nothing, and while a filter is live every
  // matching stage is shown regardless of which one is open.
  onClose?: () => void
}) {
  const { node } = props
  return (
    <>
      <div className={styles.stageHead}>
        <button
          className={styles.stageName}
          title={`${node.blurb} — ${props.nameHint}`}
          // Only where the name folds: the heading of a stage that is rendered
          // because it is open, so it is a disclosure that is always expanded.
          // On the bench and under a filter it is a heading, and claiming an
          // expanded state there would announce a fold that isn't there.
          aria-expanded={props.onClose === undefined ? undefined : true}
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
        {props.onClose === undefined ? null : (
          <button
            className={styles.stageClose}
            title={`close ${node.name} — the map stays`}
            aria-label={`close ${node.name}`}
            onClick={props.onClose}
          >
            ×
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
// It carries the standing instruction for the same reason. "Click a stage" used
// to live only in the empty state under the map, which meant it was below the
// graphic it was about and gone for good after the first click — and the open
// stage is persisted, so a returning session never saw it at all. Here it costs
// no row of its own and it is still there on the visit where you have forgotten.
//
// It is also where the full diagram is offered from. The miniature has room for
// the six trunk stages and B's branch and no more; the names on the two feeds,
// on the two loops, and on what each stage does need a card, so they get one.
function PathHead(props: { onShowDiagram: () => void }) {
  return (
    <div className={styles.pathHead}>
      <span className={styles.pathTitle}>Signal path</span>
      <span className={styles.pathHint}>click a stage</span>
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
  // Input B, drawn under the head of the trunk. null when a live filter has
  // left it nothing to show.
  branch: PathNode | null
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
  // an empty spine came out as wires between boxes that aren't there, under a
  // "0 controls, in the order the picture travels" door sitting right above
  // app.tsx's own "nothing matches" line.
  if (props.nodes.length === 0) {
    return null
  }
  // Every stage that opens onto something. The branch is a stage like any other
  // once B is patched in; without B it and the Mix stage are drawn on the map
  // and open nothing, so neither can be the thing the panel is showing.
  const openable = [
    ...props.nodes,
    ...(props.branch === null ? [] : [props.branch]),
  ].filter(n => n.off !== true)
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
        // The map is the fold here — except under a live filter, where a stage
        // is on screen because it matched and clicking its box cannot take it
        // off again.
        folds={!props.expandAll}
        live={props.live}
        onOpen={name => props.onOpen(name)}
      />
      {/* No empty state under the map. It used to carry a count of everything
          behind the boxes and a line about the order the picture travels in,
          which was two lines of the resting panel's scarcest space spent saying
          what the map above it already draws — the boxes are in signal order and
          B visibly joins at the mixer. A total like "205 controls" is a number
          nobody acts on, and the standing instruction ("click a stage") lives on
          the header line, where it costs no row and survives the first click. */}
      <div className={styles.stages}>
        {shown.map(node => (
          <div key={node.name} className={styles.stageRow}>
            <StageHead
              node={node}
              nameHint="click to fold this stage"
              countHint="click to see"
              onName={() => props.onOpen(node.name)}
              onCount={() => node.onJumpTouched()}
              // onOpen toggles, so closing is opening the stage that is
              // already open. Not offered under a live filter: there the row
              // is shown because it matches, and an × that left it on screen
              // would be a button that did nothing.
              onClose={
                props.expandAll ? undefined : () => props.onOpen(node.name)
              }
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
  branch: PathNode | null
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
        // Nothing folds on the bench: a click marks the stage and scrolls to it.
        folds={false}
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
