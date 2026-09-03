import { create } from 'zustand'

interface WindowState {
  mode: 'mini' | 'full'
  alwaysOnTop: boolean
  inited: boolean
  init: () => Promise<void>
  setMode: (mode: 'mini' | 'full') => void
  toggleAlwaysOnTop: () => void
}

export const useWindowStore = create<WindowState>((set, get) => ({
  mode: 'mini',
  alwaysOnTop: false,
  inited: false,

  init: async () => {
    if (get().inited) return
    const st = await window.bridge.windowGetState()
    set({ mode: st.mode, alwaysOnTop: st.alwaysOnTop, inited: true })
    window.bridge.onModeChanged((mode) => set({ mode }))
  },

  setMode: (mode) => {
    set({ mode })
    window.bridge.windowSetMode(mode)
  },

  toggleAlwaysOnTop: () => {
    const flag = !get().alwaysOnTop
    set({ alwaysOnTop: flag })
    window.bridge.windowSetAlwaysOnTop(flag)
  }
}))
