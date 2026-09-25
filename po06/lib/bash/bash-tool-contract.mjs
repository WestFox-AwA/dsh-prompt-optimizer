/**
 * bash-tool-contract — 模型可见的 Bash 工具契约：schema、说明与错误渲染。
 * 目标：模型不需要猜 shell 类型与路径规则；每次失败都给出可执行的下一步。
 */
export const TOOL_NAME = "bash";
export const BASH_TOOL_CONTRACT_VERSION = "1";

/** 结构化事实：文档、测试与渲染共用同一来源，避免说明与实现对不上。 */
export function contractFacts() {
  return Object.freeze({
    shellKind: "bash",
    shellRuntime: "GNU bash（MSYS2 运行时，原生 Win32 POSIX 层；**不是** WSL）",
    notShells: ["PowerShell/pwsh", "cmd.exe", "sh/dash 的 POSIX 子集"],
    pathStyle: "POSIX 风格路径；Windows 盘符映射为 /d/...（D:\\ → /d/）",
    forbiddenPathStyles: ["WSL 的 /mnt/c", "cmd 的 %VAR% 展开", "PowerShell 的 $env:VAR"],
    workdirRule: "workdir 参数用宿主路径（C:/... 或 D:/...），由插件按显式映射转换；不要在 command 里写宿主反斜线路径",
    argvRule: "需要程序参数原样传递时用 args 数组（不经过 shell 解析）；$0 固定为 dsh-bash，args 依次为 $1…$n",
    quotingRule: "command 按 bash 语义解析；含空格或特殊字符时用单引号包裹；数组参数不要手工拼进 command",
    featuresRule: "支持管道、重定向、命令替换、进程替换、glob 展开（由 bash 执行）；globstar 需先 shopt -s globstar；未匹配的 glob 原样保留",
    streamRule: "stdout 与 stderr 分开返回；truncated 为真时完整输出在 spillPath；输出按 UTF-8 解码且非法字节会被诊断",
    retryPolicy: "非零退出不会自动重试、也不会自动换后端；失败原因由 exitCode/signal/timedOut/aborted 表达",
    timeoutRule: "timeoutMs 到期会终止**整个进程树**并回收；onExpiry=none 表示不设截止时间（调用方须自带取消）",
    envVarRule: "bash 环境变量写作 $VAR 或 ${VAR}（不是 $env:VAR，也不是 %VAR%）",
    exitCodeRule: "上一条命令的退出码是 $?；管道各段用 ${PIPESTATUS[@]}",
    heredocRule: "多行输入用 heredoc（cat <<EOF … EOF）或 stdin 参数",
    newlineRule: "输出原样保留换行（Windows 工具可能给 CRLF）；跨平台比较可 tr -d 回车或 grep -a",
    encodingRule: "输出按 UTF-8 解码；非法字节会被诊断（invalid-bytes / window-started-mid-codepoint），不静默替换"
  });
}

export const BASH_TOOL_DESCRIPTION = [
  "执行 bash 命令并返回 stdout、stderr 与退出信息。",
  "",
  "【shell 类型】本工具执行的是 GNU bash（" + contractFacts().shellRuntime + "）。它不是 PowerShell/pwsh，也不是 cmd.exe；请勿使用 PS/cmd 语法（如 Get-ChildItem、$env:VAR、%VAR%）。",
  "【路径规则】命令内使用 POSIX 风格路径；Windows 盘符映射为 /d/...（D:\\ → /d/）。不要使用 WSL 的 /mnt/c。workdir 参数用宿主路径（C:/... 或 D:/...），由插件按显式映射转换；不要在 command 里写宿主反斜线路径。",
  "【参数与引用】command 按 bash 语义解析；含空格或特殊字符时用单引号包裹。需要参数原样传递（不被 shell 展开）时，用 args 数组传入：它们依次成为 $1…$n，且 $0 固定为 dsh-bash。不要把数组参数手工拼进 command。",
  "【管道与 glob】支持管道、重定向、命令替换、进程替换与 glob 展开，均由 bash 执行；globstar（**）需先执行 shopt -s globstar；未匹配的 glob 会原样保留（未设 nullglob）。",
  "【输出与截断】stdout 与 stderr 分开返回；truncated 为真时内存只保留尾部，完整输出在 spillPath，可用 grep/head 直接读取该文件。输出按 UTF-8 解码；非法字节会以 window-started-mid-codepoint 或 invalid-bytes 明确诊断，不会静默变问号。",
  "【失败语义】非零退出不会自动重试、也不会自动换后端；请根据返回的 exitCode/signal/timedOut/aborted 与 stderr 判断，并按返回的修复步骤处理。",
  "【bash 惯用写法】环境变量写作 $VAR 或 ${VAR}（不是 $env:VAR，也不是 %VAR%）；上一条命令的退出码是 $?，管道各段用 ${PIPESTATUS[@]}；多行输入用 heredoc（cat <<EOF … EOF）或 stdin 参数；逐行处理用 while IFS= read -r line。",
  "【换行与编码】输出原样保留换行（Windows 工具可能给 CRLF）；跨平台比较可先 tr -d \\r 或给 grep 加 -a。输出按 UTF-8 解码，非法字节会被诊断（invalid-bytes / window-started-mid-codepoint），不会静默替换。",
  "【超时】timeoutMs 到期会终止整个进程树并回收子进程；onExpiry=none 表示不设截止时间（需由调用方取消）。"
].join("\n");

