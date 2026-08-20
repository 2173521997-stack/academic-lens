import * as ort from 'onnxruntime-web'
import type { Segment } from './types'
import { makeSegment } from './parse'

// 配置 WASM 路径
ort.env.wasm.numThreads = 2
ort.env.wasm.simd = true

let ocrSessionPromise: Promise<ort.InferenceSession | null> | null = null
let charDict: string[] | null = null

/** 加载 PP-OCR 字符字典 */
async function getCharDict(): Promise<string[]> {
  if (charDict) return charDict

  try {
    let dictText = ''
    if (typeof window !== 'undefined' && window.bridge?.readFile) {
      try {
        const buf = await window.bridge.readFile('public/models/ppocr_keys_v1.txt')
        dictText = new TextDecoder('utf-8').decode(buf)
      } catch {
        // 降级尝试 fetch
      }
    }

    if (!dictText) {
      const res = await fetch('/models/ppocr_keys_v1.txt')
      if (res.ok) {
        dictText = await res.text()
      }
    }

    if (dictText) {
      charDict = dictText.split(/\r?\n/)
      return charDict
    }
  } catch (err) {
    console.warn('[PaddleOCR] 加载字典失败:', err)
  }

  return []
}

/** 获取或初始化 PP-OCRv4 推理会话 */
export async function getPaddleOcrSession(): Promise<ort.InferenceSession | null> {
  if (ocrSessionPromise) return ocrSessionPromise

  ocrSessionPromise = (async () => {
    try {
      const modelPath = '/models/ch_PP-OCRv4_rec_infer.onnx'
      let modelBuffer: ArrayBuffer | Uint8Array | null = null

      if (typeof window !== 'undefined' && window.bridge?.readFile) {
        try {
          modelBuffer = await window.bridge.readFile('public/models/ch_PP-OCRv4_rec_infer.onnx')
        } catch {
          // 降级 fetch
        }
      }

      const options: ort.InferenceSession.SessionOptions = {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all'
      }

      if (modelBuffer && modelBuffer.byteLength > 0) {
        return await ort.InferenceSession.create(modelBuffer, options)
      } else {
        const res = await fetch(modelPath)
        if (!res.ok) throw new Error(`Model fetch failed: ${res.statusText}`)
        const buf = await res.arrayBuffer()
        return await ort.InferenceSession.create(buf, options)
      }
    } catch (err) {
      console.warn('[PaddleOCR] 无法加载 ONNX OCR 模型:', err)
      return null
    }
  })()

  return ocrSessionPromise
}

/**
 * 对单条文字图片进行 PP-OCRv4 文本识别
 */
export async function recognizeTextFromCanvas(
  canvas: HTMLCanvasElement
): Promise<{ text: string; score: number }> {
  const session = await getPaddleOcrSession()
  const dict = await getCharDict()
  if (!session || dict.length === 0) return { text: '', score: 0 }

  const origW = canvas.width
  const origH = canvas.height
  if (origW <= 2 || origH <= 2) return { text: '', score: 0 }

  // 1. 缩放到高度 48，等比例缩放宽度
  const targetH = 48
  const targetW = Math.max(48, Math.min(960, Math.round((origW / origH) * targetH)))

  const offscreen = document.createElement('canvas')
  offscreen.width = targetW
  offscreen.height = targetH
  const ctx = offscreen.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { text: '', score: 0 }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetW, targetH)
  ctx.drawImage(canvas, 0, 0, origW, origH, 0, 0, targetW, targetH)

  const imgData = ctx.getImageData(0, 0, targetW, targetH)
  const pixels = imgData.data
  const planeSize = targetW * targetH
  const floatData = new Float32Array(3 * planeSize)

  // 归一化: (pixel / 255.0 - 0.5) / 0.5
  for (let i = 0; i < planeSize; i++) {
    const r = pixels[i * 4]
    const g = pixels[i * 4 + 1]
    const b = pixels[i * 4 + 2]
    floatData[i] = (r / 255.0 - 0.5) / 0.5
    floatData[planeSize + i] = (g / 255.0 - 0.5) / 0.5
    floatData[planeSize * 2 + i] = (b / 255.0 - 0.5) / 0.5
  }

  const tensor = new ort.Tensor('float32', floatData, [1, 3, targetH, targetW])
  const results = await session.run({ x: tensor })
  const output = results['softmax_11.tmp_0']
  if (!output || !output.data) return { text: '', score: 0 }

  const data = output.data as Float32Array
  const [batch, timeSteps, numClasses] = output.dims
  if (batch !== 1 || !timeSteps || !numClasses) return { text: '', score: 0 }

  // CTC 贪心解码
  let decoded = ''
  let totalScore = 0
  let charCount = 0
  let prevClass = 0

  for (let t = 0; t < timeSteps; t++) {
    const offset = t * numClasses
    let maxVal = -Infinity
    let maxIdx = 0

    for (let c = 0; c < numClasses; c++) {
      const val = data[offset + c]
      if (val > maxVal) {
        maxVal = val
        maxIdx = c
      }
    }

    if (maxIdx > 0 && maxIdx !== prevClass && maxIdx < numClasses) {
      if (maxIdx <= dict.length) {
        const char = dict[maxIdx - 1]
        decoded += char
        totalScore += maxVal
        charCount++
      } else if (maxIdx === dict.length + 1) {
        decoded += ' '
      }
    }
    prevClass = maxIdx
  }

  const avgScore = charCount > 0 ? totalScore / charCount : 0
  return { text: decoded.trim(), score: avgScore }
}

