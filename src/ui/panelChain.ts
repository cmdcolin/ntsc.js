import { atRest } from '../controls'
import {
  AUDIO_GROUPS,
  B_GROUPS,
  LOOP_STAGES,
  loopGroups,
  MIX_STAGE,
  OFF_HINT,
  PHASES,
  SOUND_BLURB,
  SOUND_JOIN,
  SOUND_STAGE,
  SOURCE_B_BLURB,
  SOURCE_B_STAGE,
  VIEW_BLURB,
  VIEW_GROUPS,
  VIEW_JOIN,
  VIEW_STAGE,
} from './controls'
import { freeMatches, groupMatches } from './filter'

import type { Controls } from '../controls'
import type { Group } from './controls'
import type { IsRouted } from './filter'
import type { BranchNode, LoopNode, PathNode } from './SignalPath'
import type { ReactNode } from 'react'

// Every box the panel's map draws, worked out from the control tables, the live
// look and the filter — and nothing else. Its own module because it is the
// sidebar's whole structure and it is arithmetic over data: which stages are on
// the map, which of them can act on anything, and which of them a query has left
// with nothing. That last question is the one this file exists for; see
// `anyStage` at the bottom.
//
// It builds three lists rather than one because the drawing does: the trunk the
// picture passes along, the loops patched over it, and the branches hanging
// under it.

// What a box that is wired to nothing is holding — the modulation bay's patched
// slots, the deck's engaged gestures. Neither is a count of controls off stock,
// so the clause arrives finished from whoever counted it (bayLoad, deckLoad).
export interface StageLoad {
  n: number
  say: string
}

// A stage of the panel that is not part of the chain at all: what it is patched
// into is the *controls*, every one of them, which is a wire to two hundred
// sliders and therefore no wire. It carries its own body because it is not made
// of control groups (stageBody.ts).
export interface FreeStage {
  name: string
  blurb: string
  load: StageLoad
  body: () => ReactNode
  // The words a searcher would type for something this box holds and the blurb
  // does not happen to use. Absent means the box never survives a query — see
  // `freeMatches`, which is where the two boxes part company: the deck's rows
  // are all borrowed and the bay's are not.
  keywords?: readonly string[]
}

export interface PanelChain {
  nodes: PathNode[]
  branches: BranchNode[]
  loops: LoopNode[]
  // Whether the query reached a stage that will actually draw something. Not
  // "did any stage survive the filter": a stage can survive with matching groups
  // and still render a heading over a blank, because an inert stage's groups are
  // suppressed (stageBody.ts) — which is exactly the case the "nothing matches"
  // line has to keep quiet for, and the case it has to speak up for.
  anyStage: boolean
  // The stages the query *did* reach that cannot act on anything, in the order
  // the map draws them. The other half of `anyStage`: the panel used to answer
  // "bass" with "nothing matches", which is false — there are seven controls
  // called that, and what is missing is the input they act on, not the control.
  // Empty whenever `anyStage` is true, since a result on screen answers first.
  blocked: string[]
}

// A stage with nothing patched into it: no amber however far off stock its
// controls sit, because none of them is reaching the picture, and the hint in
// place of the blurb. Whether the box still *opens* is not decided here — a
// source branch does, on the strength of the picker at its head, and SignalPath
// works that out from the pickers themselves.
//
// The hint is looked up rather than passed: OFF_HINT is the one table, because
// the full diagram draws these same dead boxes and the two copies had drifted.
const inert = (node: PathNode): PathNode => ({
  ...node,
  touched: 0,
  off: true,
  offHint: OFF_HINT[node.name],
})

// Whether a node draws anything under its heading. A node a query left with no
// groups is already dropped below, so what is left to ask is whether the ones
// that remain can act on anything.
const draws = (node: PathNode) =>
  node.off !== true && (node.groups.length > 0 || node.body !== undefined)

// The two inputs and the view, which hang under the trunk rather than sitting on
// it. One table because the three differ only in the fields here: matching the
// query, counting the edits, going inert with nothing patched in and dropping
// out when a query leaves them nothing were three copies of one rule.
//
// Each is still drawn while nothing is patched into it — a drawn, inert box is
// the one thing on screen saying that input exists at all — so one goes only
// when a live filter has left it no groups.
const BRANCHES: readonly {
  name: string
  blurb: string
  groups: readonly Group[]
  join: string
  under: 'head' | 'join'
  dir?: 'out'
  // Which input decides whether anything is reaching it. The view has none:
  // there is nothing to patch into where you are watching from, so unlike the
  // other two it never goes inert.
  fed?: 'b' | 'sound'
}[] = [
  {
    name: SOURCE_B_STAGE,
    blurb: SOURCE_B_BLURB,
    groups: B_GROUPS,
    // 'head' puts its box under the head of the trunk, sharing its left edge, so
    // the two inputs read as a column — see WiredBranch in chainLayout.ts.
    join: MIX_STAGE,
    under: 'head',
    fed: 'b',
  },
  {
    name: SOUND_STAGE,
    blurb: SOUND_BLURB,
    groups: AUDIO_GROUPS,
    join: SOUND_JOIN,
    under: 'join',
    fed: 'sound',
  },
  {
    name: VIEW_STAGE,
    blurb: VIEW_BLURB,
    groups: VIEW_GROUPS,
    join: VIEW_JOIN,
    under: 'join',
    // The one box the arrow points out of the chain into, rather than in.
    dir: 'out',
  },
]

