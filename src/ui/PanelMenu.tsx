import styles from './PanelMenu.module.css'
import { MenuItem, Popover } from './Popover'
import popoverStyles from './Popover.module.css'

// Everything about the panel itself, behind one ⋮ in the masthead.
//
// The division against the stage's own menu is what the two are menus *of*: the
// stage menu is the picture (zoom, the signal tap, stills, recording,
// fullscreen), this one is the board of controls (how wide it is, which window
// it is in, what the app is). Fullscreen and the popout both hide this panel
// outright, which is why the stage keeps its own copies of the rows they share
// — from there the ⋮ isn't on screen to reach.
//
// It exists because the masthead had grown a ◫ and a GitHub link sitting in the
// open, which is two thirds of a row spent on things nobody presses twice a
// session — and that row is the only horizontal space in the panel that was
// going spare, so it is where the filter's ⌕ had to go.
export function PanelMenu(props: {
  bench: boolean
  // Whether there is width for a second column at all. Stacked under the
  // picture on a phone the flag is ignored by construction, so the row would be
  // a switch that visibly does nothing — it used to hide itself with a media
  // query, and moving it into the menu must not lose that.
  canBench: boolean
  onToggleBench: () => void
  onPopout: () => void
  onShowPalette: () => void
  onShowAdvanced: () => void
  onShowHelp: () => void
}) {
  return (
    <Popover
      trigger={attrs => (
        <button
          className={styles.trigger}
          popoverTarget={attrs.popoverTarget}
          style={attrs.style}
          title="panel options"
          aria-label="panel options"
        >
          ⋮
        </button>
      )}
    >
      {id => (
        <>
          {/* The ⌘K key used to be a button beside the filter box; with that
              row gone this is what says the palette exists at all. First,
              because it is the only row here that reaches the controls. */}
          <MenuItem
            icon="⌕"
            label="jump to anything"
            hint="⌘K"
            closes={id}
            onClick={props.onShowPalette}
          />
          <div className={popoverStyles.menuSep} />
          {/* Stays open: this is the one row whose effect is visible behind the
              menu, and pressing it twice to compare the two widths should not
              cost re-opening the menu in between. */}
          {props.canBench ? (
            <MenuItem
              icon="◫"
              label={props.bench ? 'one column' : 'wide bench — two columns'}
              hint={props.bench ? 'on' : ''}
              onClick={props.onToggleBench}
            />
          ) : null}
          <MenuItem
            icon="⧉"
            label="pop out controls"
            hint=""
            closes={id}
            onClick={props.onPopout}
          />
          <div className={popoverStyles.menuSep} />
          <MenuItem
            icon="⚙"
            label="advanced settings"
            hint=""
            closes={id}
            onClick={props.onShowAdvanced}
          />
          <MenuItem
            icon="?"
            label="help / about"
            hint=""
            closes={id}
            onClick={props.onShowHelp}
          />
          <a
            className={styles.menuLink}
            href="https://github.com/cmdcolin/ntsc.js"
            target="_blank"
            rel="noreferrer"
          >
            <span className={popoverStyles.menuLabel}>
              <span className={popoverStyles.menuIcon}>↗</span>
              source on GitHub
            </span>
          </a>
        </>
      )}
    </Popover>
  )
}
