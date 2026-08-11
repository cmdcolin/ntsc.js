import { ControlRows } from './ControlGroup'
import { sliderFor } from './controls'
import { useControlValue, useControlsApi } from './ControlsContext'
import { cx } from './cx'
import { wipeEngaged } from './deck'
import styles from './Deck.module.css'
import { FaultShelf } from './FaultShelf'
import { PipControl } from './PipControl'
import { Rack } from './Slider'
import { TBar } from './TBar'
import { ToggleButtonGroup } from './ToggleButtonGroup'
import { TrackingPad } from './TrackingPad'
import { LoopTransport, TapeTransport } from './Transport'
import { useHold } from './useHold'

import type { ControlKey } from '../controls'
import type { SliderDef } from './controls'
import type { ReactNode } from 'react'

// The deck: a second organization of controls the panel already has, by gesture
// instead of by mechanism.
//
// The stages below are grouped by where a fault happens in the signal path, and
// that is the right axis for almost everything — it is what makes the mechanisms
// interact for free, and what tells you which of three plausible places a
// horizontal displacement belongs in. It is the wrong axis for about twenty
// controls, and they are all the same twenty: the ones a hand moves *during* a
// take rather than dials in before one. A crossfade lives in Mix, the transport
// that shuttles a loop lives in Feedback, the tracking band lives in Tape, and
// performing with the three of them means three folds and eleven sliders.
//
// So this is not a skin. A chrome texture over the sidebar would buy nothing at
// 332px and cost legibility. What the hardware metaphor is actually for is the
// second index: the same controls, reachable by the gesture that moves them.
// Nothing here is exclusive to the deck — every control it touches still has its
// row in the stage that owns it, with the MIDI bind, the mod routing and the
// help text that row carries. The trims that are settings rather than gestures
// (a wipe's softness, its sweep rate, the slow-motion depth) are those very
// rows, rendered here.
//
// It was a `<Section>` of the sidebar, folded shut by default, sitting directly
// above the map. It is a box on that map now (DECK_STAGE) — the second of the
// two that are wired to nothing, beside the modulation bay, which is the same
// statement made about the same kind of thing: the bay is the hand you set
// running, this is the hand that is on it now, and neither is the rig. Which
// also settles what "folded by default" was for. It is not folded; it is not
// there until it is pressed, and it costs the resting panel nothing.
export function Deck() {
  return (
    <div className={styles.deck}>
      <Transition />
      <Block label="inset" hint="the DVE window — drag to place, grips to size">
        <div className={styles.pad}>
          <PipControl />
        </div>
      </Block>
      <Block
        label="transport"
        hint="two machines, and the tape in each was written by a different head"
      >
        <TapeTransport />
        <LoopTransport />
      </Block>
      <Block label="tracking" hint="the knob on the front of the VCR">
        <div className={styles.pad}>
          <TrackingPad />
        </div>
      </Block>
      <Hold />
    </div>
  )
}

// One labelled division of the deck. Not a Section: these are the deck's own
// parts rather than sections of the panel, and five more folds inside a fold is
// how a performance surface becomes a filing cabinet.
function Block(props: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className={styles.block}>
      <div className={styles.blockLabel} title={props.hint}>
        {props.label}
      </div>
      {props.children}
    </div>
  )
}

// The transition-type buttons and the lever they arm.
//
// These belong side by side because that is the fact they encode: the same
// throw dissolves or wipes depending on which of these is lit, and mix_b agrees
// — the wipe gate multiplies straight into the same bGain the dissolve fades.
// "mix" is wipeMode 0 written as what it is, rather than as "off": with no
// pattern armed the transition is not off, it is a dissolve.
// Axis arrows rather than half-block glyphs. `▌`/`▀` would say which side B
// arrives from as well as which axis splits, and they are what this row wants —
// but the segmented toggle sets `var(--mono)`, whose first choices are UI faces
// that draw block elements narrow and off-baseline (the reason theme.css keeps
// a separate `--mono-blocks` at all). At 11px they came out as a bar and a
// lozenge that read as neither. The arrows survive any face, and which side
// fills is the one thing the wipe miniature in the Mix stage already shows.
const PATTERNS = ['mix', '↔', '↕', '□', '◇']

