import { Fragment, useRef } from 'react'

import { ChainMap } from './ChainMap'
import { ControlGroup } from './ControlGroup'
import { FEEDBACK_STAGE } from './controls'
import { Accordion, NestedSections } from './Section'
import styles from './SignalPath.module.css'
import { hasBody, stageBody } from './stageBody'

import type { BranchSpec } from './chainLayout'
import type { ChainStage } from './ChainMap'
import type { Group, LoopsLive } from './controls'
import type { ReactNode } from 'react'

// A stage as the panel needs it: what the map draws, plus its groups as data.
// Only the open stage builds sections — building all six to throw five away
// cost every control write a rebuild of all 121 rows.
//
// `off` (from ChainStage) says this stage's controls have nothing to act on.
// Everything *except* `opens`, which is the map's other question — whether the
// box is a door at all — and which this file answers for itself below. The two
// came apart when the pickers moved inside: a source branch with nothing
// patched in is inert and still worth opening, because the picker is the thing
// that ends that state.
export interface PathNode extends Omit<ChainStage, 'opens'> {
  // Opens the stage at its first touched group.
  onJumpTouched: () => void
  groups: Group[]
}

// The same, for a stage that hangs under the trunk rather than on it. Off
// BranchSpec rather than ChainBranchStage for the reason above: `opens` is not
// the caller's to say.
export interface BranchNode extends PathNode, BranchSpec {}

