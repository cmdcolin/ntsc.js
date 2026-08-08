import { cx } from './cx'
import styles from './FatalScreen.module.css'
import ui from './ui.module.css'

export interface Fatal {
  title: string
  body: string
  // 'lost' is a device the driver took away — reloading rebuilds it and works.
  // 'hung' is a GPU process that stopped completing work; it outlives the page,
  // so a reload lands on the same wedged process. Offering the same button for
  // both is what made the old screen tell the user not to reload next to a
  // reload button.
  //
  // 'budget' is neither: nothing has failed yet. The app needs a WebGPU device in
  // a tab that has already destroyed one that was presenting, and it is saying so
  // while there is still a painting page to say it on. The only action that works
  // is a new tab, so that is the only button that is offered — a reload lands right
  // back here, in a tab that is no better off. Under 0004 that state is reachable
  // only through `?gpudestroy=1`, so in practice this screen belongs to whoever is
  // re-measuring the browser bug.
  kind: 'unavailable' | 'lost' | 'hung' | 'budget'
  // 'budget' only: spend the session anyway. The ceiling is measured from one
  // browser on one OS, so the gate has to be arguable with — see declineDevice.
  onOverride?: () => void
}

export function FatalScreen({ fatal }: { fatal: Fatal }) {
  return (
    <div className={styles.fatalWrap}>
      <div className={styles.fatalCard}>
        <h1 className={styles.fatalTitle}>{fatal.title}</h1>
        <p style={{ margin: '0 0 14px' }}>{fatal.body}</p>
        {fatal.kind === 'unavailable' ? (
          <>
            <video
              className={styles.fatalVideo}
              src={`${import.meta.env.BASE_URL}demo-v2.mp4`}
              poster={`${import.meta.env.BASE_URL}demo-poster-v2.jpg`}
              autoPlay
              muted
              loop
              playsInline
            />
            <p className={ui.muted} style={{ margin: '0 0 14px' }}>
              The entire NTSC signal path runs in WebGPU compute shaders, so a
              WebGPU-capable browser with working hardware acceleration is
              required — there is no fallback rendering path.
            </p>
            <p className={ui.muted} style={{ margin: 0 }}>
              <a
                className={ui.link}
                href="https://github.com/cmdcolin/ntsc.js"
                target="_blank"
                rel="noreferrer"
              >
                github.com/cmdcolin/ntsc.js
              </a>
              {' · '}
              <a
                className={ui.link}
                href="https://caniuse.com/webgpu"
                target="_blank"
                rel="noreferrer"
              >
                caniuse.com/webgpu
              </a>
            </p>
          </>
        ) : fatal.kind === 'budget' ? (
          <>
            {/* An anchor and not a window.open: a link can be middle-clicked,
                copied and dragged, and no popup blocker has an opinion about it.
                `location.href` is the live look — useUrlState keeps the address
                bar current — so the new tab lands on the picture this one had. */}
            <a
              className={cx(ui.btn, ui.active)}
              href={location.href}
              target="_blank"
              rel="noreferrer"
            >
              open this look in a new tab
            </a>
            <p className={ui.muted} style={{ margin: '14px 0 0' }}>
              Measured on Firefox Nightly / Linux: handing back a WebGPU device
              that has been presenting stops the browser giving that tab
              animation frames, and the next document in the tab inherits it —
              reloading included. <code>scripts/devicetear.mjs</code> reproduces
              it in about a minute, and <code>docs/adr/0004</code> has the
              numbers.
            </p>
            {fatal.onOverride === undefined ? null : (
              <p className={ui.muted} style={{ margin: '14px 0 0' }}>
                {/* Left available on purpose. If this browser has no such
                    ceiling, refusing would be the app breaking itself over
                    another browser's bug. */}
                <button className={ui.btn} onClick={fatal.onOverride}>
                  use another device anyway
                </button>
              </p>
            )}
          </>
        ) : fatal.kind === 'hung' ? (
          <>
            <p style={{ margin: '0 0 14px' }}>
              Close this browser tab and open the app again.
            </p>
            <p className={ui.muted} style={{ margin: '0 0 14px' }}>
              The GPU process is shared across tabs and outlives this page, so
              reloading usually lands on the same wedged one.
            </p>
            <button className={ui.btn} onClick={() => location.reload()}>
              reload anyway
            </button>
          </>
        ) : (
          <button
            className={cx(ui.btn, ui.active)}
            onClick={() => location.reload()}
          >
            reload
          </button>
        )}
      </div>
    </div>
  )
}
