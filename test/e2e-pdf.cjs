const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const workerAsset = fs
  .readdirSync(path.join(__dirname, '../dist/assets'))
  .find((f) => f.startsWith('pdf.worker.min'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../dist-electron/preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  await win.loadFile(path.join(__dirname, '../dist/index.html'))
  await new Promise((r) => setTimeout(r, 800))

  const script = `
    (async () => {
      const results = [];
      try {
        const chunkUrl = new URL(${JSON.stringify('./assets/pdf-' + 'C1gUo6dv.js')}, document.baseURI).toString();
        const pdfjs = await import(chunkUrl);
        results.push('pdfjs exports: ' + Object.keys(pdfjs).slice(0, 8).join(','));
        const workerUrl = new URL(${JSON.stringify('./assets/' + workerAsset)}, document.baseURI).toString();
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const resp = await fetch('file:///C:/AcademicLens/sample2.pdf');
        results.push('fetch ok=' + resp.ok + ' status=' + resp.status);
        const ab = await resp.arrayBuffer();
        results.push('arrayBuffer bytes=' + ab.byteLength);
        const doc = await pdfjs.getDocument({ data: ab }).promise;
        const page = await doc.getPage(1);
        const content = await page.getTextContent();
        results.push('OK pages=' + doc.numPages + ' items=' + content.items.length);
        results.push('text=' + content.items.map(i => i.str).join(' | '));
        await doc.loadingTask.destroy();
      } catch (e) {
        results.push('FAIL: ' + e.message);
        results.push('STACK: ' + (e.stack || '').split('\\n').slice(0, 6).join(' <br> '));
      }
      return results.join('\\n');
    })()
  `

  const out = await win.webContents.executeJavaScript(script, true)
  console.log('[e2e-pdf]')
  console.log(out)
  app.exit(0)
})