/** 模型可见 schema：字段与说明一一对应，未知字段应被拒绝。 */
export const BASH_TOOL_SCHEMA = Object.freeze({
  name: TOOL_NAME,
  description: BASH_TOOL_DESCRIPTION,
  parameters: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: Object.freeze({
      command: { type: "string", description: "bash 源文本（非 PowerShell/cmd）。路径用 POSIX 风格；盘符写作 /d/...；含空格或特殊字符时用单引号包裹。" },
      args: { type: "array", items: { type: "string" }, description: "原样传递给脚本的参数，依次成为 $1…$n（$0=dsh-bash）。不经过 shell 解析，避免把用户数据拼进命令字符串。" },
      workdir: { type: "string", description: "工作目录，使用宿主路径（C:/... 或 D:/...），由插件映射为 bash 路径；不要在此处写反斜线路径。" },
      stdin: { type: "string", description: "写入命令标准输入后关闭；缺省表示立即 EOF。需要多行输入时优先 heredoc。" },
      timeoutMs: { type: "number", description: "毫秒截止时间；到期终止整个进程树。缺省用后端默认值，超过上限会被钳制。" }
    })
  })
});

/* ── 错误渲染：发生了什么 / 为什么 / 下一步 ─────────────────────── */

const CATEGORIES = ["exit", "timeout", "cancelled", "spawn-error", "integrity", "unmapped-path", "unsupported-target", "backend-unavailable"];

