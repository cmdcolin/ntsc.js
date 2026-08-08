import { COOL_KEYS } from '../labels'
import { cx } from './cx'
import { Popover } from './Popover'
import styles from './TagsPopover.module.css'

import type { TagName } from '../labels'
import type { LookContext } from './useLookLabels'

// "tags" — say what the look on screen is, and how much you like it.
//
// One button in the look bar, beside `saved`, and it belongs there for the same
// reason that one does: it is a thing you do *to the whole board*, in two seconds,
// and it should not cost a fold of permanent panel height. It sits next to saving
// because the two are the same moment from different angles — saving keeps a look
// for yourself, this describes it for the model.
//
// Why the app at all, rather than the labelling page at /vote.html: that page is a
// cleaner experiment but only collects from someone who set out to label. This
// collects from anyone rolling looks, which is the whole difference between a few
// hundred rows and a few thousand. See useLookLabels for why the methodological
// objections to doing it here turn out not to bite.
//
// **The vocabulary is deliberately not about mechanism.** There is no `vhs` tag and
// there never should be: the record already stores the preset weights and the
// resolved board, so a model can read the mechanism off the parameters. What it
// cannot read is how the result *feels*, and that is the only thing a human is
// adding here.
export function TagsPopover(props: {
  tags: readonly TagName[]
  vocabulary: readonly { key: string; name: TagName; hint: string }[]
  onToggle: (name: TagName) => void
  // Committing takes the rating and the look in one call, because the look has to
  // be read at the instant of the click rather than held in this component: the
  // board can move under an open popover (a slider, a knob, an LFO) and the row
  // has to describe what was on screen when the button went down.
  onRate: (cool: number, look: LookContext) => void
  readLook: () => LookContext
  // Clears the tags as the menu opens. Tags describe the look they were picked
  // for, and the board moves between openings — carrying them over would file the
  // last look's description against this one.
  onOpen: () => void
  saved: number
  pending: number
  signedIn: boolean
  onSignIn: () => void
}) {
  return (
    <Popover
      onOpen={props.onOpen}
      trigger={attrs => (
        <button
          {...attrs}
          className={styles.trigger}
          title="describe this look and rate it — teaches the app which settings are worth rolling"
        >
          tags{props.saved === 0 ? '' : ` ${props.saved}`}
        </button>
      )}
    >
      {id => (
        <div className={styles.body}>
          <p className={styles.lead}>
            What is this look like? Pick any that fit, then say how much you
            like it.
          </p>
          <div className={styles.tags}>
            {props.vocabulary.map(tag => {
              const on = props.tags.includes(tag.name)
              return (
                <button
                  key={tag.name}
                  className={cx(styles.tag, on && styles.tagOn)}
                  aria-pressed={on}
                  title={tag.hint}
                  onClick={() => {
                    props.onToggle(tag.name)
                  }}
                >
                  {tag.name}
                </button>
              )
            })}
          </div>
          {props.signedIn ? (
            <div className={styles.rateRow}>
              {COOL_KEYS.map(({ cool, label }) => (
                <button
                  key={cool}
                  className={styles.rate}
                  popoverTarget={id}
                  popoverTargetAction="hide"
                  title={`rate ${cool} of 5 and file it`}
                  onClick={() => {
                    props.onRate(cool, props.readLook())
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            // Asked here rather than up front, because pressing a rating button is
            // where somebody has shown they want to contribute. Rating without an
            // account used to be allowed and the rows waited in this browser for a
            // sign-in that mostly never came — work that looked collected and was
            // not.
            <button className={styles.signIn} onClick={props.onSignIn}>
              sign in to rate
            </button>
          )}
          <p className={styles.note}>
            {props.signedIn
              ? `Filed to your account.${props.pending === 0 ? '' : ` ${props.pending} still to send.`}`
              : 'Tags are yours to pick either way — an account is what gives the rating somewhere to go.'}
          </p>
        </div>
      )}
    </Popover>
  )
}
