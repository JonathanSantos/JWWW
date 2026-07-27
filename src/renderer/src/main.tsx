import { createRoot } from 'react-dom/client'
import './assets/globals.css'
import './lib/monaco-setup'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