// Built once, at module scope, and that is the contract rather than a
// micro-optimisation: ControlRows is a memo boundary keyed on the identity of
// its `sliders` prop, which is why the stages pass theirs through sameList. A
// fresh `.map()` per render hands it a new array every time and rebuilds every
// row behind it. These keys never change, so the array never needs to.
const PATTERN_TRIMS: readonly SliderDef[] = (
  ['wipeSoft', 'wipeRate'] satisfies ControlKey[]
).map(k => sliderFor(k))

// Both trims sit behind the same gate — a pattern has to be armed before either
// has an edge to act on — so the block states it once and the rows go quiet,
// which is what `muted` is for. Left to themselves they each drew their own
// copy of "inert — needs a wipe pattern selected · click to set": two identical
// notes 6px apart, in a block whose whole argument is that nothing here gets a
// line of its own that could share one. ControlGroup does this for a stage as a
// banner, but only once three rows are behind one gate (see `banners`); two
// rows rendered outside a group had nothing.
//
// A sentence rather than the note's click-to-fix button. The fix is the row of
// pattern keys directly above, so a button here would have to pick one of four
// arbitrarily to be the one the note arms.
const PATTERN_GATE: ReadonlySet<ControlKey> = new Set<ControlKey>(['wipeMode'])

function Transition() {
  const wipeMode = useControlValue('wipeMode')
  const { writeControl } = useControlsApi()
  return (
    <div className={styles.block}>
      <div
        className={styles.blockLabel}
        title="what the lever does when you throw it"
      >
        transition
      </div>
      <ToggleButtonGroup
        label="transition pattern"
        options={PATTERNS}
        value={Math.round(wipeMode)}
        onChange={v => writeControl('wipeMode', v)}
      />
      <TBar />
      {/* Under the lever, because that is the relationship: the row above
          mixes two pictures, and these break the receiver between them.
          Each carries its own duration — see transitions.ts. */}
      <FaultShelf />
      {/* Real rows, not deck-local copies: softness and sweep rate are settings
          you leave somewhere, so they keep their help, their MIDI bind and — for
          the sweep — the ♩ that locks it to clock. */}
      <Rack sliders={PATTERN_TRIMS}>
        <ControlRows sliders={PATTERN_TRIMS} muted={PATTERN_GATE} />
      </Rack>
      {/* Held to one line at the docked width. Two lines here and the block is
          exactly as tall as the two per-row notes it replaced, which would have
          been a rewrite that bought only the repetition. */}
      {wipeEngaged(wipeMode) ? null : (
        <div className={styles.gate}>inert on “mix” — pick a pattern above</div>
      )}
    </div>
  )
}

// Freeze, as a gesture rather than as a number.
//
// timeScale is the whole simulation's step rate: noise, rolls, sweeps, feedback
// loops and phosphor all crawl together, and 0 stops the frame dead. As a slider
// it is a trim at the bottom of a stage nobody performs from; as a button it is
// the hold that makes everything else here a performance.
//
// Deliberately time only. The modulation bay has its own freeze in the strip
// above the signal path, and it holds a different thing — every wave's *phase*,
// so letting go picks the drift back up mid-stride. One button owning two
// freezes with two restore values in two components is how the two of them
// start disagreeing about what is held.
const TIME_ROW: readonly SliderDef[] = (
  ['timeScale'] satisfies ControlKey[]
).map(k => sliderFor(k))

function Hold() {
  const timeScale = useControlValue('timeScale')
  const { writeControl } = useControlsApi()
  // The park and the memory of the rate it was at — see useHold, which the
  // motion strip's own ❚❚ shares.
  const hold = useHold(timeScale, v => writeControl('timeScale', v))
  return (
    <div className={styles.block}>
      <div className={styles.holdRow}>
        <span
          className={styles.blockLabel}
          title="the whole simulation's step rate — every mechanism slows together"
        >
          hold
        </span>
        <button
          className={cx(styles.holdBtn, hold.frozen && styles.holdOn)}
          title={
            hold.frozen
              ? 'let the picture run again, at the rate it was on'
              : 'stop the frame dead — every mechanism together, not a still image of one'
          }
          onClick={hold.toggle}
        >
          {hold.frozen ? '▶ run' : '❚❚ hold'}
        </button>
      </div>
      <Rack sliders={TIME_ROW}>
        <ControlRows sliders={TIME_ROW} />
      </Rack>
    </div>
  )
}
