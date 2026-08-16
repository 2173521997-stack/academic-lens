// 生成两页测试 PDF（更真实：含页眉、标题段、多段正文），验证「按页分组」可靠性
import { writeFileSync } from 'node:fs'

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

const pages = [
  {
    header: 'Introduction',
    blocks: [
      { size: 16, text: 'Attention Is All You Need' },
      { size: 12, text: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.' },
      { size: 12, text: 'In this work we propose the Transformer, a model architecture eschewing recurrence.' }
    ]
  },
  {
    header: 'Method',
    blocks: [
      { size: 16, text: 'Model Architecture' },
      { size: 12, text: 'Most competitive neural sequence transduction models have an encoder-decoder structure.' },
      { size: 12, text: 'The encoder maps an input sequence of symbol representations to a sequence of continuous representations.' }
    ]
  }
]

// 对象编号：1 Catalog, 2 Pages, 3/4 Page, 5/6 Contents, 7 Font
const objs = []
objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`
objs[2] = `<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>`
objs[7] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`

for (let p = 0; p < pages.length; p++) {
  const pageObj = 3 + p
  const contentObj = 5 + p
  const lines = [
    `BT /F1 9 Tf 72 760 Td (${esc(pages[p].header)}) Tj ET`
  ]
  let y = 700
  for (const b of pages[p].blocks) {
    lines.push(`BT /F1 ${b.size} Tf 72 ${y} Td (${esc(b.text)}) Tj ET`)
    y -= 30
  }
  const content = lines.join('\n') + '\n'
  objs[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents ${contentObj} 0 R >>`
  objs[contentObj] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`
}

let pdf = '%PDF-1.4\n'
const offsets = []
for (let i = 1; i <= 7; i++) {
  offsets[i] = Buffer.byteLength(pdf)
  pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`
}
const xrefStart = Buffer.byteLength(pdf)
pdf += `xref\n0 8\n0000000000 65535 f \n`
for (let i = 1; i <= 7; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

writeFileSync(new URL('./multi-real.pdf', import.meta.url), Buffer.from(pdf))
console.log('[gen] multi-real.pdf written')
