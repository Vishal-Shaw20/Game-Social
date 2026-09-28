import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// The browser must not restore scroll positions on back/forward: Chrome can
// treat the app's full-screen scroller as the page's own, put back the old
// position before React has drawn the new page, and then Layout snaps it to
// the top (a visible jump). Pages always open at the top (see Layout).
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
