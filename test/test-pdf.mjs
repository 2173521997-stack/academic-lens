import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const data = new Uint8Array(readFileSync(process.env.IN || 'sample.pdf'))
const doc = await getDocument({ data }).promise
console.log('页数:', doc.numPages)
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i)
  const content = await page.getTextContent()
  const strs = content.items.map((it) => it.str).join(' ')
  console.log(`--- 第 ${i} 页 ---`)
  console.log(strs)
}
await doc.destroy()
