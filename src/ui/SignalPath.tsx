import { Fragment, useRef } from 'react'

import { ChainMap } from './ChainMap'
import { ControlGroup } from './ControlGroup'
import { Accordion, NestedSections } from './Section'
import styles from './SignalPath.module.css'
import { hasBody, stageBody } from './stageBody'

import type { BranchSpec } from './chainLayout'
import type { ChainStage } from './ChainMap'
import type { Group, LoopPlace, LoopsLive } from './controls'
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
  // Opens the stage at its first touched group. Absent on a stage that has no
  // groups to open — see StageHead, where the count is then a readout rather
  // than a button that would do nothing.
  onJumpTouched?: () => void
  groups: Group[]
  // Contents that are not control groups (stageBody.ts). The modulation bay is
  // the one stage built this way.
  body?: () => ReactNode
}

// The same, for a stage that hangs under the trunk rather than on it. Off
// BranchSpec rather than ChainBranchStage for the reason above: `opens` is not
// the caller's to say. An intersection because BranchSpec is a union — a box
// either joins a stage or is wired to nothing (see FreeBox).
export type BranchNode = PathNode & BranchSpec

// And for one that hangs over it: a loop, which is a machine patched across the
// chain rather than a stage of it. Three of them, and each is reached by its own
// return — the run *is* the box, because there is no point on the trunk to draw
// one at. They used to be five groups filed under a 'Feedback' stage that stood
// on the wire between two different re-entry points and claimed to be both.
export interface LoopNode extends PathNode {
  loop: LoopPlace
}

// One stage as the map takes it — the panel's node with that answer stamped on.
type MapNode<T extends PathNode> = T & { opens: boolean }

// A stage's name, its off-stock count and its blurb. The two layouts below
// render exactly this and differ only in what the two buttons *do*: on the
// spine the name folds the stage and the count opens its first touched group,
// while on the bench nothing folds, so the name marks the stage on the map and
// the count scrolls to it. Kept as one component so the pair can't drift.
// What the count on a stage's heading counts. "Controls off stock" is right for
// every stage of the rig and wrong for the modulation bay, which counts patched
// slots and a gate — so the bay hands over its own clause (PathNode.touchedSay,
// built by bayLoad) and the map's boxes read the same one.
const counted = (node: PathNode): string =>
  node.touchedSay ??
  `${node.touched} control${node.touched === 1 ? '' : 's'} in this stage off stock`

