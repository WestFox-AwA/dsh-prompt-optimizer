# PTC 能力测试台（evidence/ptc-lab）

目的：用**客观、可复核、可重复**的方式回答"这套提示词优化策略在 PTC 模式下到底有没有提升"。
不靠模型自述、不靠"约束是否写全"这类自证式评分，只看**产物是否通过确定性判定器**。

## 为什么需要它

- 命令侧文本评分（旧 0~3 级 rubric）会奖励"约束齐全"，实测 0.3.8 拿 92.8% 却更差 —— 自证式评分不可用。
- Agent 自述会撒谎：实测有产物自称"已修正"，独立复算是 24 个内向面。
- 因此：**先证明判定器有效（正控必过/反控必败），再用它打分**。

## 结构

| 文件 | 作用 |
| --- | --- |
| `tasks.cjs` | 题库 + 确定性判定器 + 正控(gold)/反控(bad)；`selftest` 为判定器自证门 |
| `exec-framework.cjs` | 固定不变的 PTC 执行端框架（系统提示词、程序抽取、沙箱执行） |
| `build-strategies.cjs` → `strategies.json` | 候选策略清单（= 一段 system 提示词，取快照 extreme 档） |
| `server.cjs` + `index.html` | 实时面板（http://127.0.0.1:3097/），1s 轮询 `live.jsonl` |
| `digest.cjs` / `show.cjs` | 结果摘要 / 单轮程序与完整输出 |
| `runs/*.json`、`latest.json`、`live.jsonl` | 结果、最近一次、逐格事件流 |

宿主内主循环由 staging 工具 `ptclab` 驱动（`dev_stage_call ptclab {...}`）：它把 `tasks.cjs`
与 `exec-framework.cjs` 用 require 垫片在宿主内求值（单一真源，改文件即可迭代），调 `llm` 服务，
用 `spawnSync` 做沙箱执行。**不需要任何外部 API key，也不消耗第三方额度。**

## 一次测量怎么跑

芯片式流程：候选策略 →（精炼）→ 一条命令 →（固定 PTC 执行端，一轮一个程序）→ 产物 → 判定器。

```
node evidence/ptc-lab/tasks.cjs selftest     # ① 判定器自证：不过就不许打分
dev_stage_call ptclab { tasks, strategies, rep, rounds, budgetMs }   # ② 跑
node evidence/ptc-lab/digest.cjs             # ③ 看逐格结果
```

对照组 `norefine`（原话直送、不做精炼）用于回答"精炼本身有没有贡献"。

## 测试台自身的缺陷（都是实测踩到并已修，记录以免重犯）

1. **程序文件写在沙箱目录里** → 撞"未新增多余文件"检查，正确解被判失败。改：程序放沙箱外，`cwd` 指沙箱。
2. **沙箱在插件仓库内** → 继承 `package.json` 的 `"type":"module"`，`.js` 被当 ESM，`require` 未定义，全部 exit 1。
   改：沙箱移到系统临时目录；按语言/是否 ESM 选 `.cts/.mts/.cjs/.mjs`（Node 24 原生剥离 TS 类型 → 执行端可写真 TypeScript）。
3. **`maxTokens` 过小把程序从中间截断** → 残缺程序语法错 → 被记成"模型失败"。改：默认 8000；命中 `max-tokens` 的轮次标
   `rigLimited` 并从通过率中剔除（测试台上限不得算成能力问题）。
4. **Python 输出按本地编码（GBK）** → 判定器按 UTF-8 读成乱码，正确的中文输出被判失败。
   改：按 buffer 收，UTF-8 失败则用 `TextDecoder` 试 gb18030/gbk/cp936。
   注意 `Buffer.toString('gbk')` 不存在（Node 不支持该 encoding）。
5. **判定器过严**：题面只冻结"字段与键顺序"，判定器却做逐字符比对，美化的正确解被判死。改：解析后重新序列化比对。

## 首批数据（2026-09-16，4 题 × 3 策略 × 1 次，约 8 分钟）

模型 `deepseek-official/deepseek-v4-flash-vision-exp`；轮次上限 4。

| 策略 | 计分格 | 通过 | 通过率 | 长度限 | 精炼字符 | 精炼耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| `norefine`（对照） | 3 | 1 | 33.3% | 1 | 0 | 0 |
| `v011`（0.1.1 原样） | 3 | 1 | 33.3% | 1 | 8017（每格 ~2000） | 71s |
| `v0310`（0.1.1+PTC_RULES，当前线上） | 3 | 2 | **66.7%** | 1 | 3354（每格 ~838） | 27s |

方向与假设一致（0.3.10 > 0.1.1），但 **n=1，不能当结论**。可观察到的机制差异：
`v011` 精炼出的命令 1.6k–2.2k 字符、带"阶段 0 先勘察 / goal / todo / 每步贴证据"，
执行端因此把第 1 轮浪费在 `pwd; ls -a` 勘察上（html 那格 4 轮后**没有任何产物却报 DONE**）；
`v0310` 精炼出 642 字符"一次做完"，1 轮通过。

## 已知未修的判定器问题（修完才能把上表当能力分）

1. `cli-stats` 判定器要求 stdout 含"行/词/字符"字样，但**题面没规定输出格式** → 输出 `2 5 24` 的正确解被判失败。
   修法：题面写明输出格式（保持确定性判定）。
2. `mesh-normals` 判定器装载 `normals.js` 的方式对 ESM 解答不友好（题面允许"导出函数"，未规定模块形态）→ 需 try require / dynamic import 双通道。
3. 题库仅 4 题、每格 1 次重复（噪声带未知）→ 需扩到 ~24–40 题、8–10 域，并做难度校准（基线 <20% 或 >80% 的题淘汰）
   与随机化参数、隐藏检查、负控题。

## 后续（未做）

- 真实 PTC 门（`agentLoop.createAgent(…, meta:{agentPreset:'ptc'})` 驱动 API 未验证）作为第二通道，与模拟沙箱对照。
- 公开基准小样本对齐（Terminal-Bench 2.0 / SWE-bench Pro / OSWorld 2.0）。
- 判定器主观维度（UX 可判定性、歧义处理）目前未纳入，避免引入 LLM 评委噪声。
