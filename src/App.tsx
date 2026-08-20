import { useEffect, useState } from 'react'
import { useAppStore } from './stores/appStore'
import { useSettingsStore } from './stores/settingsStore'
import { useWordbookStore } from './stores/wordbookStore'
import { useHistoryStore } from './stores/historyStore'
import { useWindowStore } from './stores/windowStore'
import { useFileStore } from './stores/fileStore'
import { useProfileStore } from './stores/profileStore'
import { useProjectStore } from './stores/projectStore'
import { parseAnyFile } from './lib/parse'
import { isSupported } from './lib/types'
import TitleBar from './components/TitleBar'
import ResearchView from './components/ResearchView'
import EnglishView from './components/EnglishView'
import AgentView from './components/AgentView'
import SettingsView from './components/SettingsView'
import MiniTitleBar from './components/MiniTitleBar'
import QuickTranslate from './components/QuickTranslate'
import NoticeView from './components/NoticeView'

function applyTheme(): void {
  const { theme } = useSettingsStore.getState().settings
  const root = document.documentElement
  root.classList.remove('dark', 'theme-paper', 'theme-nord', 'theme-sage')
  if (theme === 'paper') {
    root.classList.add('theme-paper')
  } else if (theme === 'nord') {
    root.classList.add('dark', 'theme-nord')
  } else if (theme === 'sage') {
    root.classList.add('theme-sage')
  } else {
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.toggle('dark', dark)
  }
}

/** macOS Dock 拖入 / Finder 打开：读取并解析文件，进入来做学术板块 */
async function openDroppedFile(filePath: string): Promise<void> {
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  if (!isSupported(name)) return
  try {
    const data = await window.bridge.readFile(filePath)
    const segs = await parseAnyFile(name, data)
    const raw = new Uint8Array(data)
    useFileStore.getState().setDoc({ name, size: data.byteLength, rawBuffer: raw, path: filePath }, segs)
    
    // 如果当前有激活的学术项目，自动加入该项目
    const curProj = useProjectStore.getState().getActiveProject()
    if (curProj) {
      useProjectStore.getState().addDocToProject(curProj.id, {
        name,
        size: data.byteLength,
        path: filePath,
        rawBuffer: raw,
        segments: segs
      })
    }

    useWindowStore.getState().setMode('full')
    useAppStore.getState().go('research')
  } catch {
    /* 文件读取失败静默 */
  }
}

export default function App(): React.JSX.Element {
  const view = useAppStore((s) => s.view)
  const mode = useWindowStore((s) => s.mode)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const init = async (): Promise<void> => {
      await useSettingsStore.getState().load()
      await useWordbookStore.getState().load()
      await useHistoryStore.getState().load()
      await useProfileStore.getState().load()
      await useProjectStore.getState().load()
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
        <NoticeView />
      </div>
    )
  }

  return (
    <div className={`app-bg ${rootCls}`}>
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden">
          {(view === 'research' || view === 'home' || view === 'polish') && <ResearchView />}
          {(view === 'english' || view === 'wordbook' || view === 'flashcard' || view === 'quotes' || view === 'stats' || view === 'history') && <EnglishView />}
          {view === 'agent' && <AgentView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>
      <NoticeView />
    </div>
  )
}
