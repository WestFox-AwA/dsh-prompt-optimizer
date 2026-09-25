/**
 * @dsh-external/dsh-bash-runtime — 把内置 Bash 工具接入模型工具面（无需 WSL）。
 * 说明按注入器性能铁律压短；完整契约与诊断走返回值。
 */
// 0.7.1：并入 po06 后**不再 import 宿主的 defineTool / schemastery** —— 装配包（tgz 解包到
// profile/node_modules）解析不到它们，模块 import 会整体失败，表现是"bash 工具静默消失"。
// 注册改为**裸 tools.register + 对象根 JSON Schema**（与 po06 自己的 posix 工具同一做法）。
import { mkdirSync } from 'node:fs'

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

export function apply(ctx, config) {
  config = normalizeBashConfig(config)
  ctx.effect(() => ctx.tools.register({
    name: 'bash',
    description: '执行 bash 命令（GNU bash / MSYS2，不是 PowerShell 也不是 cmd）；命令内用 POSIX 路径（盘符写作 /d/...），workdir 用宿主路径（D:/...）；需原样传参用 args 数组（成为 $1…$n，$0=dsh-bash）；非零退出不会自动重试或换后端。',
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
        description: '毫秒截止时间；到期终止**整个进程树**并回收。缺省 ' + config.timeoutMs + 'ms，'
          + '上限 ' + config.maxTimeoutMs + 'ms（超过会被钳制到上限）。判断依据：本地快命令（ls/cat/grep/printf）用缺省；'
          + '编译或测试可适当提高并**拆成多步**；网络操作（npm/pip/curl/git clone）耗时不可预测，**单独跑并确认能通**，不要并入长链。'
          + '若本工具是在 run_code 等外层程序里被调用，外层的 deadline 必须**大于**这里的 timeoutMs，否则外层会先终止整个程序。',
      },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      let gov, jobport, contract, wsmod, provision
      try {
        [gov, jobport, contract, wsmod, provision] = await Promise.all([
          load('process-governance.mjs'), load('pg-jobport.mjs'), load('bash-tool-contract.mjs'), load('workspace-semantics.mjs'), load('runtime-provision.mjs'),
        ])
      } catch (e) {
        // 安装损坏时给出可读诊断，而不是把异常抛给宿主
        return [
          '【发生了什么】插件运行时模块加载失败，命令未执行。',
          '【为什么】' + String((e && e.message) || e),
          '【下一步】1. 重新安装/重打包插件（lib 目录应包含 process-governance.mjs、pg-jobport.mjs、bash-tool-contract.mjs、workspace-semantics.mjs、runtime-provision.mjs、runtime-layout.mjs）。 2. 若为手工放置，确认上述文件齐全后重试。',
        ].join('\n')
      }
      // 自带/指定的运行时必须把它自己的 bin 放进 PATH：
      // 否则 bash 能启动，但 head/grep/sort 等外部命令全部 command not found（实测 rc=127）。
      const withRuntimePath = (exePath) => {
        const sep = exePath.lastIndexOf('\\') >= 0 ? '\\' : '/'
        const bin = exePath.slice(0, exePath.lastIndexOf(sep))
        return { ...process.env, PATH: bin + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') }
      }
      let bashPath = config.bashPath
      if (!bashPath) {
        // 默认从插件自带目录解析。0.7.1 起本文件位于 <plugin>/lib/bash/index.js
        // （以前是 <plugin>/lib/index.js），所以要多退一级才到 <plugin>/runtime。
        const selfBundled = new URL('../../runtime', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replaceAll('/', '\\')
        const resolved = provision.resolveBashRuntime({ env: process.env, platform: process.platform, bundledRuntimeDir: config.bundledRuntimeDir || selfBundled })
        if (!resolved.ok) return resolved.repair.join('\n')
        bashPath = resolved.path
      }
      // 工作区根必须取**会话工作区**，而不是宿主进程 cwd：
      // 实测宿主进程 cwd 通常是 C:\Users\<user>，而会话工作区可能在 D:\...，
      // 用进程 cwd 会把用户真实工作区判成 OUTSIDE_WORKSPACE。
      const session = exec && exec.agent && exec.agent.session ? exec.agent.session : null
      const root = [
        session && session.header ? session.header.cwd : undefined,
        session && session.meta ? session.meta.cwd : undefined,
        exec && exec.cwd,
        process.cwd(),
      ].find((v) => typeof v === 'string' && v.length > 0)
      let workspace
      try { workspace = wsmod.createWorkspace({ hostRoot: root, bashRoot: bashRootFor(root) }) }
      catch (e) { return '工作区初始化失败：' + String(e && e.message || e) }
      const target = args.workdir ? wsmod.toBashPath(workspace, args.workdir) : { ok: true, hostPath: root, bashPath: workspace.bashRoot }
      if (!target.ok) {
        return contract.renderToolError({ category: 'unmapped-path', paths: { errno: target.reason, path: args.workdir }, availableMappings: [root + ' → ' + workspace.bashRoot] }).message
      }
      let tempDir
      try {
        tempDir = wsmod.tempDirFor(workspace, 'tool-' + process.pid)
        mkdirSync(tempDir.hostPath, { recursive: true })
      } catch (e) { return '临时目录不可用：' + String(e && e.message || e) }
      const port = jobport.createJobPort({
        cwd: target.hostPath,
        makePaths: (n) => ({ stdout: tempDir.hostPath + '/out-' + n + '.bin', stderr: tempDir.hostPath + '/err-' + n + '.bin' }),
      })
      let governed
      try {
        governed = await gov.runGoverned({
          command: bashPath,
          args: ['-c', args.command, 'dsh-bash', ...(args.args || [])],
          cwd: target.hostPath,
          env: withRuntimePath(bashPath),
          timeoutMs: clampTimeout(args.timeoutMs, config.timeoutMs, config.maxTimeoutMs),
          stdoutMaxBytes: 65536,
          exitPlatform: 'win32',
        }, port)
      } catch (e) {
        const m = String(e && e.message || e)
        if (m.includes('RUNTIME_INTEGRITY_FAILED')) {
          return contract.renderToolError({ category: 'integrity', integrity: { errno: 'RUNTIME_INTEGRITY_FAILED', problems: e.problems || [], repair: e.repair || [] } }).message
        }
        return contract.renderToolError({ category: 'spawn-error', spawnError: m }).message
      }
      const marker = (code, signal) => (typeof code === 'number' ? '[exit code: ' + code + ']' : signal ? '[killed by signal: ' + signal + ']' : '[exit code: 1]')
      const bad = governed.reason !== 'exit' || governed.outcome.exitCode !== 0 || governed.streams.stderr.truncated
      if (bad) {
        const rendered = contract.renderToolError({
          category: governed.reason === 'exit' ? 'exit' : governed.reason,
          exitCode: governed.outcome.exitCode,
          signal: governed.outcome.signal,
          stderr: governed.streams.stderr.text,
          truncated: governed.streams.stdout.truncated,
          spillPath: governed.streams.stdout.spillPath,
          timeoutMs: governed.timeoutMs,
          maxTimeoutMs: config.maxTimeoutMs,
          spawnError: governed.spawnError || undefined,
        }).message
        // 保留三段式可执行诊断，同时在**末尾**补上客户端可解析的状态标记
        return rendered + '\n' + marker(governed.outcome.exitCode, governed.outcome.signal)
      }
      const LIMIT = 16000
      const text = governed.streams.stdout.text
      const tooLong = governed.streams.stdout.truncated || text.length > LIMIT
      const parts = []
      // 截断提示必须前置：否则模型先被海量输出淹没，看不到"完整输出在哪"
      if (tooLong) {
        // spill 路径必须转成 bash 可见形式，否则"用 grep/head 直接读该文件"在 bash 里不可用
        let spillShown = governed.streams.stdout.spillPath || ''
        if (spillShown) {
          const mapped = wsmod.toBashPath(workspace, spillShown)
          spillShown = mapped.ok ? mapped.bashPath : spillShown.replaceAll('\\', '/')
        }
        parts.push('[输出过长：仅显示' + (governed.streams.stdout.truncated ? '截取后的' : '前') + LIMIT + '字符' + (spillShown ? '；完整输出在 ' + spillShown : '') + '。需要细节时用 grep/head 直接读该文件]')
      }
      parts.push(tooLong ? text.slice(-LIMIT) : text)
      if (governed.streams.stderr.text.length > 0) parts.push('[stderr] ' + governed.streams.stderr.text.slice(0, 4000))
      // 客户端 dsh-client-ui-tool 的 parseExitStatus 需要文本以 "\n[exit code: N]" 结尾
      // 才能渲染出 shell 卡片的退出状态；格式不符会退化为通用渲染。
      parts.push('[exit code: 0]')
      return parts.join('\n')
    },
  }), '@dsh-external/dsh-bash-runtime: bash tool')
}
