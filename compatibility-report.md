# P1 宿主兼容性报告（compatibility-report）

> 阶段：P1（宿主接入与生命周期探针）。宿主：`@deepseek-ai/dsh@0.1.6-alpha.1`，Node `v24.19.0`。
> **本报告只写实测结论。**每条的来源见 `EVIDENCE.md` 对应编号；未验证项明确标为未验证，不得当作可用。

## 一、结论摘要

0.6 架构所需的四条接入能力**全部成立**：

1. **非人类来源上下文的附着**——成立（EV-0010）。
2. **动态上下文的注册、排序、去重、卸载**——成立，且去重由宿主负责（EV-0013/0014）。
3. **不唤醒投递**——成立（EV-0020），并有可归因的取消。
4. **持久投影承载状态**——成立（EV-0018），但受 ADR-0011 的性能约束。

因此 **0.6 的架构不需要因宿主限制而改**。需要改的是实现约束（见第四节）。

## 二、能力对照表

| 0.6 依赖的能力 | 宿主事实 | 结论 | 证据 |
|---|---|---|---|
| plugin 来源消息可被工作模型看到 | `createUserMessage({source:{kind:'plugin',form,summary}})` 产出冻结消息；投递后成为持久 `user/message`，source 完整保留；模型请求中可见 | **可用** | EV-0010 |
| 不冒充人类来源 | `sessionController.prompt` 强制 `source.kind='user'`（源码事实）；存在 `kind:'plugin'` 通道 | **可用**（走 plugin 通道） | EV-0010 |
| 动态上下文注册 | `systemPrompt.context({name, order, text})`，返回 disposer，支持函数式 text | **可用** | EV-0013 |
| 上下文排序 | 按 `order` 升序装配 | **可用** | EV-0013 |
| 上下文去重/不重复注入 | 宿主 `RuntimeContextProjection.project()` 文本未变则不产生消息 | **宿主已具备** | EV-0014 |
| 上下文卸载 | dispose 后立即从装配中消失；插件卸载后无残留 | **可用** | EV-0013 / P1-6 |
| 上下文体积可见 | `assemble({agent, scope})` 可读出全部贡献者与字符数 | **可用**（必须带作用域，见 EV-0016） | EV-0015/0016 |
| 不唤醒投递 | `agent.inject` → next-step，`turn/start` 增量 0 | **可用** | EV-0020 |
| 唤醒投递 | `agent.followup` / `agent.steer` → 唤醒 | **可用**（受 ADR-0012 约束） | EV-0010 / EV-0020 |
| 可归因取消 | `agent.cancel(cause)` → `turn/end.reason={kind:'aborted',reason}` 持久记录 | **可用** | EV-0020 |
| 状态持久化 | `sessionProjections.register` + `checkpoint` 产出 `{ver,seq,val}` | **可用** | EV-0018 |
| 状态卸载清理 | dispose 后 `stateOf` 返回 undefined | **可用** | EV-0018 |
| 回问（负例） | 5 个校验分支在触达 answerer 前抛错 | **可用** | EV-0017 |
| 回问（正向） | 会真实弹到用户界面 | **未验证**（P4，需约定时机） | — |
| 子代理回问隔离 | `DELEGATED_CALLER` 分支 | **仅源码确认，未实测** | EV-0017 |
| 服务可用性 | `agents/sessions/sessionController/userQuestions/systemPrompt/llm/tools/webServer/settings/sessionProjections/sessionProjectionCache/storage/commands/attachments/jobs/skills` 存在 | **可用** | EV-0009 |
| 部分服务不存在 | `workspace` / `goal` / `logger` **absent** | **必须降级处理** | EV-0009 |
| 定时器 | `ctx.setInterval` 需 `export const inject` 声明 | **可用（有前提）** | EV-0012 |

## 三、对本机环境的量化事实

- 每会话动态上下文基线 ≈ **1003–1037 字符**，其中 0.5.x 插件占 298–339（EV-0015）。
- 宿主已注册 **23 个投影键**（EV-0018）。
- 本机在册 **68 个 agent，全部为 root**（EV-0019）——这直接放大了投影的驱动代价。
- 单个投影单元的 `apply` 在一次测试窗口内被调用 **1407 次**（EV-0018）。

## 四、由宿主事实推出的实现约束（已落为 ADR）

| 约束 | 原因 | ADR |
|---|---|---|
| 意图包用 `form:'snapshot'` 取代语义，不用 `notice` | 宿主合并为一条聚合快照并在文本未变时不重发 | ADR-0006 |
| 不重复陈述权限档/审批 | 宿主 `sandbox:policy`/`approval:policy` 已陈述 | ADR-0009 |
| 通道探测只按需注入；通用行为规则不默认常驻 | 无证据的常驻指令不应默认存在 | ADR-0009 |
| 投递默认 `inject`（不唤醒） | 唤醒会产生用户未预期的成本与输出 | ADR-0012 |
| 投影 `apply` 首句短路并返回同一引用 | 反向引用相等是宿主判变化的依据；调用量按会话数×事件数增长 | ADR-0011 |
| 投递/验证以持久日志为准 | `followup` 会立即认领，inbox 即时读取有竞态 | ADR-0007 |
| 属性式服务访问必须声明 `export const inject` | 未声明时读取即抛错 | ADR-0008 |
| `ctx.inject` 回调是异步的，必须 await 就绪 | P1-6 实测自检因此失败过一次 | 见 EV-0022 |
| 动态上下文是全局的：静默时文本必须为空 | 非空文本会进入**所有**会话，含用户正在使用的 | 见 EV-0022 |
| P4 前不实现真实发问 | 会打扰用户 | ADR-0010 |

## 五、仍未验证（不得当作可用）

1. **跨重启的状态恢复**：只验证了 `checkpoint` 产出，未做重启后的 hydrate 实测。
2. **running agent 上的 `steer`**：其真实用途未测（成本与风险更高）。
3. **`wire.viewSchema` 路径**：未声明 wire，未测客户端可见性校验。
4. **正向提问的真实交互**：留到 P4。
5. **`DELEGATED_CALLER`**：需非 root 子 agent 才能触发。
6. **多进程/并发 CAS**：宿主当前为单进程。
7. **0.4.4 在真实宿主中的装配运行**：仅在桩宿主下验证过加载与注册（EV-0003）。

## 六、P1 交付物

- `po06/` —— 最薄 DshAdapter 原型（`@dsh-external/dsh-po06@0.6.0-alpha.0`）。
  生产路径：**静默待命 + 不唤醒投递**；自检由标记文件 `exp/po06/run-selfcheck.flag` 触发。
  已验证：上下文注册/动态求值/静默复位/不唤醒投递（EV-0022）。
  明确不含：LLM 调用、质量展开、用户输入解析、web 路由。
- `compatibility-report.md` —— 本文件。
