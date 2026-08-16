import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useAppStore } from './stores/appStore'
import { useSettingsStore } from './stores/settingsStore'
import { useWordbookStore } from './stores/wordbookStore'
import { useHistoryStore } from './stores/historyStore'
import { useWindowStore } from './stores/windowStore'
import { useFileStore } from './stores/fileStore'
import { parseAnyFile } from './lib/parse'
import { isSupported } from './lib/types'
import TitleBar from './components/TitleBar'
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
    const unsubSettings = useSettingsStore.subscribe((s) => {
      if (s.settings.theme !== undefined) applyTheme()
    })
    const offFullscreen = window.bridge.onFullscreen(setFullscreen)
    const offOpenFile = window.bridge.onOpenFilePath((p) => void openDroppedFile(p))
    const offOpenSettings = window.bridge.onOpenSettings(() => useAppStore.getState().go('settings'))
    return () => {
      mq.removeEventListener('change', onChange)
      unsubSettings()
      offFullscreen()
      offOpenFile()
      offOpenSettings()
    }
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
      <div className="relative flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden">
          {view === 'home' && <HomeView />}
          {view === 'wordbook' && <WordbookView />}
          {view === 'history' && <HistoryView />}
          {view === 'settings' && <SettingsView />}
        </main>
        {assistantOpen ? (
          <AssistantPanel />
        ) : (
          <button
            className="absolute right-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1.5 rounded-l-full border border-r-0 border-line bg-panel/95 py-2.5 pl-3 pr-2 text-[12px] font-medium text-accent shadow-md backdrop-blur transition hover:bg-accent hover:text-white"
            onClick={() => useAppStore.getState().setAssistant(true)}
            title="展开 AI 学术助手"
          >
            <Sparkles size={13} /> AI
          </button>
        )}
      </div>
    </div>
  )
}
