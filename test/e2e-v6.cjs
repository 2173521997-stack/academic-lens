process.env.ELECTRON_SMOKE = ''
require('../dist-electron/main.js')

const { app, BrowserWindow } = require('electron')
const watchdog = setTimeout(() => {
  console.log('[e2e-v6] WATCHDOG EXIT')
  process.exit(2)
}, 150000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    await sleep(3000)
    const win = BrowserWindow.getAllWindows()[0]
    const out = []
    const js = (s) => win.webContents.executeJavaScript(s, true)

    // 清理数据，保证可重复
    await js(`window.bridge.storeSet('wordbook', [])`)
    await js(`window.bridge.storeSet('quickRecent', [])`)

    await js(`window.bridge.windowSetMode('mini')`)
    await sleep(600)

    // 用例 A：推荐搜索
    await js(`(function(){
      const el = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, 'atten');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    let sugg = 'TIMEOUT'
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      await sleep(400)
      sugg = await js(`(function(){
        const btns = Array.from(document.querySelectorAll('.mini-window button')).map(b => b.textContent.trim());
        const hits = btns.filter(t => /^att[a-z]+$/.test(t));
        return hits.length ? hits.slice(0, 10).join(',') : null;
      })()`)
      if (sugg) break
    }
    out.push(`A: 建议=${sugg} ${sugg !== 'TIMEOUT' && sugg.split(',').length >= 5 ? 'PASS' : 'FAIL'}`)

    // 用例 B：点击第一个建议 → word 模式查词 → 词卡渲染
    const firstSugg = await js(`(function(){
      const btn = Array.from(document.querySelectorAll('.mini-window button')).find(b => /^att[a-z]+$/.test(b.textContent.trim()));
      if (!btn) return null;
      const w = btn.textContent.trim();
      btn.click();
      return w;
    })()`)
    out.push(`B: 点击建议=${firstSugg}`)
    let card = 'TIMEOUT'
    const t1 = Date.now()
    while (Date.now() - t1 < 45000) {
      await sleep(500)
      card = await js(`(function(){
        const h2 = document.querySelector('.mini-window .card h2');
        const err = document.querySelector('.mini-window .text-danger');
        const stream = document.querySelector('.mini-window .stream-caret');
        if (err && /未配置|失败|超时/.test(err.textContent)) return 'ERR:' + err.textContent.slice(0, 50);
        if (stream) return 'STREAMING';
        if (h2) return 'CARD:' + h2.textContent;
        return null;
      })()`)
      if (card && (card.startsWith('CARD:') || card.startsWith('ERR:'))) break
    }
    out.push(`B: 词卡=${card} ${card === 'CARD:' + firstSugg ? 'PASS' : 'FAIL'}`)

    // 用例 C：搜索历史加入生词本（word 词卡条目 → 重载 → 点 ⭐ → 校验）
    await js(`window.bridge.storeSet('quickRecent', [{
      src: 'paradigm', mode: 'word', time: Date.now(),
      dst: 'word|paradigm\\nphonetic|/ˈpærədaɪm/\\npos|n.\\ndef|范式；范例\\nex1|This is a new paradigm. | 这是一个新范式。\\nex2|The old paradigm is outdated. | 旧范式已过时。'
    }]).then(() => 'saved')`)
    await js(`location.reload()`)
    await sleep(4500)
    const hasRecent = await js(`document.body.textContent.includes('paradigm')`)
    out.push(`C: 历史渲染=${hasRecent}`)
    const star = await js(`(function(){
      const btn = Array.from(document.querySelectorAll('.mini-window button')).find(b => b.title && (b.title.includes('加入生词本') || b.title.includes('已在生词本')));
      if (!btn) return 'NO-STAR';
      if (btn.title.includes('已在生词本')) return 'ALREADY';
      btn.click();
      return 'CLICKED';
    })()`)
    out.push(`C: 收藏=${star}`)
    await sleep(1200)
    const wb = JSON.parse(await js(`window.bridge.storeGet('wordbook').then(r => JSON.stringify(r || []))`))
    const hit = (wb || []).find((w) => w.word === 'paradigm')
    const passC = hit && hit.definition.includes('范式') && hit.context.includes('This is a new paradigm')
    out.push(`C: 生词本=${hit ? JSON.stringify({ def: hit.definition.slice(0, 30), ctx: (hit.context || '').slice(0, 50) }) : 'NOT-FOUND'} ${passC ? 'PASS' : 'FAIL'}`)

    console.log('[e2e-v6]')
    console.log(out.join('\n'))
    app.exit(0)
  } catch (e) {
    console.log('[e2e-v6] TEST ERROR:', e && e.message)
    console.log(e && e.stack)
    app.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
})