export function renderToolError(input) {
  const i = input || {};
  const tails = (s, n) => String(s === undefined || s === null ? "" : s).slice(-(n || 400));
  const steps = [];
  let category = i.category;
  let headline = "";
  let why = "";

  if (category === undefined) {
    if (i.integrity) category = "integrity";
    else if (i.paths && (i.paths.errno === "UNMAPPED_PATH" || i.paths.errno === "AMBIGUOUS_PATH_MAPPING")) category = "unmapped-path";
    else if (i.selection && i.selection.status === "unavailable") category = "backend-unavailable";
    else category = i.reason || "exit";
  }
  if (!CATEGORIES.includes(category)) throw new TypeError("unknown error category: " + category);

  if (category === "exit") {
    headline = "命令以退出码 " + String(i.exitCode) + " 结束" + (i.signal ? "（信号 " + i.signal + "）" : "") + "。";
    // 三种情形必须分开说：把"命令自己返回非零且无 stderr"写成"stderr 末尾：（空）"是噪声，
    // 会让人误以为 stderr 读取失败，而实际含义是"本次没有 stderr"。
    const stderrTail = tails(i.stderr, 300);
    if (stderrTail) {
      why = "stderr 末尾：" + stderrTail;
      steps.push("先看 stderr 指出的位置（文件/行号/参数），再用 grep -n 或 sed -n 定位。");
    } else if (i.signal) {
      why = "命令被信号 " + String(i.signal) + " 终止，本次没有 stderr 输出。";
      steps.push("先判断信号来自超时/取消还是命令自身；再检查命令里的 kill/等待逻辑。");
    } else {
      why = "命令自身返回退出码 " + String(i.exitCode) + "，本次没有 stderr 输出（非工具故障，失败状态已完整回传）。";
      steps.push("按退出码语义排查：非零常表示「未匹配 / 检查未通过」这类否定结果，逐条核对命令的判断条件（如 grep 无匹配、test 为假）。");
    }
    steps.push("若命令不存在，用 command -v <name> 确认；若缺少工具，改用已具备的工具或安装到运行时时。");
    steps.push("确认路径写法：命令内用 POSIX 风格（/d/...），不要用 PowerShell 或 WSL 风格。");
    if (i.truncated) steps.push("输出被截断，完整内容在 " + i.spillPath + "；用 grep/head 直接读该文件。");
  } else if (category === "timeout") {
    headline = "命令超过 " + String(i.timeoutMs) + "ms 被终止，进程树已回收。"
      + (i.maxTimeoutMs ? "（本次上限 " + String(i.maxTimeoutMs) + "ms）" : "");
    why = "超时属于明确的截止语义，不代表命令写错——但**先改做法，而不是先加等待**："
      + "把任务缩小或拆开，通常比提高 timeoutMs 更快拿到结果。";
    steps.push("缩小扫描范围：find 加 -maxdepth、grep 加 --max-count、只在目标目录上操作。");
    // 2026-09-25 改序：原先"提高 timeoutMs"排在这里，等于教模型用**加大等待**解决超时
    // （实测：一条含 npm i 的命令被传 4200000ms，挂满 70 分钟才被终止）。现在先引导**改做法**，
    // 只在"确认命令本身能跑完且必须一次跑完"时才提提高超时，并带上真实上限。
    steps.push("拆成多步：先跑最可能出结果（或最可能卡住）的那一步，看清它慢在哪，再决定下一步。");
    steps.push("若是网络操作（npm/pip/curl/git clone），单独跑并确认能通——耗时不可预测，不要并进长链。");
    if (i.maxTimeoutMs) {
      steps.push("确认这条命令**本身能跑完**、且必须一次跑完时，才提高 timeoutMs（上限 " + String(i.maxTimeoutMs) + "ms，超过会被钳制到上限）。");
    }
  } else if (category === "cancelled") {
    headline = "命令被取消（外部取消信号），进程树已回收。";
    why = "取消来自调用方，不是命令本身失败。";
    steps.push("确认是否仍需该结果；需要则重新执行。");
    steps.push("若取消是误触，检查上层超时/取消配置。");
  } else if (category === "spawn-error") {
    headline = "无法启动命令。";
    why = "启动失败：" + String(i.spawnError || "未知原因");
    steps.push("确认可执行文件路径存在且可执行（command -v / ls -l）。");
    steps.push("若是运行时缺失或损坏，按完整性修复步骤重新安装运行时。");
  } else if (category === "integrity") {
    headline = "运行时完整性校验失败，已阻止执行（" + String(i.integrity && i.integrity.errno ? i.integrity.errno : "RUNTIME_INTEGRITY_FAILED") + "）。";
    why = "受控运行时与清单不一致：" + String((i.integrity && i.integrity.problems ? i.integrity.problems : []).map((p) => (p.path || "?") + "(" + p.problem + ")").join(", ") || "未提供细节");
    for (const s of (i.integrity && i.integrity.repair) || []) steps.push(s);
    if (steps.length === 0) steps.push("重新解包运行时并按清单 sha256 校验后再激活。");
  } else if (category === "unmapped-path") {
    headline = "路径不在已映射范围内，已拒绝执行。";
    why = "涉及路径：" + String((i.paths && i.paths.path) || i.path || "?") + "（" + String((i.paths && i.paths.errno) || "UNMAPPED_PATH") + "）";
    steps.push("改用已映射根下的路径；可用映射：" + String((i.availableMappings || []).join(", ") || "（由宿主提供）"));
    steps.push("不要依赖 /c 或 /mnt/c：本项目只使用显式目录映射。");
  } else if (category === "unsupported-target") {
    headline = "当前平台/架构不受支持，未执行。";
    why = "请求目标不在白名单内。";
    steps.push("查看支持的平台-架构组合（win32-x64 等），或在受支持环境重试。");
  } else if (category === "backend-unavailable") {
    headline = "没有可用的兼容后端，未执行任何命令。";
    why = "拒绝原因：" + String(((i.selection && i.selection.decisions) || []).map((d) => d.code).join(", ") || "未提供");
    steps.push("按原因处理：方言不匹配时改用 bash 语法；探测失败时修复运行时；被禁用时调整配置。");
    steps.push("不会自动改用语义不同的 shell（例如 PowerShell）——请不要据此改写命令。");
  }

  const parts = [
    "【发生了什么】" + headline,
    "【为什么】" + why,
    "【下一步】" + steps.map((s, n) => (n + 1) + ". " + s).join(" ")
  ];
  return Object.freeze({ category, headline, why, fixSteps: Object.freeze(steps), message: parts.join("\n") });
}