export function panelChain(o: {
  controls: Controls
  // The live filter, lowercased and trimmed — '' for none.
  query: string
  isRouted: IsRouted
  // Whether anything is patched into each of the two things that can be.
  bOn: boolean
  soundOn: boolean
  // Opens one group inside one stage: what a stage's `• N` jumps to.
  onOpenGroup: (stage: string, group: string) => void
  // The boxes wired to nothing, in the order they sit on their own row. Under a
  // query each survives on its own keywords (`freeMatches`) rather than both
  // dropping out — which is what they used to do, on the argument that neither
  // holds a control the filter can reach.
  //
  // That was half true, and the false half was load-bearing. It holds for the
  // deck, whose every row is borrowed from a stage already in the results under
  // its own name. It never held for the bay: the gate, its rate, the tempo and
  // the split against a held look are in no group and on no other stage, so the
  // filter was hiding the only copy of them — and hiding it hardest for the word
  // most people search this app for, since "strobe" is what the gate is.
  free: readonly FreeStage[]
}): PanelChain {
  const { controls } = o
  const matching = (groups: readonly Group[]) =>
    groups.filter(g => groupMatches(g, o.query, o.isRouted))

  // Roll the per-group touched state up to the stage, so the chain reads as a
  // status map — you see which stages you're in without opening any. The count
  // is a button: it jumps into the first touched group, which is the path from
  // "this preset looks cool" to the knobs that made it. Data only: the open
  // stage builds its own sections.
  const node = (name: string, blurb: string, groups: Group[]): PathNode => {
    const parts = groups.map(group => ({
      touched: group.sliders.filter(s => !atRest(controls[s.key], s.key))
        .length,
      onOpen: () => o.onOpenGroup(name, group.name),
    }))
    return {
      name,
      blurb,
      groups,
      touched: parts.reduce((n, p) => n + p.touched, 0),
      onJumpTouched: () => {
        const first = parts.find(p => p.touched > 0)
        if (first !== undefined) first.onOpen()
      },
    }
  }

  // The trunk. Mix is the one stage on it that can go inert: every one of its
  // controls needs a second signal, and unlike a branch there is no picker for
  // "a second signal" to offer — so its box is a statement about the chain
  // rather than a door (see PICKER_STAGES).
  const nodes = PHASES.flatMap((phase): PathNode[] => {
    const groups = matching(phase.groups)
    if (groups.length === 0) return []
    const n = node(phase.name, phase.blurb, groups)
    return [phase.name === MIX_STAGE && !o.bOn ? inert(n) : n]
  })

  // The three loops, drawn over the trunk. Never inert: there is nothing to
  // patch into a loop and the chain under it is always carrying A, so unlike a
  // branch a loop has no off state to draw. One drops out only when a live
  // filter has left it nothing — and then its run goes too, because for a loop
  // the run is the whole door.
  const loops = LOOP_STAGES.flatMap((l): LoopNode[] => {
    const groups = matching(loopGroups(l.loop))
    return groups.length === 0
      ? []
      : [{ ...node(l.name, l.blurb, groups), loop: l.loop }]
  })

  const fed = { b: o.bOn, sound: o.soundOn }
  const branches: BranchNode[] = [
    ...BRANCHES.flatMap((b): BranchNode[] => {
      const groups = matching(b.groups)
      if (groups.length === 0) return []
      const n = node(b.name, b.blurb, groups)
      const wiring = { join: b.join, under: b.under, dir: b.dir }
      return [
        { ...(b.fed !== undefined && !fed[b.fed] ? inert(n) : n), ...wiring },
      ]
    }),
    ...o.free
      .filter(f => o.query === '' || freeMatches(f, o.query))
      .map((f): BranchNode => ({
        ...node(f.name, f.blurb, []),
        // What the box wears its amber for, and what that number counts —
        // "controls off stock" being the wrong noun for either of these.
        // Neither has groups, so `node` counts nothing and this is the whole
        // of it.
        touched: f.load.n,
        touchedSay: f.load.say,
        // No `onJumpTouched`: there is no group under these to jump to —
        // opening one *is* arriving.
        onJumpTouched: undefined,
        body: f.body,
        free: true,
      })),
  ]

  // Trunk, then loops, then branches — the order the panel lists them in, and
  // the order the drawing reads in from the top.
  const all = [...nodes, ...loops, ...branches]
  const anyStage = all.some(draws)
  return {
    nodes,
    branches,
    loops,
    anyStage,
    blocked: anyStage ? [] : all.filter(n => n.off === true).map(n => n.name),
  }
}
