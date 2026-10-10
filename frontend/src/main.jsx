import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuentes alojadas en el propio sitio: sin dependencia de Google Fonts ni hojas externas sin SRI.
import '@fontsource/fredoka/latin-500.css'
import '@fontsource/fredoka/latin-600.css'
import '@fontsource/fredoka/latin-700.css'
import '@fontsource/readex-pro/latin-300.css'
import '@fontsource/readex-pro/latin-400.css'
import '@fontsource/readex-pro/latin-500.css'
import '@fontsource/readex-pro/latin-600.css'
import './index.css'
import './shop.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
