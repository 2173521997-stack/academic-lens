import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { createBrowserBridge } from './bridge/browser'

if (!window.bridge) {
  window.bridge = createBrowserBridge()
  console.info('[web] 浏览器模式：使用本地存储 + 直连 LLM（CORS）')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
