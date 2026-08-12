import { DECK_STAGE, MOD_STAGE } from './controls'
import { MOVING_QUERY } from './filter'

import type { PaletteAction } from './CommandPalette'
import type { MutateAmount } from './mutate'
import type { AnySlotView } from './slotView'

// Everything ⌘K can run that is not a preset or a control — those two the
// palette indexes for itself off the static tables, and this is the list of
// verbs nothing else can enumerate.
//
// Its own module because it is a list, not a component: a hundred and eighty
// lines of names and blurbs that App was carrying between its hooks and its
// markup, and every one of them is one call into something App already holds.
// What is left at the call site is which handler each row is wired to, which is
// the only part App is the authority on.
//
// Hold-to-compare is deliberately absent: it is a gesture, not a command.

// The cue verbs for one slot. Both are already on the row under that slot's seek
// bar and both have a key, and they are in the palette as well for the reason
// the Commons verbs in the same list are: that row lives inside a section which
// starts folded, and these are pressed while looking at the picture rather than
// at the panel.
//
// The name tracks the state, the way the star's does. A press means something
// different depending on what is marked, and a row that read "cue" while the
// next press would close a loop would be lying about what it does.
//
// One argument, and it is the slot: the tag, the duration, the cue and both
// verbs all come out of it together. Handed over as five loose values — which is
// what this took before ui/slotView.ts existed — it was possible to label B's
// row with A's tag, or to wire the tag and the cue to one slot and `run` to the
// other, and nothing but reading would have caught it.
const cueVerbs = (slot: AnySlotView): PaletteAction[] => {
  const { tag, cue } = slot
  const noClip = slot.duration === 0
  const cueArmed = cue !== null && cue.out === null
  return [
    {
      name: cueArmed
        ? `close the loop on source ${tag}`
        : cue !== null
          ? `re-cue source ${tag}`
          : `cue source ${tag}`,
      blurb: noClip
        ? `nothing with a timeline on source ${tag} — a clip or a file first`
        : cueArmed
          ? 'the stretch since the cue starts repeating at once'
          : cue !== null
            ? 'drop this loop and mark a fresh cue at the playhead'
            : 'mark the playhead — press again to loop from there',
      run: slot.tapCue,
    },
    {
      name: `back to the cue on source ${tag}`,
      blurb:
        cue === null
          ? `nothing cued on source ${tag} yet`
          : 'jump back and keep playing — stab it in time for a stutter',
      run: slot.retrigger,
    },
  ]
}

