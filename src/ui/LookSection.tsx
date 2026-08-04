import { useState } from 'react'

import { ControlSlider } from './ControlGroup'
import { GROUPS, PHASES } from './controls'
import { sliderMatches, useFilterQuery } from './filter'
import styles from './LookSection.module.css'
import { useModSlotsApi } from './ModSlotsContext'
import { Section } from './Section'

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
// Which placements are stages on the map, as opposed to the two that surface
// contextually ('ab', 'audio') and have nothing for the map to open.
const STAGES = new Set<string>(PHASES.map(p => p.name))

// What the look on screen is actually made of: every control sitting off stock,
// in signal-path order, as live rows under the group each came from.
//
// This is the panel's answer to the question a session asks most and could not
// ask here at all. Picking a preset is one click; understanding it was five —
// the chain map colours the stages that carry an edit and counts them, but each
// count is a fold, and the controls behind it are scattered down five stages
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
// Costs nothing on a clean board — with nothing off stock there is nothing to
// list, and app.tsx doesn't render the section.
export function LookSection(props: {
  sliders: readonly SliderDef[]
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
  // preset, a mutate, a scene, a link — which shows up here as a key arriving
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
  return matched.length === 0 ? null : (
    <Section
      title="This look"
      openOnFilter
      summary={`${matched.length} off stock`}
    >
      {shown.map((s, i) => {
        const group = GROUP_OF.get(s.key)
        // One caption per run of rows from the same group, not one per row:
        // signal order keeps a group's controls together, so this comes out as
        // a heading over each module the look reaches into.
        const prev = i === 0 ? undefined : GROUP_OF.get(shown[i - 1].key)
        return (
          <div key={s.key}>
            {group === prev ? null : (
              <GroupCaption group={group} onOpen={props.onOpenGroup} />
            )}
            <ControlSlider slider={s} />
          </div>
        )
      })}
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
// Only a button for a group that is on the spine: the A/B and audio groups
// surface in sections of their own, which the map has no fold for.
function GroupCaption(props: {
  group: Group | undefined
  onOpen: (stage: string, group: string) => void
}) {
  const group = props.group
  if (group === undefined) return null
  return STAGES.has(group.place) ? (
    <button
      className={styles.from}
      title={`open ${group.name} in the ${group.place} stage`}
      onClick={() => props.onOpen(group.place, group.name)}
    >
      {group.name}
    </button>
  ) : (
    <div className={styles.from}>{group.name}</div>
  )
}
