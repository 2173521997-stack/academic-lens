import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

let pdfjsModule: typeof import('pdfjs-dist') | null = null

export async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist')
    const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    pdfjsModule.GlobalWorkerOptions.workerSrc = workerUrl
  }
  return pdfjsModule
}

const docCache = new Map<string, PDFDocumentProxy>()

export async function loadPdfDocument(data: Uint8Array, docKey = 'current_doc'): Promise<PDFDocumentProxy> {
  if (docCache.has(docKey)) {
    return docCache.get(docKey)!
  }
  const pdfjs = await getPdfjs()
  const loadingTask = pdfjs.getDocument({ data: data.slice(0) })
  const doc = await loadingTask.promise
  docCache.set(docKey, doc)
  return doc
}

export function clearPdfCache(): void {
  for (const doc of docCache.values()) {
    void (doc as unknown as { loadingTask?: { destroy: () => Promise<void> } }).loadingTask?.destroy()
  }
  docCache.clear()
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale = 1.5
): Promise<{ width: number; height: number }> {
  const dpr = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: scale * dpr })

  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`

  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return { width: viewport.width, height: viewport.height }

  // 纯白底色防止透明黑底
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const renderContext = {
    canvasContext: ctx,
    viewport,
    intent: 'display' as const,
    canvas
  }

  await page.render(renderContext).promise
  return {
    width: Math.floor(viewport.width / dpr),
    height: Math.floor(viewport.height / dpr)
  }
}
