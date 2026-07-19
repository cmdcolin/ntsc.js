import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build runs from any sub-path (Pages project site, a
// moved/renamed repo, a subfolder). Dev + screenshot harness stay at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  // Pinned so the screenshot harness (scripts/shot.mjs, README) has a stable
  // URL; strictPort fails loudly instead of silently drifting to another port.
  server: { port: 5199, strictPort: true },
}))
