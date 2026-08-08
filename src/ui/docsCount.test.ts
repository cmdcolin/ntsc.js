import { expect, test } from 'vitest'

import { CONTROL_KEYS } from '../controls'

import { readFileSync } from 'node:fs'

// Four places in the prose quote how many controls there are, and every one of
// them said "130" long after there were 234 — the number is the first thing a
// reader meets and nothing was holding it to the schema. (A handoff note put it
// at 268, which was never true either; the drift runs both ways once nobody can
// check.) The count is `CONTROL_KEYS.length`, so these read it.
//
// Both phrasings the docs use are accepted, because both are honest: an exact
// "~234" and a rounded-down "230+". The rule is that the quoted figure must not
// overstate, and must not trail reality by a round ten — which is what makes
// adding a control cheap (nothing to update until the ten rolls over) while
// still catching a claim that has fallen a hundred behind.
const SITES = [
  {
    file: 'docs/USER-GUIDE.md',
    re: /the way into all ~(\d+) controls/,
  },
  {
    file: 'docs/MIDI.md',
    re: /There are about (\d+) sliders in this thing/,
  },
  {
    file: 'docs/COMPARISON.md',
    re: /\*\*(\d+)\+ controls\*\* across/,
  },
  {
    file: 'README.md',
    re: /- (\d+)\+ settings across/,
  },
]

test.each(SITES)('$file quotes a live control count', ({ file, re }) => {
  const found = re.exec(readFileSync(file, 'utf8'))
  // A null here means the sentence was reworded, not that the count is wrong.
  // Fix the pattern in this file rather than deleting the case.
  expect(
    found,
    `no control-count sentence matching ${String(re)}`,
  ).not.toBeNull()

  const claimed = Number(found?.[1])
  const actual = CONTROL_KEYS.length
  expect(claimed).toBeLessThanOrEqual(actual)
  expect(actual - claimed).toBeLessThan(10)
})
