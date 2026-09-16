// PTC 测试台 · P0 判定器（先做判定，再做执行）：
//   每道题 = { 题面生成(可随机化), 判定器(确定性), 正控(gold) / 反控(bad) 构造 }
//   selftest 会对每题跑 "gold 必须过 / bad 必须失败"，判定器自身不过自证就不许用来打分。
// 用法：node evidence/ptc-lab/tasks.cjs          # 打印题目清单
//       node evidence/ptc-lab/tasks.cjs selftest # 判定器自证（正控/反控）
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

// ── 通用：确定性小工具
const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8') } catch (e) { return null } }
const exists = (dir, f) => fs.existsSync(path.join(dir, f))
const runNode = (dir, args, input) => spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', input, timeout: 20000 })
// Python 解释器探测：本机可能只有 py -3 / python3；全都没有时标记为"环境缺失"，由判定器判为跳过（不得静默算 0 分）
let NO_PY = false
let PY_CMD = null
for (const cand of [['python'], ['python3'], ['py', '-3']]) {
  const r = spawnSync(cand[0], cand.slice(1).concat(['-c', 'print(1)']), { encoding: 'utf8', timeout: 8000 })
  if (r.status === 0 && String(r.stdout).trim() === '1') { PY_CMD = cand; break }
}
if (!PY_CMD) NO_PY = true
const runPython = (dir, args, input) => {
  if (NO_PY) return { status: -1, stdout: '', stderr: 'no-python-interpreter' }
  // Windows 下 Python 写管道默认用本地编码（GBK/cp936），必须按 buffer 收再双解码，否则中文标签会变乱码，
  // 判定器会把"正确的解答"误判为失败（实测踩到：gold 因编码问题被判 FAIL）。
  const r = spawnSync(PY_CMD[0], PY_CMD.slice(1).concat(args), { cwd: dir, encoding: 'buffer', input, timeout: 20000 })
  const dec = (buf) => {
    if (!buf) return ''
    const b = Buffer.from(buf)
    const u = b.toString('utf8')
    if (u.indexOf('\uFFFD') < 0) return u
    // Buffer 不支持 gbk（只有 TextDecoder 支持），逐个候选本地编码尝试
    for (const enc of ['gb18030', 'gbk', 'cp936', 'big5']) {
      try { return new TextDecoder(enc).decode(b) } catch (e) { /* 该编码不可用则试下一个 */ }
    }
    return u
  }
  return { status: r.status, stdout: dec(r.stdout), stderr: dec(r.stderr) }
}
const mk = (name, pass, evidence) => ({ name, pass: Boolean(pass), evidence: String(evidence) })
const verdict = (checks) => {
  // 环境缺失（如本机无 Python）：整题判"跳过"，不计入通过/失败，也不许当成能力问题
  if (NO_PY && checks.some((c) => !c.pass && /no-python-interpreter|Python/.test(c.evidence))) return { pass: false, env: true, checks }
  return { pass: checks.every((c) => c.pass), checks }
}
// 规范化 JSON 文本：解析后重新序列化（保留键序），用于"字段与键顺序"判定（不吃缩进/空白差异）
const canonical = (obj) => { try { return JSON.stringify(obj) } catch (e) { return null } }

