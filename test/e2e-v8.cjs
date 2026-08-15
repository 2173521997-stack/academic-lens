process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow } = require('electron')
const watchdog = setTimeout(() => {
  console.log('[e2e-v8] WATCHDOG EXIT')
  process.exit(2)
}, 120000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    await sleep(3000)
    const win = BrowserWindow.getAllWindows()[0]
    const out = []
    const js = (s) => win.webContents.executeJavaScript(s, true)

    // 准备数据：历史（单词条目+句子条目）、词卡 recent（提供例句搭配）、清空生词本
    await js(`window.bridge.storeSet('history', [
      { id: 'h1', time: Date.now(), type: 'translate', title: 'paradigm', detail: 'n. 范式；范例' },
      { id: 'h2', time: Date.now() - 1000, type: 'translate', title: 'This is a long sentence in history.', detail: '这是历史中的长句翻译。' },
      { id: 'h3', time: Date.now() - 2000, type: 'file', title: 'paper.pdf', detail: '42 段' }
    ]).then(() => 'ok')`)
    await js(`window.bridge.storeSet('quickRecent', [{
      src: 'paradigm', mode: 'word', time: Date.now(),
      dst: 'word|paradigm\\nphonetic|/ˈpærədaɪm/\\npos|n.\\ndef|范式；范例\\nex1|This is a new paradigm. | 这是一个新范式。\\nex2|The old paradigm is outdated. | 旧范式已过时。'
    }]).then(() => 'ok')`)
    await js(`window.bridge.storeSet('wordbook', []).then(() => 'ok')`)
    await js(`location.reload()`)
    await sleep(4500)

    // 大窗 → 历史页
    await js(`window.bridge.windowSetMode('full')`)
    await sleep(700)
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '历史')?.click()`)
    await sleep(700)

    // 用例 A：历史中单词条目出现收藏按钮，句子/文件条目不出现
    const starInfo = await js(`(function(){
      const cards = Array.from(document.querySelectorAll('.card')).filter(c => c.textContent.includes('paradigm'));
      const star = cards[0] ? cards[0].querySelector('button[title*="收藏"]') : null;
      const sentenceStar = (function(){
        const c = Array.from(document.querySelectorAll('.card')).find(c => c.textContent.includes('This is a long sentence'));
        return c ? !!c.querySelector('button[title*="收藏"]') : 'NO-CARD';
      })();
      return JSON.stringify({ wordStar: !!star, sentenceStar });
    })()`)
    out.push(`A: 单词条目可收藏=${JSON.parse(starInfo).wordStar} 句子条目无收藏=${!JSON.parse(starInfo).sentenceStar} ${JSON.parse(starInfo).wordStar && !JSON.parse(starInfo).sentenceStar ? 'PASS' : 'FAIL'}`)

    // 用例 B：点击收藏 → 生词本含拼写/释义/搭配（例句回填）
    await js(`(function(){
      const c = Array.from(document.querySelectorAll('.card')).find(c => c.textContent.includes('paradigm'));
      c.querySelector('button[title*="收藏"]')?.click();
    })()`)
    await sleep(1500)
    const wb = JSON.parse(await js(`window.bridge.storeGet('wordbook').then(r => JSON.stringify(r || []))`))
    const hit = (wb || []).find((w) => w.word === 'paradigm')
    out.push(`B: 生词本=${hit ? JSON.stringify({ def: (hit.definition || '').slice(0, 25), ctx: (hit.context || '').slice(0, 45) }) : 'NOT-FOUND'} ${hit && hit.definition.includes('范式') && hit.context && hit.context.includes('This is a new paradigm') ? 'PASS' : 'FAIL'}`)

    // 用例 C：删除历史不影响生词本
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('清空历史'))?.click()`)
    await sleep(1000)
    const afterClear = await js(`Promise.all([
      window.bridge.storeGet('history').then(r => JSON.stringify(r || [])),
      window.bridge.storeGet('wordbook').then(r => JSON.stringify((r || []).map(w => w.word)))
    ]).then(([h, w]) => JSON.stringify({ h, w }))`)
    const ac = JSON.parse(afterClear)
    out.push(`C: 清空后 history=${ac.h} wordbook=${ac.w} ${ac.h === '[]' && ac.w.includes('paradigm') ? 'PASS' : 'FAIL'}`)

    // 用例 D：新词表（9.2万）推荐回归：保底词 transformer 可推荐
    await js(`window.bridge.windowSetMode('mini')`)
    await sleep(600)
    await js(`(function(){
      const el = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, 'transf');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    let sugg = 'TIMEOUT'
    const t0 = Date.now()
    while (Date.now() - t0 < 15000) {
      await sleep(400)
      sugg = await js(`(function(){
        const hits = Array.from(document.querySelectorAll('.mini-window button')).map(b => b.textContent.trim()).filter(t => t.startsWith('transf'));
        return hits.length ? hits.slice(0, 6).join(',') : null;
      })()`)
      if (sugg) break
    }
    out.push(`D: 新词表建议(transf)=${sugg} ${sugg && sugg.includes('transformer') ? 'PASS' : 'FAIL'}`)

    console.log('[e2e-v8]')
    console.log(out.join('\n'))
    app.exit(0)
  } catch (e) {
    console.log('[e2e-v8] TEST ERROR:', e && e.message)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
