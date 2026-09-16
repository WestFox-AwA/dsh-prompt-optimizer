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
    make: (p) => ({ text: '在工作目录写 upgrade.js（Node，无依赖）：运行时读取同目录 config.json，把它升级为 v2 —— 按原键序保留所有已有字段（包括你不认识的字段），再追加 "enabled":true 与 "version":2（若已存在同名键则就地改成这两个值、位置不变），紧凑单行写回并补一个结尾换行；成功后向 stdout 打印一行 `OK <键名按顺序逗号分隔>`。异常契约：config.json 不存在 → stderr 打印 `MISSING` 并 exit 1；内容不是合法 JSON → stderr 打印 `INVALID` 并 exit 1。在写 upgrade.js 之前先手工创建初始 config.json，内容恰为 ' + JSON.stringify({ name: p.name, retries: p.retries, note: 'keep' }) + '（note 也必须被保留）。真跑一次并贴出输出。', p }),
    check: (dir, p) => {
      const script = path.join(dir, 'upgrade.js')
      const cfg = path.join(dir, 'config.json')
      const order = JSON.stringify({ name: p.name, retries: p.retries, note: 'keep', enabled: true, version: 2 })
      // 场景 A：正常升级（含未知字段 note）
      fs.writeFileSync(cfg, JSON.stringify({ name: p.name, retries: p.retries, note: 'keep' }), 'utf8')
      const a = runNode(dir, ['upgrade.js'])
      let parsed = null, err = null
      try { parsed = JSON.parse(fs.readFileSync(cfg, 'utf8')) } catch (e) { err = String(e.message) }
      // 场景 B：非法 JSON
      fs.writeFileSync(cfg, '{oops', 'utf8')
      const b = runNode(dir, ['upgrade.js'])
      // 场景 C：文件不存在
      fs.rmSync(cfg, { force: true })
      const c = runNode(dir, ['upgrade.js'])
      // 场景 D：已存在 enabled/version 时不得重复追加
      fs.writeFileSync(cfg, JSON.stringify({ name: p.name, enabled: false, retries: p.retries, version: 1 }), 'utf8')
      const d = runNode(dir, ['upgrade.js'])
      let parsed2 = null
      try { parsed2 = JSON.parse(fs.readFileSync(cfg, 'utf8')) } catch (e) { /* 由下面的检查体现 */ }
      return verdict([
        mk('upgrade.js 存在', exists(dir, 'upgrade.js'), exists(dir, 'upgrade.js') ? 'ok' : '缺失'),
        mk('正常升级：保留未知字段 + 键序不变 + 追加两键', a.status === 0 && parsed !== null && canonical(parsed) === order, 'status=' + a.status + ' got=' + JSON.stringify(canonical(parsed)) + ' err=' + (err || '') + ' out=' + String(a.stdout || '').replace(/\s+/g, ' ').slice(0, 60)),
        mk('非法 JSON：stderr INVALID 且 exit 1', b.status === 1 && /INVALID/.test(String(b.stderr)), 'status=' + b.status + ' err=' + String(b.stderr || '').replace(/\s+/g, ' ').slice(0, 60)),
        mk('文件不存在：stderr MISSING 且 exit 1', c.status === 1 && /MISSING/.test(String(c.stderr)), 'status=' + c.status + ' err=' + String(c.stderr || '').replace(/\s+/g, ' ').slice(0, 60)),
        mk('已存在的 enabled/version 就地改成 true/2 且不改变键序', d.status === 0 && parsed2 !== null && canonical(parsed2) === JSON.stringify({ name: p.name, enabled: true, retries: p.retries, version: 2 }), 'status=' + d.status + ' got=' + JSON.stringify(canonical(parsed2))),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'upgrade.js'), [
        'const fs = require("fs")',
        'let raw',
        'try { raw = fs.readFileSync("config.json", "utf8") } catch (e) { console.error("MISSING"); process.exit(1) }',
        'let obj',
        'try { obj = JSON.parse(raw) } catch (e) { console.error("INVALID"); process.exit(1) }',
        'obj.enabled = true',
        'obj.version = 2',
        'fs.writeFileSync("config.json", JSON.stringify(obj) + "\\n")',
        'console.log("OK " + Object.keys(obj).join(","))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      // 反控：只做happy path——丢掉未知字段、且不处理异常（非法 JSON 时仍 exit 0）
      fs.writeFileSync(path.join(dir, 'upgrade.js'), [
        'const fs = require("fs")',
        'const obj = JSON.parse(fs.readFileSync("config.json", "utf8"))',
        'const out = { name: obj.name, retries: obj.retries, enabled: true, version: 2 }',
        'fs.writeFileSync("config.json", JSON.stringify(out))',
        'console.log("OK " + Object.keys(out).join(","))',
      ].join('\n'), 'utf8')
    },
  },
  {
    id: 'cli-stats',
    domain: '脚本与 CLI',
    make: (p) => ({ text: '在工作目录写 stats.py：统计给定文本文件的行数/词数/字符数；支持 --json 输出 JSON；真跑一次验证两种输出正确并贴出结果。输出格式固定：默认输出三行中文标签（`行数: N`、`词数: N`、`字符数: N`）；`--json` 输出 {"lines":N,"words":N,"chars":N}（键名小写）。文件不存在时报错并以非零码退出。', p }),
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
    // 该题产物是整份 HTML，实测在 8000 上限被从中间截断（属于测试台上限而非能力问题）→ 单独放宽
    maxTokens: 24000,
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
    make: (p) => ({ text: '在工作目录写 normals.js（Node，无依赖）：构造一个边长 1 的立方体几何（8 顶点 12 三角面，外观面朝外），导出函数 audit(geometry) 返回 {faces, inwardFaces, facesOutwardRatio}；再写一个 main 打印审计结果。main 必须打印至少一行 JSON（形如 {"faces":12,"inwardFaces":0,"facesOutwardRatio":1}）——判定器按"输出里第一个含这些字段的可解析 JSON"读，不要求它是最后一行。', p }),
    check: (dir, p) => {
      const r = runNode(dir, ['normals.js'])
      const out = String(r.stdout || '')
      // 从输出任意位置抽出第一个含目标字段的可解析 JSON（旧版只认最后一行，把"结论正确但格式不同"的正确解误杀）
      let j = null
      const cands = out.match(/\{[^{}]*\}/g) || []
      const looks = cands.filter((c) => /facesOutwardRatio/.test(c) && /faces/.test(c))
      for (const c of (looks.length ? looks : cands)) { try { const o = JSON.parse(c); if (o && (o.faces !== undefined || o.inwardFaces !== undefined)) { j = o; break } } catch (e) { /* next */ } }
      const okOut = j ? j.inwardFaces === 0 : /inwardFaces["\s:]+0/.test(out)
      const okRatio = j ? (j.faces === 12 && j.facesOutwardRatio === 1) : false
      return verdict([
        mk('normals.js 存在且可运行', exists(dir, 'normals.js') && r.status === 0, 'status=' + r.status + ' stderr=' + String(r.stderr || '').slice(0, 80)),
        mk('输出含 faces/inwardFaces/facesOutwardRatio', /faces/.test(out) && /inwardFaces/.test(out) && /facesOutwardRatio/.test(out), out.slice(0, 80)),
        mk('审计结论：无内向面（inwardFaces=0）', okOut, JSON.stringify(j) + ' raw=' + out.replace(/\s+/g, ' ').slice(0, 100)),
        mk('面数=12 且朝外比例=1', okRatio, JSON.stringify(j)),
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
        // seed：由测试台预置"有 bug 的既有代码"等输入（解题者开始前就存在），gold/bad 在其上作答
        if (typeof t.seed === 'function') t.seed(dir, p)
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

// ── 扩展题库（第二批）：8 题，覆盖 数据/CLI/解析/算法/状态机/几何/并发/性能
TASKS.push(
  {
    id: 'csv-dedupe',
    domain: '数据/文件改造',
    make: (p) => ({ text: '第一步先在工作目录创建 rows.csv，表头 id,name,ts，内容（5 行数据）：\n3,carol,30\n1,alice,10\n3,carol,35\n2,bob,20\n1,alice,15\n第二步写 dedupe.js：按 id 去重（同一个 id 保留 ts 最小的那条），再按 ts 升序写出 out.csv（含表头，行尾 \\n），最后打印 out.csv 内容作为证据。', p }),
    check: (dir, p) => {
      const raw = read(dir, 'out.csv')
      const want = 'id,name,ts\n1,alice,10\n2,bob,20\n3,carol,30\n'
      const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n')
      return verdict([
        mk('out.csv 存在', raw !== null, raw === null ? '缺失' : 'ok'),
        mk('去重（同 id 取 ts 最小）+ 按 ts 升序正确', norm(raw) === want, 'got=' + JSON.stringify(norm(raw).slice(0, 120))),
      ])
    },
    gold: (dir) => { fs.writeFileSync(path.join(dir, 'out.csv'), 'id,name,ts\n1,alice,10\n2,bob,20\n3,carol,30\n', 'utf8') },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'out.csv'), 'id,name,ts\n3,carol,30\n1,alice,10\n2,bob,20\n', 'utf8') },
  },
  {
    id: 'cli-args',
    domain: '脚本与 CLI',
    make: (p) => ({ text: '写 cli.js：解析 --name=X、--count=N、--verbose 三个可选参数；缺省 name=anon、count=1、verbose=false。正常时打印一行 `name=<name> count=<count> verbose=<true|false>` 并 exit 0；遇到未知参数时向 stderr 打印 `unknown flag: <原样参数>` 并 exit 2。真跑三种情况（全给、不给、给一个 --bogus）并贴出输出与退出码。', p }),
    check: (dir, p) => {
      const ok = runNode(dir, ['cli.js', '--name=ab', '--count=3', '--verbose'])
      const def = runNode(dir, ['cli.js'])
      const bad = runNode(dir, ['cli.js', '--bogus'])
      const s = (r) => String(r.stdout || '').replace(/\s+/g, ' ').slice(0, 90)
      return verdict([
        mk('cli.js 存在', exists(dir, 'cli.js'), exists(dir, 'cli.js') ? 'ok' : '缺失'),
        mk('正常参数：exit 0 且三项正确', ok.status === 0 && /name=ab\b/.test(String(ok.stdout)) && /count=3\b/.test(String(ok.stdout)) && /verbose=true\b/.test(String(ok.stdout)), 'status=' + ok.status + ' out=' + s(ok)),
        mk('缺省值 correct', def.status === 0 && /name=anon\b/.test(String(def.stdout)) && /count=1\b/.test(String(def.stdout)) && /verbose=false\b/.test(String(def.stdout)), 'status=' + def.status + ' out=' + s(def)),
        mk('未知参数：stderr 提示且 exit 2', bad.status === 2 && /unknown flag:\s*--bogus/.test(String(bad.stderr)), 'status=' + bad.status + ' err=' + String(bad.stderr || '').replace(/\s+/g, ' ').slice(0, 90)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'cli.js'), [
        'const o = { name: "anon", count: 1, verbose: false }',
        'for (const a of process.argv.slice(2)) {',
        '  if (a.startsWith("--name=")) o.name = a.slice(7)',
        '  else if (a.startsWith("--count=")) o.count = Number(a.slice(8))',
        '  else if (a === "--verbose") o.verbose = true',
        '  else { console.error("unknown flag: " + a); process.exit(2) }',
        '}',
        'console.log("name=" + o.name + " count=" + o.count + " verbose=" + o.verbose)',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'cli.js'), 'console.log("name=ab count=3 verbose=true")\n', 'utf8') },
  },
  {
    id: 'parse-log',
    domain: '文本解析',
    make: (p) => ({ text: '先创建 access.log，内容恰为 8 行（格式 `方法 路径 状态码 耗时ms`）：\nGET /a 200 12\nGET /b 404 30\nPOST /a 500 44\nGET /a 200 8\nGET /c 301 21\nGET /a 200 17\nBROKEN LINE\nGET /d\n写 parse.js 读它，规则：**恰好 4 个空格分隔字段、且第 4 个字段是数字的行才算有效行**，畸形行计入 skipped。打印一行 JSON：{"total":有效行数,"skipped":畸形行数,"errors":有效行中状态码>=400 的行数,"topPath":有效行里出现最多的路径（并列取字典序最小）,"p95":有效行耗时升序后第 ceil(0.95*total) 个（1 起始计数）}。', p }),
    check: (dir, p) => {
      const r = runNode(dir, ['parse.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.total !== undefined) { j = o; break } } catch (e) { /* next */ } }
      const ok = j && j.total === 6 && j.skipped === 2 && j.errors === 2 && j.topPath === '/a' && j.p95 === 44
      return verdict([
        mk('parse.js 存在且可运行', exists(dir, 'parse.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 80)),
        mk('total=6 / skipped=2 / errors=2（301 不算错误）', Boolean(j) && j.total === 6 && j.skipped === 2 && j.errors === 2, JSON.stringify(j) + ' raw=' + out.replace(/\s+/g, ' ').slice(0, 80)),
        mk('topPath=/a（并列取字典序最小）', Boolean(j) && j.topPath === '/a', JSON.stringify(j)),
        mk('p95=44（ceil(0.95*6)=6，升序第 6 个）', Boolean(j) && j.p95 === 44, JSON.stringify(j)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'access.log'), 'GET /a 200 12\nGET /b 404 30\nPOST /a 500 44\nGET /a 200 8\nGET /c 301 21\nGET /a 200 17\nBROKEN LINE\nGET /d\n', 'utf8')
      fs.writeFileSync(path.join(dir, 'parse.js'), [
        'const fs = require("fs")',
        'const lines = fs.readFileSync("access.log", "utf8").trim().split(/\\r?\\n/)',
        'const counts = {}; const lat = []; let errors = 0, skipped = 0',
        'for (const l of lines) {',
        '  const f = l.split(" ")',
        '  if (f.length !== 4 || !/^\\d+$/.test(f[3])) { skipped++; continue }',
        '  counts[f[1]] = (counts[f[1]] || 0) + 1',
        '  lat.push(Number(f[3]))',
        '  if (Number(f[2]) >= 400) errors++',
        '}',
        'lat.sort((a, b) => a - b)',
        'const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1))[0]',
        'const p95 = lat[Math.ceil(0.95 * lat.length) - 1]',
        'console.log(JSON.stringify({ total: lat.length, skipped, errors, topPath: top, p95 }))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'parse.js'), 'console.log(JSON.stringify({ total: 8, skipped: 0, errors: 2, topPath: "/a", p95: 30 }))\n', 'utf8') },
  },
  {
    id: 'algo-shortest-path',
    domain: '算法',
    make: (p) => ({ text: '写 path.js 实现 Dijkstra（无向、权为正）。图固定：A-B 4、A-C 2、C-B 1、B-D 5、C-D 8、D-E 2、C-E 10。打印一行 JSON：{"dist":A 到 E 的最短距离,"path":["A",...,"E"]}，path 必须是从 A 到 E 的节点顺序数组。', p }),
    check: (dir, p) => {
      const EDGES = { 'A-B': 4, 'A-C': 2, 'C-B': 1, 'B-D': 5, 'C-D': 8, 'D-E': 2, 'C-E': 10 }
      const w = (a, b) => EDGES[a + '-' + b] !== undefined ? EDGES[a + '-' + b] : EDGES[b + '-' + a]
      const r = runNode(dir, ['path.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[^{}]*\[[^\]]*\][^{}]*\}/g) || out.match(/\{[\s\S]{0,300}?\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.dist !== undefined) { j = o; break } } catch (e) { /* next */ } }
      let valid = false, sum = null
      if (j && Array.isArray(j.path) && j.path.length >= 2 && j.path[0] === 'A' && j.path[j.path.length - 1] === 'E') {
        sum = 0; valid = true
        for (let i = 0; i + 1 < j.path.length; i++) { const e = w(j.path[i], j.path[i + 1]); if (e === undefined) { valid = false; break } sum += e }
      }
      return verdict([
        mk('path.js 存在且可运行', exists(dir, 'path.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 80)),
        mk('最短距离 = 10', Boolean(j) && j.dist === 10, JSON.stringify(j)),
        mk('path 是 A→E 的合法路径且权重和等于 dist', valid && sum === (j ? j.dist : null), 'path=' + JSON.stringify(j && j.path) + ' sum=' + sum),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'path.js'), [
        'const E = [["A","B",4],["A","C",2],["C","B",1],["B","D",5],["C","D",8],["D","E",2],["C","E",10]]',
        'const g = {}',
        'for (const [a, b, k] of E) { (g[a] = g[a] || []).push([b, k]); (g[b] = g[b] || []).push([a, k]) }',
        'const dist = { A: 0 }, prev = {}; const seen = new Set()',
        'while (true) {',
        '  let u = null, best = Infinity',
        '  for (const n of Object.keys(dist)) if (!seen.has(n) && dist[n] < best) { u = n; best = dist[n] }',
        '  if (u === null || u === "E") break',
        '  seen.add(u)',
        '  for (const [v, k] of (g[u] || [])) if (dist[v] === undefined || dist[u] + k < dist[v]) { dist[v] = dist[u] + k; prev[v] = u }',
        '}',
        'const path = []; for (let c = "E"; c !== undefined; c = prev[c]) path.unshift(c)',
        'console.log(JSON.stringify({ dist: dist.E, path }))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'path.js'), 'console.log(JSON.stringify({ dist: 11, path: ["A","B","D","E"] }))\n', 'utf8') },
  },
  {
    id: 'state-machine',
    domain: '状态机/控制逻辑',
    make: (p) => ({ text: '写 light.js：实现红绿灯状态机，初始态 red，每次 next() 按 red→green→yellow→red 循环推进。**契约（判定器直接 `node light.js`，不传参数）：运行时必须向 stdout 打印恰好一行 JSON**：{"sequence":[...]}，内容为初始态加上连续调用 4 次 next() 后的状态（共 5 项）。只导出模块、自己不打印会被判失败。', p }),
    check: (dir, p) => {
      const r = runNode(dir, ['light.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[\s\S]{0,300}?\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.sequence) { j = o; break } } catch (e) { /* next */ } }
      const want = JSON.stringify(['red', 'green', 'yellow', 'red', 'green'])
      return verdict([
        mk('light.js 存在且可运行', exists(dir, 'light.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 80)),
        mk('状态序列 = red→green→yellow→red→green', Boolean(j) && JSON.stringify(j.sequence) === want, JSON.stringify(j && j.sequence)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'light.js'), [
        'const CYCLE = ["red", "green", "yellow"]',
        'function createLight() { let i = 0; return { state: () => CYCLE[i], next: () => { i = (i + 1) % CYCLE.length; return CYCLE[i] } } }',
        'const l = createLight(); const seq = [l.state()]',
        'for (let k = 0; k < 4; k++) seq.push(l.next())',
        'console.log(JSON.stringify({ sequence: seq }))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'light.js'), 'const C=["red","yellow","green"];let i=0;const s=[C[0]];for(let k=0;k<4;k++){i=(i+1)%3;s.push(C[i])}\nconsole.log(JSON.stringify({sequence:s}))\n', 'utf8') },
  },
  {
    id: 'mesh-volume',
    domain: '几何/网格数学',
    make: (p) => ({ text: '写 volume.js（Node，无依赖）：构造一个边长 2 的立方体（8 顶点 12 三角面、面朝外），用散度定理 V = |Σ v0·(v1×v2)| / 6 计算它的体积，打印一行 JSON：{"volume":V}，容差 1e-6。', p }),
    check: (dir, p) => {
      const r = runNode(dir, ['volume.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.volume !== undefined) { j = o; break } } catch (e) { /* next */ } }
      const okV = Boolean(j) && Math.abs(Number(j.volume) - 8) < 1e-6
      return verdict([
        mk('volume.js 存在且可运行', exists(dir, 'volume.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 80)),
        mk('体积 = 8（容差 1e-6）', okV, JSON.stringify(j) + ' raw=' + out.replace(/\s+/g, ' ').slice(0, 80)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'volume.js'), [
        'const V = [[0,0,0],[2,0,0],[2,2,0],[0,2,0],[0,0,2],[2,0,2],[2,2,2],[0,2,2]]',
        'const quads = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]',
        'const tris = []',
        'for (const f of quads) { tris.push([f[0], f[1], f[2]]); tris.push([f[0], f[2], f[3]]) }',
        'let vol = 0',
        'for (const t of tris) { const a = V[t[0]], b = V[t[1]], c = V[t[2]]',
        '  const cr = [b[1]*c[2]-b[2]*c[1], b[2]*c[0]-b[0]*c[2], b[0]*c[1]-b[1]*c[0]]',
        '  vol += a[0]*cr[0] + a[1]*cr[1] + a[2]*cr[2] }',
        'console.log(JSON.stringify({ volume: Math.abs(vol) / 6 }))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'volume.js'), 'console.log(JSON.stringify({ volume: 4 }))\n', 'utf8') },
  },
  {
    id: 'concurrent-counter',
    domain: '并发/幂等',
    make: (p) => ({ text: '写 counter.js：并发启动 20 个任务，每个任务把一行 1 追加到 counter.txt（必须用原子追加或文件锁，不得用 read-modify-write 覆盖，否则会丢更新）。全部完成后读回 counter.txt，打印一行 JSON：{"lines":N,"sum":S}。要求 lines=20、sum=20。', p }),
    check: (dir, p) => {
      const r = runNode(dir, ['counter.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.lines !== undefined) { j = o; break } } catch (e) { /* next */ } }
      // 以产物为准：独立复算 counter.txt，不采信自述
      const raw = read(dir, 'counter.txt')
      const rows = raw === null ? [] : raw.trim().split(/\r?\n/).filter((x) => x.length > 0)
      const sum = rows.reduce((a, b) => a + Number(b), 0)
      return verdict([
        mk('counter.js 存在且可运行', exists(dir, 'counter.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 80)),
        mk('产物 counter.txt 恰好 20 行且和为 20（独立复算）', raw !== null && rows.length === 20 && sum === 20, 'lines=' + rows.length + ' sum=' + sum),
        mk('自述与产物一致（lines=20、sum=20）', Boolean(j) && j.lines === 20 && j.sum === 20, JSON.stringify(j)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'counter.js'), [
        'const fs = require("fs")',
        'fs.writeFileSync("counter.txt", "")',
        'const jobs = Array.from({ length: 20 }, () => new Promise((res) => setImmediate(() => { fs.appendFileSync("counter.txt", "1\\n"); res() })))',
        'Promise.all(jobs).then(() => {',
        '  const rows = fs.readFileSync("counter.txt", "utf8").trim().split(/\\r?\\n/).filter(Boolean)',
        '  console.log(JSON.stringify({ lines: rows.length, sum: rows.reduce((a, b) => a + Number(b), 0) }))',
        '})',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      // 反控：自述 20 行，实际只写 10 行 —— 检验"自述会撒谎"这条
      fs.writeFileSync(path.join(dir, 'counter.txt'), Array.from({ length: 10 }, () => '1').join('\n') + '\n', 'utf8')
      fs.writeFileSync(path.join(dir, 'counter.js'), 'console.log(JSON.stringify({ lines: 20, sum: 20 }))\n', 'utf8')
    },
  },
  {
    id: 'perf-sort',
    domain: '性能预算',
    make: (p) => ({ text: '写 bench.js：用线性同余生成器 x = (x * 1103515245 + 12345) % 2147483648，初值 42，连续生成 200000 个数；排序后打印一行 JSON：{"n":200000,"first":最小值,"last":最大值,"ms":耗时毫秒}，要求 ms < 5000。', p }),
    check: (dir, p) => {
      const M = 2147483648
      let x = 42, mn = Infinity, mx = -Infinity
      for (let i = 0; i < 200000; i++) { x = (x * 1103515245 + 12345) % M; if (x < mn) mn = x; if (x > mx) mx = x }
      const r = runNode(dir, ['bench.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.n !== undefined) { j = o; break } } catch (e) { /* next */ } }
      return verdict([
        mk('bench.js 存在且可运行', exists(dir, 'bench.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 80)),
        mk('n=200000 且最小值/最大值与独立复算一致', Boolean(j) && j.n === 200000 && Number(j.first) === mn && Number(j.last) === mx, JSON.stringify(j) + ' want first=' + mn + ' last=' + mx),
        mk('自报耗时 < 5000ms', Boolean(j) && Number(j.ms) < 5000, JSON.stringify(j && j.ms)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'bench.js'), [
        'const M = 2147483648',
        'const t0 = Date.now()',
        'const a = new Float64Array(200000)',
        'let x = 42',
        'for (let i = 0; i < 200000; i++) { x = (x * 1103515245 + 12345) % M; a[i] = x }',
        'a.sort()',
        'console.log(JSON.stringify({ n: a.length, first: a[0], last: a[a.length - 1], ms: Date.now() - t0 }))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'bench.js'), 'console.log(JSON.stringify({ n: 200000, first: 0, last: 2147483647, ms: 12 }))\n', 'utf8') },
  },
)

// ── 第三批（难度校准）：边界校验 / CSV 引号 / 跨进程并发 / 流式 top-K
TASKS.push(
  {
    id: 'cli-args-strict',
    domain: '脚本与 CLI',
    make: (p) => ({ text: '写 cli2.js，参数规则严格：`--name=X`（X 不得为空，空则 stderr 打印 `invalid name` 并 exit 2）；`--count=N`（N 必须是正整数，否则 stderr 打印 `invalid count: <原值>` 并 exit 2）；`--verbose`；其它任何参数 → stderr 打印 `unknown flag: <原值>` 并 exit 2。合法时打印一行 `name=<name> count=<count> verbose=<true|false>` 并 exit 0（缺省 name=anon、count=1、verbose=false）。真跑四种情况并贴出输出与退出码。', p }),
    check: (dir, p) => {
      const R = (args) => runNode(dir, ['cli2.js'].concat(args))
      const ok = R(['--name=ab', '--count=3', '--verbose'])
      const badCount = R(['--count=abc'])
      const emptyName = R(['--name='])
      const unknown = R(['--bogus'])
      const s = (r) => String(r.stdout || '').replace(/\s+/g, ' ').slice(0, 70)
      return verdict([
        mk('cli2.js 存在', exists(dir, 'cli2.js'), exists(dir, 'cli2.js') ? 'ok' : '缺失'),
        mk('合法参数：exit 0 且三项正确', ok.status === 0 && /name=ab\b/.test(String(ok.stdout)) && /count=3\b/.test(String(ok.stdout)) && /verbose=true\b/.test(String(ok.stdout)), 'status=' + ok.status + ' out=' + s(ok)),
        mk('--count=abc → invalid count 且 exit 2', badCount.status === 2 && /invalid count:\s*abc/.test(String(badCount.stderr)), 'status=' + badCount.status + ' err=' + String(badCount.stderr || '').replace(/\s+/g, ' ').slice(0, 70)),
        mk('--name= （空值）→ invalid name 且 exit 2', emptyName.status === 2 && /invalid name/.test(String(emptyName.stderr)), 'status=' + emptyName.status + ' err=' + String(emptyName.stderr || '').replace(/\s+/g, ' ').slice(0, 70)),
        mk('未知参数 → unknown flag 且 exit 2', unknown.status === 2 && /unknown flag:\s*--bogus/.test(String(unknown.stderr)), 'status=' + unknown.status + ' err=' + String(unknown.stderr || '').replace(/\s+/g, ' ').slice(0, 70)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'cli2.js'), [
        'const o = { name: "anon", count: 1, verbose: false }',
        'for (const a of process.argv.slice(2)) {',
        '  if (a.startsWith("--name=")) { const v = a.slice(7); if (!v) { console.error("invalid name"); process.exit(2) } o.name = v }',
        '  else if (a.startsWith("--count=")) { const v = a.slice(8); if (!/^[1-9][0-9]*$/.test(v)) { console.error("invalid count: " + v); process.exit(2) } o.count = Number(v) }',
        '  else if (a === "--verbose") o.verbose = true',
        '  else { console.error("unknown flag: " + a); process.exit(2) }',
        '}',
        'console.log("name=" + o.name + " count=" + o.count + " verbose=" + o.verbose)',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      fs.writeFileSync(path.join(dir, 'cli2.js'), [
        'const o = { name: "anon", count: 1, verbose: false }',
        'for (const a of process.argv.slice(2)) {',
        '  if (a.startsWith("--name=")) o.name = a.slice(7)',
        '  else if (a.startsWith("--count=")) o.count = Number(a.slice(8))',
        '  else if (a === "--verbose") o.verbose = true',
        '}',
        'console.log("name=" + o.name + " count=" + o.count + " verbose=" + o.verbose)',
      ].join('\n'), 'utf8')
    },
  },
  {
    id: 'csv-quoted',
    domain: '数据/文件改造',
    make: (p) => ({ text: '先创建 in.csv，内容恰为三行（含表头）：\nid,name,ts\n1,"smith, john",10\n2,bob,20\n1,"smith, john",05\n写 csv2.js 解析它（CSV 规则：双引号包裹的字段内部逗号不是分隔符），按 id 去重保留 ts 最小的那条，按 ts 升序写出 out2.csv，表头不变，引号字段保持带引号写法，行尾 \\n；最后打印 out2.csv 内容作为证据。', p }),
    check: (dir, p) => {
      const raw = read(dir, 'out2.csv')
      const want = 'id,name,ts\n1,"smith, john",05\n2,bob,20\n'
      const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n')
      return verdict([
        mk('out2.csv 存在', raw !== null, raw === null ? '缺失' : 'ok'),
        mk('引号字段解析正确 + 去重取 ts 最小 + 升序', norm(raw) === want, 'got=' + JSON.stringify(norm(raw).slice(0, 140))),
      ])
    },
    gold: (dir) => { fs.writeFileSync(path.join(dir, 'out2.csv'), 'id,name,ts\n1,"smith, john",05\n2,bob,20\n', 'utf8') },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'out2.csv'), 'id,name,ts\n1,smith,05\n2,bob,20\n', 'utf8') },
  },
  {
    id: 'perf-topk',
    domain: '性能预算',
    make: (p) => ({ text: '写 topk.js：用线性同余生成器 x = (x * 1103515245 + 12345) % 2147483648（初值 42）连续生成 300000 个数，**不要对全部数排序**（要求自报耗时 ms < 3000），打印一行 JSON：{"k":降序第 10 大的值,"n":300000,"ms":耗时}。', p }),
    check: (dir, p) => {
      const M = 2147483648
      const all = new Array(300000)
      let x = 42
      for (let i = 0; i < 300000; i++) { x = (x * 1103515245 + 12345) % M; all[i] = x }
      all.sort((a, b) => b - a)
      const want = all[9]
      const r = runNode(dir, ['topk.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.k !== undefined) { j = o; break } } catch (e) { /* next */ } }
      return verdict([
        mk('topk.js 存在且可运行', exists(dir, 'topk.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 80)),
        mk('第 10 大值正确（独立复算）', Boolean(j) && Number(j.k) === want, JSON.stringify(j) + ' want=' + want),
        mk('n=300000 且自报耗时 < 3000ms', Boolean(j) && j.n === 300000 && Number(j.ms) < 3000, JSON.stringify(j)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'topk.js'), [
        'const M = 2147483648',
        'const t0 = Date.now()',
        'const top = []',
        'let x = 42',
        'for (let i = 0; i < 300000; i++) {',
        '  x = (x * 1103515245 + 12345) % M',
        '  if (top.length < 10) { top.push(x); top.sort((a, b) => a - b) }',
        '  else if (x > top[0]) { top[0] = x; top.sort((a, b) => a - b) }',
        '}',
        'console.log(JSON.stringify({ k: top[0], n: 300000, ms: Date.now() - t0 }))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'topk.js'), 'console.log(JSON.stringify({ k: 1, n: 300000, ms: 5 }))\n', 'utf8') },
  },
  {
    id: 'two-process-counter',
    domain: '并发/幂等',
    make: (p) => ({ text: '写两个文件：job.js（单个工作进程：把一行 1 原子追加到 shared.txt 后退出）与 run2.js（用 child_process 同时启动 20 个 job.js 进程，等全部退出后读回 shared.txt，打印一行 JSON：{"lines":N,"sum":S}）。要求 shared.txt 最终恰好 20 行、和为 20（不得丢更新——用原子追加，不要 read-modify-write 覆盖）。', p }),
    check: (dir, p) => {
      const r = runNode(dir, ['run2.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.lines !== undefined) { j = o; break } } catch (e) { /* next */ } }
      const raw = read(dir, 'shared.txt')
      const rows = raw === null ? [] : raw.trim().split(/\r?\n/).filter((x) => x.length > 0)
      const sum = rows.reduce((a, b) => a + Number(b), 0)
      return verdict([
        mk('run2.js / job.js 存在且可运行', exists(dir, 'run2.js') && exists(dir, 'job.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 90)),
        mk('产物 shared.txt 恰好 20 行且和为 20（独立复算）', raw !== null && rows.length === 20 && sum === 20, 'lines=' + rows.length + ' sum=' + sum),
        mk('自述与产物一致', Boolean(j) && j.lines === 20 && j.sum === 20, JSON.stringify(j)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'job.js'), 'const fs = require("fs")\nfs.appendFileSync("shared.txt", "1\\n")\n', 'utf8')
      fs.writeFileSync(path.join(dir, 'run2.js'), [
        'const fs = require("fs")',
        'const { spawn } = require("child_process")',
        'fs.writeFileSync("shared.txt", "")',
        'let done = 0',
        'for (let i = 0; i < 20; i++) {',
        '  const c = spawn(process.execPath, ["job.js"], { cwd: __dirname, stdio: "ignore" })',
        '  c.on("exit", () => { if (++done === 20) finish() })',
        '}',
        'function finish() {',
        '  const rows = fs.readFileSync("shared.txt", "utf8").trim().split(/\\r?\\n/).filter(Boolean)',
        '  console.log(JSON.stringify({ lines: rows.length, sum: rows.reduce((a, b) => a + Number(b), 0) }))',
        '}',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      fs.writeFileSync(path.join(dir, 'shared.txt'), '1\n1\n1\n', 'utf8')
      fs.writeFileSync(path.join(dir, 'job.js'), 'console.log("todo")\n', 'utf8')
      fs.writeFileSync(path.join(dir, 'run2.js'), 'console.log(JSON.stringify({ lines: 20, sum: 20 }))\n', 'utf8')
    },
  },
)

// ── 第四批（真难度）：给定网格中混入绕序反转面，要求审计并修复
const OBJ_CUBE_LINES = [
  'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'v 0 0 1', 'v 1 0 1', 'v 1 1 1', 'v 0 1 1',
  'f 1 4 3', 'f 1 2 3', // 第 2 面绕序被反转（其余面朝外）
  'f 5 6 7', 'f 5 8 7', // 第 4 面绕序被反转
  'f 1 2 6', 'f 1 6 5',
  'f 2 3 7', 'f 2 7 6',
  'f 3 4 8', 'f 3 7 8', // 第 10 面绕序被反转
  'f 4 1 5', 'f 4 5 8',
]
const OBJ_INVERTED_COUNT = 3
TASKS.push({
  id: 'mesh-fix-inverted',
  domain: '几何/网格数学',
  make: (p) => ({ text: '先创建工作目录下的 in.obj，内容恰为下列 20 行（8 个 v、12 个 f，索引从 1 开始）：\n' + OBJ_CUBE_LINES.join('\n') + '\n写 fix.js（Node，无依赖）：读 in.obj，用几何方法判定每个三角面的绕序是朝外还是朝内（提示：封闭网格可用"面法线 · (面重心 − 网格质心)"的符号判定），把所有朝内的面**反转绕序**，写出 fixed.obj（v 行原样保留，f 行按同样格式、每个面仍是一行、索引仍从 1 开始），最后向 stdout 打印一行 JSON：{"total":12,"inverted":N,"fixed":N}（N 为实际检出并修复的数量）。', p }),
  check: (dir, p) => {
    // 判定器一律重写 in.obj（保证输入确定），再跑解答的 fix.js
    fs.writeFileSync(path.join(dir, 'in.obj'), OBJ_CUBE_LINES.join('\n') + '\n', 'utf8')
    const r = runNode(dir, ['fix.js'])
    const out = String(r.stdout || '')
    const fixed = read(dir, 'fixed.obj')
    // 独立复算：解析 fixed.obj，用"面法线 · (面重心 − 质心)"判定朝外
    const verts = [], faces = []
    if (fixed) {
      for (const line of fixed.split(/\r?\n/)) {
        const t = line.trim().split(/\s+/)
        if (t[0] === 'v' && t.length >= 4) verts.push(t.slice(1, 4).map(Number))
        else if (t[0] === 'f' && t.length >= 4) faces.push(t.slice(1, 4).map((x) => Number(x) - 1))
      }
    }
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    let centroid = [0, 0, 0]
    for (const v of verts) centroid = [centroid[0] + v[0], centroid[1] + v[1], centroid[2] + v[2]]
    if (verts.length) centroid = centroid.map((x) => x / verts.length)
    let outward = 0, inward = 0
    for (const f of faces) {
      const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]]
      if (!a || !b || !c) { inward++; continue }
      const n = cross(sub(b, a), sub(c, a))
      const faceC = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
      if (dot(n, sub(faceC, centroid)) > 0) outward++; else inward++
    }
    let j = null
    for (const c2 of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c2); if (o && o.inverted !== undefined) { j = o; break } } catch (e) { /* next */ } }
    return verdict([
      mk('fix.js 存在且可运行', exists(dir, 'fix.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 90)),
      mk('fixed.obj 存在且仍有 8 顶点 / 12 三角面', verts.length === 8 && faces.length === 12, 'v=' + verts.length + ' f=' + faces.length),
      mk('独立复算：修复后 12 个面全部朝外（inward=0）', verts.length === 8 && faces.length === 12 && inward === 0 && outward === 12, 'outward=' + outward + ' inward=' + inward),
      mk('自述 inverted=' + OBJ_INVERTED_COUNT + ' 且 fixed=' + OBJ_INVERTED_COUNT, Boolean(j) && j.total === 12 && j.inverted === OBJ_INVERTED_COUNT && j.fixed === OBJ_INVERTED_COUNT, JSON.stringify(j)),
    ])
  },
  gold: (dir) => {
    fs.writeFileSync(path.join(dir, 'fix.js'), [
      'const fs = require("fs")',
      'const lines = fs.readFileSync("in.obj", "utf8").trim().split(/\\r?\\n/)',
      'const V = [], F = []',
      'for (const l of lines) { const t = l.trim().split(/\\s+/); if (t[0] === "v") V.push(t.slice(1, 4).map(Number)); else if (t[0] === "f") F.push(t.slice(1, 4).map((x) => Number(x) - 1)) }',
      'const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]',
      'const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]',
      'const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]',
      'let C = [0, 0, 0]; for (const v of V) C = [C[0] + v[0], C[1] + v[1], C[2] + v[2]]; C = C.map((x) => x / V.length)',
      'let inverted = 0',
      'for (const f of F) {',
      '  const a = V[f[0]], b = V[f[1]], c = V[f[2]]',
      '  const n = cross(sub(b, a), sub(c, a))',
      '  const fc = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]',
      '  if (dot(n, sub(fc, C)) <= 0) { const t = f[1]; f[1] = f[2]; f[2] = t; inverted++ }',
      '}',
      'const vLines = V.map((v) => "v " + v.join(" "))',
      'const fLines = F.map((f) => "f " + f.map((i) => i + 1).join(" "))',
      'fs.writeFileSync("fixed.obj", vLines.concat(fLines).join("\\n") + "\\n")',
      'console.log(JSON.stringify({ total: F.length, inverted, fixed: inverted }))',
    ].join('\n'), 'utf8')
  },
  bad: (dir) => {
    // 反控：不做几何判定，直接声称已修（并原样复制输入）
    fs.writeFileSync(path.join(dir, 'fixed.obj'), OBJ_CUBE_LINES.join('\n') + '\n', 'utf8')
    fs.writeFileSync(path.join(dir, 'fix.js'), 'const fs = require("fs")\nfs.copyFileSync("in.obj", "fixed.obj")\nconsole.log(JSON.stringify({ total: 12, inverted: 0, fixed: 0 }))\n', 'utf8')
  },
})

// ── 第五批（找 bug 类，最有判别力）：测试台预置"看起来能跑但结果错"的既有代码，要求定位并修复
//    判定用**隐藏测试**：判定器自己写一份模块测试进沙箱跑，解题者看不到它。
TASKS.push(
  {
    id: 'fix-stats-bug',
    domain: '定位并修复缺陷',
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, 'stats.js'), [
        '// 统计工具：mean 求均值，p95 求 95 分位（已上线，但结果不对）',
        'function mean(xs) {',
        '  let s = 0',
        '  for (const x of xs) s += x',
        '  return s / (xs.length - 1)   // 疑似有问题',
        '}',
        'function p95(xs) {',
        '  const a = [...xs].sort((x, y) => x - y)',
        '  return a[Math.floor(0.95 * a.length)]   // 疑似有问题',
        '}',
        'module.exports = { mean, p95 }',
      ].join('\n'), 'utf8')
      fs.writeFileSync(path.join(dir, 'demo.js'), "const s = require('./stats')\nconsole.log(s.mean([1,2,3,4]), s.p95([1,2,3,4,5,6,7,8,9,10]))\n", 'utf8')
    },
    make: (p) => ({ text: '工作目录里已有 stats.js（导出 mean(xs) 与 p95(xs)），它现在算错。请定位并修好，契约如下（判定器会用自己的隐藏测试直接 require 你的 stats.js）：mean([]) 返回 0；mean([1,2,3,4]) 返回 2.5；p95 定义为"数组升序后第 ceil(0.95*n) 个（1 起始计数）"，n=0 时返回 null；不得改变导出名与参数签名。修完请真跑一次并把验证输出贴出来。', p }),
    check: (dir, p) => {
      // 隐藏测试：判定器自己写、自己跑，解题者看不到
      const hidden = path.join(dir, '_hidden_stats_test.js')
      fs.writeFileSync(hidden, [
        "const assert = require('assert')",
        "const s = require('./stats')",
        'assert.strictEqual(typeof s.mean, "function", "mean 必须是函数")',
        'assert.strictEqual(typeof s.p95, "function", "p95 必须是函数")',
        'assert.strictEqual(s.mean([]), 0, "mean([]) 应为 0")',
        'assert.strictEqual(s.mean([1,2,3,4]), 2.5, "mean([1,2,3,4]) 应为 2.5")',
        'assert.strictEqual(s.mean([7]), 7, "mean([7]) 应为 7")',
        'assert.strictEqual(s.p95([]), null, "p95([]) 应为 null")',
        'assert.strictEqual(s.p95([5]), 5, "p95([5]) 应为 5")',
        'const xs = []',
        'for (let i = 1; i <= 20; i++) xs.push(i)',
        'assert.strictEqual(s.p95(xs), 19, "p95(1..20) 应为 19（ceil(0.95*20)=19）")',
        'const ys = []',
        'for (let i = 1; i <= 10; i++) ys.push(i * 3)',
        'assert.strictEqual(s.p95(ys), 30, "p95(3,6,..,30) 应为 30（ceil(9.5)=10）")',
        'console.log("HIDDEN_OK")',
      ].join('\n'), 'utf8')
      const r = runNode(dir, ['_hidden_stats_test.js'])
      const raw = read(dir, 'stats.js')
      return verdict([
        mk('stats.js 仍在（未被删除/改名）', raw !== null, raw === null ? '缺失' : 'ok'),
        mk('隐藏测试全过（均值/分位数边界与定义）', r.status === 0 && /HIDDEN_OK/.test(String(r.stdout)), 'status=' + r.status + ' out=' + String(r.stdout || '').replace(/\s+/g, ' ').slice(0, 60) + ' err=' + String(r.stderr || '').replace(/\s+/g, ' ').slice(0, 120)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'stats.js'), [
        'function mean(xs) {',
        '  if (xs.length === 0) return 0',
        '  let s = 0',
        '  for (const x of xs) s += x',
        '  return s / xs.length',
        '}',
        'function p95(xs) {',
        '  if (xs.length === 0) return null',
        '  const a = [...xs].sort((x, y) => x - y)',
        '  return a[Math.ceil(0.95 * a.length) - 1]',
        '}',
        'module.exports = { mean, p95 }',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      // 反控：只修了 mean，p95 仍是 floor 版（差一位）
      fs.writeFileSync(path.join(dir, 'stats.js'), [
        'function mean(xs) { if (xs.length === 0) return 0; let s = 0; for (const x of xs) s += x; return s / xs.length }',
        'function p95(xs) { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(0.95 * a.length)] }',
        'module.exports = { mean, p95 }',
      ].join('\n'), 'utf8')
    },
  },
  {
    id: 'fix-race-bug',
    domain: '定位并修复缺陷',
    seed: (dir) => {
      // 确定性竞态：所有任务都先读到 n=0，再统一写回 n=1 → 丢更新
      fs.writeFileSync(path.join(dir, 'run.js'), [
        'const fs = require("fs")',
        'const N = Number(process.argv[2] || 5)',
        'fs.writeFileSync("counter.json", JSON.stringify({ n: 0 }))',
        'fs.writeFileSync("log.txt", "")',
        'const jobs = []',
        'for (let i = 0; i < N; i++) {',
        '  jobs.push((async () => {',
        '    const cur = JSON.parse(fs.readFileSync("counter.json", "utf8"))',
        '    await new Promise((r) => setImmediate(r))',
        '    cur.n += 1',
        '    fs.writeFileSync("counter.json", JSON.stringify(cur))',
        '    fs.appendFileSync("log.txt", i + "\\n")',
        '  })())',
        '}',
        'Promise.all(jobs).then(() => {',
        '  const c = JSON.parse(fs.readFileSync("counter.json", "utf8"))',
        '  console.log("n=" + c.n)',
        '})',
      ].join('\n'), 'utf8')
    },
    make: (p) => ({ text: '工作目录里已有 run.js：`node run.js N` 会先把 counter.json 重置为 {"n":0}、清空 log.txt，然后并发启动 N 个自增任务，每个任务把 counter.json 的 n 加一、并向 log.txt 追加一行，最后打印 `n=<值>`。它现在**会丢更新**（并发读改写覆盖）。请定位并修好，契约：结束时 counter.json 的 n 必须**恰好等于 N**、log.txt 恰好 N 行、stdout 打印 `n=<N>`；允许改实现（串行化/队列/单写者），但必须保留"启动时重置、参数 N、结束时打印"这三条行为。修完请分别用 N=3 与 N=7 真跑一次并贴出输出。', p }),
    check: (dir, p) => {
      const r7 = runNode(dir, ['run.js', '7'])
      const c7 = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'counter.json'), 'utf8')) } catch (e) { return null } })()
      const log7 = read(dir, 'log.txt')
      const lines7 = log7 === null ? -1 : log7.trim().split(/\r?\n/).filter((x) => x.length > 0).length
      const r3 = runNode(dir, ['run.js', '3'])
      const c3 = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'counter.json'), 'utf8')) } catch (e) { return null } })()
      return verdict([
        mk('run.js 仍在且可运行', exists(dir, 'run.js') && r7.status === 0, 'status=' + r7.status + ' err=' + String(r7.stderr || '').replace(/\s+/g, ' ').slice(0, 90)),
        mk('N=7：counter.json 的 n 恰好 7（无丢更新）', Boolean(c7) && c7.n === 7, JSON.stringify(c7)),
        mk('N=7：log.txt 恰好 7 行（每个任务都执行了）', lines7 === 7, 'lines=' + lines7),
        mk('N=7：stdout 打印 n=7', /n\s*=\s*7/.test(String(r7.stdout)), JSON.stringify(String(r7.stdout).replace(/\s+/g, ' ').slice(0, 50))),
        mk('N=3：n 恰好 3（不是写死的 7）', Boolean(c3) && c3.n === 3 && r3.status === 0, JSON.stringify(c3) + ' status=' + r3.status),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'run.js'), [
        'const fs = require("fs")',
        'const N = Number(process.argv[2] || 5)',
        'fs.writeFileSync("counter.json", JSON.stringify({ n: 0 }))',
        'fs.writeFileSync("log.txt", "")',
        'let chain = Promise.resolve()',
        'const jobs = []',
        'for (let i = 0; i < N; i++) {',
        '  jobs.push((async () => {',
        '    await new Promise((r) => setImmediate(r))',
        '    chain = chain.then(() => {',            // 串行化：读-改-写不再交错
        '      const cur = JSON.parse(fs.readFileSync("counter.json", "utf8"))',
        '      cur.n += 1',
        '      fs.writeFileSync("counter.json", JSON.stringify(cur))',
        '      fs.appendFileSync("log.txt", i + "\\n")',
        '    })',
        '    return chain',
        '  })())',
        '}',
        'Promise.all(jobs).then(() => chain).then(() => {',
        '  const c = JSON.parse(fs.readFileSync("counter.json", "utf8"))',
        '  console.log("n=" + c.n)',
        '})',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => {
      // 反控：保持竞态（读后 await 再写），只补了 log 追加
      fs.writeFileSync(path.join(dir, 'run.js'), [
        'const fs = require("fs")',
        'const N = Number(process.argv[2] || 5)',
        'fs.writeFileSync("counter.json", JSON.stringify({ n: 0 }))',
        'fs.writeFileSync("log.txt", "")',
        'const jobs = []',
        'for (let i = 0; i < N; i++) {',
        '  jobs.push((async () => {',
        '    const cur = JSON.parse(fs.readFileSync("counter.json", "utf8"))',
        '    await new Promise((r) => setImmediate(r))',
        '    cur.n += 1',
        '    fs.writeFileSync("counter.json", JSON.stringify(cur))',
        '    fs.appendFileSync("log.txt", i + "\\n")',
        '  })())',
        '}',
        'Promise.all(jobs).then(() => {',
        '  const c = JSON.parse(fs.readFileSync("counter.json", "utf8"))',
        '  console.log("n=" + c.n)',
        '})',
      ].join('\n'), 'utf8')
    },
  },
)

// ── 第六批：严格资源预算（判定器独立计时，不采信自报耗时）
TASKS.push({
  id: 'perf-huge-scan',
  domain: '性能预算',
  make: (p) => ({ text: '写 huge.js：用线性同余生成器 x = (x * 1103515245 + 12345) % 2147483648（初值 42）连续生成 5000000 个数，打印一行 JSON：{"k":降序第 10 大的值,"sum":全部数之和 mod 1000000007,"ms":你自报的耗时}。**硬预算：判定器会独立计时，`node huge.js` 的墙钟时间（含 Node 启动）必须 < 600ms**，所以不要先把 500 万个数整体排序。', p }),
  check: (dir, p) => {
    const M = 2147483648, MOD = 1000000007, N = 5000000
    // 独立复算期望值（一次扫描 + 维护前 10 大）
    let x = 42, sum = 0
    const top = []
    for (let i = 0; i < N; i++) {
      x = (x * 1103515245 + 12345) % M
      sum = (sum + x) % MOD
      if (top.length < 10) { top.push(x); top.sort((a, b) => a - b) }
      else if (x > top[0]) { top[0] = x; top.sort((a, b) => a - b) }
    }
    const t0 = Date.now()
    const r = runNode(dir, ['huge.js'])
    const wall = Date.now() - t0
    const out = String(r.stdout || '')
    let j = null
    for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.k !== undefined) { j = o; break } } catch (e) { /* next */ } }
    return verdict([
      mk('huge.js 存在且可运行', exists(dir, 'huge.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').replace(/\s+/g, ' ').slice(0, 80)),
      mk('第 10 大值正确（独立复算）', Boolean(j) && Number(j.k) === top[0], JSON.stringify(j && j.k) + ' want=' + top[0]),
      mk('sum 正确（独立复算 mod 1000000007）', Boolean(j) && Number(j.sum) === sum, JSON.stringify(j && j.sum) + ' want=' + sum),
      mk('独立计时 < 600ms（含 Node 启动；实测聪明解 ~280ms、全排序 ~950ms）', wall < 600, 'wall=' + wall + 'ms 自报=' + JSON.stringify(j && j.ms)),
    ])
  },
  gold: (dir) => {
    fs.writeFileSync(path.join(dir, 'huge.js'), [
      'const M = 2147483648, MOD = 1000000007, N = 5000000',
      'const t0 = Date.now()',
      'let x = 42, sum = 0',
      'const top = new Float64Array(10); let filled = 0',
      'for (let i = 0; i < N; i++) {',
      '  x = (x * 1103515245 + 12345) % M',
      '  sum = (sum + x) % MOD',
      '  if (filled < 10) {',
      '    top[filled++] = x',
      '    for (let a = filled - 1; a > 0 && top[a - 1] > top[a]; a--) { const t = top[a - 1]; top[a - 1] = top[a]; top[a] = t }',
      '  } else if (x > top[0]) {',
      '    top[0] = x',
      '    for (let a = 1; a < 10 && top[a - 1] > top[a]; a++) { const t = top[a - 1]; top[a - 1] = top[a]; top[a] = t }',
      '  }',
      '}',
      'console.log(JSON.stringify({ k: top[0], sum, ms: Date.now() - t0 }))',
    ].join('\n'), 'utf8')
  },
  bad: (dir) => {
    // 反控：整体排序（真实做法但超预算）——用 5e6 个元素的全排序
    fs.writeFileSync(path.join(dir, 'huge.js'), [
      'const M = 2147483648, MOD = 1000000007, N = 5000000',
      'const t0 = Date.now()',
      'const a = new Float64Array(N)',
      'let x = 42, sum = 0',
      'for (let i = 0; i < N; i++) { x = (x * 1103515245 + 12345) % M; a[i] = x; sum = (sum + x) % MOD }',
      'a.sort()',
      'console.log(JSON.stringify({ k: a[N - 10], sum, ms: Date.now() - t0 }))',
    ].join('\n'), 'utf8')
  },
})

// ── 第七批：内存硬上限（判定器带 --max-old-space-size 运行；实测偷懒解必崩）
const MEMCAP_LINES = 4000000
const MEMCAP_MOD = 1000000007
TASKS.push({
  id: 'memcap-stream-sum',
  domain: '性能预算',
  seed: (dir) => {
    // 造 400 万行、约 40MB 的 data.txt（一行一个非负整数）
    const out = []
    let x = 42, buf = []
    for (let i = 0; i < MEMCAP_LINES; i++) {
      x = (x * 1103515245 + 12345) % 2147483648
      buf.push(String(x))
      if (buf.length === 200000) { out.push(buf.join('\n') + '\n'); buf = [] }
    }
    if (buf.length) out.push(buf.join('\n') + '\n')
    fs.writeFileSync(path.join(dir, 'data.txt'), out.join(''), 'utf8')
  },
  make: (p) => ({ text: '工作目录里已有一个 data.txt（4000000 行，每行一个非负整数，约 40MB）。写 sum.js：**判定器会用 `node --max-old-space-size=128 sum.js` 运行它**（JS 堆上限 128MB），必须能跑完、不得因内存不足崩溃，打印一行 JSON：{"count":行数,"sum":所有数之和 mod 1000000007,"max":最大值}。提示：不要把整个文件一次性读进内存——那样必然撞上限。', p }),
  check: (dir, p) => {
    // 期望值由判定器独立复算（同一 LCG，不读文件）
    let x = 42, sum = 0, mx = 0
    for (let i = 0; i < MEMCAP_LINES; i++) { x = (x * 1103515245 + 12345) % 2147483648; sum = (sum + x) % MEMCAP_MOD; if (x > mx) mx = x }
    const r = spawnSync(process.execPath, ['--max-old-space-size=128', 'sum.js'], { cwd: dir, encoding: 'utf8', timeout: 120000 })
    const out = String(r.stdout || '')
    let j = null
    for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.count !== undefined) { j = o; break } } catch (e) { /* next */ } }
    return verdict([
      mk('sum.js 存在', exists(dir, 'sum.js'), exists(dir, 'sum.js') ? 'ok' : '缺失'),
      mk('在 128MB 堆上限下跑完（未 OOM 崩溃）', r.status === 0, 'exit=' + r.status + ' stderr=' + String(r.stderr || '').replace(/\s+/g, ' ').slice(0, 110)),
      mk('count=4000000', Boolean(j) && Number(j.count) === MEMCAP_LINES, JSON.stringify(j && j.count)),
      mk('sum 正确（独立复算 mod 1e9+7）', Boolean(j) && Number(j.sum) === sum, JSON.stringify(j && j.sum) + ' want=' + sum),
      mk('max 正确（独立复算）', Boolean(j) && Number(j.max) === mx, JSON.stringify(j && j.max) + ' want=' + mx),
    ])
  },
  gold: (dir) => {
    fs.writeFileSync(path.join(dir, 'sum.js'), [
      'const fs = require("fs"), readline = require("readline")',
      'const rl = readline.createInterface({ input: fs.createReadStream("data.txt"), crlfDelay: Infinity })',
      'let count = 0, sum = 0, max = 0',
      'rl.on("line", (l) => {',
      '  if (!l) return',
      '  const v = Number(l)',
      '  count++',
      '  sum = (sum + v) % 1000000007',
      '  if (v > max) max = v',
      '})',
      'rl.on("close", () => console.log(JSON.stringify({ count, sum, max })))',
    ].join('\n'), 'utf8')
  },
  bad: (dir) => {
    // 反控：一次性读全文件并 split（实测在 64/128MB 上限下都 OOM，exit 134）
    fs.writeFileSync(path.join(dir, 'sum.js'), [
      'const fs = require("fs")',
      'const t = fs.readFileSync("data.txt", "utf8")',
      'const rows = t.split(/\\r?\\n/).filter(Boolean)',
      'let sum = 0, max = 0',
      'for (const r of rows) { const v = Number(r); sum = (sum + v) % 1000000007; if (v > max) max = v }',
      'console.log(JSON.stringify({ count: rows.length, sum, max }))',
    ].join('\n'), 'utf8')
  },
})

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
