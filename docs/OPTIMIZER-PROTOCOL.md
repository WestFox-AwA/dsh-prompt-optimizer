# 短提示词优化协议 v3 · 本地实施记录

状态：已接入本地开发插件、可用户实际测试；未发布、未提交、未推送。包版本仍为 0.8.2-stable，协议版本单独标记为 3。

## 本轮实际改变

- 单一[协议模块](../po06/lib/optimizer-protocol.js)维护中英文共用核心、轻/标准/重用途、薄输出格式，以及只读/语气/英文任务翻译的可选段。
- 轻度：原意更清楚、消歧与反问。
- 标准：澄清表达加关键补足。
- 重度：围绕已有目标贡献全方位正向补充、构思、方法与建议，呈现未定前提与取舍。
- [实际组装入口](../po06/lib/index.js)只拼一个核心、一条档位说明和一次输出格式；自定义核心替换默认核心，不再叠加两份解释协议。工具主请求和无工具回退共享同一次解析/翻译快照。
- [解释器](../po06/lib/interpreter.js)兼容新 intent/clarify/add/ask 与旧 ops。新路径的 ID、消息来源与状态补丁由宿主生成；新辅助全部保持机器身份，不进入“用户明说”类别。
- [输入流水线](../po06/lib/pipeline.js)完整传递新结果，不走旧 12 条/300 字裁剪、包预算丢弃或提问配额。问题只是 proposed，没有自动问出、自动同意或默认授权。
- [状态](../po06/lib/capability.js)保留完整新辅助及任务关系，重载可读；新输入清掉旧机器增量。机器理解不再与辅助包重复注入，空增量不生成填充内容。
- 当前原话仅作为完整 originalText 独立提供。背景按现有历史设置读取，不在 system/user 重复；已在历史出现的任务起点不再另发一次，空背景不占位。
- [英文模式](../po06/lib/english-mode.js)仍先验证忠实任务翻译，再处理可选辅助。代码/路径/精确文本恢复，英文建议与任务翻译分开，用户本身的答复语言请求保留。
- [界面](../po06/lib/client.js)流式读取新四类输出，最终包仍可审查编辑。详情中显示协议 v3、设置组合预览及最后实际发送的协议/字符/effort，预览明确不是实测请求。
- [离线演练入口](../po06/lib/eval-e001.js)也改用完整协议，缓存绑定实际 system 指纹；有效零增量可记录，不冒充优化失败。

## 已核对的中文 system 长度

| 当前档位 | 普通组合 | 加只读与硬邦邦 |
|---|---:|---:|
| 轻度 | 596 | 693 |
| 标准 | 599 | 696 |
| 重度 | 639 | 736 |

数字包含核心、当前档位与输出格式；不是输出裁剪阈值，不含任务、历史或工具 schema。字符数不等于 provider tokens，不证明时延按同比例下降。

## 本机覆盖迁移

- 本机旧默认文件已按精确 hash 确认，迁移为 323 字符的短核心。
- 迁移前以 Copy-Item 原样备份；两文件 SHA256 均为 c0374fa48461d5aad5a6d41d255c49672481ba35fa2c0da68232098c6e42270d。
- 备份为 [po06-prompt.before-protocol-v3-c0374fa4.md](../../../po06-prompt.before-protocol-v3-c0374fa4.md)。
- 已知旧默认匹配时改用内置短核心，原文件不被解析器覆写；任何实际修改过的自定义文本继续保留，并可继续解析旧 ops。自定义协议若自身写得很长，长度不会被偷偷裁剪。

## 验证与证据

- 完整回归：93 套通过，0 失败，各套件自报通过合计 1,002。末尾长原文历史去重修正后又跑了 8 套受影响用例，全部通过；见[回归日志](evidence/optimizer-protocol-regression.txt)。
- 新协议自身 14 个测试涵盖双语单次组装、原意/机器来源、长建议与多反问完整传递、有效空增量、追问/换任务、迟到/取消/跨会话、英文字面量、真正自定义保留、一次翻译、存档重读与实际请求记录。
- 流式显示、旧 ops、只读工具、真实生产订阅、中文与英文来源等受影响套件亦通过。
- 仅定向检查两个更新了锚点的变异守卫，二者均用合法变异触发失败，源码字节还原；见[守卫记录](evidence/optimizer-protocol-guards.txt)。未重跑全量变异或声明新的发版门通过。
- 用已加载插件做小型 Flash/low 真实格式验证；第一次临时返回序列化不正确，不作成果证据，第二次记录在[模型冒烟原始结果](evidence/optimizer-protocol-runtime-smoke.json)。
- 可核对的那次调用：system 639 字符、请求正文 50 字符、15,189ms、reasoning 7,495 字符、usage.totalTokens 3,555。只证明新格式可返回和可解析，不证明模型能力或耗时改善。

## 仍须由用户实际判断

新协议不使用固定行业清单，但模型仍可能给出清单化、过多或者并不合适的建议。冒烟返回中出现“至少包含”等建议措辞，保留在机器建议栏目，没有成为用户要求；它是否有真实价值不能由格式校验、字数比例或自评分证明。

解释模型当前仍配置 Max；本轮没有改任何用户思考档位、权限、英文模式或推理增强开关。若仍出现长思考，需要对照同模型/effort 的真实任务，再判断是协议、背景还是推理预算造成。

## English summary

The local plugin now uses compact protocol v3: a single shared core, one selected tier and a small intent/clarify/add/ask format. The host owns identifiers, provenance and state operations. The original source stays separate and authoritative; all generated additions remain machine advice. Legacy ops responses and stored state remain readable.

Light clarifies intent; Standard adds the most consequential missing pieces; Heavy develops broad positive contributions around the existing goal. No new content-count or character quotas are enforced on compact outputs. Valid empty assistance is successful.

English translation stays separate from additions, with original literals restored. The prompt editor distinguishes a settings preview from the last actual request. A real low-effort model smoke call confirmed format usability only; it does not establish better task performance or latency. Persistent model effort settings were not changed.

Independent review was requested but not executed (assist-off). It is not counted as a passed review. The final loaded instance and live API checks are recorded in the evidence files.