/**
 * 图像/插图/表格局部 OCR 提取：从原图区域中检测文字行并使用 PaddleOCR 识别
 */
export async function processFigureWithPaddle(
  pageCanvas: HTMLCanvasElement,
  box: { x1: number; y1: number; x2: number; y2: number },
  pageNo: number,
  pageWidth: number,
  pageHeight: number
): Promise<Segment[]> {
  const segs: Segment[] = []
  const session = await getPaddleOcrSession()
  if (!session) return []

  const boxW = Math.max(10, box.x2 - box.x1)
  const boxH = Math.max(10, box.y2 - box.y1)

  // 1. 裁剪图表区域
  const figCanvas = document.createElement('canvas')
  figCanvas.width = boxW
  figCanvas.height = boxH
  const ctx = figCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []

  ctx.drawImage(pageCanvas, box.x1, box.y1, boxW, boxH, 0, 0, boxW, boxH)

  // 2. 图像水平投影剖析 (Horizontal Projection Profile) 检测图内的文字行条带
  const imgData = ctx.getImageData(0, 0, boxW, boxH)
  const data = imgData.data
  const rowDensity = new Float32Array(boxH)

  // 计算每行的边缘与暗色像素分布
  for (let y = 0; y < boxH; y++) {
    let darkCount = 0
    for (let x = 0; x < boxW; x++) {
      const idx = (y * boxW + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      if (gray < 200) darkCount++
    }
    rowDensity[y] = darkCount / boxW
  }

  // 提取文字行区间
  const textStrips: { y1: number; y2: number }[] = []
  let inStrip = false
  let stripStart = 0
  const threshold = 0.015

  for (let y = 0; y < boxH; y++) {
    if (rowDensity[y] > threshold && !inStrip) {
      inStrip = true
      stripStart = y
    } else if (rowDensity[y] <= threshold && inStrip) {
      inStrip = false
      const h = y - stripStart
      if (h >= 7 && h <= 50) {
        textStrips.push({ y1: Math.max(0, stripStart - 2), y2: Math.min(boxH, y + 2) })
      }
    }
  }
  if (inStrip) {
    const h = boxH - stripStart
    if (h >= 7 && h <= 50) {
      textStrips.push({ y1: Math.max(0, stripStart - 2), y2: boxH })
    }
  }

  // 3. 对每个检测到的文字条带执行 PaddleOCR
  for (const strip of textStrips) {
    const stripH = strip.y2 - strip.y1
    const stripCanvas = document.createElement('canvas')
    stripCanvas.width = boxW
    stripCanvas.height = stripH
    const sCtx = stripCanvas.getContext('2d', { willReadFrequently: true })
    if (!sCtx) continue

    sCtx.drawImage(figCanvas, 0, strip.y1, boxW, stripH, 0, 0, boxW, stripH)

    const ocrResult = await recognizeTextFromCanvas(stripCanvas)
    if (ocrResult.text.length >= 2 && ocrResult.score >= 0.5) {
      const pagePxX1 = box.x1
      const pagePxY1 = box.y1 + strip.y1
      const pagePxW = boxW
      const pagePxH = stripH

      const rect = {
        x: Math.max(0, Math.min(100, (pagePxX1 / pageWidth) * 100)),
        y: Math.max(0, Math.min(100, (pagePxY1 / pageHeight) * 100)),
        width: Math.max(2, Math.min(100, (pagePxW / pageWidth) * 100)),
        height: Math.max(1, Math.min(100, (pagePxH / pageHeight) * 100))
      }

      segs.push(
        makeSegment('p', ocrResult.text, pageNo, {
          kind: 'paragraph',
          runs: [{ text: ocrResult.text }]
        }, rect)
      )
    }
  }

  return segs
}
