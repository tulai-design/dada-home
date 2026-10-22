import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, ToastHost } from '@lobehub/ui'
import { motion } from 'motion/react'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider motion={motion}>
      <ToastHost position="top-right" />
      <App />
    </ConfigProvider>
  </StrictMode>,
)
