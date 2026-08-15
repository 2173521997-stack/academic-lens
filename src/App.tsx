import { useEffect, useState } from 'react'
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
import HistoryView from './components/HistoryView'
import SettingsView from './components/SettingsView'
import AssistantPanel from './components/AssistantPanel'
import MiniTitleBar from './components/MiniTitleBar'
import QuickTranslate from './components/QuickTranslate'

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
  const mode = useWindowStore((s) => s.mode)
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
    useSettingsStore.subscribe((s) => {
      if (s.settings.theme !== undefined) applyTheme()
    })
    window.bridge.onFullscreen(setFullscreen)
    window.bridge.onOpenFilePath((p) => void openDroppedFile(p))
    window.bridge.onOpenSettings(() => useAppStore.getState().go('settings'))
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const rootCls = `flex h-screen w-screen flex-col overflow-hidden text-ink-1 ${
    fullscreen ? 'is-fullscreen' : ''
  }`

  if (mode === 'mini') {
    return (
      <div className={`mini-window ${rootCls}`}>
        <MiniTitleBar />
        <QuickTranslate />
      </div>
    )
  }

  return (
    <div className={`app-bg ${rootCls}`}>
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          {view === 'home' && <HomeView />}
          {view === 'wordbook' && <WordbookView />}
          {view === 'history' && <HistoryView />}
          {view === 'settings' && <SettingsView />}
        </main>
        {assistantOpen && <AssistantPanel />}
      </div>
    </div>
  )
}