// One stage as the map takes it — the panel's node with that answer stamped on.
type MapNode<T extends PathNode> = T & { opens: boolean }

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
// the six trunk stages and the three boxes under them and no more — a seventh
// trunk box drops the fit to 0.81 and leaves a label about a unit of padding
// inside its box; the names on the two feeds and the sentence on each loop and
// each stage need a card, so they get one. The miniature now draws all three
// loops and names them — what it still cannot carry is what any of them *do*,
// which is a sentence per run and three sentences the band has no room for.
function PathHead(props: { onShowDiagram: () => void }) {
  return (
    <div className={styles.pathHead}>
      <span className={styles.pathTitle}>Signal path</span>
      <span className={styles.pathHint}>click a stage</span>
      <button
        className={styles.pathDiagram}
        title="the whole path drawn large — both inputs, their feeds, the mixer, all three loops and where the sound joins, each one a way into its controls"
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
  // The stages that hang under the trunk — input B at its head, the sound under
  // the receiver, the view under the screen. Two are patched in and one is fed
  // out; the map's arrowheads are what say which. One drops out when a live
  // filter has left it nothing to show.
  branches: BranchNode[]
  // null = no stage picked, which is where exploration starts. Ignored while a
  // filter is live: then every stage with a match shows at once.
  open: string | null
  expandAll: boolean
  // Two columns of module cards, every stage mounted (see Bench).
  bench: boolean
  // Which feedback returns are carrying signal, for the map to mark.
  live: LoopsLive
  onOpen: (name: string) => void
  // Opens the Feedback stage at one loop's own group — what a return wire on
  // the map does, as against the box under it, which opens the stage at
  // whichever of its groups comes first.
  onOpenLoop: (group: string) => void
  // Which group inside the open stage is unfolded — one at a time.
  openGroup: string | null
  onOpenGroup: (name: string) => void
  // What heads a stage, above its groups: the picker that decides what feeds it.
  // Keyed by stage name, and the three keys are three of the boxes the map
  // already draws — Source A, Source B, Sound — which is the whole reason these
  // moved here out of a section that named the same three things 60px higher up.
  //
  // A record of thunks rather than of nodes, for the reason `groups` arrives as
  // data rather than as sections: only the stages on screen call theirs, so a
  // folded map builds no pickers. And keyed rather than a plain function so
  // `opensOn` below can ask *whether* a stage has one without building it.
  stageTop: Partial<Record<string, () => ReactNode>>
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
  // Whether a stage's box is a door, stamped on here rather than handed in.
  // A stage opens if its controls can act on something, or if it has a picker at
  // its head — and both halves of that read off what actually renders below, so
  // a box that opens and a stage with something to show cannot come apart. Mix
  // is what it leaves shut: B unpatched leaves its every control inert, and
  // there is no picker for "a second signal", only B's.
  // Asked as "is there a picker" rather than "is there a key": a key present
  // with nothing behind it would open a box onto the empty stage it is drawn
  // inert for, which is the one outcome this is here to make impossible.
  const opensOn = <T extends PathNode>(n: T): MapNode<T> => ({
    ...n,
    opens: n.off !== true || props.stageTop[n.name] !== undefined,
  })
  const nodes = props.nodes.map(opensOn)
  const branches = props.branches.map(opensOn)
  const openable = [...nodes, ...branches].filter(n => n.opens)
  if (props.bench) {
    return (
      <Bench
        nodes={nodes}
        openable={openable}
        branches={branches}
        open={props.open}
        live={props.live}
        onOpen={props.onOpen}
        onOpenLoop={props.onOpenLoop}
        onShowDiagram={props.onShowDiagram}
        stageTop={props.stageTop}
      />
    )
  }
  // Under a live filter every matching stage shows at once; otherwise it is the
  // one that is open — and either way, only if it has a body to show. Paired up
  // with that body here so the list and the markup below are the same answer.
  const shown = openable
    .filter(n => props.expandAll || props.open === n.name)
    .map(node => ({
      node,
      body: stageBody(node, props.stageTop, !props.expandAll),
    }))
    .filter(({ body }) => hasBody(body))
  return (
    <>
      <PathHead onShowDiagram={props.onShowDiagram} />
      <ChainMap
        stages={nodes}
        branches={branches}
        open={props.open}
        // The map is the fold here — except under a live filter, where a stage
        // is on screen because it matched and clicking its box cannot take it
        // off again.
        folds={!props.expandAll}
        live={props.live}
        onOpen={name => props.onOpen(name)}
        onOpenLoop={props.onOpenLoop}
      />
      {/* No empty state under the map. It used to carry a count of everything
          behind the boxes and a line about the order the picture travels in,
          which was two lines of the resting panel's scarcest space spent saying
          what the map above it already draws — the boxes are in signal order and
          B visibly joins at the mixer. A total like "205 controls" is a number
          nobody acts on, and the standing instruction ("click a stage") lives on
          the header line, where it costs no row and survives the first click. */}
      <div className={styles.stages}>
        {shown.map(({ node, body }) => (
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
            {/* The picker first, because it is what the rest of the stage is
                downstream of. */}
            {body.picker?.()}
            {body.groups.length === 0 ? null : (
              <NestedSections>
                <Accordion
                  openId={props.openGroup}
                  onToggle={props.onOpenGroup}
                >
                  {body.groups.map(group => (
                    <ControlGroup key={group.name} group={group} />
                  ))}
                </Accordion>
              </NestedSections>
            )}
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
  nodes: MapNode<PathNode>[]
  // The trunk plus whichever branches open — every stage the bench mounts a
  // heading and a set of cards for.
  openable: MapNode<PathNode>[]
  branches: MapNode<BranchNode>[]
  open: string | null
  live: LoopsLive
  onOpen: (name: string) => void
  onOpenLoop: (group: string) => void
  onShowDiagram: () => void
  stageTop: Partial<Record<string, () => ReactNode>>
}) {
  // The stage headings, by name, as scroll targets. Element-relative
  // scrollIntoView only: the panel also renders inside the popout's document,
  // where this window's scrolling APIs address the wrong realm.
  const heads = useRef(new Map<string, HTMLDivElement>())
  const scrollTo = (name: string) =>
    heads.current
      .get(name)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  const jump = (name: string) => {
    props.onOpen(name)
    scrollTo(name)
  }
  // A loop opens its group and scrolls to the stage holding it, which is the
  // bench's answer to every other click on the map: nothing folds, so reaching
  // something means bringing it up rather than unfolding it.
  const jumpLoop = (group: string) => {
    props.onOpenLoop(group)
    scrollTo(FEEDBACK_STAGE)
  }
  return (
    <>
      <PathHead onShowDiagram={props.onShowDiagram} />
      <ChainMap
        stages={props.nodes}
        branches={props.branches}
        open={props.open}
        // Nothing folds on the bench: a click marks the stage and scrolls to it.
        folds={false}
        live={props.live}
        onOpen={jump}
        onOpenLoop={jumpLoop}
      />
      <div className={styles.bench}>
        {props.openable.map(node => {
          // The bench never narrows, so the picker is always in — but the body
          // comes from the same place the spine's does, so an inert stage drops
          // its groups here for the same reason and by the same line of code.
          const body = stageBody(node, props.stageTop, true)
          return (
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
                {/* The picker rides with the heading rather than in a card of
                  its own: it is what the stage is fed by, not one more module
                  of it. */}
                {body.picker?.()}
              </div>
              {body.groups.map(group => (
                <div key={group.name} className={styles.groupCard}>
                  <NestedSections>
                    <ControlGroup group={group} />
                  </NestedSections>
                </div>
              ))}
            </Fragment>
          )
        })}
      </div>
    </>
  )
}
