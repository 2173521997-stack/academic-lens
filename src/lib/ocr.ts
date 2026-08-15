import type { Worker } from 'tesseract.js'
import { useSettingsStore } from '../stores/settingsStore'

let worker: Worker | null = null
let workerLangs = ''
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let initPromise: Promise<void> | null = null

const TESS_PATH = 'tessdata'

function langsFor(lang: string): string {
  if (lang === 'eng' || lang === 'chi_sim') return lang
  return 'eng+chi_sim'
}

async function getWorker(): Promise<Worker> {
  const lang = langsFor(useSettingsStore.getState().settings.ocrLang)
  if (worker && workerLangs === lang) return worker
  if (initPromise) {
    await initPromise
    return worker as Worker
  }
  initPromise = (async () => {
    try {
      if (worker) await worker.terminate()
      const Tesseract = (await import('tesseract.js')).default
      worker = await Tesseract.createWorker(lang, 1, {
        langPath: TESS_PATH,
        corePath: `${TESS_PATH}/core`,
        workerPath: `${TESS_PATH}/worker.min.js`,
        // file:// 下 blob 包装的 importScripts 会被安全策略拦截，必须直连加载
        workerBlobURL: false,
        gzip: false,
        logger: () => undefined
      })
      workerLangs = lang
    } finally {
      initPromise = null
    }
  })()
  return initPromise.then(() => worker as Worker)
}

function scheduleRelease(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    if (worker) {
      void worker.terminate().catch(() => undefined)
      worker = null
      workerLangs = ''
    }
  }, 30000)
}

/** 图片缩放：最长边限长，降低内存与识别耗时 */
async function scaleImage(file: Blob, maxSide = 2000): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败'))
      el.src = url
    })
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 压缩为缩略图 dataURL（最长边 maxSide），降低内存占用 */
export async function fileToDataUrl(file: Blob, maxSide = 480): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败'))
      el.src = url
    })
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return url
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.8)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface OcrProgress {
  phase: 'loading' | 'recognizing'
  percent: number
}

export interface OcrOut {
  text: string
  lines: string[]
}

let progressCb: ((p: OcrProgress) => void) | null = null

export function setOcrProgress(cb: ((p: OcrProgress) => void) | null): void {
  progressCb = cb
}

export async function recognizeClipboardImage(
  file: Blob,
  opts?: { onProgress?: (p: OcrProgress) => void }
): Promise<OcrOut> {
  if (opts?.onProgress) progressCb = opts.onProgress
  progressCb?.({ phase: 'loading', percent: 0 })
  const w = await getWorker()
  const scaled = await scaleImage(file)
  progressCb?.({ phase: 'recognizing', percent: 30 })
  const { data } = await w.recognize(scaled)
  const text = data.text.trim()
  progressCb?.({ phase: 'recognizing', percent: 100 })
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  scheduleRelease()
  return { text, lines }
}

/** 释放 worker（内存回收），下次识别自动重建 */
export async function releaseOcr(): Promise<void> {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
  if (worker) {
    await worker.terminate().catch(() => undefined)
    worker = null
    workerLangs = ''
  }
}
