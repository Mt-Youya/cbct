import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useViewerStore } from './store/useViewerStore'
import './styles.css'

// Exposed for automated visual checks and manual debugging (dev only).
if (import.meta.env.DEV) {
  ;(window as unknown as { __viewer: typeof useViewerStore }).__viewer = useViewerStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
