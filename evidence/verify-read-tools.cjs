// 只读工具（glob/read/grep）的桩单测：node evidence/verify-read-tools.cjs
// 起因：动态试题台 b777001 里"读仓库"臂用了 `**/README*`，**根目录下的 README.md 命不中**——
//   命令里于是写着"通配未命中、路径需自行确认"，把工具失败变成下游的负担。glob 的约定语义是
//   `**/` 匹配**零层或更多层**目录，根目录命中是基本期待。
// 这里把边界一次性钉死（临时目录 + 真实文件），避免再靠"跑一遍看看"。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const cases = [];
const check = (name, got, want) => cases.push({ name, got, want });

(async () => {
  const mod = await import(MOD);
  const V = mod.__poVerify;
  if (!toolFns(V)) { console.error('❌ __poVerify 未导出只读工具'); process.exit(1) }
  const { glob, read, grep } = toolFns(V);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-readtools-'));
  try {
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# root readme\n');
    fs.writeFileSync(path.join(dir, 'tool.mjs'), "console.log('--dry-run')\n");
    fs.writeFileSync(path.join(dir, 'sub', 'README.md'), '# sub readme\n');
    fs.writeFileSync(path.join(dir, 'sub', 'other.txt'), 'needle\n');

    // ① **/ 必须匹配零层目录（回归本测）
    const g1 = glob(dir, { pattern: '**/README*' }).split('\n').slice(1);
    check('**/README* 命中根目录与子目录', g1.slice().sort(), ['README.md', 'sub/README.md']);
    // ② * 不跨目录
    check('* 只命中根目录一层', glob(dir, { pattern: '*' }).split('\n').slice(1).indexOf('sub/README.md'), -1);
    // ③ **/* 命中全部文件（含根）
    const g3 = glob(dir, { pattern: '**/*' }).split('\n').slice(1);
    check('**/* 含根目录文件', g3.indexOf('README.md') >= 0, true);
    // ④ 单层通配
    check('sub/*.txt 命中一层', glob(dir, { pattern: 'sub/*.txt' }).split('\n').slice(1), ['sub/other.txt']);
    // ⑤ 无匹配如实说明
    check('无匹配时返回"无匹配"', /无匹配/.test(glob(dir, { pattern: 'nope/*.md' })), true);
    // ⑥ read 给出可引用的路径与行号
    const r1 = read(dir, { path: 'README.md' });
    check('read 返回文件路径与行号', { hasPath: r1.indexOf('README.md') >= 0, hasLine: /\d+\| /.test(r1) }, { hasPath: true, hasLine: true });
    // ⑦ 越界拒绝（只读工具限定在根内）
    check('read 越界被拒', /拒绝/.test(read(dir, { path: '../../etc/passwd' })), true);
    // ⑧ grep 命中给出 路径:行号
    check('grep 命中给出 路径:行号', /other\.txt:1:/.test(grep(dir, { pattern: 'needle' })), true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* best effort */ }
  }

  let bad = 0;
  for (const c of cases) {
    const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
    if (!ok) { console.log('      得到 ' + JSON.stringify(c.got)); console.log('      期望 ' + JSON.stringify(c.want)); }
  }
  console.log('');
  console.log(bad === 0 ? '判定：只读工具的路径语义按约定工作 ✓（**/ 零层命中、*/** 分层、越界拒绝、给出可引用位置）' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });

function toolFns(V) {
  if (V && typeof V.toolGlob === 'function') return { glob: V.toolGlob, read: V.toolRead, grep: V.toolGrep };
  return null;
}
