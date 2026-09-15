// 英文档位名统一：Basic → Low，Advanced → High，Extreme → Ultra（只改英文文档中的档位名）。
// 用法：node evidence/rename-en-tiers.cjs [--apply]
const fs = require('fs')
const path = require('path')
const apply = process.argv.indexOf('--apply') >= 0
const root = path.join(__dirname, '..')
const FILES = ['README.en.md', 'PROMPT-OPTIMIZATION.md', 'ACCEPTANCE.md', 'CHANGELOG.md', 'ROADMAP.md', 'DSH-COMPAT.md']
const MAP = [['Basic', 'Low'], ['Advanced', 'High'], ['Extreme', 'Ultra']]
for (const f of FILES) {
  const p = path.join(root, f)
  let t = fs.readFileSync(p, 'utf8')
  const hits = []
  for (const [from, to] of MAP) {
    // 词边界替换，避免误伤（例如英文单词内部）
    const re = new RegExp('\\b' + from + '\\b', 'g')
    const n = (t.match(re) || []).length
    if (n) { hits.push(from + '→' + to + ' x' + n); if (apply) t = t.replace(re, to) }
  }
  if (hits.length) { if (apply) fs.writeFileSync(p, t, 'utf8'); console.log((apply ? 'APPLY ' : 'DRY   ') + f + '  ' + hits.join('  ')) }
}
