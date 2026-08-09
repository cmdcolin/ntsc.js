import { useState } from 'react'

import { ControlSlider } from './ControlGroup'
import { GROUPS, SOUND_STAGE, SOURCE_B_STAGE, VIEW_STAGE } from './controls'
import { sliderMatches, useFilterQuery } from './filter'
import styles from './LookSection.module.css'
import { useModSlotsApi } from './ModSlotsContext'
import { Section } from './Section'
import { Rack } from './Slider'

import type { ControlKey } from '../controls'
import type { Group, SliderDef } from './controls'

// How many of the off-stock rows stand in the open before the rest go behind a
// count. Six is about where the section stops being a summary and starts being
// a second copy of the panel: "deep end" moves thirty-four controls, and
// unfolded that is 700px of sidebar above the chain map — the exact reserve the
// last two passes went to the trouble of taking out.
const CAP = 6

// Where each control lives, so a row gathered out of its stage can still say
// which one it came from. Built once at module load off the same table the
// panel's own headers are built from.
const GROUP_OF = new Map<ControlKey, Group>()
for (const g of GROUPS) for (const s of g.sliders) GROUP_OF.set(s.key, g)

// The placements that are not a stage name. Every other `place` is a Phase and
// is already the name of the stage that opens it, so this is the whole
// translation — a table rather than a chain of ternaries, because there are
// three of them now and a fourth would have kept extending the chain.
const OFF_SPINE_STAGE: Partial<Record<Group['place'], string>> = {
  b: SOURCE_B_STAGE,
  audio: SOUND_STAGE,
  view: VIEW_STAGE,
}

// What the look on screen is actually made of: every control sitting off stock,
// in signal-path order, as live rows under the group each came from.
//
// This is the panel's answer to the question a session asks most and could not
// ask here at all. Picking a preset is one click; understanding it was five —
// the chain map colours the stages that carry an edit and counts them, but each
// count is a fold, and the controls behind it are scattered down six stages
// that only open one at a time. So "what does vhs actually do?" and "which knob
// is making that?" both ended in a hunt, and the panel's resting state was
// 414px of chrome with not one slider in it.
//
// The rows are the real ones, so this is not a readout: the thing that made the
// look is the thing you drag, and each row carries its own ↺ for putting one
// piece back without losing the rest. The group captions between them are the
// other half of it — "mix", "gain" and "zoom" mean nothing out of their module,
// and each is a way into that module on the map, so the section doubles as a
// contents page for the look.
//
// Folded by default, and present on a clean board, because this is the one
// section in the panel that grows on its own — every other one is the size it
// is until you open it. It sits above everything you work on, so a row arriving
// here used to push the control under your pointer 87px down the screen
// (measured: first edit, panel at the top). useScrollAnchor takes that back
// when the section is out of sight above the fold, but nothing can take it back
// while the section is on screen: the growth is above your row and there is
// nothing above it to scroll away, so either your row moves or the masthead
// does.
//
// So the section doesn't grow. Folded it is a header and a count, and the count
// going from 3 to 4 is not a layout change; the header is rendered at zero rows
// too, so the first edit isn't one either. Opening it is a click you made, and
// from then on it grows in view like anything you unfold.
export function LookSection(props: {
  sliders: readonly SliderDef[]
  // The stages a caption can jump to right now — see GroupCaption.
  openStages: ReadonlySet<string>
  onOpenGroup: (stage: string, group: string) => void
}) {
  const [all, setAll] = useState(false)
  const query = useFilterQuery()
  const mod = useModSlotsApi()
  // Membership is sticky, and that is not a nicety: a row leaving the list the
  // instant it reaches its default would unmount the range input *mid-drag*,
  // which is the ordinary way to turn a fault off (drag it to the left end,
  // where most of these defaults sit). The drag would stop early and the rows
  // below would jump up under the pointer.
  //
  // So the list only re-syncs when something writes the board wholesale — a
  // preset, a mutate, a saved look, a link — which shows up here as a key arriving
  // that the list didn't have. Putting rows back never grows the set, so a row
  // you reset stays where it is, at stock and quiet, still in reach if you want
  // it again. "clean" empties the set outright, and that does prune.
  const [held, setHeld] = useState<readonly SliderDef[]>(props.sliders)
  const stale =
    props.sliders.some(s => !held.includes(s)) ||
    (props.sliders.length === 0 && held.length > 0)
  if (stale) setHeld(props.sliders)
  const list = stale ? props.sliders : held

  const matched =
    query === ''
      ? list
      : list.filter(s => sliderMatches(s, query, mod.modFor(s.key) !== null))
  const rest = matched.length - CAP
  const shown = all ? matched : matched.slice(0, CAP)
  // Under a query the section is a result list like any other, and a header
  // over nothing is a dead end in one — so the empty header is for the resting
  // panel only, where it is what keeps the first edit from moving anything.
  if (matched.length === 0 && query !== '') return null
  return (
    <Section
      title="This look"
      defaultOpen={false}
      openOnFilter
      summary={
        matched.length === 0
          ? 'nothing off stock'
          : `${matched.length} off stock`
      }
    >
      {matched.length === 0 ? (
        <div className={styles.empty}>
          every control is at its default — move one and it turns up here
        </div>
      ) : null}
      {/* One rack over the whole list, not one per caption: these rows are
          gathered out of six stages and the captions between them are
          headings, not divisions — tracks that stepped left and right down the
          list would read as the section being several lists. Sized off
          `matched` so unfolding the tail doesn't shift the rows above it. */}
      <Rack sliders={matched}>
        {shown.map((s, i) => {
          const group = GROUP_OF.get(s.key)
          // One caption per run of rows from the same group, not one per row:
          // signal order keeps a group's controls together, so this comes out
          // as a heading over each module the look reaches into.
          const prev = i === 0 ? undefined : GROUP_OF.get(shown[i - 1].key)
          return (
            <div key={s.key}>
              {group === prev ? null : (
                <GroupCaption
                  group={group}
                  openStages={props.openStages}
                  onOpen={props.onOpenGroup}
                />
              )}
              <ControlSlider slider={s} />
            </div>
          )
        })}
      </Rack>
      {rest <= 0 ? null : (
        <button
          className={styles.more}
          onClick={() => setAll(!all)}
          title="the rest of the controls this look moves off stock"
        >
          {all ? '▾ fewer' : `▸ ${rest} more`}
        </button>
      )}
    </Section>
  )
}

// Which module the rows under it came from, and the way back to it on the map.
// Only a button for a group in a stage that will actually open: a branch — the
// sound, input B — and, for B, the mixer it arrives at open onto nothing while
// that branch has no input. A look can still carry a wipe from a preset applied
// with B switched off since, so this is a live question rather than a property
// of the table.
function GroupCaption(props: {
  group: Group | undefined
  openStages: ReadonlySet<string>
  onOpen: (stage: string, group: string) => void
}) {
  const group = props.group
  if (group === undefined) return null
  // The off-spine placements are named for what they hold; the stage each opens
  // is named for what it is. Every other placement is already the stage's own
  // name.
  const stage = OFF_SPINE_STAGE[group.place] ?? group.place
  return props.openStages.has(stage) ? (
    <button
      className={styles.from}
      title={`open ${group.name} in the ${stage} stage`}
      onClick={() => props.onOpen(stage, group.name)}
    >
      {group.name}
    </button>
  ) : (
    <div className={styles.from}>{group.name}</div>
  )
}
