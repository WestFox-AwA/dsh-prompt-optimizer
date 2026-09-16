// PTC 执行端框架（外置，宿主内由 require 垫片求值）：
// 固定不变的执行端规则 + 程序抽取 + 沙箱执行。策略（候选优化提示词）不影响本文件，
// 因此 A/B 差异只能来自"精炼后的命令"，可归因。
const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const EXEC_SYSTEM = [
  '你是执行端 AI，运行在 PTC 模式：你没有交互式工具，每一轮只能提交"一个"可直接运行的程序。',
  '规则：',
  '1. 只回复一个代码块（```ts 或 ```js 用 Node，```python 用 Python），不要长篇解释；代码块外最多一行说明。',
  '2. 程序在工作目录（进程 cwd）内运行；可用 Node/Python 内置能力（读写文件、起子进程、本机网络）。',
  '3. 每轮结束你会收到：exit code、stdout、stderr（可能截断）。据此决定下一轮的程序。',
  '4. 任务真正完成时，让程序输出以 DONE: 开头的一行作为完成信号；不确定就继续。',
  '5. 不要假设自己在和用户对话；你只写程序。',
  '6. 程序要短而直给：不要写备份/回滚/多种方案，不要自己打印整份文件清单当装饰。',
].join('\n')

const taskMsg = (cmdText, dir, rounds) => ['【任务】', String(cmdText || ''), '', '工作目录：' + dir + '（就是当前目录，直接用相对路径）', '轮次上限：' + rounds + ' 轮。', '', '现在开始第 1 轮：只回复一个程序。'].join('\n')

const CODE_LANGS = /^(js|javascript|jsx|node|ts|tsx|typescript|python|py|python3)$/
const isPy = (lang) => /^(py|python|python3)$/.test(lang)
const isTs = (lang) => /^(ts|tsx|typescript)$/.test(lang)
const isEsm = (code) => /^\s*(import|export)\s/m.test(String(code))

// 程序抽取：取"最长的代码块"（而不是最后一个）——精炼后的命令常要求模型贴出多段证据，
// 最后一对围栏可能只是证据片段；同时清掉嵌套围栏残留行。
const pickProgram = (text) => {
  const src = String(text || '')
  const re = /```([a-zA-Z0-9_+.-]*)[ \t]*\r?\n([\s\S]*?)```/g
  const blocks = []
  let m
  while ((m = re.exec(src))) blocks.push({ lang: String(m[1] || '').toLowerCase(), code: m[2] })
  const clean = (code) => code.split(/\r?\n/).filter((l) => !/^\s*```[a-zA-Z0-9_+.-]*\s*$/.test(l)).join('\n')
  if (blocks.length > 0) {
    const known = blocks.filter((b) => CODE_LANGS.test(b.lang))
    const pool = known.length > 0 ? known : blocks
    let best = pool[0]
    for (const b of pool) if (b.code.length > best.code.length) best = b
    return { lang: best.lang || 'js', code: clean(best.code) }
  }
  // 没有围栏：整段当程序（仅当像代码时）
  const t = src.trim()
  if (t && /(^\s*(const|let|var|function|import|export|require|def |class |print\()|=>)/m.test(t)) return { lang: 'js', code: t }
  return null
}

const extFor = (lang, code) => {
  if (isPy(lang)) return '.py'
  if (isTs(lang)) return isEsm(code) ? '.mts' : '.cts'
  return isEsm(code) ? '.mjs' : '.cjs'
}

const dec = (b) => {
  if (!b) return ''
  const buf = Buffer.from(b)
  const u = buf.toString('utf8')
  if (u.indexOf('\uFFFD') < 0) return u
  for (const e of ['gb18030', 'gbk', 'cp936']) { try { return new TextDecoder(e).decode(buf) } catch (e2) { /* next */ } }
  return u
}

const runProgram = (progDir, cwdDir, lang, code, timeoutMs, pythonCmd) => {
  fs.mkdirSync(progDir, { recursive: true })
  const file = path.join(progDir, 'round' + Math.random().toString(36).slice(2, 7) + extFor(lang, code))
  fs.writeFileSync(file, code, 'utf8')
  const cmd = isPy(lang) ? (pythonCmd || 'python') : process.execPath
  const r = cp.spawnSync(cmd, [file], { cwd: cwdDir, encoding: 'buffer', timeout: timeoutMs, windowsHide: true })
  return {
    file: path.basename(file),
    exit: r.status === null ? 'null' : r.status,
    stdout: dec(r.stdout),
    stderr: dec(r.stderr),
    timedOut: Boolean(r.error && /ETIMEDOUT|timed/i.test(String(r.error.message))),
  }
}

module.exports = { EXEC_SYSTEM, taskMsg, pickProgram, extFor, runProgram, isPy, isTs, isEsm }
