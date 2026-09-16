# 重启后活实例复测（2026/09/16，针对 0.3.12-beta.1）

重启前所有"界面实际生效"的结论都标为待复测；本文是收口记录。

## 复测项 1：策略指纹 —— 已切换 ✓

方法：让活实例真实生成一条命令（`evidence/relay-once.cjs`，tier=extreme），再数 0.3.x 特征段名
（`evidence/fp.cjs`）。探针请求：给插件加"每周自动清理日志"开关 + 修设置页下拉框对齐。

| 指标 | 重启前（0.3.8 代码） | 重启后（0.3.12-beta.1） |
| --- | --- | --- |
| 生成命令字数 | 1763 / 1984 / 2305（三次） | **905** |
| `流程长度` | 1 | **0** |
| `不得降级清单` | 1 | **0** |
| `本轮不做项` | 1 | **0** |
| `停手条件` | 1 | **0** |
| `证据形式` | 1 | **0** |
| 文风 | 计划/阶段/闸门式（0.3.x 规划器） | 改写器式（"先把仓库读一遍确认事实再动手…"） |

结论：活实例**已运行 0.1.1 + PTC 规则**策略，与 `evidence/prompt-snapshot-v0312.json`（1273/1627/1736）一致，
"只改 junction + 热重载不切版本、必须重建 loader entry（重启）"这条规程得到验证。

## 复测项 2：`/api/state` 的 settings —— 报错消失，但状态是 `no-settings-service` ⚠️

| | 重启前 | 重启后 |
| --- | --- | --- |
| `state.settings` | `error: TypeError: schema is not a function` | **`no-settings-service`** |

即：zod→schemastery 的修复生效了（不再抛 TypeError），但插件在初始化时**没拿到 settings 服务**
（`ctx.get('settings')` 为空），因此命名空间未注册、设置镜像未启用。

初步判断（**待验证**）：`initSettingsNamespace(ctx)` 只在插件 apply 时执行一次，而 settings 服务的挂载
可能晚于本插件（boot 顺序）——一次性查询错过就永久错过。修法（拟 0.3.13）：
在既有的 1.2s 看门狗里，只要 `settingsStatus === 'no-settings-service'` 就重试一次注册（幂等、自愈，注册成功即停）。

注意：该项**不影响**提示词策略与 UI 主体功能，只影响"设置页命名空间/镜像"这条可选能力。
