import { useSettingsStore } from '../stores/settingsStore'
import { dictLookup } from './dictLookup'

/** 已解析 word → 音频 URL 的缓存，避免重复网络请求 */
const audioCache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

function isSimpleWord(text: string): boolean {
  return /^[A-Za-z][A-Za-z'-]{1,45}$/.test(text.trim())
}

/**
 * 优先使用词典(uapis)真实发音，无 key/未收录/失败时降级为系统语音合成。
 * 供闪卡、听写、词卡等处统一调用，保证发音来源一致。
 */
export async function pronounce(text: string, rate = 1): Promise<boolean> {
  const word = text.trim()
  if (!word) return false

  // 1) 尝试真实音频（仅当配置了词典且是简单单词）
  if (isSimpleWord(word)) {
    const key = word.toLowerCase()
    if (audioCache.has(key)) {
      void playAudio(audioCache.get(key)!, word, rate)
      return true
    }
    const settings = useSettingsStore.getState().settings
    if (settings.lookupSource === 'dict' && settings.dictApiKey) {
      let p = inflight.get(key)
      if (!p) {
        p = dictLookup(word, settings.dictApiKey).then((res) => res?.audio?.us?.audio || res?.audio?.uk?.audio || null)
        inflight.set(key, p)
      }
      const audioUrl: string | null | undefined = await p
      if (audioUrl) {
        audioCache.set(key, audioUrl)
        inflight.delete(key)
        void playAudio(audioUrl, word, rate)
        return true
      }
      inflight.delete(key)
    }
  }

  // 2) 降级：系统语音合成
  window.bridge.speak(word, rate)
  return true
}

function playAudio(url: string, word: string, rate: number): void {
  const a = new Audio(url)
  a.playbackRate = rate
  void a.play().catch(() => window.bridge.speak(word, rate))
}