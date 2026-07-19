import { createRoot } from 'react-dom/client'
import { App } from './app'

const root = document.getElementById('root')
if (root) {
  document.body.style.margin = '0'
  createRoot(root).render(<App />)
}