export function paletteActions(o: {
  // The three whole-board rolls and the walk back through them.
  onSurprise: () => void
  onMutate: (amount: MutateAmount) => void
  onRollMotion: (amount: MutateAmount) => void
  onUndo: () => void
  onRedo: () => void
  // Both decks, for the cue verbs above — as a list, so the pair cannot be
  // written out twice and get one of the four names crossed over.
  slots: readonly AnySlotView[]
  // Three settings applied at once, which is a command and not a surface. Its
  // parts each went to the thing they belong to — the rate to each deck's own
  // transport, the tail to the audio picker — and a row that only sets all three
  // at their preset values is exactly what the palette is for. It arrives
  // assembled because it reaches across two hooks: the engine cannot move the
  // audio picker's state.
  onVaporwave: () => void
  // The random archives, which need two verbs from the keys rather than from the
  // sidebar: both are in the caption row already, and that row is inside a
  // section that starts folded and is 141px of the panel when it is not — which
  // is exactly the wrong place for the one control in this app you press
  // repeatedly while looking at the picture rather than at the panel.
  roll: {
    can: boolean
    // What is on screen out of a pool, already captioned — null when nothing
    // rolled is up. Neither row is gated on it: a row that vanishes is a row
    // nobody learns is there, and the blurb is what says what it would do.
    up: string | null
    kept: boolean
    again: () => void
    keep: () => void
  }
  // Keeping the board under a name. The one way in that needs no name typed: it
  // takes the same suggestion the save box offers as a placeholder. A palette row
  // cannot prompt for text, and refusing to save from here over that would be the
  // wrong half of the feature to withhold — the row is for hands already on the
  // keys, and a look saved as "vhs 3" is one × in the menu away from gone if that
  // was not the name you wanted.
  save: { can: boolean; as: string; run: () => void }
  onCopyLink: () => void
  onRecord: () => void
  onStill: () => void
  // Where the picture and the panel are.
  onFullscreen: () => void
  onBench: () => void
  onPopout: () => void
  // The doors. `onFilter` is also how the one entry that can see a routing
  // answers: the palette indexes controls by their static definition, so it can
  // no more see one than the filter could, and it hands the question over.
  onFilter: (query: string) => void
  onOpenStage: (name: string) => void
  onDiagram: () => void
  onAdvanced: () => void
  onAbout: () => void
}): PaletteAction[] {
  // A jump into a free box clears the filter first, or it can open a stage that
  // is not being drawn. The deck is off the map under every query (it declares
  // no keywords — see `freeMatches`), and the bay is off it under most: it
  // answers to its own words and not to the one you happen to have typed. Either
  // way the box has to be back on the map before a jump lands on it.
  const jump = (name: string) => () => {
    o.onFilter('')
    o.onOpenStage(name)
  }
  return [
    // Named as the look bar names them, with the words they used to carry kept
    // in the blurbs: the palette matches on both, so anyone who learnt
    // "surprise" or "mutate" still types it and still lands on the right row.
    {
      name: 'random look',
      blurb: 'a surprise — stack a few random presets',
      run: o.onSurprise,
    },
    {
      name: 'random nudge',
      blurb: 'mutate: jitter every control around the current look',
      run: () => o.onMutate('normal'),
    },
    {
      name: 'random nudge, gentle',
      blurb:
        'a small mutation, for creeping around a look that is nearly right',
      run: () => o.onMutate('gentle'),
    },
    {
      name: 'random nudge, wild',
      blurb: 'a big mutation, for getting out of a corner',
      run: () => o.onMutate('wild'),
    },
    // The heavy one. It has always been on the button under ctrl (or cmd), and
    // nothing said so anywhere you could read without hovering — a wreck you can
    // only reach by holding a key you were never told about may as well not
    // ship. Named for what it does rather than for its amount: nobody searches
    // the palette for "turbo".
    {
      name: 'randomize everything, hard',
      blurb:
        'turbo: throw most controls past anything a real set would do — the wreck, not a variation',
      run: () => o.onMutate('turbo'),
    },
    // The motion roll, and the one row in this trio whose blurb has to say what
    // it *doesn't* touch: "random" next to a look everybody has just spent ten
    // minutes dialing in reads as a threat, and this one takes nothing away.
    {
      name: 'random motion',
      blurb:
        'keep every slider and re-cable what moves them — a fresh patch of LFOs and drift onto controls this look is using',
      run: () => o.onRollMotion('normal'),
    },
    {
      name: 'random motion, gentle',
      blurb: 'one slow wobble on one control, and nothing else moving',
      run: () => o.onRollMotion('gentle'),
    },
    {
      name: 'random motion, wild',
      blurb: 'three routings, faster and deeper — the board visibly hunting',
      run: () => o.onRollMotion('wild'),
    },
    {
      name: 'vaporwave',
      blurb: 'slow both clips, dial in the tail, and let their sound drive it',
      run: o.onVaporwave,
    },
    {
      name: 'roll another file',
      blurb: !o.roll.can
        ? 'put one of the random archives on a source first'
        : o.roll.up === null
          ? 'another out of the same archive'
          : `another out of the same archive — ${o.roll.up} is up now`,
      run: o.roll.again,
    },
    {
      name: o.roll.kept ? 'unkeep this file' : 'keep this file',
      blurb:
        o.roll.up === null
          ? 'keeps the rolled file that is on screen — nothing is up now'
          : o.roll.kept
            ? 'take it off your clip shelf'
            : 'keep it on your clip shelf: the next roll replaces the picture, the shelf keeps it',
      run: o.roll.keep,
    },
    ...o.slots.flatMap(cueVerbs),
    {
      name: 'undo',
      blurb: 'step back through the looks you have been through',
      run: o.onUndo,
    },
    {
      name: 'redo',
      blurb: 'step forward again after an undo',
      run: o.onRedo,
    },
    {
      name: 'show what is moving',
      blurb: 'filter the panel down to the controls the bay is driving',
      run: () => o.onFilter(MOVING_QUERY),
    },
    {
      name: 'copy link',
      blurb: 'put this look on the clipboard as a URL',
      run: o.onCopyLink,
    },
    {
      name: 'save this look',
      blurb: o.save.can
        ? `keep the board as “${o.save.as}” under saved`
        : 'sign in first — saved looks live on your account',
      run: o.save.run,
    },
    {
      name: 'record clip',
      blurb: 'start or stop recording the stage',
      run: o.onRecord,
    },
    {
      name: 'save still',
      blurb: 'download the current frame as a png',
      run: o.onStill,
    },
    {
      name: 'fullscreen',
      blurb: 'give the picture the whole screen',
      run: o.onFullscreen,
    },
    {
      name: 'wide bench',
      blurb: 'spread the controls over two columns',
      run: o.onBench,
    },
    {
      name: 'pop out controls',
      blurb: 'move this panel into its own window',
      run: o.onPopout,
    },
    {
      name: 'signal path',
      blurb:
        'the whole chain as a diagram — both inputs, the mixer, both loops',
      run: o.onDiagram,
    },
    // The one part of the app the palette cannot otherwise reach. It indexes
    // GROUPS, and nothing in the bay is in GROUPS: a routing describes a slot
    // rather than a knob on the rig, and the stab gate is deliberately not a
    // control (see modSlots.ts for why making it one would put a slider for the
    // whole board inside one stage of it). So the panel's most visible single
    // effect — the entire board cut against a second look on the beat — answered
    // to no search at all. This entry is where it is findable from.
    //
    // Which puts the whole burden on the blurb, since `score` has only the name
    // and this string to match against. So it carries the words somebody types
    // rather than the words the panel uses: **strobe** above all, because that is
    // what most people call this and the app spends the name on two other things
    // (the beam's blanking strobe, the mixer loop's strobe hold). The filter box
    // answers the same query through MOD_KEYWORDS, and the two lists are meant to
    // agree — a word worth adding to one is worth adding to the other.
    {
      name: 'modulation bay',
      blurb:
        'the stab gate that strobes the whole board in and out on the beat — against stock, or against a look you hold there, which flips between the two — plus the tempo every ♩ locks to, and every LFO, drift and envelope you have patched',
      run: jump(MOD_STAGE),
    },
    // The deck is reachable by search only in the same roundabout way: every row
    // it draws is a real control row, so a query finds each of them — in the
    // four separate stages that own them, which is the arrangement the deck
    // exists to offer an alternative to. Nothing answers to "deck" itself.
    {
      name: 'deck',
      blurb:
        'the transition lever and its wipe patterns, the inset, both tape transports, tracking and the hold — the controls a hand moves during a take, gathered under one',
      run: jump(DECK_STAGE),
    },
    {
      name: 'advanced settings',
      blurb: 'render scale and MIDI setup',
      run: o.onAdvanced,
    },
    {
      name: 'about',
      blurb: 'what this is, the user guide, the source, and the version',
      run: o.onAbout,
    },
  ]
}
