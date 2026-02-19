import { createRoot } from 'react-dom/client'
import { Inspector } from './Inspector.tsx'

const root = document.getElementById('root')!
root.style.margin = '0'
root.style.padding = '0'
document.body.style.margin = '0'
document.body.style.fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans JP", sans-serif'
document.body.style.background = '#1a1a2e'
document.body.style.color = '#e8e8e8'

createRoot(root).render(<Inspector />)
