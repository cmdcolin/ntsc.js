import type { Group } from './controls'
import type { ReactNode } from 'react'

// Everything a stage on the signal path renders under its heading: the picker
// that decides what feeds it, and its control groups.
//
// Either can be absent, for reasons that have nothing to do with each other — a
// live filter suppresses pickers, because everything below the filter box is the
// result set and a picker is not a result; and an inert stage's groups are
// dropped, because the input they act on is the thing you would open the stage
// to pick.
//
// Which means a stage can end up with **neither**, and that is the case worth
// having a file for. A stage with no body must not be listed at all: it comes
// out as a heading over nothing, which is the dead end in a result list that
// app.tsx already drops empty stages to avoid. That shipped once — with the
// pickers newly inside the stages, a query matching a control on an unpatched
// Source B listed the stage, suppressed its picker for being under a filter, and
// gated its groups off for being unable to act, leaving the name and a blank.
//
// So both questions are answered from one value here — whether to list a stage,
// and what it draws — rather than by a filter rule in one place and a pair of
// render gates in another, kept agreeing by hand.

// What this needs of a stage, named structurally rather than imported: the
// panel's `PathNode` (ui/SignalPath.tsx) satisfies it, and taking the type from
// there would be a cycle for two fields.
export interface StageLike {
  name: string
  groups: Group[]
  // Nothing patched in, so this stage's controls have nothing to act on.
  off?: boolean
}

export interface StageBody {
  // A thunk, not a node: only the stages on screen build their picker, which is
  // the same reason `groups` travels as data rather than as rendered sections.
  picker: (() => ReactNode) | undefined
  groups: Group[]
}

export const stageBody = (
  node: StageLike,
  stageTop: Partial<Record<string, () => ReactNode>>,
  showPicker: boolean,
): StageBody => ({
  picker: showPicker ? stageTop[node.name] : undefined,
  groups: node.off === true ? [] : node.groups,
})

export const hasBody = (body: StageBody): boolean =>
  body.picker !== undefined || body.groups.length > 0
