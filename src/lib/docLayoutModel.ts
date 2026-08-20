import * as ort from 'onnxruntime-web'

export type DocLayoutCategory =
  | 'title'
  | 'plain_text'
  | 'abandon'
  | 'figure'
  | 'figure_caption'
  | 'table'
  | 'table_caption'
  | 'table_footnote'
  | 'isolate_formula'
  | 'formula_caption'

export const DOC_LAYOUT_CLASSES: DocLayoutCategory[] = [
  'title',
  'plain_text',
  'abandon',
  'figure',
  'figure_caption',
  'table',
  'table_caption',
  'table_footnote',
  'isolate_formula',
  'formula_caption'
]

export interface DetectedLayoutBox {
  category: DocLayoutCategory
  classId: number
  score: number
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
  box: {
    x1: number
    y1: number
    x2: number
    y2: number
  }
}

let sessionPromise: Promise<ort.InferenceSession | null> | null = null

/** 获取或初始化 DocLayout-YOLO 推理会话 */
export async function getDocLayoutSession(): Promise<ort.InferenceSession | null> {
  if (sessionPromise) return sessionPromise

  sessionPromise = (async () => {
    try {
      const modelPath = '/models/doclayout_yolo_docstructbench_imgsz1024_dynamic.onnx'
      let modelBuffer: ArrayBuffer | Uint8Array | null = null

      // 在 Electron 环境下使用 bridge 读取二进制流
      if (typeof window !== 'undefined' && window.bridge?.readFile) {
        try {
          modelBuffer = await window.bridge.readFile('public/models/doclayout_yolo_docstructbench_imgsz1024_dynamic.onnx')
        } catch {
          // 降级尝试 fetch
        }
      }

      const options: ort.InferenceSession.SessionOptions = {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all'
      }

      if (modelBuffer && modelBuffer.byteLength > 0) {
        return await ort.InferenceSession.create(modelBuffer, options)
      } else {
        // Web / Vite Dev Server 模式使用 fetch
        const res = await fetch(modelPath)
        if (!res.ok) throw new Error(`Model fetch failed: ${res.statusText}`)
        const buf = await res.arrayBuffer()
        return await ort.InferenceSession.create(buf, options)
      }
    } catch (err) {
      console.warn('[DocLayout-YOLO] 无法加载 ONNX 版面模型，将自动降级为规则分栏算法:', err)
      return null
    }
  })()

  return sessionPromise
}

/** 运行 DocLayout-YOLO 版面分析 */
export async function runDocLayoutAnalysis(
  canvas: HTMLCanvasElement,
  confidenceThreshold = 0.35
): Promise<DetectedLayoutBox[]> {
  const session = await getDocLayoutSession()
  if (!session) return []

  const origW = canvas.width
  const origH = canvas.height
  if (!origW || !origH) return []

  // 1. 预处理：Letterbox 缩放至 1024x1024
  const targetSize = 1024
  const scale = Math.min(targetSize / origW, targetSize / origH)
  const scaledW = Math.round(origW * scale)
  const scaledH = Math.round(origH * scale)
  const padX = Math.floor((targetSize - scaledW) / 2)
  const padY = Math.floor((targetSize - scaledH) / 2)

  const offscreen = document.createElement('canvas')
  offscreen.width = targetSize
  offscreen.height = targetSize
  const ctx = offscreen.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []

  // 填充灰底
  ctx.fillStyle = '#727272'
  ctx.fillRect(0, 0, targetSize, targetSize)
  ctx.drawImage(canvas, 0, 0, origW, origH, padX, padY, scaledW, scaledH)

  const imgData = ctx.getImageData(0, 0, targetSize, targetSize)
  const pixels = imgData.data
  const planeSize = targetSize * targetSize
  const floatData = new Float32Array(3 * planeSize)

  // NCHW 归一化 RGB
  for (let i = 0; i < planeSize; i++) {
    floatData[i] = pixels[i * 4] / 255.0
    floatData[planeSize + i] = pixels[i * 4 + 1] / 255.0
    floatData[planeSize * 2 + i] = pixels[i * 4 + 2] / 255.0
  }

  const tensor = new ort.Tensor('float32', floatData, [1, 3, targetSize, targetSize])
  const results = await session.run({ images: tensor })
  const output = results.output0
  if (!output || !output.data) return []

  const data = output.data as Float32Array
  const numPredictions = output.dims[1] || 300
  const boxes: DetectedLayoutBox[] = []

  for (let i = 0; i < numPredictions; i++) {
    const offset = i * 6
    const x1 = data[offset + 0]
    const y1 = data[offset + 1]
    const x2 = data[offset + 2]
    const y2 = data[offset + 3]
    const score = data[offset + 4]
    const classId = Math.round(data[offset + 5])

    if (score < confidenceThreshold || classId < 0 || classId >= DOC_LAYOUT_CLASSES.length) {
      continue
    }

    // 还原 Letterbox 坐标到原始图像像素坐标
    const origX1 = Math.max(0, (x1 - padX) / scale)
    const origY1 = Math.max(0, (y1 - padY) / scale)
    const origX2 = Math.min(origW, (x2 - padX) / scale)
    const origY2 = Math.min(origH, (y2 - padY) / scale)

    if (origX2 - origX1 <= 2 || origY2 - origY1 <= 2) continue

    const category = DOC_LAYOUT_CLASSES[classId]
    boxes.push({
      category,
      classId,
      score,
      box: {
        x1: origX1,
        y1: origY1,
        x2: origX2,
        y2: origY2
      },
      rect: {
        x: (origX1 / origW) * 100,
        y: (origY1 / origH) * 100,
        width: ((origX2 - origX1) / origW) * 100,
        height: ((origY2 - origY1) / origH) * 100
      }
    })
  }

  // 2. 阅读顺序重构：按垂直带与左右双栏排序
  return sortLayoutBoxes(boxes)
}

/** 按照人类阅读顺序（通栏优先、左栏自顶向下、右栏自顶向下）对检测框排序 */
function sortLayoutBoxes(boxes: DetectedLayoutBox[]): DetectedLayoutBox[] {
  if (boxes.length <= 1) return boxes

  // 区分通栏（宽 > 55% 页面）与分栏（左/右栏）
  const fullWidthBoxes = boxes.filter((b) => b.rect.width > 55 || (b.rect.x < 30 && b.rect.x + b.rect.width > 70))
  const colBoxes = boxes.filter((b) => !fullWidthBoxes.includes(b))

  if (colBoxes.length === 0) {
    return fullWidthBoxes.sort((a, b) => a.box.y1 - b.box.y1)
  }

  // 左右分栏
  const midX = 50
  const leftCol = colBoxes.filter((b) => b.rect.x + b.rect.width * 0.5 < midX).sort((a, b) => a.box.y1 - b.box.y1)
  const rightCol = colBoxes.filter((b) => b.rect.x + b.rect.width * 0.5 >= midX).sort((a, b) => a.box.y1 - b.box.y1)

  // 组合：顶部通栏 -> 左栏 -> 右栏 -> 底部通栏
  const topFull = fullWidthBoxes.filter((b) => b.rect.y < 35).sort((a, b) => a.box.y1 - b.box.y1)
  const bottomFull = fullWidthBoxes.filter((b) => b.rect.y >= 35).sort((a, b) => a.box.y1 - b.box.y1)

  return [...topFull, ...leftCol, ...rightCol, ...bottomFull]
}
