import React, { useEffect, useState } from 'react'
import { useAppStore } from './stores/appStore'
import { useSettingsStore } from './stores/settingsStore'
import { useWordbookStore } from './stores/wordbookStore'
import { useHistoryStore } from './stores/historyStore'
import { useWindowStore } from './stores/windowStore'
import { useFileStore } from './stores/fileStore'
import { parseAnyFile } from './lib/parse'
import { isSupported } from './lib/types'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import HomeView from './components/HomeView'
import WordbookView from './components/WordbookView'
import SettingsView from './components/SettingsView'
import AssistantPanel from './components/AssistantPanel'
import MiniTitleBar from './components/MiniTitleBar'
import QuickTranslate from './components/QuickTranslate'
import QuickLookupModal from './components/QuickLookupModal'

function applyTheme(): void {
  const { theme } = useSettingsStore.getState().settings
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** macOS Dock 拖入 / Finder 打开：读取并解析文件，进入翻译 */
async function openDroppedFile(filePath: string): Promise<void> {
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  if (!isSupported(name)) return
  try {
    const data = await window.bridge.readFile(filePath)
    const segs = await parseAnyFile(name, data)
    useFileStore.getState().setDoc({ name, size: data.byteLength }, segs)
    useWindowStore.getState().setMode('full')
    useAppStore.getState().go('home')
  } catch {
    /* 文件读取失败静默 */
  }
}

export default function App(): React.JSX.Element {
  const view = useAppStore((s) => s.view)
  const assistantOpen = useAppStore((s) => s.assistantOpen)
  const toggleAssistant = useAppStore((s) => s.toggleAssistant)
  const mode = useWindowStore((s) => s.mode)
  const openQuickLookup = useAppStore((s) => s.openQuickLookup)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const init = async (): Promise<void> => {
      await useSettingsStore.getState().load()
      await useWordbookStore.getState().load()
      await useHistoryStore.getState().load()
      await useWindowStore.getState().init()
      const info = await window.bridge.appInfo()
      useAppStore.getState().setPlatform(info.platform, info.isMac)
      applyTheme()
    }
    void init()

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme()
    mq.addEventListener('change', onChange)
    const unsubSettings = useSettingsStore.subscribe((s) => {
      if (s.settings.theme !== undefined) applyTheme()
    })
    const offFullscreen = window.bridge.onFullscreen(setFullscreen)
    const offOpenFile = window.bridge.onOpenFilePath((p) => void openDroppedFile(p))
    const offOpenSettings = window.bridge.onOpenSettings(() => useAppStore.getState().go('settings'))

    // 全局快捷键监听（Cmd/Ctrl+K 唤起查词 Spotlight，Cmd/Ctrl+Shift+A 切换 AI 助手）
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K') && !e.shiftKey) {
        e.preventDefault()
        openQuickLookup()
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        toggleAssistant()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      mq.removeEventListener('change', onChange)
      unsubSettings()
      offFullscreen()
      offOpenFile()
      offOpenSettings()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openQuickLookup, toggleAssistant])

  const rootCls = `flex h-screen w-screen overflow-hidden text-ink-1 ${
    fullscreen ? 'is-fullscreen' : ''
  }`

  if (mode === 'mini') {
    return (
      <div className={`mini-window flex-col ${rootCls}`}>
        <MiniTitleBar />
        <QuickTranslate />
      </div>
    )
  }

  return (
    <div className={`app-bg flex-row ${rootCls}`}>
      {/* macOS 经典毛玻璃侧边栏 */}
      <Sidebar />

      {/* 主工作区 */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-card/85">
        <TitleBar />
        <main className="min-w-0 flex-1 overflow-hidden">
          {view === 'home' && <HomeView />}
          {view === 'wordbook' && <WordbookView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* 统一的右侧 AI 助手面板 */}
      {assistantOpen && <AssistantPanel />}

      {/* 软件内快捷查词 Spotlight 弹窗 */}
      <QuickLookupModal />
    </div>
  )
}
