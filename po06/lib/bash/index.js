/**
 * @dsh-external/dsh-bash-runtime — 把内置 Bash 工具接入模型工具面（无需 WSL）。
 * 说明按注入器性能铁律压短；完整契约与诊断走返回值。
 */
// 0.7.1：并入 po06 后**不再 import 宿主的 defineTool / schemastery** —— 装配包（tgz 解包到
// profile/node_modules）解析不到它们，模块 import 会整体失败，表现是"bash 工具静默消失"。
// 注册改为**裸 tools.register + 对象根 JSON Schema**（与 po06 自己的 posix 工具同一做法）。
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, delimiter, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { renderBashOutput } from './bash-output.mjs'
import { beginInvocation, endInvocation, usageNote } from './bash-diagnostics.mjs'
import { homedir } from 'node:os'

export const name = "@dsh-external/dsh-bash-runtime"
export const inject = ['tools']

export const DEFAULT_BASH_CONFIG = Object.freeze({
  // 留空 = 自动解析（env DSH_BASH_PATH → 自带 bundle → Git → MSYS2 → PATH）。
  // 不再硬编码 D:/other/Git/... 这类机器专属路径。
  bashPath: '',
  bundledRuntimeDir: '',
  timeoutMs: 120000,
  // 单次调用的**上限**（安全网）。取值理由：默认 10 分钟足够跑常见的编译/测试，
  // 又能挡住"传个 70 分钟，把已经卡死的命令一直挂着"这种失控（2026-09-25 实测：
  // 一条含 npm i 的命令被传了 timeoutMs=4200000，真的挂满 70 分钟才被终止）。
  // ⚠ 钳制是**安全网**，不是替代模型判断：真实上限会写进工具描述，让模型自己决定该用多少。
  maxTimeoutMs: 600000,
})

/** 配置归一（替代原 schemastery schema）：缺失/非法值一律回落默认，避免 NaN 传进钳制。 */
export function normalizeBashConfig(c) {
  const o = c && typeof c === 'object' ? c : {}
  const num = (v, dv) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : dv)
  return {
    bashPath: typeof o.bashPath === 'string' ? o.bashPath : '',
    bundledRuntimeDir: typeof o.bundledRuntimeDir === 'string' ? o.bundledRuntimeDir : '',
    timeoutMs: num(o.timeoutMs, 120000),
    maxTimeoutMs: num(o.maxTimeoutMs, 600000),
  }
}

const load = (file) => import(new URL('./' + file, import.meta.url).href)

/**
 * issue #17：MSYS 的 /tmp 没有任何人负责创建（仓库里它是空目录 ⇒ 进不了 git、也进不了包，
 * provision 也不建它），于是**非作者机器上每次调用**都往 stderr 打：
 *   bash.exe: warning: could not find /tmp, please create!
 * 这不只是噪音：任何断言 stderr 为空的测试/工具都会被弄红（报告者实测 8 个测试全红）。
 *
 * ⚠ 必须建在**任何一次 bash 启动之前**——运行时候选探测（probeRuntime）本身就会 spawn bash，
 *   放在 spawn 前一步是不够的（实测：探测那次仍然把警告打了出来）。
 * 只作用于**自带运行时根**，不去写别人的 Git/MSYS 安装目录。best effort：建不出来不阻断命令。
 * 完整性校验只核清单内文件是否存在/哈希相符，不会因为多出 tmp/ 而失败（runtime-layout.verifyRuntime）。
 */
export function ensureMsysTmp(runtimeRoot) {
  try {
    if (!runtimeRoot) return false
    mkdirSync(resolve(runtimeRoot, 'tmp'), { recursive: true })
    return true
  } catch { return false }
}

/** 自带运行时的默认位置（`<plugin>/runtime`）。 */
function defaultBundledRuntimeDir() {
  return fileURLToPath(new URL('../../runtime', import.meta.url))
}


/**
 * 把调用方给的 timeoutMs 收进 [1, max]；非法值回落缺省。**纯函数**。
 * 这是**安全网**，不是决策者：真实上限已写进工具描述，模型可据此自行判断该用多少。
 */
export function clampTimeout(requested, fallback, max) {
  const n = Number(requested)
  const base = Number.isFinite(n) && n > 0 ? n : fallback
  return Math.min(base, max)
}

function bashRootFor(hostRoot) {
  const p = hostRoot.replaceAll('\\', '/')
  return p.replace(/^([A-Za-z]):/, (_m, d) => '/' + d.toLowerCase())
}

// Diagnosis helpers are kept separately from execution.
export { costNote, splitStages, chainFinding, heavyFindings, usageNote } from './bash-diagnostics.mjs'

