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
    make: (p) => ({ text: '工作目录先创建 access.log，内容（6 行，格式 `方法 路径 状态码`）：\nGET /a 200\nGET /b 404\nPOST /a 500\nGET /a 200\nGET /c 301\nGET /a 200\n写 parse.js 读它并打印一行 JSON：{"total":总行数,"errors":状态码>=400 的行数,"topPath":"出现最多的路径（并列取字典序最小）"}。', p }),
    check: (dir, p) => {
      const r = runNode(dir, ['parse.js'])
      const out = String(r.stdout || '')
      let j = null
      for (const c of (out.match(/\{[^{}]*\}/g) || [])) { try { const o = JSON.parse(c); if (o && o.total !== undefined) { j = o; break } } catch (e) { /* next */ } }
      return verdict([
        mk('parse.js 存在且可运行', exists(dir, 'parse.js') && r.status === 0, 'status=' + r.status + ' err=' + String(r.stderr || '').slice(0, 80)),
        mk('total=6 且 errors=2（301 不算错误）', Boolean(j) && j.total === 6 && j.errors === 2, JSON.stringify(j) + ' raw=' + out.replace(/\s+/g, ' ').slice(0, 80)),
        mk('topPath=/a', Boolean(j) && j.topPath === '/a', JSON.stringify(j)),
      ])
    },
    gold: (dir) => {
      fs.writeFileSync(path.join(dir, 'access.log'), 'GET /a 200\nGET /b 404\nPOST /a 500\nGET /a 200\nGET /c 301\nGET /a 200\n', 'utf8')
      fs.writeFileSync(path.join(dir, 'parse.js'), [
        'const fs = require("fs")',
        'const lines = fs.readFileSync("access.log", "utf8").trim().split(/\\r?\\n/)',
        'const counts = {}; let errors = 0',
        'for (const l of lines) { const p = l.split(" ")[1]; const s = Number(l.split(" ")[2]); counts[p] = (counts[p] || 0) + 1; if (s >= 400) errors++ }',
        'const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1))[0]',
        'console.log(JSON.stringify({ total: lines.length, errors, topPath: top }))',
      ].join('\n'), 'utf8')
    },
    bad: (dir) => { fs.writeFileSync(path.join(dir, 'parse.js'), 'console.log(JSON.stringify({ total: 6, errors: 3, topPath: "/b" }))\n', 'utf8') },
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
