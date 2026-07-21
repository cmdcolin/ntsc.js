import { execSync } from 'node:child_process'

import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import pkg from './package.json' with { type: 'json' }
import { ytdlp } from './vite-plugin-ytdlp'

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
  server: { port: 5199 },
}))
