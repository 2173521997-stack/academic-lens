import { useSettingsStore } from '../stores/settingsStore'

export async function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

export async function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

export async function recognizeClipboardImage(file: Blob): Promise<{ text: string; lines: string[] }> {
  const base64 = await fileToBase64(file)
  const { ocr } = useSettingsStore.getState().settings
  if (!ocr.apiKey) {
    throw new Error('未配置 OCR API Key：请到「设置 → 图片识别(OCR)」填写')
  }
  return window.bridge.ocrRecognize(base64, ocr)
}
