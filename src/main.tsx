import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerAframeComponents } from './utils/aframe-components'
import App from './App.tsx'

// Register custom A-Frame components before mounting React
registerAframeComponents();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
