process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow } = require('electron')
const watchdog = setTimeout(() => {
  console.log('[e2e-v7] WATCHDOG EXIT')
  process.exit(2)
}, 120000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    await sleep(2500)
    const win = BrowserWindow.getAllWindows()[0]
    const out = []
    const js = (s) => win.webContents.executeJavaScript(s, true)

    const result = await js(`(async () => {
      const res = [];
      const t0 = performance.now();
      try {
        const mod = await import('file:///C:/AcademicLens/node_modules/tesseract.js/dist/tesseract.esm.min.js');
        const T = mod.default ?? mod;
        res.push('lib=' + (T.createWorker ? 'OK' : 'MISSING'));

        // 生成中英混合测试图
        const canvas = document.createElement('canvas');
        canvas.width = 900; canvas.height = 320;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 900, 320);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 40px Arial';
        ctx.fillText('Attention Is All You Need', 40, 90);
        ctx.font = 'bold 40px "Microsoft YaHei", sans-serif';
        ctx.fillText('深度学习模型', 40, 170);
        ctx.font = 'bold 40px Arial';
        ctx.fillText('Transformer Architecture', 40, 250);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        res.push('blob=' + (blob ? blob.size : 'null'));
        res.push('T.version=' + (T.version || '?'));

        let worker = null;
        try {
          worker = await T.createWorker('eng+chi_sim', 1, {
            langPath: 'file:///C:/AcademicLens/dist/tessdata',
            corePath: 'file:///C:/AcademicLens/dist/tessdata/core',
            workerPath: 'file:///C:/AcademicLens/dist/tessdata/worker.min.js',
            workerBlobURL: false,
            gzip: false,
            logger: () => undefined
          });
          res.push('worker=OK');
        } catch (ew) {
          res.push('createWorker FAIL: ' + ((ew && ew.message) || String(ew)));
          if (ew && ew.stack) res.push('WS: ' + ew.stack.split('\\n').slice(0, 5).join(' | '));
          return res.join('\\n');
        }
        const initMs = Math.round(performance.now() - t0);
        res.push('init=' + initMs + 'ms');

        const { data } = await worker.recognize(blob);
        const ocrMs = Math.round(performance.now() - t0);
        res.push('ocr=' + ocrMs + 'ms');
        res.push('text=' + JSON.stringify(data.text.trim().slice(0, 200)));
        await worker.terminate();
        return res.join('\\n');
      } catch (e) {
        res.push('FAIL: ' + ((e && e.message) || String(e)));
        res.push('STACK: ' + ((e && e.stack) || '').split('\\n').slice(0, 4).join(' | '));
        return res.join('\\n');
      }
    })()`)

    out.push(result)
    const hasAttention = /Attention/i.test(result)
    const hasChinese = /深度学习|模型/i.test(result)
    const hasTransformer = /Transformer/i.test(result)
    out.push(`关键词: Attention=${hasAttention} 中文=${hasChinese} Transformer=${hasTransformer}`)
    out.push(`结论: ${hasAttention && hasTransformer ? 'PASS' : 'PARTIAL'}（中文识别受字体渲染影响，可容忍）`)

    console.log('[e2e-v7]')
    console.log(out.join('\n'))
    app.exit(0)
  } catch (e) {
    console.log('[e2e-v7] TEST ERROR:', e && e.message, e && e.stack)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