function StageHead(props: {
  node: PathNode
  nameHint: string
  countHint: string
  onName: () => void
  // Where the count goes, when there is anywhere for it to go. A stage whose
  // contents are not groups has nothing to jump to on the spine — it is already
  // the thing on screen — so its count is a mark rather than a link.
  onCount?: () => void
  // The way back to the map alone, when there is one. The fold is already on
  // the stage name and on the map box the click came from, but neither *looks*
  // like a way out — a name reads as a label and the box you pressed to open a
  // stage does not announce that pressing it again closes one. Left off where
  // it would lie: the bench folds nothing, and while a filter is live every
  // matching stage is shown regardless of which one is open.
  onClose?: () => void
  // Whether the stage's role is spelled out under its name. The bench does,
  // because it mounts every stage at once and the line is what tells six
  // headings apart at a glance, and because at 664px it has the width to spare.
  //
  // The spine no longer does. It is a caption directly under the word it
  // captions, clamped to one line because at the sidebar's width all five of
  // them wrap — and since the heading became a tinted strip that is unmistakably
  // the stage you pressed on the map, it was 19px saying what the strip says.
  // Nothing is lost with it: the full line is the title of the name button
  // beside it, and of the map box the click came from.
  blurb?: boolean
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
        {node.touched === 0 ? null : props.onCount === undefined ? (
          <span className={styles.phaseCount} title={counted(node)}>
            • {node.touched}
          </span>
        ) : (
          <button
            className={styles.phaseDot}
            title={`${counted(node)} — ${props.countHint}`}
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
      {props.blurb !== true ? null : (
        <div className={styles.stageBlurb} title={node.blurb}>
          {node.blurb}
        </div>
      )}
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
// the five trunk stages, the three boxes under them and the three runs over
// them, and no more — the names on the two feeds and the sentence on each loop
// and each stage need a card, so they get one. It draws all three loops and
// names them; what it still cannot carry is what any of them *do*, which is a
// sentence per run and three sentences the band has no room for.
function PathHead(props: { mapped: boolean; onShowDiagram: () => void }) {
  return (
    <div className={styles.pathHead}>
      <span className={styles.pathTitle}>Signal path</span>
      {/* Only where there is a map to click. A query can narrow the panel down
          to a loop or a branch, and the map needs the trunk — every wire and
          every box under it is placed off a trunk box — so it drops out and the
          standing instruction would be pointing at nothing. */}
      {props.mapped ? (
        <span className={styles.pathHint}>click a stage</span>
      ) : null}
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
  // The three loops, drawn over the trunk on their own returns. Like a branch
  // each is a stage without being a Phase; unlike a branch there is nothing to
  // patch into one, so none of them ever goes inert — a loop is the patch. One
  // drops out when a live filter has left it nothing to show.
  loops: LoopNode[]
  // null = no stage picked, which is where exploration starts. Ignored while a
  // filter is live: then every stage with a match shows at once.
  open: string | null
  expandAll: boolean
  // Two columns of module cards, every stage mounted (see Bench).
  bench: boolean
  // Which feedback returns are carrying signal, for the map to mark.
  live: LoopsLive
  onOpen: (name: string) => void
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
  // Whether a stage's box is a door, stamped on here rather than handed in.
  // A stage opens if its controls can act on something, or if it has a picker at
  // its head — and both halves of that read off what actually renders below, so
  // a box that opens and a stage with something to show cannot come apart. Mix
  // is what it leaves shut: B unpatched leaves its every control inert, and
  // there is no picker for "a second signal", only B's.
  // Asked as "is there a picker" rather than "is there a key": a key present
  // with nothing behind it would open a box onto the empty stage it is drawn
  // inert for, which is the one outcome this is here to make impossible.
  // `dim` is checked first and on its own. A stage the query missed has no
  // groups left to show, but it can still have a picker keyed on its name — so
  // without this, searching for "ghost" would leave SOURCE A pressable and open
  // it onto its input picker alone, which is the stage answering a question
  // nobody asked.
  const opensOn = <T extends PathNode>(n: T): MapNode<T> => ({
    ...n,
    opens:
      n.dim !== true &&
      (n.off !== true || props.stageTop[n.name] !== undefined),
  })
  const nodes = props.nodes.map(opensOn)
  const branches = props.branches.map(opensOn)
  const loops = props.loops.map(opensOn)
  // Trunk, then loops, then branches — the order the panel lists them in, and
  // the order the drawing reads in from the top: the returns ride over the
  // chain and the branches hang under it.
  const openable = [...nodes, ...loops, ...branches].filter(n => n.opens)
  if (props.bench) {
    return (
      <Bench
        nodes={nodes}
        openable={openable}
        branches={branches}
        loops={loops}
        open={props.open}
        live={props.live}
        onOpen={props.onOpen}
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
  // The map no longer empties: a query that matches nothing dims every box
  // rather than removing them, so there is always a chain to head and always
  // somewhere for app.tsx's "nothing matches" line to sit *under*. This used to
  // bail out here, and the two bugs it was patched for either way — an empty
  // spine drawing wires between boxes that aren't there, and a query for
  // "vignette" or "bass" matching a loop or a branch while the trunk went
  // blank — are both gone with the reshaping that caused them.
  if (nodes.length === 0) return null
  return (
    <>
      <PathHead mapped={nodes.length > 0} onShowDiagram={props.onShowDiagram} />
      <ChainMap
        stages={nodes}
        branches={branches}
        loops={loops}
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
        {shown.map(({ node, body }) => (
          <div key={node.name} className={styles.stageRow}>
            <StageHead
              node={node}
              nameHint="click to fold this stage"
              countHint="click to see"
              onName={() => props.onOpen(node.name)}
              onCount={node.onJumpTouched}
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
            {/* And a stage that is not made of groups, handed over whole. */}
            {body.body?.()}
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
  loops: MapNode<LoopNode>[]
  open: string | null
  live: LoopsLive
  onOpen: (name: string) => void
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
  return (
    <>
      <PathHead
        mapped={props.nodes.length > 0}
        onShowDiagram={props.onShowDiagram}
      />
      <ChainMap
        stages={props.nodes}
        branches={props.branches}
        loops={props.loops}
        open={props.open}
        // Nothing folds on the bench: a click marks the stage and scrolls to it.
        // A run answers the same way a box does now, which is what it could not
        // do while a loop was a group inside somebody else's stage.
        folds={false}
        live={props.live}
        onOpen={jump}
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
                  blurb
                />
                {/* The picker rides with the heading rather than in a card of
                  its own: it is what the stage is fed by, not one more module
                  of it. A groupless stage's body rides there too, for want of
                  a group card to be — it is one module either way. */}
                {body.picker?.()}
                {body.body?.()}
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
