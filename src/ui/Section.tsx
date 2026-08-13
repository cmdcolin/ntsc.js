import { createContext, use, useState } from 'react'

import { cx } from './cx'
import { useFilterQuery } from './filter'
import styles from './Section.module.css'
import { readRecord, writeJSON } from './storage'

import type { ReactNode } from 'react'

// Collapsed/open choices persist per title so a reload keeps your working set.
// Parsed once per page load: seventeen sections mounting used to parse the map
// seventeen times over, and every toggle re-parsed it to write it back.
const STORE = 'video_feedback_sections'
type OpenMap = Partial<Record<string, boolean>>
let openMap: OpenMap | undefined
function getOpenMap(): OpenMap {
  openMap ??= readRecord<OpenMap>(STORE, {})
  return openMap
}
function persistOpen(title: string, open: boolean) {
  openMap = { ...getOpenMap(), [title]: open }
  writeJSON(STORE, openMap)
}

// Whether a section sits under something that already named a division of the
// panel — another section, or a stage heading. It's a structural fact, so it's
// read from the tree rather than asked of every call site: passing it by hand
// meant one forgotten prop rendered a group at the same rank as its parent,
// which is the flat look this is meant to break up.
const NestedContext = createContext(false)

// For a heading that owns sections without being one itself — SignalPath's
// stage names, which outrank the groups rendered beneath them.
export function NestedSections(props: { children: ReactNode }) {
  return <NestedContext value={true}>{props.children}</NestedContext>
}

// Single-open browsing: sections inside one take their open state from the
// shared id, so opening a group folds its neighbours and the whole signal path
// stays on screen. Structural, like NestedContext: a section is a member by
// where it sits, not by every call site passing a matching pair of props.
const AccordionContext = createContext<{
  openId: string | null
  onToggle: (id: string) => void
} | null>(null)

export function Accordion(props: {
  openId: string | null
  onToggle: (id: string) => void
  children: ReactNode
}) {
  return (
    <AccordionContext
      value={{ openId: props.openId, onToggle: props.onToggle }}
    >
      {props.children}
    </AccordionContext>
  )
}

type SectionHelpApi = { open: boolean; openSection: () => void }

export function Section(props: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  // Filtering reaches inside this section, so a match must not stay hidden
  // behind a collapsed header. Off for sections holding nothing filterable.
  openOnFilter?: boolean
  // How many controls inside sit off their default — 0 for none, and then the
  // header wears nothing.
  //
  // A count rather than the bare bullet it used to be, in the same `• N` the
  // stage's own heading wears a few pixels above (SignalPath.module.css
  // .phaseDot) and off the same arithmetic, so the counts under a stage add up
  // to the one on it. A stage opens with its groups folded, and nine headers
  // that each said only "something in here" left you opening them one at a time
  // to find which held the three the stage was claiming.
  dot?: number
  // What the section is set to, for a section whose whole state reads in a few
  // words — shown only while it is folded, where it is the reason folding is
  // free rather than a thing you have to open the section to check.
  summary?: string
  // Optional accessory (e.g. a ? explainer) beside the title, outside the
  // toggle button so its clicks are its own. Given as a function it also gets
  // the section's open state and a way to open it: an accessory that reveals
  // something in the body — Presets' "all" — otherwise reads as a dead button
  // while the section is folded, since its whole effect is out of sight.
  help?: ReactNode | ((api: SectionHelpApi) => ReactNode)
}) {
  const nested = use(NestedContext)
  const accordion = use(AccordionContext)
  const query = useFilterQuery()
  const [selfOpen, setSelfOpen] = useState(
    () => getOpenMap()[props.title] ?? props.defaultOpen ?? true,
  )
  const open = accordion === null ? selfOpen : accordion.openId === props.title
  const shown = (props.openOnFilter === true && query !== '') || open
  const toggle = () => {
    if (accordion === null) {
      setSelfOpen(!selfOpen)
      persistOpen(props.title, !selfOpen)
    } else {
      accordion.onToggle(props.title)
    }
  }
  return (
    <div>
      <h3 className={cx(styles.head, nested && styles.headSub)}>
        <button
          className={styles.headBtn}
          aria-expanded={shown}
          onClick={() => toggle()}
        >
          <span className={styles.headTitle}>
            {props.title}
            {props.dot === undefined || props.dot === 0 ? null : (
              <span className={styles.dot}> • {props.dot}</span>
            )}
          </span>
          {shown || props.summary === undefined ? null : (
            <span className={styles.summary} title={props.summary}>
              {props.summary}
            </span>
          )}
          <span className={styles.caret}>{shown ? '▾' : '▸'}</span>
        </button>
        {typeof props.help === 'function'
          ? props.help({
              open: shown,
              openSection: () => {
                if (!shown) toggle()
              },
            })
          : props.help}
      </h3>
      {shown ? <NestedSections>{props.children}</NestedSections> : null}
    </div>
  )
}
