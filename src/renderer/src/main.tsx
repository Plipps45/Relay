import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './assets/main.css'
import './lib/monaco'
import { App } from './App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
