import { createRoot } from 'react-dom/client'

import { App } from './app'
import './theme.css'

// Deliberately not wrapped in <StrictMode>, and this is the one place that can
// say why.
//
// StrictMode double-invokes effects in development: mount, clean up, mount
// again. `useEngine`'s mount effect calls `Engine.create`, so that would be two
// `GPUDevice`s per page load instead of one — and, worse, a teardown between
// them. Letting go of a presenting device is cheap now (the app never destroys
// one; see gpu/context.ts and scripts/devicetear.mjs for what destroying one
// costs a tab), but a mount/unmount/mount cycle around a WebGPU canvas is the
// exact shape that used to freeze the tab, and nothing about StrictMode makes
// the extra device or the extra swapchain configure free.
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
