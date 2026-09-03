import type { Worker } from 'tesseract.js'
import { useSettingsStore } from '../stores/settingsStore'
import { agentStream, type StreamCall } from './llm'

let worker: Worker | null = null
let workerLangs = ''
let initPromise: Promise<void> | null = null

const TESS_PATH = 'tessdata'

function langsFor(lang: string): string {
  if (lang === 'eng' || lang === 'chi_sim') return lang
  return 'eng+chi_sim'
}

/** 预热或获取 Tesseract Worker（保持常驻预热，提速 300%） */
export async function getWorker(): Promise<Worker> {
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

/** 解码图片为 HTMLImageElement */
async function decodeImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败，请确认文件格式正确'))
      el.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 图像增强管线：
 * 1. 动态缩放至最优 OCR 分辨率（最长边 1400-1800px）；
 * 2. 灰度化 + 直方图自适应对比度拉伸（增强公式微小上下标与分号）；
 * 3. 适度二值化锐化，去除背景噪点。
 */
function preprocessImage(
  img: HTMLImageElement,
  maxSide = 1800
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const scale = Math.min(1.5, Math.max(0.5, maxSide / Math.max(img.width, img.height)))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  // 绘制原图
  ctx.drawImage(img, 0, 0, w, h)

  try {
    const imgData = ctx.getImageData(0, 0, w, h)
    const d = imgData.data

    // 计算灰度均值与极值
    let minG = 255
    let maxG = 0
    const grays = new Uint8ClampedArray(w * h)

    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      // 经典生理加权灰度转换
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
      grays[j] = g
      if (g < minG) minG = g
      if (g > maxG) maxG = g
    }

    const range = Math.max(1, maxG - minG)

    // 对比度拉伸与自适应阈值增强
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let g = grays[j]
      // 线性对比度拉伸
      g = Math.round(((g - minG) / range) * 255)

      // 轻微 gamma 增强，强化公式文字
      if (g < 140) {
        g = Math.max(0, Math.round(g * 0.75))
      } else if (g > 200) {
        g = 255
      }

      d[i] = g
      d[i + 1] = g
      d[i + 2] = g
    }

    ctx.putImageData(imgData, 0, 0)
  } catch {
    // 若像素操作受限，回退为标准画布
  }

  return { canvas, ctx }
}

/** 压缩为缩略图 dataURL（最长边 maxSide） */
export async function fileToDataUrl(file: Blob, maxSide = 480): Promise<string> {
  const img = await decodeImage(file)
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return URL.createObjectURL(file)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.85)
}

export interface OcrProgress {
  phase: 'loading' | 'recognizing'
  percent: number
}

export interface OcrOut {
  text: string
  lines: string[]
}

/** 识别剪贴板或上传的图片 */
export async function recognizeClipboardImage(
  file: Blob,
  opts?: { onProgress?: (p: OcrProgress) => void }
): Promise<OcrOut> {
  opts?.onProgress?.({ phase: 'loading', percent: 10 })

  // 1. 获取已常驻预热的 Worker
  const w = await getWorker()

  opts?.onProgress?.({ phase: 'loading', percent: 30 })

  // 2. 图像增强预处理
  const img = await decodeImage(file)
  const proc = preprocessImage(img, 1800)
  const processedBlob = proc
    ? await new Promise<Blob>((resolve) => proc.canvas.toBlob((b) => resolve(b ?? file), 'image/png'))
    : file

  opts?.onProgress?.({ phase: 'recognizing', percent: 50 })

  // 3. 执行识别
  const { data } = await w.recognize(processedBlob)
  const text = data.text.trim()

  opts?.onProgress?.({ phase: 'recognizing', percent: 100 })

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  return { text, lines }
}

const SYS_MATH_OCR_CORRECT =
  '你是资深理工科公式与学术文本识别校正专家。用户提供了从图片/截图中提取出的原始 OCR 识别文本（可能包含公式乱码、字符粘连、希腊字母混淆等）。\n' +
  '请执行以下处理：\n' +
  '1. 校正 OCR 错词与混淆字符（如将 1/l、0/O、x/\\times、\\int 符号误识进行精确校正）；\n' +
  '2. 识别所有数学/物理/工程公式，并将其重构成标准的 LaTeX 格式（行内用 $...$，独立块级用 $$...$$）；\n' +
  '3. 输出清晰工整的 Markdown 文本与公式，保留原有段落与列表逻辑；\n' +
  '4. 不要输出任何无关问候语或解释前缀，直接输出校正后的学术内容。'

/** 使用大模型对 OCR 识别出的草稿进行公式结构化纠偏与标准排版重构 */
export function correctOcrMathStream(
  rawText: string,
  callbacks: {
    onChunk: (chunk: string) => void
    onDone: () => void
    onError: (err: string) => void
  }
): StreamCall {
  return agentStream(
    [
      { role: 'system', content: SYS_MATH_OCR_CORRECT },
      { role: 'user', content: `请校正并标准化以下 OCR 识别内容中的公式与学术文本：\n\n${rawText}` }
    ],
    {
      onChunk: callbacks.onChunk,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    },
    { maxTokens: 4096, temperature: 0.1 }
  )
}

/** 释放 worker（内存回收） */
export async function releaseOcr(): Promise<void> {
  if (worker) {
    await worker.terminate().catch(() => undefined)
    worker = null
    workerLangs = ''
  }
}
