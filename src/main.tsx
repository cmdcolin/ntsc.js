import { createRoot } from 'react-dom/client'

import { App } from './app'
import './theme.css'

// Deliberately not wrapped in <StrictMode>, and this is the one place that can
// say why.
//
// StrictMode double-invokes effects in development: mount, clean up, mount
// again. `useEngine`'s mount effect calls `Engine.create`, so that would be two
// `GPUDevice`s per page load instead of one — and a tab is worth about two
// WebGPU sessions before Firefox stops delivering animation frames to it
// (TAB_GPU_CEILING in gpu/context.ts, reproducible with
// scripts/rafceiling.mjs). The budget would be spent on the first load, and the
// first hot update after it would freeze the tab.
//
// So this is not an oversight to tidy up. If StrictMode is ever wanted for the
// checks it does bring, the engine has to stop being created per mount first —
// a module-level device behind a promise that serialises concurrent asks, the
// way `packages/render-core/src/gpuDevice.ts` in jbrowse-components does it.
// See docs/adr/0002.
const root = document.getElementById('root')
if (root) {
  document.body.style.margin = '0'
  createRoot(root).render(<App />)
}
