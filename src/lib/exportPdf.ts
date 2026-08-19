import type { DocInfo, Segment } from './types'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** 生成高质量双语并排打印/导出 HTML，供用户直接导出 PDF 或在浏览器中打印 */
export function buildBilingualPdfHtml(doc: DocInfo, segments: Segment[]): string {
  const pagesMap = new Map<number, Segment[]>()
  for (const s of segments) {
    const p = s.page || 1
    const list = pagesMap.get(p) || []
    list.push(s)
    pagesMap.set(p, list)
  }

  const pagesHtml: string[] = []
  const sortedPages = Array.from(pagesMap.entries()).sort((a, b) => a[0] - b[0])

  for (const [pageNo, segs] of sortedPages) {
    const rows = segs
      .map((s) => {
        const src = s.text || ''
        const dst = (s.translation || '').trim() || '（未翻译）'
        const isH = s.type === 'h'
        return `
          <div class="bilingual-row ${isH ? 'heading-row' : ''}">
            <div class="col-src">
              ${isH ? `<h3>${escapeHtml(src)}</h3>` : `<p>${escapeHtml(src)}</p>`}
            </div>
            <div class="col-dst">
              ${isH ? `<h3>${escapeHtml(dst)}</h3>` : `<p>${escapeHtml(dst)}</p>`}
            </div>
          </div>
        `
      })
      .join('')

    pagesHtml.push(`
      <section class="pdf-page">
        <header class="page-header">
          <span class="doc-title">${escapeHtml(doc.name)}</span>
          <span class="page-num">第 ${pageNo} 页</span>
        </header>
        <div class="page-content">
          ${rows}
        </div>
      </section>
    `)
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(doc.name)} - 双语对照文档</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #1d1d1f;
      background: #ffffff;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pdf-page {
      page-break-after: always;
      padding-bottom: 24px;
    }
    .pdf-page:last-child {
      page-break-after: auto;
    }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e5e5e7;
      padding-bottom: 8px;
      margin-bottom: 16px;
      font-size: 11px;
      color: #86868b;
    }
    .bilingual-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 14px;
      break-inside: avoid;
    }
    .heading-row {
      border-top: 1px dashed #e5e5e7;
      padding-top: 12px;
      margin-top: 18px;
    }
    .heading-row h3 {
      margin: 0 0 4px 0;
      font-size: 14px;
      font-weight: 700;
      color: #007aff;
    }
    .col-src {
      font-size: 12px;
      line-height: 1.65;
      color: #515154;
      border-right: 1px solid #f0f0f2;
      padding-right: 16px;
    }
    .col-dst {
      font-size: 12.5px;
      line-height: 1.7;
      color: #1d1d1f;
      font-weight: 500;
    }
    p {
      margin: 0 0 6px 0;
    }
  </style>
</head>
<body>
  ${pagesHtml.join('')}
  <script>
    window.onload = () => {
      // 自动触发系统打印/导出 PDF 预览
      window.print();
    };
  </script>
</body>
</html>`
}