export function apply(ctx, config, dependencies = {}) {
  config = normalizeBashConfig(config)
  // issue #17：注册期就先补一次（此后任何探测/调用都不该再为 /tmp 报警告）。
  ensureMsysTmp(resolve(config.bundledRuntimeDir || defaultBundledRuntimeDir()))
  ctx.effect(() => ctx.tools.register({
    name: 'bash',
    description: '执行 bash 命令（GNU bash / MSYS2，不是 PowerShell 也不是 cmd）；命令内用 POSIX 路径（盘符写作 /d/...），workdir 用宿主路径（D:/...）；需原样传参用 args 数组（成为 $1…$n，$0=dsh-bash）；非零退出不会自动重试或换后端。'
      // 2026-10-01 修：这里原先写着“跑 Windows 原生程序时 pwsh 通常更快更稳”——那是我自己写的
      // **未实测断言**，还把位置放错了（塞在 timeoutMs 参数说明里）。结果模型被推离 bash：
      // 本会话 pwsh 136 次 / bash 2 次。现在移到工具描述本体，按**命令性质**给判据，
      // 并把用户口径的经验如实标成经验（不当作实测事实）。
      + '【选哪个 shell】按命令性质选，不要按习惯：需要 POSIX 管线（grep/sed/awk）、glob、多条命令串联、重定向或 bash 语义时用本工具；需要 PowerShell 对象语义（Get-ChildItem、Select-Object、$env:）时才用 pwsh。本机经验（用户口径）：两者都能做时 bash 通常更稳、更可预期，优先 bash；不要为同一条命令来回换 shell。',
    // ⚠ 裸 register 要求**对象根 JSON Schema**：逐属性 required:true 的方言只有 defineTool 的
    // 编译路径才认，裸传会被宿主直接拒（po06 的 posix 就栽过，且失败不冒泡 ⇒ 工具静默缺席）。
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['command', 'description'],
      properties: {
      command: { type: 'string', description: 'bash 源文本；含空格或特殊字符的参数用单引号包裹。' },
      // 客户端 dsh-client-ui-tool 的 shellCall() 要求 description：缺失时会退化成
      // "persistent shell" 通用卡片并把结果走 generic 路径（实测表现：UI 显示通用图标与代码块）。
      // host 的 bash/pwsh 工具同样把它声明为必填（"shown in the UI"）。
      description: { type: 'string', description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "ls" → "List files in current directory".' },
      args: { type: 'array', items: { type: 'string' }, description: '原样传给脚本的参数，依次为 $1…$n（不经 shell 解析）。' },
      workdir: { type: 'string', description: '工作目录（宿主路径，须在工作区内）。缺省用会话目录。' },
      // 描述里给出**真实**的缺省值与上限（2026-09-25 修复）：原先只写"到期终止整个进程树"，
      // 模型无从判断该给多少，于是出现"传 4200000ms、把一条卡死的命令挂满 70 分钟"。
      // 钳制仍然生效（安全网），但**先让模型有依据自己决定**——给出上限和判断规则，
      // 比替它决定更可靠（用户 2026-09-25："模型本身应该也要有自主思考来调整的能力"）。
      timeoutMs: {
        type: 'number',
        description: '毫秒截止时间（含准备与探测）；到期请求终止受管进程并等待收尾，无法证明树清空时明确标注。缺省 ' + config.timeoutMs + 'ms，'
          + '上限 ' + config.maxTimeoutMs + 'ms（超过会被钳制到上限）。判断依据：本地快命令（ls/cat/grep/printf）用缺省；'
          + '编译或测试可适当提高并**拆成多步**；网络操作（npm/pip/curl/git clone）耗时不可预测，**单独跑并确认能通**，不要并入长链。'
          + '若本工具是在 run_code 等外层程序里被调用，外层的 deadline 必须**大于**这里的 timeoutMs，否则外层会先终止整个程序。'
          + '**一条命令只干一件事**：把组装、构建、取图这类阶段分开调用，别串成一条长链——'
          + '串链一旦某步卡住，就是一次赔进去几分钟、还拿不到可比对的信息。'
          + '**不要吞输出**（>/dev/null 这类）：命令的价值就是它的输出。'
          + '跑编译/测试/构建这类耗时命令时，按最慢的单步给值，不要按整条链给。',
      },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const started = performance.now()
      const signal = exec?.signal
      const cancelled = () => signal?.aborted === true
      // issue #17：**在加载模块与探测之前**补 tmp——探测本身会 spawn bash，晚一步就会漏出警告。
      ensureMsysTmp(resolve(config.bundledRuntimeDir || defaultBundledRuntimeDir()))
      if (cancelled()) return '调用已取消，命令未执行。'
      let gov, jobport, wsmod, provision
      try {
        [gov, jobport, wsmod, provision] = dependencies.modules || await Promise.all([
          load('process-governance.mjs'), load('pg-jobport.mjs'), load('workspace-semantics.mjs'), load('runtime-provision.mjs'),
        ])
      } catch (error) { return '运行时模块不可用，命令未执行：' + String(error?.message || error) }
      const session = exec?.agent?.session
      const root = [session?.header?.cwd, session?.meta?.cwd, exec?.cwd, process.cwd()].find(v => typeof v === 'string' && v)
      const workspace = wsmod.createWorkspace({ hostRoot: root, bashRoot: bashRootFor(root) })
      const target = args.workdir ? wsmod.toBashPath(workspace, args.workdir) : { ok: true, hostPath: root }
      if (!target.ok) return '工作目录不可用：' + target.reason
      const timeoutMs = clampTimeout(args.timeoutMs, config.timeoutMs, config.maxTimeoutMs)
      const deadline = AbortSignal.timeout(timeoutMs)
      const fused = signal ? AbortSignal.any([signal, deadline]) : deadline
      let bashPath = config.bashPath
      // 运行时来源要带下去给 HOME 用（见下）。显式 config.bashPath 标成 'explicit'：那不是我们的
      // 运行时，它的 HOME 语义由指定者自己负责。
      let runtimeSource = config.bashPath ? 'explicit' : null
      if (!bashPath) {
        const bundledRuntimeDir = config.bundledRuntimeDir || fileURLToPath(new URL('../../runtime', import.meta.url))
        const resolved = await provision.resolveBashRuntime({ env: process.env, platform: process.platform, signal: fused, bundledRuntimeDir })
        if (!resolved.ok) return (resolved.repair || [resolved.reason || '运行时不可用']).join('\n')
        bashPath = resolved.path
        runtimeSource = resolved.source
      }
      if (fused.aborted) return '调用已取消或在准备阶段达到截止时间，命令未执行。'
      const temp = wsmod.tempDirFor(workspace, 'tool-' + randomUUID())
      mkdirSync(temp.hostPath, { recursive: true })
      const env = { ...process.env }
      // 自带 MSYS2 运行时在 win32 上必须**显式给 HOME**，否则运行时会自己兜底成 `/home/<账户>`，
      // 而本插件的 MSYS 根是 `<plugin>/runtime` ⇒ 落点是 `<plugin>/runtime/home/<user>` ——
      // **该目录不存在，也没有任何环节创建它**。后果不是「报错」而是**假阴性**：
      // `git config --global --get …` 静默返回空（rc=1），写入报 `could not lock config file`；
      // 同一台机器、同一个用户，插件内外看到的是两份不同的"全局配置"。
      //
      // 生效条件收紧到「自家 bundle + win32」，原因：MSYS2 才是本问题载体，而自带 bundle 在
      // 运行时选型里排在 Git for Windows 之前（`runtime-provision.mjs` 的候选序），
      // 所以只要包里带 `runtime/` 就必然走这个私有 root；Git for Windows / 系统 MSYS2 /
      // `DSH_BASH_PATH` / `config.bashPath` 自己会把 HOME 映射到用户目录，一律不动。
      //
      // 传 Windows 形式即可：MSYS 会自己转成 POSIX（`C:\Users\x` ↔ `/cygdrive/c/Users/x`）。
      // 有意要隔离 home 的场景用 `DSH_BASH_HOME` 显式指定（CHANGELOG 条目里有用法说明）。
      if (process.platform === 'win32' && runtimeSource === 'bundled') {
        env.HOME = process.env.DSH_BASH_HOME
          || process.env.USERPROFILE
          || (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : '')
          || homedir()
      }
      const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
      const oldPath = pathKey ? env[pathKey] : ''
      for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
      const bin = dirname(bashPath)
      env.PATH = (bin === '.' ? '' : bin + delimiter) + oldPath
      // Preserve MSYS conversion semantics; do not silently rewrite native-program arguments.
      const prepareMs = performance.now() - started
      let token = null
      try {
        token = beginInvocation({ home: process.env.DSH_HOME || homedir() + '/.dsh', sessionId: session?.id || root, command: args.command })
        const port = jobport.createJobPort({ cwd: target.hostPath,
          makePaths: n => ({ stdout: temp.hostPath + '/out-' + n + '.bin', stderr: temp.hostPath + '/err-' + n + '.bin' }) })
        const governed = await gov.runGoverned({ command: bashPath, args: ['-c', args.command, 'dsh-bash', ...(args.args || [])],
          cwd: target.hostPath, env, signal: fused,
          timeoutMs: Math.max(1, timeoutMs - Math.ceil(performance.now() - started)), stdoutMaxBytes: 65536,
          exitPlatform: process.platform }, port)
        const result = deadline.aborted && !signal?.aborted && governed.reason === 'cancelled'
          ? { ...governed, reason: 'timeout' } : governed
        if (result.reason === 'spawn-error') provision.clearBashRuntimeCache?.()
        const note = usageNote({ ms: performance.now() - started, command: args.command,
          outLen: result.streams.stdout.text.length + result.streams.stderr.text.length,
          failed: result.reason !== 'exit' || result.outcome.exitCode !== 0,
          timedOut: result.reason === 'timeout', cancelled: result.reason === 'cancelled',
          stdoutBytes: result.streams.stdout.totalBytes, stderrBytes: result.streams.stderr.totalBytes })
        return renderBashOutput(result, { command: args.command, elapsedMs: performance.now() - started, prepareMs,
          note: [token?.note, note].filter(Boolean).join('\n'),
          mapPath: p => { const mapped = wsmod.toBashPath(workspace, p); return mapped.ok ? mapped.bashPath : p } })
      } catch (error) {
        return '【发生了什么】执行工具异常：' + String(error?.message || error) + '\n[已结束本次调用记录；不把它误报成上次崩溃]'
      } finally { if (token) endInvocation(token) }
    },
  }), '@dsh-external/dsh-bash-runtime: bash tool')
}
