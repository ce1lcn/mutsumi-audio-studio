import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import './styles/shell.css'
import './styles/pages.css'

// 首帧前按上次主题着色，避免闪白
try {
  const theme = localStorage.getItem('mutsumi-theme')
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme
} catch { /* 忽略 */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
