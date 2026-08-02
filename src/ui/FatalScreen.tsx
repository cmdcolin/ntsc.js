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
  kind: 'unavailable' | 'lost' | 'hung'
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
                href="https://github.com/cmdcolin/ntscenery"
                target="_blank"
                rel="noreferrer"
              >
                github.com/cmdcolin/ntscenery
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
