import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import UpdateToast from './components/UpdateToast.jsx'
import { registerServiceWorker } from './lib/pwa'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <UpdateToast />
  </StrictMode>,
)

registerServiceWorker()
