import { writeFileSync } from 'node:fs'

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildPdf(lines) {
  const content =
    lines
      .map((text, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td (${esc(text)}) Tj ET`)
      .join('\n') + '\n'
  const objs = [
    null,
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf)
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xrefStart = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n`
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf)
}

const buf = buildPdf([
  'Attention Is All You Need',
  'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
  'The Transformer allows for significantly more parallelization and can reach a new state of the art in translation quality.',
  'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.'
])
writeFileSync(process.env.OUT || 'sample.pdf', buf)
console.log('PDF 生成完毕:', buf.length, 'bytes')