const TASKS = [
  {
    id: 'json-upgrade',
    domain: '数据/文件改造',
    make: (p) => ({ text: '在工作目录创建 config.json，内容为 ' + JSON.stringify({ name: p.name, retries: p.retries }) + '；把它升级为 v2：加上 "enabled":true 与 "version":2，其余字段与键顺序不变；最后打印文件内容作为证据。', p }),
    check: (dir, p) => {
      const raw = read(dir, 'config.json')
      const want = '{"name":"' + p.name + '","retries":' + p.retries + ',"enabled":true,"version":2}'
      let parsed = null, err = null
      try { parsed = JSON.parse(raw) } catch (e) { err = String(e.message) }
      return verdict([
        mk('文件存在', raw !== null, raw === null ? 'config.json 不存在' : 'ok'),
        mk('可解析为 JSON', parsed !== null, err || 'ok'),
        // 题面只冻结"字段与键顺序"，不冻结空白/缩进 —— 逐字符比对会误杀美化输出的正确解（实测踩到）
        mk('字段与键顺序完全一致（无多余字段）', raw !== null && parsed !== null && canonical(parsed) === want, 'got=' + JSON.stringify(canonical(parsed) || (raw || '').trim().slice(0, 80))),
        mk('未新增多余文件', fs.readdirSync(dir).filter((f) => f !== 'config.json').length === 0, 'extra=' + JSON.stringify(fs.readdirSync(dir).filter((f) => f !== 'config.json'))),
      ])
    },
    gold: (dir, p) => { fs.writeFileSync(path.join(dir, 'config.json'), '{"name":"' + p.name + '","retries":' + p.retries + ',"enabled":true,"version":2}', 'utf8') },
    bad: (dir, p) => { fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ enabled: true, name: p.name, retries: p.retries, version: 2 }), 'utf8') },
  },
  {
    id: 'cli-stats',
    domain: '脚本与 CLI',
    make: (p) => ({ text: '在工作目录写 stats.py：统计给定文本文件的行数/词数/字符数；支持 --json 输出 JSON；真跑一次验证两种输出正确并贴出结果。', p }),
    check: (dir, p) => {
      const src = read(dir, 'stats.py')
      const r = runPython(dir, ['stats.py', 'sample.txt'])
      const rj = runPython(dir, ['stats.py', 'sample.txt', '--json'])
      const miss = runPython(dir, ['stats.py', '不存在的文件.txt'])
      let j = null, jerr = null
      try { j = JSON.parse(String(rj.stdout || '').trim()) } catch (e) { jerr = String(e.message) }
      return verdict([
        mk('stats.py 存在', src !== null, src === null ? '缺失' : 'ok'),
        mk('默认输出含 行/词/字符 三项数字', /行/.test(String(r.stdout)) && /词/.test(String(r.stdout)) && /字符/.test(String(r.stdout)), JSON.stringify(String(r.stdout).slice(0, 60))),
        mk('--json 可被解析且三键齐全(l小写 lines/words/chars)', j && typeof j.lines === 'number' && typeof j.words === 'number' && typeof j.chars === 'number', jerr || JSON.stringify(j)),
        mk('默认输出与 --json 数字一致', (() => { if (!j) return false; const nums = String(r.stdout).match(/\d+/g) || []; return nums.length >= 3 && Number(nums[0]) === j.lines && Number(nums[1]) === j.words && Number(nums[2]) === j.chars })(), 'stdout=' + JSON.stringify(String(r.stdout).slice(0, 60))),
        mk('文件不存在时报错且非零退出', String(miss.stdout) + String(miss.stderr) !== '' && miss.status !== 0, 'status=' + miss.status),
      ])
    },
    gold: (dir) => {
      const sample = 'alpha beta\n\ngamma\ndelta epsilon zeta\n'
      fs.writeFileSync(path.join(dir, 'sample.txt'), sample, 'utf8')
      fs.writeFileSync(path.join(dir, 'stats.py'), [
        'import sys, json',
        'def main():',
        '    args = [a for a in sys.argv[1:] if a != "--json"]',
        '    as_json = "--json" in sys.argv',
        '    if not args:',
        '        print("usage: stats.py <file> [--json]", file=sys.stderr); return 2',
        '    try:',
        '        t = open(args[0], encoding="utf-8").read()',
        '    except OSError as e:',
        '        print("error: " + str(e), file=sys.stderr); return 1',
        '    lines = t.count("\\n") + (0 if t.endswith("\\n") or t == "" else 1)',
        '    words = len(t.split())',
        '    chars = len(t)',
        '    if as_json: print(json.dumps({"lines": lines, "words": words, "chars": chars}))',
        '    else:',
        '        print("行数: %d" % lines); print("词数: %d" % words); print("字符数: %d" % chars)',
        '    return 0',
        'sys.exit(main() or 0)',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      fs.writeFileSync(path.join(dir, 'sample.txt'), 'x\n', 'utf8')
      fs.writeFileSync(path.join(dir, 'stats.py'), 'print("todo")\n', 'utf8')
    },
  },
  {
    id: 'html-selfcheck',
    domain: '单文件 HTML 产物',
    make: (p) => ({ text: '在工作目录写一个单文件 HTML（CDN 引入 three.js）：显示一个自动旋转的立方体；并暴露 window.__selfcheck() 返回 {checks:[{name,pass,evidence}],pass}，交付前真跑一次贴出输出。', p }),
    check: (dir, p) => {
      const html = read(dir, 'cube.html') || read(dir, 'index.html')
      let self = null, err = null
      if (html) {
        try {
          const m = html.match(/window\.__selfcheck\s*=\s*([\s\S]{0,4000}?)\n/) || html.match(/function\s+__selfcheck[\s\S]{0,4000}?\n\}/)
          if (!m) err = '未找到 __selfcheck 定义'
          else {
            const body = html.slice(html.indexOf('__selfcheck'), html.indexOf('__selfcheck') + 3000)
            self = { found: true, structured: /checks\s*:/.test(body) && /pass\s*:/.test(body) && /evidence/.test(body) }
          }
        } catch (e) { err = String(e.message) }
      }
      return verdict([
        mk('产出单个 HTML 文件', html !== null, html === null ? '未找到 cube.html/index.html' : 'ok'),
        mk('用 CDN 引入 three.js 且版本固定', /cdn[^"']*three[^"']*\.js/i.test(html || '') && /three@?\d+\.\d+/.test(html || ''), 'cdn=' + /three[^"']{0,60}/.exec(html || '')?.[0]),
        mk('顶层定义 __selfcheck（不依赖 load 回调）', /window\.__selfcheck\s*=/.test(html || '') && !/addEventListener\(\s*['"]load['"][\s\S]{0,200}__selfcheck/.test(html || ''), err || 'ok'),
        mk('自检返回结构化 {checks:[{name,pass,evidence}],pass}', Boolean(self && self.structured), JSON.stringify(self)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'cube.html'), [
        '<!doctype html><html><head><meta charset="utf-8"><title>cube</title>',
        '<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script></head><body>',
        '<canvas id="c"></canvas><script>',
        'window.__selfcheck = function(){ return { checks:[{name:"three_loaded",pass:true,evidence:"three r160"},{name:"cube",pass:true,evidence:"mesh=1"}], pass:true } }',
        '</script></body></html>',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      fs.writeFileSync(path.join(dir, 'cube.html'), '<!doctype html><html><body><canvas></canvas><script>document.addEventListener("load",function(){ window.__selfcheck=function(){return {pass:true}} })</script></body></html>', 'utf8')
    },
  },
  {
    id: 'mesh-normals',
    domain: '几何/网格数学',
    make: (p) => ({ text: '在工作目录写 normals.js（Node，无依赖）：构造一个边长 1 的立方体几何（8 顶点 12 三角面，外观面朝外），导出函数 audit(geometry) 返回 {faces, inwardFaces, facesOutwardRatio}；再写一个 main 打印审计结果。', p }),
    check: (dir, p) => {
      const r = runNode(dir, ['normals.js'])
      const out = String(r.stdout || '')
      let j = null
      try { j = JSON.parse(out.trim().split('\n').pop()) } catch (e) { /* 允许非 JSON 输出 */ }
      return verdict([
        mk('normals.js 存在且可运行', exists(dir, 'normals.js') && r.status === 0, 'status=' + r.status + ' stderr=' + String(r.stderr || '').slice(0, 80)),
        mk('输出含 faces/inwardFaces/facesOutwardRatio', /faces/.test(out) && /inwardFaces/.test(out) && /facesOutwardRatio/.test(out), out.slice(0, 80)),
        mk('审计结论：无内向面（inwardFaces=0）', j ? j.inwardFaces === 0 : /inwardFaces["\s:]+0/.test(out), JSON.stringify(j)),
        mk('面数=12 且朝外比例=1', j ? (j.faces === 12 && j.facesOutwardRatio === 1) : false, JSON.stringify(j)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'normals.js'), [
        'function build(){',
        '  const f = { px:[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]], nx:[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]],',
        '    py:[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]], ny:[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]],',
        '    pz:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], nz:[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] }',
        '  const positions = [], indices = []',
        '  for (const k of Object.keys(f)) { const b = positions.length; positions.push(...f[k]); indices.push(b,b+1,b+2,b,b+2,b+3) }',
        '  return { positions, indices }',
        '}',
        'function audit(g){ let inward=0,total=0; let cx=0,cy=0,cz=0',
        '  for (const p of g.positions){cx+=p[0];cy+=p[1];cz+=p[2]} const n=g.positions.length; cx/=n;cy/=n;cz/=n',
        '  for (let i=0;i+2<g.indices.length;i+=3){ const a=g.positions[g.indices[i]],b=g.positions[g.indices[i+1]],c=g.positions[g.indices[i+2]]',
        '    const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]]',
        '    const fn=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]',
        '    const fc=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3]',
        '    total++; if((fc[0]-cx)*fn[0]+(fc[1]-cy)*fn[1]+(fc[2]-cz)*fn[2]<=0) inward++ }',
        '  return { faces: total, inwardFaces: inward, facesOutwardRatio: total?(total-inward)/total:0 } }',
        'console.log(JSON.stringify(audit(build())))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      fs.writeFileSync(path.join(dir, 'normals.js'), 'const g={positions:[[0,0,0],[1,0,0],[0,1,0]],indices:[0,2,1]}\nconsole.log(JSON.stringify({faces:1,inwardFaces:1,facesOutwardRatio:0}))\n', 'utf8')
    },
  },
]

function selftest() {
  const rows = []
  for (const t of TASKS) {
    const p = { name: 'demo', retries: 3 }
    for (const kind of ['gold', 'bad']) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptclab-' + t.id + '-'))
      try {
        t[kind](dir, p)
        const res = t.check(dir, p)
        if (res.env) rows.push({ task: t.id, domain: t.domain, kind, env: true })
        else rows.push({ task: t.id, domain: t.domain, kind, pass: res.pass, failed: res.checks.filter((c) => !c.pass).map((c) => c.name) })
      } catch (e) { rows.push({ task: t.id, domain: t.domain, kind, pass: false, failed: ['异常: ' + String(e.message)] }) }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
  const scored = rows.filter((r) => !r.env)
  const skipped = rows.filter((r) => r.env)
  const ok = scored.every((r) => (r.kind === 'gold' ? r.pass === true : r.pass === false))
  console.log('=== PTC 测试台 · 判定器自证（gold 必须过 / bad 必须失败）===')
  for (const r of rows) {
    if (r.env) { console.log('  ' + r.task.padEnd(15) + r.kind.padEnd(6) + 'SKIP（环境缺失，不计分）'); continue }
    console.log('  ' + r.task.padEnd(15) + r.kind.padEnd(6) + (r.kind === 'gold' ? (r.pass ? 'PASS ✓' : 'FAIL ✗') : (r.pass ? 'FAIL ✗（反控不该过）' : 'PASS ✓（被正确判失败）')) + (r.failed.length ? '   ' + JSON.stringify(r.failed) : ''))
  }
  console.log('')
  console.log('Python 解释器：' + (NO_PY ? '未找到（相关题将被跳过，不计分）' : PY_CMD.join(' ')))
  console.log('判定器自证：' + (ok ? '通过 ✓（' + scored.length + ' 项计分' + (skipped.length ? '，' + skipped.length + ' 项跳过' : '') + '，可用于打分）' : '未通过 ✗（先修判定器，不许用它打分）'))
  fs.writeFileSync(path.join(__dirname, 'selftest.json'), JSON.stringify({ at: new Date().toISOString(), ok, python: NO_PY ? null : PY_CMD.join(' '), rows }, null, 1), 'utf8')
  console.log('WROTE evidence/ptc-lab/selftest.json')
  process.exit(ok ? 0 : 1)
}

// 复用出口：宿主内测试台会把本文件（截到此行以上）用 require 垫片求值后取 TASKS/verdict。
module.exports = { TASKS, verdict, mk, read, exists, runNode, runPython, PY_CMD: PY_CMD ? PY_CMD.join(' ') : null }

const cmd = process.argv[2]
if (cmd === 'selftest') selftest()
else {
  console.log('题目清单（' + TASKS.length + ' 题）：')
  for (const t of TASKS) console.log('  ' + t.id.padEnd(15) + t.domain)
  console.log('')
  console.log('用法：node evidence/ptc-lab/tasks.cjs selftest   ← 判定器自证')
}
