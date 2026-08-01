import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import pkg from './package.json' with { type: 'json' }
import { ytdlp } from './vite-plugin-ytdlp.ts'

import { execSync } from 'node:child_process'

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// Relative base so the build runs from any sub-path (Pages project site, a
// moved/renamed repo, a subfolder). Dev + screenshot harness stay at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  // React Compiler memoizes components and hook results itself, so the UI
  // doesn't hand-maintain useMemo/useCallback around the engine handoffs.
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), ytdlp()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha()),
  },
  // Preferred port for the screenshot harness (scripts/shot.mjs, README);
  // falls back to the next free port if it's taken.
  //
  // forwardConsole patches console.* to relay logs to the dev server, which
  // reports every message at the patch site inside Vite's client instead of
  // where it was logged. The render loop's whole diagnostic story is console
  // breadcrumbs, so the real source location is worth more than the relay.
  server: { port: 5199, forwardConsole: false },
}))
