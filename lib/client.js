window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-prompt-optimizer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		const API = "/prompt-optimizer/api";
		const NS = "dsh-prompt-optimizer";
		/** 客户端侧目录缓存有效期（宿主侧另有 30s 缓存，这里避免频繁打网络）。 */
		const CATALOG_TTL_MS = 60 * 1000;
		/* 单例闸门：插件包会被 HMR 重新求值，旧实例的监听若尚未回收就会"替新实例干活"——
		   结果是旧实例拦截了发送、跑起了优化，但它的 UI 早已卸载 ⇒ 后台在跑、弹窗不显示。
		   这里让每个实例在 apply 时抢注 token，只有持有 token 的实例才有权拦截与渲染。 */
		const INSTANCE_TOKEN = NS + "#" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
		const isActiveInstance = () => {
			try { return window.__DPO_ACTIVE__ === INSTANCE_TOKEN; } catch (e) { return true; }
		};
		const MARK = "data-dpo";

		/* ══════════ 模块状态（P0 骨架：只服务于"手势拦截实测"） ══════════ */
		const store = {
			armed: true,
			tier: "basic",
			permission: "review",
			modelLabel: "会话默认",
			modelSel: null,
			modelCatalog: null,
			modelCatalogAt: 0,
			modelCatalogLoading: false,
			modelCatalogError: null,
			modelCatalogPromise: null,
			modelPop: null,
			modelPopOpen: false,
			node: null,
			overlay: { open: false, text: "", src: "" },
			reviewText: null,
			regenAsk: false,
			regenDir: "",
			touched: false,
			intercepts: [],
			listeners: new Set(),
			latest: { input: null, session: null, actions: null, sessionId: undefined },
			viewSessionId: null,
			stash: {},
			tierBySession: {},
			permissionBySession: {},
			panes: { thinking: null, original: false, trace: false },
			turns: 0,   // 回合模式：读入最近 0~10 回合（0 = 不读历史）
			historyMode: "turns",   // 上下文模式：turns（回合 0~10）/ full（全文：与工作 AI 看到的上下文一致）
			fullOn: false,          // 全文模式的开关（滑块只有两档：关 / 开）
			locale: "zh",   // 跟随 DSH 语言设置（locale 服务）
			ball: { visible: false, pos: null, run: null, sent: false },
			helpOpen: false,
			helpPos: null,
		};
		/* ── i18n：与 DSH 语言设置对接（locale 服务给出 zh / en）。键＝中文原文，查不到就原样返回（中文兜底）── */
const EN_TEXT = {
  "档位": "Tier",
  "权限": "Permission",
  "关闭": "Off",
  "普通": "Basic",
  "高级": "Advanced",
  "极端": "Extreme",
  "审查": "Review",
  "自动": "Auto",
  "需要审查": "Review",
  "自动输出": "Auto",
  "提示词优化": "Prompt Optimizer",
  "提示词优化档位": "Optimizer tier",
  "提示词优化档位：关闭 / 普通 / 高级 / 极端": "Optimizer tier: Off / Basic / Advanced / Extreme",
  "优化权限": "Optimizer permission",
  "优化权限：需要审查 / 自动输出": "Optimizer permission: Review / Auto",
  "优化模型（与对话模型独立）": "Optimizer model (independent of your chat model)",
  "优化所用模型（与对话模型独立）": "Model used for optimization (independent of your chat model)",
  "选择模型": "Choose a model",
  "正在加载模型目录…": "Loading model catalog…",
  "刷新目录": "Refresh",
  " · 不可达": " · unreachable",
  "会话当前": "session current",
  "（当前会话模型）": "(current session model)",
  "恢复默认（跟随会话）": "Reset (follow the session)",
  "模型目录不可用": "Model catalog unavailable",
  "重试": "Retry",
  "取消": "Cancel",
  "知道了": "Got it",
  "读入最近对话的回合数": "Turns of recent dialogue to read",
  "读入完整上下文（全文）": "Read the full context (full-text)",
  "回合": "Turns",
  "全文": "Full text",
  "开": "On",
  "关": "Off",
  "上下文模式：回合（读最近 0~10 回合）— 点一下切到「全文」": "Context mode: Turns (last 0–10 turns) — click to switch to Full text",
  "上下文模式：全文（与工作 AI 看到的上下文一致）— 点一下切回「回合」": "Context mode: Full text (same context the working AI sees) — click to switch back to Turns",
  "上下文模式：": "Context mode: ",
  "（点击切换）": " (click to switch)",
  "读最近 0~10 回合：只保留你的原话，工作 AI 的回复只留长度（防被带偏）": "Read the last 0–10 turns: your own words only; the working AI's replies are reduced to their length (so they cannot bias the rewrite)",
  "把工作 AI 现在看到的完整上下文（双方全文）交给优化模型，两档：关 / 开": "Hand the optimizer the full context the working AI currently sees (both sides verbatim); two positions: Off / On",
  "档位为「关闭」时不生效": "Inactive while the tier is Off",
  "档位（点击展开弹层调整）": "Tier (click to open the popover)",
  "档位（滑块越右越强）": "Tier (the further right, the stronger)",
  "使用帮助（怎么用 / 档位 / 权限 / 推荐组合）": "Help (how to use / tier / permission / recommended combo)",
  "使用帮助 · 提示词优化": "Help · Prompt Optimizer",
  "怎么用": "How to use",
  "照常输入，按 Enter（或点发送）": "Type as usual, press Enter (or click send)",
  "消息不会直接发出，先被优化": "The message is not sent directly — it is optimized first",
  "迷你窗里看「思考/产出」，再决定发送": "Check Thinking / Output in the mini window, then decide whether to send",
  "只把话说清楚，不加新需求（约 3 秒）": "Just says it clearly, adds no new requirements (~3 s)",
  "先自己把事推一遍，再把必要假设、步骤、边界与验收写成要求（约 20 秒）": "Thinks it through first, then turns the necessary assumptions, steps, boundaries and acceptance criteria into requirements (~20 s)",
  "读项目真实结构 + 按难度决定是否建 goal/分阶段；命中不可逆/发布类信号才给多情况预案（约 20 秒）": "Reads the real project structure; decides by difficulty whether to create a goal/stages; only adds contingencies when irreversible or release-type signals appear (~20 s)",
  "完全不拦截，恢复原生发送": "No interception at all — native sending is restored",
  "优化器会做什么（v0.2.1 起）": "What the optimizer does (since v0.2.1)",
  "实质优先": "Substance first",
  "先在推理通道里把题算一遍/把事推一遍，再把结论变成对工作 AI 的要求（假设、步骤、单位、边界、异常）": "Works the problem out in the reasoning channel first, then turns the conclusions into requirements for the working AI (assumptions, steps, units, boundaries, exceptions)",
  "流程长度": "Process weight",
  "替工作 AI 定开发长度：轻＝直接做完验证、不要建 goal/todo；中＝先列 3~6 条 todo；重＝先建立 goal + 分阶段": "Decides the working AI's process weight: light = just do it and verify, no goal/todos; medium = list 3–6 todos first; heavy = create a goal and work in stages",
  "硬约束": "Hard constraints",
  "分清 必须做 / 不得做 / 做完必须满足的判据，并各带一句违反时的处置": "Separates must-do / must-not-do / must-hold-when-done, each with its violation handling",
  "防过度": "No over-process",
  "未命中高危信号（不可逆、动数据/schema、权限密钥、发布上线、对外接口、无测试可验证、目标未定）不许升档": "No escalation without a hazard signal (irreversible work, data/schema changes, credentials, release/deploy, external API compatibility, nothing can verify it, undefined target)",
  "产出可编辑，点「确认提交」才发送": "Output is editable; sent only when you click Confirm & send",
  "优化一完成就自动发出（失败也会按原文发出）": "Sent automatically as soon as optimization finishes (the original is sent if it fails)",
  "上下文（用滑块右侧的按钮切换模式）": "Context (switch modes with the button right of the slider)",
  "回合 1.2 万字符 / 全文 6 万字符；超限按整回合丢弃，绝不截断单条约束": "Turns: 12k chars / Full text: 60k chars; over budget drops whole turns and never truncates a single constraint",
  "迷你窗按钮": "Mini-window buttons",
  "‹ 回退": "‹ Roll back",
  "停止优化、关闭窗口、不发消息、原文留在输入框": "Stop, close, send nothing; your original text stays in the composer",
  "重新生成": "Regenerate",
  "先给个方向，再按该方向重跑一版": "Give a direction first, then re-run in that direction",
  "放行本条": "Send as-is",
  "不优化了，按你的原文直接发出（v0.1.9 起放行后不会再自动补发第二条）": "Skip optimization and send your original text (since v0.1.9 this no longer triggers a second auto-send)",
  "右下角": "Bottom-right",
  "拖拽可改窗口大小（会记住）": "Drag to resize the window (it is remembered)",
  "想要发挥插件所有能力且自动化，建议【极端】+【自动】。": "For full capability and automation, use [Extreme] + [Auto].",
  "本插件界面跟随 DSH 设置里的语言：中文即全中文、English 即全英文（无需在插件里另设）": "This plugin follows DSH's language setting: Chinese gives a fully Chinese UI, English a fully English one (no separate switch inside the plugin)",
  "上下文：全文（与工作 AI 看到的上下文一致）": "Context: Full text (same context the working AI sees)",
  "上下文：回合（读最近 0~10 回合）": "Context: Turns (last 0–10 turns)",
  "审查中：请点「确认提交」／「重新生成」／「回退」": "In review: click Confirm & send / Regenerate / Roll back",
  "优化进行中…请稍候（或点「回退」按原文处理）": "Optimizing… please wait (or click Roll back to use your original text)",
  "另一会话的优化已完成，切回该会话即自动发送": "Another session finished optimizing; switch back to it to auto-send",
  "优化结果已发送 · 点击回看（只读）": "Result sent · click to review (read-only)",
  "优化结果 · 点击回看": "Optimized result · click to review",
  "已发送": "Sent",
  "已发送 · 仅供查看": "Sent · view only",
  "结果": "Result",
  "原文": "Original",
  "思考": "Thinking",
  "产出": "Output",
  "轨迹": "Trace",
  "确认提交": "Confirm & send",
  "关闭窗口": "Close",
  "默认模型重试": "Retry with default model",
  "按原文发出": "Send as-is",
  "按此方向重跑": "Re-run in this direction",
  "确定回退": "Confirm rollback",
  "取消回退": "Cancel rollback",
  "确定回退？将停止优化、关闭浮层，且不发送任何消息。": "Roll back? Optimization stops, the panel closes, and nothing is sent.",
  "已回退：优化已停止，输入框原文保留": "Rolled back: optimization stopped, your original text remains",
  "重新生成：先给个方向（可留空＝换一次随机重跑）": "Regenerate: give a direction first (leave empty for a fresh random re-run)",
  "例如：更短、保留技术细节、强调验收标准…": "e.g. shorter, keep technical detail, emphasise acceptance criteria…",
  "（等待思考…）": "(waiting for reasoning…)",
  "（等待产出…）": "(waiting for output…)",
  "未收到产出": "No output received",
  "优化失败": "Optimization failed",
  "优化未产出内容": "Optimizer produced no content",
  "等待 provider 上报用量": "waiting for provider usage",
  "该 provider 未上报思考 token": "this provider did not report reasoning tokens",
  "本次优化总 token": "Total tokens for this run",
  "产出的输出 token": "Output tokens",
  "产出字数": "Output length",
  "本次思考消耗 token（provider 上报）": "Reasoning tokens (reported by provider)",
  "本次已读入的对话上下文（只含用户原话全文；工作 AI 回复只留长度）": "Dialogue context read for this run (your words verbatim; the working AI's replies reduced to their length)",
  "本会话累计拦截次数": "Interceptions in this session",
  "（暂无查证动作）": "(no verification actions yet)",
  "查证动作 ": "verification action ",
  "渲染降级": "Degraded render",
  "已记录错误": "error recorded",
  "浮层渲染出错，已降级为最小面板（优化仍在后台进行）。错误：": "The panel failed to render and was degraded to a minimal panel (optimization continues in the background). Error: ",
  "未知": "unknown",
  "按 Enter 发送": "press Enter to send",
  "拖拽可移动窗口": "drag to move the window",
  "按住拖动（右下角可改大小）": "drag to move (bottom-right to resize)",
  "拖动改大小（记住）": "drag to resize (remembered)",
  "方向框下方按钮在底部常驻操作栏（窗口再小也点得到）": "the direction buttons live in the pinned footer (clickable even in a tiny window)",
  "UI 自检通知": "UI self-check notice",
  "作者": "Author",
  "版本": "Version",
  "版本日期": "Date",
  "本版本适用于 dsh-0.1.6-alpha.1（0.1.5-rc.1 亦可）": "This version targets dsh-0.1.6-alpha.1 (0.1.5-rc.1 also works)",
  " · 本会话已拦截 ": " · intercepted in this session: ",
  "（只读）": " (read-only)",
  "访问模式": "access mode",
  "真实派发": "real dispatch",
  "已按 {tier} 档优化结果发送": "Sent the result optimized at tier {tier}",
  "（点击/拖动/方向键；当前：{v}）": " (click / drag / arrow keys; current: {v})",
  "（两档：关 / 开）": " (two positions: off / on)",
  "（拖动 / 点击 / ←→；当前 {v} 回合）": " (drag / click / ←→; currently {v} turns)",
  "全文 {t}": "Full text {t}",
  "{t} 回合": "{t} turns",
  "目录为空": "The catalog is empty",
  " 次": " times",
  "上限": "Cap",
  "加载失败：": "Load failed: ",
  "（暂无可用模型）": "(no model available)",
  "全文：把工作 AI 现在看到的完整上下文（双方全文）交给优化模型；受 6 万字符总量上限约束，超限整回合省略": "Full text: hand the optimizer the complete context the working AI sees right now (both sides verbatim); capped at 60k characters, dropping whole turns when over",
  "读入最近 0~10 回合对话作为意图上下文（0 = 不读；只读用户侧信息，工作 AI 回复只留长度）": "Read the last 0–10 turns as intent context (0 = none; user side only, the working AI's replies are reduced to their length)",
  "读入最近对话的回合数（0~10）": "How many recent turns to read (0–10)",
  "无": "none",
  "{n} 步": "{n} steps",
  " · 已达上限并收敛": " · converged at the cap",
  "查证": "Check",
  "收尾": "Wrap-up",
  " · 已达轮次上限并收敛": " · converged at the round cap",
  "行": " lines",
  "启动失败：": "Failed to start: ",
  "未知错误": "unknown error",
  "优化模型不可用 → 已按原文发出，并回退到默认模型": "Optimizer model unavailable → sent your original text and fell back to the default model",
  "优化失败 → 已按原文发出": "Optimization failed → sent your original text",
  "优化未产出内容 → 已按原文发出": "Optimization produced nothing → sent your original text",
  "该模型供应商未注册（没有可用适配器）——请在优化模型里换一个可用的 provider": "That provider is not registered (no adapter available) — pick a working provider under the optimizer model",
  "请求已被取消（回退或超时）": "The request was cancelled (rollback or timeout)",
  "找不到可用的模型路由（请先选一个优化模型）": "No usable model route (pick an optimizer model first)",
  "凭据无效或未授权（请检查该 provider 的 API Key）": "Invalid or unauthorized credentials (check that provider's API key)",
  "请求过于频繁，请稍后重试": "Too many requests — please retry shortly",
  "请求超时，可重试": "The request timed out; you can retry",
  "优化中…": "Optimizing…",
  "已完成": "Done",
  "失败": "Failed",
  " 字": " chars",
  " · 首字 ": " · first token ",
  "上下文 ": " Context ",
  " 回合 · ": " turns · ",
  "失败：": "Failed: ",
  "以下内容将原样发给工作 AI（可直接编辑） · ": "The following is sent to the working AI as-is (editable) · ",
  "放行本条（按原文发出）": "Send as-is (original text)",
  "查证动作": "Verification actions",
  "会话默认": "Session default",
};
function L(zh) {
  const s = String(zh === undefined || zh === null ? "" : zh);
  if (store.locale !== "en") return s;
  return Object.prototype.hasOwnProperty.call(EN_TEXT, s) ? EN_TEXT[s] : s;
}
function Lf(zh, params) {
  let s = L(zh);
  if (!params) return s;
  for (const k of Object.keys(params)) s = s.split("{" + k + "}").join(String(params[k]));
  return s;
}
		const TIER_TONES = { off: '#8b8f98', basic: '#4a9eff', advanced: '#a970ff', extreme: '#ff8a3d' };
		const CTX_TURNS_MAX = 10;   // 回合量程上限：0~10（再多容易把优化模型的上下文撑爆）
		const TIERS = [
			{ id: "off", label: L("关闭") },
			{ id: "basic", label: L("普通") },
			{ id: "advanced", label: L("高级") },
			{ id: "extreme", label: L("极端") },
		];
		const PERMISSIONS = [
			{ id: "review", label: L("审查") },
			{ id: "auto", label: L("自动") },
		];
		let noticeTimer = 0;
		function showNotice(text) {
			store.notice = { text, until: Date.now() + 2600 };
			emit();
			if (noticeTimer) window.clearTimeout(noticeTimer);
			noticeTimer = window.setTimeout(() => { store.notice = null; noticeTimer = 0; emit(); }, 2700);
		}
		function persistState(patch) {
			try {
				fetch(API + "/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ tier: store.tier, permission: store.permission, model: store.modelSel, sessionId: store.viewSessionId || null, turns: store.turns, historyMode: store.historyMode, fullOn: store.fullOn }, patch || {})) }).catch(() => {});
			} catch (e) { /* best effort */ }
		}
		/** 浮层几何（尺寸/位置）落盘：尺寸可自定义并跨会话记住。探针期间被抑制。 */
		function persistUi() {
			try {
				if (store.suppressUiPersist === true) return;
				const size = store.overlaySize || {};
				const pos = store.overlayPos || {};
				fetch(API + "/state", {
					method: "POST", headers: { "content-type": "application/json" },
					body: JSON.stringify({ ui: { w: size.w || null, h: size.h || null, x: pos.x === undefined ? null : Math.round(pos.x), y: pos.y === undefined ? null : Math.round(pos.y) } }),
				}).catch(() => {});
			} catch (e) { /* best effort */ }
		}
		function setTier(id, why) {
			store.tier = id;
			store.armed = id !== "off";
			if (why !== "init") store.tierBySession[sessionKey()] = id; // 只改本会话
			if (why !== "init") store.touched = true;
			beacon("tier-change", { tier: id, armed: store.armed, why: why || "ui" });
			if (why !== "init") persistState();
			emit();
		}
		function setPermission(id, why) {
			if (store.tier === "off") return;
			store.permission = id;
			if (why !== "init") store.permissionBySession[sessionKey()] = id;
			if (why !== "init") store.touched = true;
			beacon("permission-change", { permission: id, why: why || "ui" });
			if (why !== "init") persistState();
			emit();
		}
		/* ══════════ 档位/权限：按会话独立（v55） ══════════
		   每个会话各记一份；没设过的会话继承"上次用的值"（即全局默认）。
		   切换会话时像弹窗一样换入换出 —— 在 A 改档位不会影响 B。 */
		function sessionKey() { return store.viewSessionId || "__none__"; }
		function rememberTierPermission() {
			const k = sessionKey();
			store.tierBySession[k] = store.tier;
			store.permissionBySession[k] = store.permission;
		}
		function applyTierPermissionFor(sid) {
			const k = sid || "__none__";
			const t = store.tierBySession[k];
			const p = store.permissionBySession[k];
			if (typeof t === "string") { store.tier = t; store.armed = t !== "off"; }
			if (typeof p === "string") store.permission = p;
		}

		/* ══════════ 会话隔离：弹窗属于触发它的那个会话 ══════════
		   迷你窗/运行/审查编辑都挂在"当前查看的会话"上；切换会话时把这一份暂存起来，
		   切回来再取回 —— 于是 A 里触发的弹窗不会跑到 B，切回 A 又原样出现。 */
		const VIEW_KEYS = ["run", "overlay", "reviewText", "regenAsk", "regenDir", "rollbackConfirm", "ball"];
		function emptyView() {
			return {
				run: null,
				overlay: { open: false, text: "", fullText: "", src: "", sessionId: null },
				reviewText: null, regenAsk: false, regenDir: "", rollbackConfirm: false,
			};
		}
		function stashCurrentView() {
			const sid = store.viewSessionId || "__none__";
			const snap = {};
			for (const k of VIEW_KEYS) snap[k] = store[k];
			store.stash[sid] = snap;
		}
		function restoreViewFor(sid) {
			const key = sid || "__none__";
			const snap = store.stash[key];
			if (snap) { for (const k of VIEW_KEYS) store[k] = snap[k]; return true; }
			const blank = emptyView();
			for (const k of VIEW_KEYS) store[k] = blank[k];
			return false;
		}
		/** composer 报告"当前会话"变化时调用（slot 的 sessionId 是权威来源）。 */
		function onViewSessionChange(next) {
			const sid = next || null;
			if (sid === store.viewSessionId) return;
			const prev = store.viewSessionId;
			rememberTierPermission();      // 把旧会话的档位/权限存进它自己
			stashCurrentView();
			store.viewSessionId = sid;
			applyTierPermissionFor(sid);   // 载入新会话的（没设过则继承当前默认）
			const restored = restoreViewFor(sid);
			beacon("view-session-change", {
				from: prev, to: sid, restored,
				carried: restored && store.run ? store.run.status : null,
				tier: store.tier, permission: store.permission, tierScope: Object.keys(store.tierBySession).length,
				pendingSessions: Object.keys(store.stash).filter((k) => {
					const s = store.stash[k];
					return s && ((s.run && s.run.status !== "aborted") || (s.overlay && s.overlay.open));
				}).length,
			});
			// 切回时若该会话的优化已完成且是自动档，这时才补发（只有当前会话有 composer 可提交）
			const run = store.run;
			if (restored && run && run.readyToSend && store.permission === "auto") {
				const text = String(run.readyToSend);
				run.readyToSend = null;
				window.setTimeout(() => {
					try {
						if (store.latest.actions && store.latest.sessionId === sid) {
							store.latest.actions.setDraft(text);
							store.latest.actions.submit();
							store.overlay.open = false;
							store.run = null;
							store.reviewText = null;
							showNotice(Lf("已按 {tier} 档优化结果发送", { tier: run.tier }));
							emit();
						}
					} catch (e) { /* noop */ }
				}, 320);
			}
			emit();
		}

		function emit() { for (const fn of [...store.listeners]) { try { fn() } catch (e) { /* noop */ } } }
		function setOverlay(patch) { store.overlay = Object.assign({}, store.overlay, patch); emit(); }
		function record(kind, text, extra) {
			const row = Object.assign({ t: Date.now(), kind, text: String(text || "").slice(0, 160) }, extra || {});
			store.intercepts.push(row);
			emit();
			return row;
		}
		function draftFromHook() {
			const s = store.latest.input;
			return s && typeof s.draft === "string" ? s.draft : "";
		}
		/* 拦截判定必须读"此刻编辑器里真实存在的字"：React 快照可能滞后于用户输入 */
		function draftFromDom() {
			const ed = editorOf(cardOf(store.node));
			if (!ed) return null;
			const raw = typeof ed.innerText === "string" && ed.innerText.length > 0 ? ed.innerText : (ed.textContent || "");
			return raw.replace(/\u00a0/g, " ");
		}
		function draftLive() {
			const dom = draftFromDom();
			return dom === null ? draftFromHook() : dom;
		}
		function sessionOf() { return store.latest.session || {}; }
		function runningNow() { return sessionOf().running === true; }

		/* ══════════ DOM 定位（全部从本插件节点结构推导，不用产品类名/选择器） ══════════ */
		function cardOf(node) {
			let el = node;
			while (el && el !== document.body) {
				if (el.querySelector && el.querySelector('[contenteditable="true"]')) return el;
				el = el.parentElement;
			}
			return null;
		}
		function editorOf(card) { return card ? card.querySelector('[contenteditable="true"]') : null; }
		function buttonsOf(card) { return card ? Array.from(card.querySelectorAll("button")) : []; }
		function lastButtonOf(card) { const list = buttonsOf(card); return list.length ? list[list.length - 1] : null; }
		/* 发送按钮定位：①本地化标签命中（首选）②兜底=卡片内最后一个 button（官方主按钮的结构位置） */
		function sendButtonOf(card) {
			if (!card) return null;
			for (const b of buttonsOf(card)) {
				const label = b.getAttribute("aria-label");
				if (label && SEND_LABELS.has(label)) return b;
			}
			return lastButtonOf(card);
		}
		function isSendLabel(label) { return Boolean(label && SEND_LABELS.has(label)); }

		/* 发送按钮本地化标签集：懒解析 + locale 变化时重取（产品字典晚于本插件注册时不再失配） */
		const SEND_LABELS = new Set();
		const STOP_LABELS = new Set();
		let localeService = null;
		function loadSendLabels() {
			SEND_LABELS.clear();
			STOP_LABELS.clear();
			try {
				const t = localeService ? localeService.bind("conversation") : null;
				if (t) {
					for (const key of ["input.send", "input.send.queue", "input.send.steer"]) {
						const v = t(key);
						if (typeof v === "string" && v && v !== key) SEND_LABELS.add(v);
					}
					const stop = t("input.stop");
					if (typeof stop === "string" && stop && stop !== "input.stop") STOP_LABELS.add(stop);
				}
			} catch (e) { /* 字典不可用 → 点击路径走结构兜底 */ }
			return [...SEND_LABELS];
		}
		function ensureLabels() { if (SEND_LABELS.size === 0) loadSendLabels(); return SEND_LABELS.size > 0; }

		/* 焦点追踪仅作遥测；判定一律以"此刻 activeElement 是否在输入卡片内"为准 */
		let lastFocusInComposer = false;
		let lastKeyBeacon = 0;
		function insideComposer() {
			const card = cardOf(store.node);
			if (!card) return false;
			const active = document.activeElement;
			if (!active || !card.contains(active)) return false;      // 设置页/重命名框/空白处：一律放行
			if (active.closest && active.closest("button")) return false; // 焦点在按钮上（模型座位等）：Enter 交还官方
			if (active.closest && active.closest('[data-dpo="overlay"]')) return false; // 浮层内的输入（重跑方向等）：Enter 交还浮层
			return true;
		}

		function beacon(stage, data) {			try {
				fetch(API + "/beacon", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(Object.assign({ t: Date.now(), stage }, data || {})),
				}).catch(() => {});
			} catch (e) { /* best effort */ }
		}

		/* ══════════ 拦截判定（唯一真源，探针与真实手势共用） ══════════ */
		function interceptKey(e) {
			if (!store.armed) return false;
			if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
			if (e.isComposing === true || e.keyCode === 229) return false;
			if (!cardOf(store.node)) return false;
			if (!insideComposer()) return false;
			const trimmed = draftLive().trim();
			if (!trimmed || trimmed.startsWith("/")) return false;
			return true;
		}
		/** 点击接管的唯一判定（探针可直接对任意按钮求值，无需真的派发事件）。 */
		function wouldInterceptClick(btn) {
			if (!store.armed || !btn) return false;
			// 浮层自身的按钮永不吞（回退/×/确认提交/重新生成…）；本插件底栏里的按钮（含"回合/全文"转化按钮）同样永不吞
			if (btn.closest && (btn.closest('[data-dpo="overlay"]') || btn.closest('[data-dpo="controls"]'))) return false;
			const card = cardOf(store.node);
			if (!card || !card.contains(btn)) return false;
			// 只有"要发出去的草稿"才接管：空草稿时主按钮是"停止生成"，绝不可吞
			if (!draftLive().trim()) return false;
			const label = btn.getAttribute("aria-label");
			if (label && STOP_LABELS.has(label)) return false;
			ensureLabels();
			return isSendLabel(label) || lastButtonOf(card) === btn;
		}
		function interceptClick(e) {
			const target = e.target;
			const btn = target && target.closest ? target.closest("button") : null;
			return wouldInterceptClick(btn);
		}

		/* ══════════ 两个入口组件 ══════════ */
		/**
		 * 胶囊滑块：一个长圆框，里面一个小滑块滑动（更简洁、无外侧标签与数值胶囊）。
		 * 采用**单元对齐**：滑块覆盖当前档位所在的那一格（left = i/N，宽 = 1/N），
		 * 命中映射也用同一套单元坐标（floor(t*N)）——视觉、命中、键盘三者同源，不存在"点与滑块对不上"。
		 */
		function Slider(props) {
			const trackRef = React.useRef(null);
			const draggingRef = React.useRef(false);
			const prevRef = React.useRef(props.value);
			const [tick, setTick] = React.useState(0);
			React.useEffect(() => {
				if (prevRef.current !== props.value) { prevRef.current = props.value; setTick((n) => n + 1); }
			}, [props.value]);
			const n = Math.max(1, props.options.length);
			const idx = Math.max(0, props.options.findIndex((o) => o.id === props.value));
			const curLabel = L((props.options[idx] || {}).label || "");
			const pickFromX = (clientX) => {
				if (props.disabled === true) return;
				const el = trackRef.current;
				if (!el) return;
				const r = el.getBoundingClientRect();
				const t = Math.min(0.999, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
				pickIdx(Math.floor(t * n));
			};
			const pickIdx = (i) => {
				if (props.disabled === true) return;
				const opt = props.options[Math.min(n - 1, Math.max(0, i))];
				if (opt && opt.id !== props.value) props.onPick(opt.id);
			};
			const onDown = (e) => {
				if (props.disabled === true) return;
				draggingRef.current = true;
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 合成指针无捕获 */ }
				pickFromX(e.clientX);
				e.preventDefault();
			};
			const onMove = (e) => { if (draggingRef.current) pickFromX(e.clientX); };
			const onUp = (e) => {
				if (!draggingRef.current) return;
				draggingRef.current = false;
				try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
			};
			const onKeyDown = (e) => {
				if (props.disabled === true) return;
				if (e.key === "ArrowLeft" || e.key === "ArrowDown") { pickIdx(idx - 1); e.preventDefault(); }
				else if (e.key === "ArrowRight" || e.key === "ArrowUp") { pickIdx(idx + 1); e.preventDefault(); }
				else if (e.key === "Home") { pickIdx(0); e.preventDefault(); }
				else if (e.key === "End") { pickIdx(n - 1); e.preventDefault(); }
			};
			return h("div", {
				className: "dpo-cap",
				"data-dpo": props.name,
				"data-tone": props.tone || "accent",
				"data-value": props.value,
				"data-disabled": String(props.disabled === true),
				title: (props.title || "") + Lf("（点击/拖动/方向键；当前：{v}）", { v: curLabel }),
				role: "slider", tabIndex: props.disabled === true ? -1 : 0,
				"aria-label": props.title || curLabel,
				"aria-valuemin": 0, "aria-valuemax": n - 1, "aria-valuenow": idx, "aria-valuetext": curLabel,
				onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp,
				onKeyDown,
			},
				h("span", { ref: trackRef, className: "dpo-cap-track", "data-dpo": props.name + "-track", "aria-hidden": "true" },
					h("span", { className: "dpo-cap-knob", "data-dpo": props.name + "-knob", style: { width: (100 / n) + "%", left: ((idx / n) * 100) + "%" } }),
					...props.options.map((opt, i) => h("button", {
						key: opt.id,
						type: "button",
						className: "dpo-cap-opt",
						"data-dpo": props.name + "-" + opt.id,
						"data-on": String(props.value === opt.id),
						style: { width: (100 / n) + "%", left: ((i / n) * 100) + "%" },
						disabled: props.disabled === true,
						title: L(opt.label),
						tabIndex: -1,
						onClick: () => { if (props.disabled === true) return; props.onPick(opt.id); },
					}, L(opt.label))),
				),
				// 数值文本保留为可读锚点（探针与无障碍都依赖它），视觉上并入胶囊内的一格
				h("span", { className: "dpo-cap-value", "data-dpo": props.name + "-value", key: "v" + tick }, curLabel),
			);
		}
		/**
		 * 量程胶囊滑块（0~100 连续，用于"读取回合数"）。
		 * 结构：胶囊框 = [ 左侧轨道（6px 轨道 + 圆形滑块） ] + [ 右侧独立数字区 ]。
		 * - 数字**不画在滑块上**：右侧单独留位（等宽数字），两端与三位数都不会压住滑块或被裁切。
		 * - 尺寸**全部自适应**：轨道用 flex 撑开，滑块按百分比定位并左右各留 9px 内边距（= 滑块半径），
		 *   因此不依赖任何硬编码像素宽度，容器变宽变窄都不会错位。
		 * - 取值与显示**同源**：数字直接来自 props.value（store.turns），拖动即实时更新，不另开 state。
		 */
		function RangeCap(props) {
			const twoState = props.mode === "full";   // 全文态：只有两档（关 / 开），不做"读几回合"
			const max = twoState ? 1 : Math.max(1, Number(props.max === undefined ? CTX_TURNS_MAX : props.max));
			const val = Math.max(0, Math.min(max, Math.round(Number(props.value) || 0)));
			const trackRef = React.useRef(null);
			const draggingRef = React.useRef(false);
			const pickFromX = (clientX) => {
				if (props.disabled === true) return;
				const el = trackRef.current;
				if (!el) return;
				const r = el.getBoundingClientRect();
				const t = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
				const next = Math.round(t * max);
				if (next !== val) props.onPick(next);
			};
			const onDown = (e) => {
				if (props.disabled === true) return;
				draggingRef.current = true;
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 合成指针无捕获 */ }
				pickFromX(e.clientX);
				e.preventDefault();
			};
			const onMove = (e) => { if (draggingRef.current) pickFromX(e.clientX); };
			const onUp = (e) => {
				if (!draggingRef.current) return;
				draggingRef.current = false;
				try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
			};
			const onKeyDown = (e) => {
				if (props.disabled === true) return;
				const step = e.shiftKey ? 10 : 1;
				if (e.key === "ArrowLeft" || e.key === "ArrowDown") { props.onPick(Math.max(0, val - step)); e.preventDefault(); }
				else if (e.key === "ArrowRight" || e.key === "ArrowUp") { props.onPick(Math.min(max, val + step)); e.preventDefault(); }
				else if (e.key === "PageDown") { props.onPick(Math.max(0, val - 10)); e.preventDefault(); }
				else if (e.key === "PageUp") { props.onPick(Math.min(max, val + 10)); e.preventDefault(); }
				else if (e.key === "Home") { props.onPick(0); e.preventDefault(); }
				else if (e.key === "End") { props.onPick(max); e.preventDefault(); }
			};
			const pct = max > 0 ? (val / max) * 100 : 0;
			const text = twoState ? (val === 0 ? L("关") : L("开")) : String(val);
			const hint = twoState
				? (props.title || "") + L("（两档：关 / 开）")
				: (props.title || "") + Lf("（拖动 / 点击 / ←→；当前 {v} 回合）", { v: val });
			return h("div", {
				className: "dpo-cap dpo-range",
				"data-dpo": props.name,
				"data-tone": props.tone || "ctx",
				"data-value": String(val),
				"data-mode": twoState ? "full" : "turns",
				"data-disabled": String(props.disabled === true),
				title: hint,
				onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp,
			},
				h("span", {
					className: "dpo-range-rail", "data-dpo": props.name + "-track",
					role: "slider", tabIndex: props.disabled === true ? -1 : 0,
					"aria-label": props.ariaLabel || (twoState ? L("读入完整上下文（全文）") : L("读入最近对话的回合数")),
					"aria-valuemin": 0, "aria-valuemax": max, "aria-valuenow": val,
					"aria-valuetext": twoState ? Lf("全文 {t}", { t: text }) : Lf("{t} 回合", { t: text }),
					onKeyDown,
				},
					h("span", { ref: trackRef, className: "dpo-range-inner", "aria-hidden": "true" },
						h("span", { className: "dpo-range-fill", style: { width: pct + "%" } }),
						h("span", { className: "dpo-range-knob", "data-dpo": props.name + "-knob", style: { left: pct + "%" } }),
					),
				),
				h("span", { className: "dpo-range-sep", "aria-hidden": "true" }),
				h("span", { className: "dpo-range-num", "data-dpo": props.name + "-value" }, text),
				h("button", {
					type: "button", className: "dpo-ctx-mode", "data-dpo": props.name + "-mode",
					"data-mode": twoState ? "full" : "turns",
					title: twoState ? L("上下文模式：全文（与工作 AI 看到的上下文一致）— 点一下切回「回合」") : L("上下文模式：回合（读最近 0~10 回合）— 点一下切到「全文」"),
					"aria-label": L("上下文模式：") + (twoState ? L("全文") : L("回合")) + L("（点击切换）"),
					onPointerDown: (e) => e.stopPropagation(),
					onClick: (e) => { e.stopPropagation(); if (typeof props.onMode === "function") props.onMode(twoState ? "turns" : "full"); },
				}, twoState ? L("全文") : L("回合")),
			);
		}

		/** 模型目录：真加载 + 缓存 + 状态（曾经只在探针里拉过一次，弹层永远停在"加载中"）。 */
		function loadCatalog(reason, force) {
			const now = Date.now();
			if (!force && store.modelCatalog && store.modelCatalogAt && (now - store.modelCatalogAt) < CATALOG_TTL_MS) return Promise.resolve(store.modelCatalog);
			if (store.modelCatalogLoading === true) return store.modelCatalogPromise || Promise.resolve(store.modelCatalog);
			store.modelCatalogLoading = true;
			store.modelCatalogError = null;
			emit();
			const t0 = Date.now();
			const url = API + "/models" + (force ? "?force=1" : "");
			store.modelCatalogPromise = fetch(url, { cache: "no-store" })
				.then((r) => r.json())
				.then((d) => {
					const groups = d && Array.isArray(d.groups) ? d.groups : [];
					store.modelCatalog = { current: (d && d.current) || null, groups };
					store.modelCatalogAt = Date.now();
					store.modelCatalogLoading = false;
					store.modelCatalogError = groups.length === 0 ? L("目录为空") : null;
					beacon("catalog-loaded", {
						reason: reason || "ui", groups: groups.length,
						models: groups.reduce((n, g) => n + ((g.models || []).length), 0),
						ms: Date.now() - t0, cached: d && d.cached === true, hostBuiltMs: d && d.builtMs,
						degraded: d && d.degraded ? d.degraded : null,
					});
					emit();
					return store.modelCatalog;
				})
				.catch((e) => {
					store.modelCatalogLoading = false;
					store.modelCatalogError = String(e && e.message ? e.message : e);
					beacon("catalog-error", { reason: reason || "ui", error: store.modelCatalogError.slice(0, 200), ms: Date.now() - t0 });
					emit();
					return null;
				});
			return store.modelCatalogPromise;
		}

		/** 使用帮助（放在模型胶囊右侧）：简洁操作教程 + 推荐组合。 */
		function helpPopover() {
			if (store.helpOpen !== true) return null;
			const pos = store.helpPos || { x: 40, bottom: 200, maxH: 420 };
			const line = (k, v) => h("div", { className: "dpo-help-row" }, h("span", { className: "dpo-help-k" }, k), h("span", { className: "dpo-help-v" }, v));
			return h("div", {
				className: "dpo-pop dpo-help-pop", "data-dpo": "help-pop",
				// 视口自适应高度：bottom 与 maxHeight 一起算，构造上保证顶部留白 ≥24px（内容变多后必须）
				style: (() => {
					const vh = window.innerHeight || 800;
					const bottom = Math.max(8, Math.min(pos.bottom || 200, Math.max(120, vh - 240)));
					const maxH = Math.max(220, Math.min(pos.maxH || 420, vh - bottom - 24));
					// box-sizing 必须是 border-box：否则 max-height 只约束内容盒，实际高度还要加上下内边距（实测差 30px，会把面板顶出屏幕）
					return { left: pos.x + "px", bottom: bottom + "px", maxHeight: maxH + "px", boxSizing: "border-box" };
				})(),
			},
				h("div", { className: "dpo-pop-head" }, L("使用帮助 · 提示词优化") + (store.intercepts.length > 0 ? L(" · 本会话已拦截 ") + store.intercepts.length + L(" 次") : "")),
				h("div", { className: "dpo-help-sec" }, L("怎么用")),
				line("①", L("照常输入，按 Enter（或点发送）")),
				line("②", L("消息不会直接发出，先被优化")),
				line("③", L("迷你窗里看「思考/产出」，再决定发送")),
				line("④", L("本插件界面跟随 DSH 设置里的语言：中文即全中文、English 即全英文（无需在插件里另设）")),
				h("div", { className: "dpo-help-sec" }, L("档位（滑块越右越强）")),
				line(L("普通"), L("只把话说清楚，不加新需求（约 3 秒）")),
				line(L("高级"), L("先自己把事推一遍，再把必要假设、步骤、边界与验收写成要求（约 20 秒）")),
				line(L("极端"), L("读项目真实结构 + 按难度决定是否建 goal/分阶段；命中不可逆/发布类信号才给多情况预案（约 20 秒）")),
				line(L("关闭"), L("完全不拦截，恢复原生发送")),
				h("div", { className: "dpo-help-sec" }, L("优化器会做什么（v0.2.1 起）")),
				line(L("实质优先"), L("先在推理通道里把题算一遍/把事推一遍，再把结论变成对工作 AI 的要求（假设、步骤、单位、边界、异常）")),
				line(L("流程长度"), L("替工作 AI 定开发长度：轻＝直接做完验证、不要建 goal/todo；中＝先列 3~6 条 todo；重＝先建立 goal + 分阶段")),
				line(L("硬约束"), L("分清 必须做 / 不得做 / 做完必须满足的判据，并各带一句违反时的处置")),
				line(L("防过度"), L("未命中高危信号（不可逆、动数据/schema、权限密钥、发布上线、对外接口、无测试可验证、目标未定）不许升档")),
				h("div", { className: "dpo-help-sec" }, L("权限")),
				line(L("需要审查"), L("产出可编辑，点「确认提交」才发送")),
				line(L("自动输出"), L("优化一完成就自动发出（失败也会按原文发出）")),
				h("div", { className: "dpo-help-sec" }, L("上下文（用滑块右侧的按钮切换模式）")),
				line(L("回合"), L("读最近 0~10 回合：只保留你的原话，工作 AI 的回复只留长度（防被带偏）")),
				line(L("全文"), L("把工作 AI 现在看到的完整上下文（双方全文）交给优化模型，两档：关 / 开")),
				line(L("上限"), L("回合 1.2 万字符 / 全文 6 万字符；超限按整回合丢弃，绝不截断单条约束")),
				h("div", { className: "dpo-help-sec" }, L("迷你窗按钮")),
				line(L("‹ 回退"), L("停止优化、关闭窗口、不发消息、原文留在输入框")),
				line(L("重新生成"), L("先给个方向，再按该方向重跑一版")),
				line(L("放行本条"), L("不优化了，按你的原文直接发出（v0.1.9 起放行后不会再自动补发第二条）")),
				line(L("右下角"), L("拖拽可改窗口大小（会记住）")),
				h("div", { className: "dpo-help-tip", "data-dpo": "help-tip" },
					L("想要发挥插件所有能力且自动化，建议【极端】+【自动】。"),
				),
				h("div", { className: "dpo-pop-foot" },
					h("button", { type: "button", className: "dpo-btn", "data-dpo": "help-close", onClick: () => { store.helpOpen = false; emit(); } }, L("知道了")),
				),
				// 署名（面板最底部）
				h("div", { className: "dpo-help-meta", "data-dpo": "help-meta" },
					L("作者") + "：啃轮胎的西狐 · " + L("版本") + " 0.2.2beta1 · " + L("版本日期") + " 2026/09/15",
					h("br"),
					L("本版本适用于 dsh-0.1.6-alpha.1（0.1.5-rc.1 亦可）")),
			);
		}

		function modelPopover() {
			if (!store.modelPopOpen) return null;
			const cat = store.modelCatalog;
			const pos = store.modelPop || { x: 40, bottom: 200, maxH: 320 };
			const groups = cat && Array.isArray(cat.groups) ? cat.groups : [];
			if (groups.length === 0 && store.modelCatalogLoading !== true) loadCatalog("popover-open", false);
			return h("div", {
				className: "dpo-pop", "data-dpo": "model-pop",
				style: { left: pos.x + "px", bottom: (pos.bottom || 200) + "px", maxHeight: (pos.maxH || 320) + "px" },
				onMouseLeave: () => { /* 保持打开，点击外部关闭 */ },
			},
				store.narrow === true
					? h("div", { className: "dpo-pop-sliders" },
						h(Slider, { name: "tier", title: L("提示词优化档位"), options: TIERS, value: store.tier, onPick: (id) => setTier(id) }),
						h(Slider, { name: "perm", title: L("优化权限"), options: PERMISSIONS, value: store.permission, disabled: store.tier === "off", onPick: (id) => setPermission(id) }),
					)
					: null,
				h("div", { className: "dpo-pop-head" }, L("优化模型（与对话模型独立）")),
				store.modelCatalogLoading === true && groups.length === 0
					? h("div", { className: "dpo-pop-empty", "data-dpo": "model-loading" }, L("正在加载模型目录…"))
					: null,
				groups.length === 0 && store.modelCatalogLoading !== true
					? h("div", { className: "dpo-pop-empty", "data-dpo": "model-error" },
						(store.modelCatalogError ? L("加载失败：") + store.modelCatalogError : L("（暂无可用模型）")),
						h("button", { type: "button", className: "dpo-btn", "data-dpo": "model-retry", onClick: () => loadCatalog("retry", true) }, L("重试")),
					)
					: null,
				...groups.map((g) => h("div", { key: g.id, className: "dpo-pop-group", "data-dpo": "model-group" },
					h("div", { className: "dpo-pop-gtitle", "data-dpo": "model-group-name" }, g.name + "（" + (g.models || []).length + "）" + (g.degraded ? L(" · 不可达") : "")),
					...(g.models || []).map((m) => {
						const sel = store.modelSel && store.modelSel.provider === g.id && store.modelSel.model === m.id;
						const cur = cat && cat.current && cat.current.provider === g.id && cat.current.model === m.id;
						return h("button", {
							key: g.id + "/" + m.id, type: "button", className: "dpo-pop-item", "data-dpo": "model-item",
							"data-provider": g.id, "data-model": m.id,
							"data-selected": String(Boolean(sel)), "data-session": String(Boolean(cur) && !sel),
							title: g.name + " · " + m.name + (cur ? L("（当前会话模型）") : ""),
							onClick: () => { store.modelSel = { provider: g.id, model: m.id, name: m.name }; store.modelPopOpen = false; persistState(); emit(); },
						}, m.name, cur && !sel ? h("span", { className: "dpo-pop-chip" }, L("会话当前")) : null);
					}),
				)),
				h("div", { className: "dpo-pop-foot" },
					h("button", { type: "button", className: "dpo-btn", "data-dpo": "model-reset", onClick: () => { store.modelSel = null; store.modelPopOpen = false; persistState({ tier: store.tier, permission: store.permission, model: null }); emit(); } }, L("恢复默认（跟随会话）")),
					h("button", { type: "button", className: "dpo-btn", "data-dpo": "model-refresh", onClick: () => loadCatalog("refresh", true) }, L("刷新目录")),
					h("button", { type: "button", className: "dpo-btn", "data-dpo": "model-close", onClick: () => { store.modelPopOpen = false; emit(); } }, L("关闭")),
				),
			);
		}

		function Controls(props) {
			const nodeRef = React.useRef(null);
			const input = props.useInput((s) => s);
			const session = props.useSession((s) => s);
			store.latest.input = input;
			store.latest.session = session;
			store.latest.actions = props.inputActions;
			store.latest.sessionId = props.sessionId;
			React.useEffect(() => {
				store.node = nodeRef.current;
				return () => { if (store.node === nodeRef.current) store.node = null; };
			}, []);
			// 会话切换：迷你窗/运行属于触发它的会话（切走收起、切回恢复）
			React.useEffect(() => { onViewSessionChange(props.sessionId || null); }, [props.sessionId]);
			const [, force] = React.useState(0);
			React.useEffect(() => {
				const fn = () => force((x) => x + 1);
				store.listeners.add(fn);
				return () => { store.listeners.delete(fn); };
			}, []);
			React.useEffect(() => {
				const mq = window.matchMedia("(max-width: 1240px)");
				const onMq = () => { store.narrow = mq.matches; force((x) => x + 1); };
				onMq();
				try { mq.addEventListener("change", onMq); return () => mq.removeEventListener("change", onMq); } catch (e) { return () => {}; }
			}, []);
			const n = store.intercepts.length;
			const off = store.tier === "off";
			if (!isActiveInstance()) return null; // 旧实例不再渲染控件（新实例已接管）
			return h("div", { ref: nodeRef, className: "dpo-controls", "data-dpo": "controls" },
				store.narrow === true
					? h("button", {
						type: "button", className: "dpo-model", "data-dpo": "tier-collapsed",
						title: L("档位（点击展开弹层调整）"),
						onClick: (e) => { const r = e.currentTarget.getBoundingClientRect(); store.modelPop = { x: Math.max(8, Math.min(r.left, window.innerWidth - 320)), bottom: Math.max(8, window.innerHeight - r.top + 6), maxH: Math.max(140, r.top - 16) }; store.modelPopOpen = !store.modelPopOpen; emit(); },
					},
						h("span", { className: "dpo-model-k" }, L("档位")),
						h("span", { className: "dpo-model-v" }, L((TIERS.find((x) => x.id === store.tier) || {}).label || "")),
					)
					: h(Slider, {
						name: "tier", label: L("档位"), tone: "tier",
					title: L("提示词优化档位：关闭 / 普通 / 高级 / 极端"),
					options: TIERS,
					value: store.tier,
					onPick: (id) => setTier(id),
				}),
				h(Slider, {
					name: "perm", label: L("权限"), tone: "perm",
					title: off ? L("档位为「关闭」时不生效") : L("优化权限：需要审查 / 自动输出"),
					options: PERMISSIONS,
					value: store.permission,
					disabled: off,
					onPick: (id) => setPermission(id),
				}),
				h(RangeCap, {
					name: "turns", tone: "ctx",
					mode: store.historyMode,
					max: CTX_TURNS_MAX,
					title: off ? L("档位为「关闭」时不生效")
						: store.historyMode === "full"
							? L("全文：把工作 AI 现在看到的完整上下文（双方全文）交给优化模型；受 6 万字符总量上限约束，超限整回合省略")
							: L("读入最近 0~10 回合对话作为意图上下文（0 = 不读；只读用户侧信息，工作 AI 回复只留长度）"),
					ariaLabel: store.historyMode === "full" ? L("读入完整上下文（全文）") : L("读入最近对话的回合数（0~10）"),
					value: store.historyMode === "full" ? (store.fullOn ? 1 : 0) : store.turns,
					disabled: off,
					onPick: (v) => {
						store.touched = true;
						if (store.historyMode === "full") store.fullOn = v === 1; else store.turns = v;
						persistState(); emit();
					},
					onMode: (m) => {
						store.touched = true;
						store.historyMode = m;
						persistState(); emit();
						showNotice(m === "full" ? L("上下文：全文（与工作 AI 看到的上下文一致）") : L("上下文：回合（读最近 0~10 回合）"));
					},
				}),
				h("span", { className: "dpo-divider", "aria-hidden": "true" }),
				h("button", {
					type: "button",
					className: "dpo-model",
					"data-dpo": "model",
					"data-open": String(store.modelPopOpen === true),
					"data-default": String(!store.modelSel),
					title: L("优化所用模型（与对话模型独立）"),
					onClick: (e) => { const r = e.currentTarget.getBoundingClientRect(); store.modelPop = { x: Math.max(8, Math.min(r.left, window.innerWidth - 320)), bottom: Math.max(8, window.innerHeight - r.top + 6), maxH: Math.max(140, r.top - 16) }; store.modelPopOpen = !store.modelPopOpen; emit(); },
				},
					h("span", { className: "dpo-model-v" }, store.modelSel ? store.modelSel.name : L("会话默认")),
					h("span", { className: "dpo-model-caret" }, "▾"),
				),
				h("button", {
					type: "button", className: "dpo-help", "data-dpo": "help",
					"data-open": String(store.helpOpen === true),
					title: L("使用帮助（怎么用 / 档位 / 权限 / 推荐组合）"),
					onClick: (e) => {
						const r = e.currentTarget.getBoundingClientRect();
						store.helpPos = { x: Math.max(8, Math.min(r.left - 260, window.innerWidth - 360)), bottom: Math.max(8, window.innerHeight - r.top + 6), maxH: Math.max(200, r.top - 16) };
						store.helpOpen = !store.helpOpen;
						if (store.helpOpen) store.modelPopOpen = false;
						emit();
					},
				}, "?"),
				helpPopover(),
				noticeToast(),
				modelPopover(),
			);
		}

		/** 查证折叠行的一行摘要（不展开也能知道有没有查证、查了几步）。 */
		function traceSummary() {
			const t = store.trace;
			const rows = t ? [...(t.normal || []), ...(t.capped || [])] : [];
			if (rows.length === 0) return L("无");
			return Lf("{n} 步", { n: rows.length }) + (t && t.converged ? L(" · 已达上限并收敛") : "");
		}

		function traceRows() {
			const t = store.trace;
			const rows = t ? [...(t.normal || []).map((x) => ({ ...x, phase: L("查证") })), ...(t.capped || []).map((x) => ({ ...x, phase: L("收尾") }))] : [];
			if (rows.length === 0) {
				return h("div", { className: "dpo-trace", "data-dpo": "trace" }, h("div", { className: "dpo-trace-empty" }, L("（暂无查证动作）")));
			}
			return h("div", { className: "dpo-trace", "data-dpo": "trace" },
				h("div", { className: "dpo-trace-head" }, L("查证动作 ") + Lf("{n} 步", { n: rows.length }) + (t && t.converged ? L(" · 已达轮次上限并收敛") : "")),
				...rows.slice(0, 8).map((r, i) => h("div", { key: i, className: "dpo-trace-row", "data-dpo": "trace-row" },
					h("span", { className: "dpo-trace-tool" }, "r" + r.round + " " + r.tool),
					h("span", { className: "dpo-trace-args" }, JSON.stringify(r.args || {}).slice(0, 46)),
					h("span", { className: "dpo-trace-meta" }, String(r.ms) + "ms · " + String(r.resultLines) + L("行")),
				)),
			);
		}

		/* 拖动位置（会话内存内保留）+ 边界夹紧 */
		const PANEL_MIN_W = 400;
		const PANEL_MIN_H = 320;
		function clampPos(x, y, panel) {
			const w = panel ? panel.offsetWidth : (store.overlaySize && store.overlaySize.w) || 520;
			const h = panel ? panel.offsetHeight : 320;
			const maxX = Math.max(8, window.innerWidth - w - 8);
			const maxY = Math.max(8, window.innerHeight - h - 8);
			return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
		}
		/** 尺寸夹紧：不小于最小值，也不超出视口（浏览器缩小后仍完整可见）。 */
		function clampSize(w, h) {
			const maxW = Math.max(PANEL_MIN_W, window.innerWidth - 16);
			const maxH = Math.max(PANEL_MIN_H, window.innerHeight - 16);
			const out = {};
			if (w !== null && w !== undefined) out.w = Math.min(Math.max(PANEL_MIN_W, Math.round(w)), maxW);
			if (h !== null && h !== undefined) out.h = Math.min(Math.max(PANEL_MIN_H, Math.round(h)), maxH);
			return out;
		}
		/** 把当前尺寸/位置落到 DOM 与 store（不开渲染，供拖动帧内使用）。 */
		function applyGeom(panel) {
			if (!panel) return;
			const size = store.overlaySize || {};
			if (size.w) panel.style.width = size.w + "px";
			panel.style.height = size.h ? size.h + "px" : "auto";
			panel.style.maxHeight = size.h ? "none" : "min(78vh,660px)";
			const pos = store.overlayPos || { x: 0, y: 0 };
			panel.style.transform = "translate3d(" + pos.x + "px," + pos.y + "px,0)";
		}
		/** 重新夹紧并写回（开窗、窗口缩放、改尺寸后统一走这里）。 */
		function reflowOverlay(panel) {
			const p = panel || (typeof document !== "undefined" ? document.querySelector('[data-dpo="overlay"]') : null);
			if (!p) return null;
			if (store.overlaySize && store.overlaySize.w) {
				const fixed = clampSize(store.overlaySize.w, store.overlaySize.h || null);
				store.overlaySize = Object.assign({}, store.overlaySize, fixed);
			}
			applyGeom(p);
			const base = store.overlayPos || { x: 8, y: 8 };
			store.overlayPos = clampPos(base.x, base.y, p);
			p.style.transform = "translate3d(" + store.overlayPos.x + "px," + store.overlayPos.y + "px,0)";
			return store.overlayPos;
		}

		/* ══════════ 实时优化运行（小类 3.2：SSE 双通道 → 浮层分区渲染） ══════════ */
		/** 确定回退：停止后端运行 + 关浮层 + 不发消息；输入框原文保持不动。 */
		function rollbackYes() {
			const run = store.run;
			const original = run ? String(run.request || "") : "";
			store.rollbackConfirm = false;
			// 回退承诺"不发送任何消息"：必须先打终结标记，避免 done 事件触发自动发送
			if (run) run.settled = "rolled-back";
			if (run && run.es) { try { run.es.close() } catch (e) { /* noop */ } }
			if (run && run.runId) {
				fetch(API + "/run/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.runId }) }).catch(() => {});
			}
			store.run = null;
			store.reviewText = null;
			store.regenAsk = false;
			setOverlay({ open: false });
			// 原文还原：拦截发生在发送之前，草稿通常仍在；若被清空则显式写回
			try {
				if (original && store.latest.actions && original !== draftLive()) store.latest.actions.setDraft(original);
			} catch (e) { /* noop */ }
			beacon("rollback-done", { restored: original.slice(0, 40), draft: String(draftLive() || "").slice(0, 40) });
			showNotice(L("已回退：优化已停止，输入框原文保留"));
			emit();
		}

		/** 浮层几何自检：可见性出问题时留下可判定的证据（"弹窗消失"类缺陷）。 */
		function beaconOverlayGeom(stage) {
			try {
				const el = document.querySelector('[data-dpo="overlay"]');
				if (!el) { beacon("overlay-geom", { stage, exists: false, open: store.overlay.open === true }); return; }
				const r = el.getBoundingClientRect();
				const cs = getComputedStyle(el);
				const centerEl = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
				beacon("overlay-geom", {
					stage, exists: true,
					rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
					viewport: { w: window.innerWidth, h: window.innerHeight },
					inView: r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
					display: cs.display, visibility: cs.visibility, opacity: cs.opacity, zIndex: cs.zIndex, overflow: cs.overflow,
					headVisible: Boolean(document.querySelector('[data-dpo="drag-handle"]')),
					hitIsOurs: Boolean(centerEl && centerEl.closest && centerEl.closest('[data-dpo="overlay"]')),
					scrollH: el.scrollHeight, clientH: el.clientHeight,
				});
			} catch (e) { beacon("overlay-geom", { stage, error: String(e) }); }
		}

		/** 接线：拦截到"发送"后真正启动优化（档位/权限决定后续自动提交或转审查态）。 */
		function interceptAndOptimize(text) {
			const body = String(text || "").trim();
			if (!body) return;
			// 已有 run 在跑：绝不静默起第二个（否则第一个被覆盖，用户会感觉"发出去了但没反应"）
			const busy = store.run && (store.run.status === "connecting" || store.run.status === "running");
			const awaitingReview = store.run && store.run.status === "done" && store.permission === "review";
			if (busy || awaitingReview) {
				beacon("dup-intercept", { status: store.run.status, chars: body.length, kind: busy ? "busy" : "awaiting-review" });
				showNotice(busy ? L("优化进行中…请稍候（或点「回退」按原文处理）") : L("审查中：请点「确认提交」／「重新生成」／「回退」"));
				setOverlay({ open: true, src: busy ? "dup" : "review" });
				return;
			}
			const tier = store.tier === "off" ? "basic" : store.tier;
			record("optimize-start", body, { tier, permission: store.permission, sessionId: store.viewSessionId });
			setOverlay({ open: true, text: body.slice(0, 80), fullText: body, src: "optimize", sessionId: store.viewSessionId });
			startRun(body, tier, false);
		}

		function startRun(request, tier, forceError, opts) {
			const extra = opts || {};
			const sid = store.viewSessionId || null;
			if (store.run && store.run.es) { try { store.run.es.close() } catch (e) { /* noop */ } }
			const run = {
				status: "connecting", reasoning: "", text: "", error: null,
				startedAt: Date.now(), firstPaintMs: null, request, tier,
				forceError: forceError === true, runId: null, es: null,
				direction: extra.direction || null, version: (extra.version || 1),
				sessionId: sid, readyToSend: null,
			};
			store.run = run;
			store.reviewText = null;
			store.regenAsk = false;
			setOverlay({ open: true, text: String(request || "").slice(0, 80), fullText: String(request || ""), src: "run", sessionId: sid });
			emit();
			/** 自动档要把结果发出去：只有"该会话正在被查看"时才有 composer 可提交，否则挂起等切回。 */
			const autoSend = (text, noticeText) => {
				const isView = (run.sessionId || null) === (store.viewSessionId || null);
				const out = String(text || "");
				if (!out) return false;
				// 用户已经终结这次运行（放行原文 / 确定回退 / 关窗放弃）→ 绝不再自动发出第二条
				if (run.settled) {
					beacon("auto-send-suppressed", { why: run.settled, chars: out.length, view: isView, tier: run.tier });
					return false;
				}
				if (isView && store.latest.actions) {
					run.settled = "auto-sent";   // 幂等：同一次运行只自动发送一次
					store.overlay.open = false;
					run.sent = true;
					store.run = null;
					store.reviewText = null;
					store.latest.actions.setDraft(out);
					store.latest.actions.submit();
					if (noticeText) showNotice(noticeText);
					showBall(run, true);   // 发送后收成悬浮球，点球可回看（只读）
					emit();
					return true;
				}
				run.readyToSend = out;
				beacon("auto-send-deferred", { sessionId: run.sessionId, view: store.viewSessionId, chars: out.length });
				showNotice(L("另一会话的优化已完成，切回该会话即自动发送"));
				return false;
			};
			fetch(API + "/run", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ request, tier, turns: store.turns, historyMode: store.historyMode, fullOn: store.fullOn, sessionId: sid || store.latest.sessionId, forceError: forceError === true, provider: store.modelSel ? store.modelSel.provider : null, model: store.modelSel ? store.modelSel.model : null, direction: extra.direction || null, prevText: extra.prevText || null }),
			}).then((r) => r.json()).then((d) => {
				if (!d || d.ok !== true) { run.status = "error"; run.error = L("启动失败：") + JSON.stringify(d); emit(); return; }
				run.runId = d.runId;
				const es = new EventSource(API + "/stream?runId=" + encodeURIComponent(d.runId));
				run.es = es;
				es.onmessage = (ev) => {
					let msg = null;
					try { msg = JSON.parse(ev.data) } catch (e) { return; }
					const cur = run; // 绑定本 run 自身：即使被切到别的会话（暂存）也继续收流
					if (msg.type === "snapshot") {
						cur.reasoning = msg.reasoning || "";
						cur.text = msg.text || "";
						if (msg.usage) cur.usage = msg.usage;
						if (msg.history) cur.history = msg.history;
						if (msg.status && msg.status !== "running") cur.status = msg.status;
						if (msg.error) cur.error = msg.error;
						if (cur.firstPaintMs === null && (cur.reasoning || cur.text)) cur.firstPaintMs = Date.now() - cur.startedAt;
					} else if (msg.type === "reasoning-delta" || msg.type === "text-delta") {
						if (msg.type === "reasoning-delta") cur.reasoning += msg.text; else cur.text += msg.text;
						if (cur.firstPaintMs === null) cur.firstPaintMs = Date.now() - cur.startedAt;
						cur.status = "running";
					} else if (msg.type === "history") {
						cur.history = msg.history || null;
					} else if (msg.type === "usage") {
						let u = null;
						try {
							u = typeof msg.usage === "string" ? JSON.parse(msg.usage)
								: (msg.usage || (typeof msg.text === "string" ? JSON.parse(msg.text) : null));
						} catch (e) { u = null; }
						if (u && typeof u === "object") {
							cur.usage = u;
							if (cur.usageBeaconed !== true) {
								cur.usageBeaconed = true;
								beacon("usage-delta", { keys: Object.keys(u).slice(0, 10), reasoning: reasoningTokensOf(u), total: u.totalTokens || u.total_tokens || null, tier: cur.tier });
							}
						}
					} else if (msg.type === "aborted") {
						cur.status = "aborted";
					} else if (msg.type === "error") {
						cur.status = "error";
						cur.error = msg.message || L("未知错误");
						// 死模型自愈：provider 不接 / 连不上 → 清掉落盘的模型选择，下次回默认
						const deadRoute = /NO_ADAPTER|TRANSPORT|no adapter registered|Connection error|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/i.test(String(cur.error || ""));
						if (deadRoute) {
							store.modelSel = null;
							persistState({ tier: store.tier, permission: store.permission, model: null });
							beacon("model-selfheal", { reason: String(cur.error || "").slice(0, 120) });
						}
						// 自动档：优化失败也要把用户的消息发出去（fail-open），绝不静默吞掉
						if (store.permission === "auto") {
							const original = String(cur.request || "");
							autoSend(original, deadRoute ? L("优化模型不可用 → 已按原文发出，并回退到默认模型") : L("优化失败 → 已按原文发出"));
							beacon("fail-open-send", { kind: "error", deadRoute, originalChars: original.length, reason: String(cur.error || "").slice(0, 120) });
						}
					} else if (msg.type === "done") {
						cur.status = "done";
						if (cur.settled) {
							// 用户已放行/回退：只记状态，不再开浮层、不再自动发送
							beacon("done-after-settle", { why: cur.settled, chars: String(cur.text || "").length, tier: cur.tier });
						} else if (store.permission === "auto" && String(cur.text || "").trim()) {
							autoSend(String(cur.text), Lf("已按 {tier} 档优化结果发送", { tier: cur.tier }));
						} else if (store.permission === "auto") {
							// 空产出也放行原文：宁可按原文发出，也不要"按了发送却什么都没发生"
							const original = String(cur.request || "");
							autoSend(original, L("优化未产出内容 → 已按原文发出"));
							beacon("fail-open-send", { kind: "empty-done", originalChars: original.length });
						} else {
							// 审查态：确保浮层处于打开状态，双按钮在粘底操作区内
							cur.regenAsk = false;
							if ((cur.sessionId || null) === (store.viewSessionId || null) || cur.sessionId === null) setOverlay({ open: true, src: "review", sessionId: cur.sessionId });
							beacon("review-ready", { chars: String(cur.text || "").length, tier: cur.tier, permission: store.permission, sessionId: cur.sessionId, isView: (cur.sessionId || null) === (store.viewSessionId || null) });
							window.setTimeout(() => { beaconOverlayGeom("review-ready"); }, 80);
							try {
								window.setTimeout(() => {
									const el = document.querySelector('[data-dpo="review"]');
									if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
								}, 60);
							} catch (e) { /* noop */ }
						}
					}
					if (cur.status !== "running" && cur.status !== "connecting" && cur.es) { try { cur.es.close() } catch (e) { /* noop */ } cur.es = null; }
					emit();
				};
				es.onerror = () => { /* 连接中断：保留已收内容，状态由事件决定 */ };
			}).catch((e) => {
				run.status = "error"; run.error = String(e); emit();
			});
		}

		function humanizeError(raw) {
			const s = String(raw || "");
			if (s.includes("NO_ADAPTER")) return L("该模型供应商未注册（没有可用适配器）——请在优化模型里换一个可用的 provider");
			if (s.includes("ABORTED")) return L("请求已被取消（回退或超时）");
			if (s.includes("no-llm-route")) return L("找不到可用的模型路由（请先选一个优化模型）");
			if (/401|unauthor/i.test(s)) return L("凭据无效或未授权（请检查该 provider 的 API Key）");
			if (/429|rate.?limit/i.test(s)) return L("请求过于频繁，请稍后重试");
			if (/timeout|ETIMEDOUT/i.test(s)) return L("请求超时，可重试");
			return s.length > 160 ? s.slice(0, 160) + "…" : s;
		}

		/** token 数格式化：1234 → 1.2k；缺失则返回 null（有些 provider 不上报用量）。 */
		function fmtTokens(n) {
			const v = Number(n);
			if (!Number.isFinite(v) || v <= 0) return null;
			return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : String(Math.round(v));
		}
		/** 从 usage 里挑"思考消耗"：优先 reasoningTokens，其次 completion 里的 reasoning 明细。 */
		function reasoningTokensOf(usage) {
			if (!usage || typeof usage !== "object") return null;
			const direct = usage.reasoningTokens || usage.reasoning_tokens || (usage.details && (usage.details.reasoningTokens || usage.details.reasoning_tokens));
			if (Number.isFinite(Number(direct))) return Number(direct);
			return null;
		}
		function usageChips(usage) {
			if (!usage || typeof usage !== "object") return null;
			const rt = fmtTokens(reasoningTokensOf(usage));
			const out = fmtTokens(usage.outputTokens || usage.completionTokens || usage.output_tokens);
			const tot = fmtTokens(usage.totalTokens || usage.total_tokens);
			return { reasoning: rt, output: out, total: tot };
		}

		/** 运行中让面板跟随滚动（用户手动上滚时不抢），流式产出看起来是"活"的。 */
		function liveScroll(el) {
			if (!el) return;
			const st = store.run && store.run.status;
			if (st !== "running" && st !== "connecting") return;
			if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight;
		}

		/* ══════════ 结果悬浮球：发送后把结果收成一颗小球，点它再展开（学自社区 PR#1） ══════════ */
		function showBall(run, sent) {
			if (!run || !String(run.text || "").trim()) { hideBall(); return; }
			store.ball = {
				visible: true,
				pos: store.ball && store.ball.pos ? store.ball.pos : { x: Math.max(8, window.innerWidth - 76), y: Math.max(8, window.innerHeight - 160) },
				run, sent: sent === true,
			};
			beacon("ball-shown", { sent: sent === true, chars: String(run.text || "").length, tier: run.tier });
			emit();
		}
		function hideBall() {
			if (store.ball && store.ball.visible) beacon("ball-hidden", {});
			store.ball = { visible: false, pos: (store.ball && store.ball.pos) || null, run: null, sent: false };
			emit();
		}
		/** 点球展开：把结果放回浮层（已发送态为只读） */
		function reopenFromBall() {
			const b = store.ball;
			if (!b || !b.visible || !b.run) { hideBall(); return; }
			const run = b.run;
			run.sent = b.sent === true;
			store.run = run;
			store.reviewText = null;
			store.overlay = Object.assign({}, store.overlay, { open: true, text: String(run.request || "").slice(0, 80), fullText: String(run.request || ""), src: "ball", sessionId: run.sessionId || store.viewSessionId, fromBall: true });
			store.ball = Object.assign({}, b, { visible: false });
			beacon("ball-reopen", { sent: run.sent === true, readOnly: run.sent === true });
			emit();
		}
		function collapseToBall() {
			const run = store.run;
			if (!run) { setOverlay({ open: false }); hideBall(); return; }
			setOverlay({ open: false });
			showBall(run, run.sent === true);
		}

		/** 通知：固定在控件行上方浮出，不参与行内布局（避免顶动控件）。 */
		function noticeToast() {
			if (!store.notice || Date.now() >= store.notice.until) return null;
			return h("div", { className: "dpo-toast", "data-dpo": "notice", role: "status" }, store.notice.text);
		}

		/** 折叠区块：次要信息默认收起，需要时再展开（极简但信息不丢）。 */
		function disclosure(key, title, summary, body) {
			const open = store.panes[key] === true;
			return h("div", { className: "dpo-fold", "data-dpo": "fold-" + key, "data-open": String(open) },
				h("button", {
					type: "button", className: "dpo-fold-head", "data-dpo": "fold-head-" + key,
					"aria-expanded": String(open),
					onClick: () => { store.panes[key] = !open; emit(); },
				},
					h("span", { className: "dpo-fold-caret", "aria-hidden": "true" }, "›"),
					h("span", { className: "dpo-fold-title" }, title),
					summary ? h("span", { className: "dpo-fold-sum" }, summary) : null,
				),
				open ? h("div", { className: "dpo-fold-body" }, body) : null,
			);
		}

		function runPanes() {
			const run = store.run;
			if (!run) return null;
			const live = run.status === "running" || run.status === "connecting";
			const chips = usageChips(run.usage);
			const inReview = run.status === "done" && store.permission === "review";
			const label = live ? L("优化中…") : run.status === "done" ? L("已完成") : run.status === "error" ? L("失败") : run.status;
			// 思考：运行中默认展开（看推理），完成后默认收起（把空间让给产出）；用户手动点过则以用户为准
			const thinkingOpen = store.panes.thinking === null || store.panes.thinking === undefined ? live : store.panes.thinking === true;
			const thinkingSummary = [
				chips && chips.reasoning ? chips.reasoning + " tok" : (chips ? "— tok" : null),
				run.reasoning ? run.reasoning.length + L(" 字") : null,
			].filter(Boolean).join(" · ");
			return h("div", { className: "dpo-run", "data-dpo": "run" },
				h("div", { className: "dpo-run-status", "data-dpo": "run-status" },
					label + (live && run.firstPaintMs !== null ? L(" · 首字 ") + run.firstPaintMs + "ms" : ""),
					run.history && run.history.turns > 0 ? h("span", { className: "dpo-tok-chip dpo-tok-muted", "data-dpo": "history-chip", title: L("本次已读入的对话上下文（只含用户原话全文；工作 AI 回复只留长度）") }, L("上下文 ") + (run.history.userTurns || 0) + L(" 回合 · ") + (run.history.chars || 0) + L(" 字")) : null,
					chips && chips.total ? h("span", { className: "dpo-tok-chip", "data-dpo": "token-total", title: L("本次优化总 token") }, "Σ " + chips.total + " tok") : null,
					live && !chips ? h("span", { className: "dpo-tok-chip dpo-tok-live", "data-dpo": "token-wait", title: L("等待 provider 上报用量") }, "tok …") : null,
				),
				// 思考：可折叠（自带 token 计数徽标）
				h("div", { className: "dpo-fold", "data-dpo": "fold-thinking", "data-open": String(thinkingOpen) },
					h("button", {
						type: "button", className: "dpo-fold-head", "data-dpo": "fold-head-thinking",
						"aria-expanded": String(thinkingOpen),
						onClick: () => { store.panes.thinking = !thinkingOpen; emit(); },
					},
						h("span", { className: "dpo-fold-caret", "aria-hidden": "true" }, "›"),
						h("span", { className: "dpo-fold-title", "data-dpo": "thinking-title" }, L("思考")),
						chips && chips.reasoning
							? h("span", { className: "dpo-tok-chip", "data-dpo": "token-reasoning", title: L("本次思考消耗 token（provider 上报）") }, chips.reasoning + " tok")
							: h("span", { className: "dpo-tok-chip dpo-tok-muted", "data-dpo": "token-reasoning-none", title: L("该 provider 未上报思考 token") }, "— tok"),
						thinkingSummary ? h("span", { className: "dpo-fold-sum" }, thinkingSummary) : null,
					),
					thinkingOpen
						? h("div", { className: "dpo-pane dpo-fold-body", "data-dpo": "pane-reasoning", "data-kind": "reasoning", "data-live": String(live && !run.reasoning) },
							h("div", { className: "dpo-pane-body", ref: liveScroll }, run.reasoning || L("（等待思考…）")),
						)
						: null,
				),
				// 产出：审查态由可编辑文本框承载（不重复渲染）；运行中显示流式产出
				inReview
					? null
					: h("div", { className: "dpo-pane", "data-dpo": "pane-text", "data-kind": "text", "data-live": String(live && Boolean(run.reasoning)) },
						h("div", { className: "dpo-pane-title" },
							L("产出"),
							chips && chips.output ? h("span", { className: "dpo-tok-chip", "data-dpo": "token-output", title: L("产出的输出 token") }, chips.output + " tok") : null,
							run.text ? h("span", { className: "dpo-tok-chip dpo-tok-muted", title: L("产出字数") }, run.text.length + L(" 字")) : null,
						),
						h("div", { className: "dpo-pane-body", ref: liveScroll }, run.text || L("（等待产出…）")),
					),
				run.status === "error"
					? h("div", { className: "dpo-run-error", "data-dpo": "run-error" },
						h("span", { title: String(run.error || "") }, L("失败：") + humanizeError(run.error)),
					)
					: null,
			);
		}

		function reviewPane() {
			const run = store.run;
			if (!run || run.status !== "done") return null;
			const text = (store.reviewText !== undefined && store.reviewText !== null) ? store.reviewText : run.text;
			return h("div", { className: "dpo-review", "data-dpo": "review" },
				h("div", { className: "dpo-pane-title", "data-dpo": "review-hint" },
					L("以下内容将原样发给工作 AI（可直接编辑） · ") + String(text || "").length + L(" 字")),
				store.regenAsk === true
					? h("div", { className: "dpo-regen-ask", "data-dpo": "regen-ask" },
						h("div", { className: "dpo-pane-title" }, L("重新生成：先给个方向（可留空＝换一次随机重跑）")),
						h("input", {
							className: "dpo-regen-input", "data-dpo": "regen-input", type: "text",
							placeholder: L("例如：更短、保留技术细节、强调验收标准…"),
							value: store.regenDir || "",
							onChange: (e) => { store.regenDir = e.target.value; emit(); },
							onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); submitRegen(); } },
						}),
						h("div", { className: "dpo-hint-quiet" }, L("方向框下方按钮在底部常驻操作栏（窗口再小也点得到）")),
					)
					: null,
				h("textarea", {
					className: "dpo-review-text",
					"data-dpo": "review-text",
					value: text,
					spellCheck: false,
					onChange: (e) => { store.reviewText = e.target.value; emit(); },
				}),
			);
		}

		/** 按用户给的方向重跑（空方向＝直接重跑）。 */
		function submitRegen() {
			const cur = store.run;
			const dir = String(store.regenDir || "").trim();
			beacon("regen-go", { dir: dir.slice(0, 60) });
			store.regenAsk = false;
			if (!cur) return;
			const prev = (store.reviewText !== undefined && store.reviewText !== null) ? store.reviewText : cur.text;
			startRun(cur.request, cur.tier, false, { direction: dir || null, prevText: prev, version: (cur.version || 1) + 1 });
		}

		/** 确认提交：把（可能已编辑的）文本交回官方发送链路，随后关闭浮层。 */
		function confirmSubmit() {
			const run = store.run;
			// 已发送态只读：不再走提交链路（防重复发送，学自社区 PR#1）
			if (run && run.sent === true) { beacon("submit-blocked-sent", {}); setOverlay({ open: false }); hideBall(); emit(); return; }
			const text = (store.reviewText !== undefined && store.reviewText !== null)
				? store.reviewText
				: (run ? run.text : "");
			setOverlay({ open: false });
			store.run = null;
			store.reviewText = null;
			if (text && store.latest.actions) {
				store.latest.actions.setDraft(text);
				store.latest.actions.submit();
			}
			emit();
		}

		/** 常驻底部操作栏：不在滚动区内 —— 无论弹窗多小、内容多长，关键按钮永不消失。 */
		function overlayFooter() {
			const run = store.run;
			const done = run && run.status === "done";
			const err = run && run.status === "error";
			if (store.regenAsk === true) {
				return h("div", { className: "dpo-overlay-actions", "data-dpo": "foot-regen" },
					h("button", { type: "button", className: "dpo-btn primary", "data-dpo": "regen-go", onClick: submitRegen }, L("按此方向重跑")),
					h("button", { type: "button", className: "dpo-btn", "data-dpo": "regen-cancel", onClick: () => { store.regenAsk = false; emit(); } }, L("取消")),
				);
			}
			if (done && run && run.sent === true) {
				return h("div", { className: "dpo-overlay-actions", "data-dpo": "foot-sent" },
					h("span", { className: "dpo-sent-tag", "data-dpo": "sent-tag" }, L("已发送 · 仅供查看")),
					h("button", { type: "button", className: "dpo-btn", "data-dpo": "close-sent", onClick: () => { setOverlay({ open: false }); hideBall(); } }, L("关闭")),
					h("button", { type: "button", className: "dpo-btn ghost", "data-dpo": "regen", onClick: () => { store.regenAsk = true; if (store.regenDir === undefined) store.regenDir = ""; emit(); } }, L("重新生成")),
				);
			}
			if (done && store.permission === "review") {
				return h("div", { className: "dpo-overlay-actions", "data-dpo": "foot-review" },
					h("button", { type: "button", className: "dpo-btn ghost", "data-dpo": "rollback", onClick: () => { beacon("rollback-click", { confirm: false }); store.rollbackConfirm = true; emit(); } }, L("‹ 回退")),
					h("button", { type: "button", className: "dpo-btn primary", "data-dpo": "confirm", onClick: () => { beacon("confirm-click", {}); confirmSubmit(); } }, L("确认提交")),
					h("button", {
						type: "button", className: "dpo-btn danger", "data-dpo": "regen",
						onClick: () => {
							beacon("regen-click", { hasRun: Boolean(store.run) });
							store.regenAsk = true;
							if (store.regenDir === undefined) store.regenDir = "";
							emit();
							window.setTimeout(() => { try { const el = document.querySelector('[data-dpo="regen-ask"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); } catch (e) { /* noop */ } }, 80);
						},
					}, L("重新生成")),
				);
			}
			if (err) {
				return h("div", { className: "dpo-overlay-actions", "data-dpo": "foot-error" },
					h("button", { type: "button", className: "dpo-btn", "data-dpo": "retry", onClick: () => startRun(run.request, run.tier, false) }, L("重试")),
					h("button", { type: "button", className: "dpo-btn", "data-dpo": "reset-model", onClick: () => { store.modelSel = null; persistState({ tier: store.tier, permission: store.permission, model: null }); startRun(run.request, run.tier, false); } }, L("默认模型重试")),
					h("button", { type: "button", className: "dpo-btn primary", "data-dpo": "release", onClick: releaseOriginal }, L("按原文发出")),
				);
			}
			// 运行中 / 无运行 / 自动档：始终给一个"放行原文"的出口
			return h("div", { className: "dpo-overlay-actions", "data-dpo": "foot-idle" },
				h("button", { type: "button", className: "dpo-btn", "data-dpo": "rollback-here", onClick: () => { store.rollbackConfirm = true; emit(); window.setTimeout(() => { try { const el = document.querySelector('[data-dpo="rollback-confirm"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); } catch (e) { /* noop */ } }, 80); } }, L("‹ 回退")),
				h("button", { type: "button", className: "dpo-btn primary", "data-dpo": "release", onClick: releaseOriginal }, L("放行本条（按原文发出）")),
			);
		}

		/** 放行原文（浮层与降级面板共用）：完整原文优先，绝不截断。 */
		function releaseOriginal() {
			if (store.run && store.run.sent === true) { beacon("release-blocked-sent", {}); setOverlay({ open: false }); hideBall(); emit(); return; }
			const text = store.overlay.fullText || (store.run && store.run.request) || draftLive();
			beacon("release-original", { chars: String(text || "").length, from: store.overlay.fullText ? "fullText" : (store.run ? "run.request" : "draft") });
			// 关键：先给这次运行打上"已被用户终结"的标记，再清 store.run。
			// SSE 闭包里持有的那份 run 对象不会因 store.run=null 而失效，若不标记，
			// done 事件仍会走自动发送 → 放行后又被自动发出第二条（表现为"排队发送"）。
			const settling = store.run;
			if (settling) {
				settling.settled = "released";
				try { if (settling.es) { settling.es.close(); settling.es = null; } } catch (e) { /* noop */ }
				if (settling.runId) fetch(API + "/run/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: settling.runId }) }).catch(() => {});
			}
			setOverlay({ open: false });
			store.run = null;
			store.reviewText = null;
			if (text && store.latest.actions) {
				store.latest.actions.setDraft(text);
				store.latest.actions.submit();
			}
			emit();
		}

		/** 降级面板：任何渲染异常下依然给出「回退 / 放行原文」两个出口（浮层不再"无声消失"）。 */
		function OverlayFallback(props) {
			return h("div", {
				className: "dpo-overlay", "data-dpo": "overlay", "data-dpo-degraded": "1",
				style: { transform: "translate3d(" + Math.max(8, (window.innerWidth || 800) - 480) + "px,96px,0)" },
			},
				h("div", { className: "dpo-overlay-head", "data-dpo": "drag-handle" },
					h("span", { className: "dpo-head-title" }, L("提示词优化")),
					h("span", { className: "dpo-head-tier" }, L("渲染降级")),
					h("span", { className: "dpo-head-hint" }, L("已记录错误")),
				),
				h("div", { className: "dpo-overlay-scroll" },
					store.rollbackConfirm === true
						? h("div", { className: "dpo-overlay-src", "data-dpo": "rollback-confirm" },
							h("span", null, L("确定回退？将停止优化、关闭浮层，且不发送任何消息。")),
							h("button", { type: "button", className: "dpo-btn danger", "data-dpo": "rollback-yes", onClick: () => { beacon("rollback-yes", {}); rollbackYes(); } }, L("确定回退")),
							h("button", { type: "button", className: "dpo-btn", "data-dpo": "rollback-no", onClick: () => { store.rollbackConfirm = false; emit(); } }, L("取消回退")),
						)
						: null,
					h("div", { className: "dpo-overlay-body" }, L("浮层渲染出错，已降级为最小面板（优化仍在后台进行）。错误：") + String(props && props.err || L("未知"))),
					h("div", { className: "dpo-overlay-actions" },
						h("button", { type: "button", className: "dpo-btn primary", "data-dpo": "release", onClick: releaseOriginal }, L("放行本条（按原文发出）")),
					),
				),
			);
		}

		/** 错误边界：捕获浮层渲染/副作用异常 → 记录证据 + 渲染降级面板，而不是整块消失。 */
		class OverlayBoundary extends React.Component {
			constructor(props) { super(props); this.state = { err: null }; }
			static getDerivedStateFromError(error) { return { err: String((error && error.message) || error) }; }
			componentDidCatch(error, info) {
				beacon("overlay-error", {
					message: String((error && error.message) || error),
					stack: String((error && error.stack) || "").slice(0, 700),
					componentStack: String((info && info.componentStack) || "").slice(0, 700),
					runStatus: store.run ? store.run.status : null,
					permission: store.permission, tier: store.tier,
				});
			}
			render() { return this.state.err ? h(OverlayFallback, { err: this.state.err }) : this.props.children; }
		}
		const OverlayHost = () => h(OverlayBoundary, null, h(Overlay));

		function Overlay() {


			const [, force] = React.useState(0);
			const panelRef = React.useRef(null);
			const dragRef = React.useRef(null);
			const rafRef = React.useRef(0);
			const sizeRafRef = React.useRef(0);
			const pendingRef = React.useRef(null);
			const sizeRef = React.useRef(null); // ← 必须在任何 early return 之前（#310 事故根源）
			// 挂载/卸载埋点：若"开着却没有节点"，这里能区分"从未挂上"与"被卸载"
			React.useEffect(() => {
				beacon("overlay-mounted", { runStatus: store.run ? store.run.status : null, open: store.overlay.open === true });
				return () => { beacon("overlay-unmounted", { openNow: store.overlay.open === true, runStatus: store.run ? store.run.status : null }); };
			}, []);
			React.useEffect(() => {
				const fn = () => force((x) => x + 1);
				store.listeners.add(fn);
				return () => { store.listeners.delete(fn); };
			}, []);
			const open = store.overlay.open;
			// 开窗即夹紧：即便上一次在更宽的窗口里拖到右侧，也不会出现在视口之外
			React.useLayoutEffect(() => {
				if (!open) return undefined;
				const raf = requestAnimationFrame(() => { reflowOverlay(panelRef.current); beaconOverlayGeom("open"); force((x) => x + 1); });
				return () => cancelAnimationFrame(raf);
			}, [open]);
			// 窗口尺寸变化 → 重新夹紧（位置与尺寸都不越界）；卸载即注销监听
			React.useEffect(() => {
				if (!open) return undefined;
				const onResize = () => { reflowOverlay(panelRef.current); };
				store.resizeListeners = (store.resizeListeners || 0) + 1;
				window.addEventListener("resize", onResize);
				return () => {
					window.removeEventListener("resize", onResize);
					store.resizeListeners = Math.max(0, (store.resizeListeners || 0) - 1);
				};
			}, [open]);
			const o = store.overlay;
			const ball = store.ball;
			if (!o.open) {
				if (!ball || ball.visible !== true) return null;
				const bp = ball.pos || { x: Math.max(8, window.innerWidth - 76), y: Math.max(8, window.innerHeight - 160) };
				const tone = TIER_TONES[(ball.run && ball.run.tier) || store.tier] || "var(--dpo-acc)";
				return h("div", {
					className: "dpo-ball", "data-dpo": "ball", "data-sent": String(ball.sent === true),
					style: { transform: "translate3d(" + bp.x + "px," + bp.y + "px,0)", "--dpo-ball-tone": tone },
					title: ball.sent === true ? L("优化结果已发送 · 点击回看（只读）") : L("优化结果 · 点击回看"),
					onPointerDown: (e) => {
						if (e.button !== 0) return;
						const start = { x: e.clientX, y: e.clientY, bx: bp.x, by: bp.y };
						const panel = e.currentTarget;
						let moved = false;
						const move = (ev) => {
							const dx = ev.clientX - start.x; const dy = ev.clientY - start.y;
							if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
							if (!moved) return;
							const nx = Math.max(8, Math.min(window.innerWidth - 56, start.bx + dx));
							const ny = Math.max(8, Math.min(window.innerHeight - 56, start.by + dy));
							ball.pos = { x: nx, y: ny };
							panel.style.transform = "translate3d(" + nx + "px," + ny + "px,0)";
						};
						const up = (ev) => {
							window.removeEventListener("pointermove", move, true);
							window.removeEventListener("pointerup", up, true);
							try { panel.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
							if (!moved) reopenFromBall();
							else { beacon("ball-moved", { pos: ball.pos }); emit(); }
						};
						window.addEventListener("pointermove", move, true);
						window.addEventListener("pointerup", up, true);
						e.preventDefault();
						e.stopPropagation();
					},
				},
					h("span", { className: "dpo-ball-icon", "aria-hidden": "true" }, ball.sent === true ? "✓" : "◍"),
					h("span", { className: "dpo-ball-label", "data-dpo": "ball-label" }, ball.sent === true ? L("已发送") : L("结果")),
				);
			}
			// 会话隔离兜底：弹窗只属于它的会话
			if (o.sessionId !== undefined && o.sessionId !== null && store.viewSessionId !== null && o.sessionId !== store.viewSessionId) return null;
			if (!isActiveInstance()) return null; // 旧实例不再渲染浮层（否则会出现"后台在跑、弹窗不显示"）
			store.renderCount = (store.renderCount || 0) + 1;
			const applyPending = () => {
				rafRef.current = 0;
				const panel = panelRef.current;
				const next = pendingRef.current;
				if (!panel || !next) return;
				store.overlayPos = next;
				panel.style.transform = "translate3d(" + next.x + "px," + next.y + "px,0)";
			};
			const onPointerDown = (e) => {
				if (e.button !== 0) return;
				// 起点在按钮上时不启动拖动：preventDefault 会抑制兼容 click，导致「回退」「×」点不动
				const hit = e.target;
				if (hit && hit.closest && hit.closest("button")) return;
				const panel = panelRef.current;
				if (!panel) return;
				const rect = panel.getBoundingClientRect();
				dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
				try { panel.setPointerCapture(e.pointerId); } catch (err) { /* 合成指针无捕获 */ }
				e.preventDefault();
			};
			const onPointerMove = (e) => {
				const drag = dragRef.current;
				const panel = panelRef.current;
				if (!drag || !panel) return;
				pendingRef.current = clampPos(e.clientX - drag.dx, e.clientY - drag.dy, panel);
				if (rafRef.current === 0) rafRef.current = requestAnimationFrame(applyPending);
			};
			const onPointerUp = (e) => {
				if (!dragRef.current) return;
				dragRef.current = null;
				try { if (panelRef.current) panelRef.current.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
				if (rafRef.current !== 0) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
				applyPending();
				beacon("overlay-move", { pos: store.overlayPos });
				persistUi();
			};
			/* 右下角改尺寸（自定义弹窗大小，落盘记住）—— sizeRef 已提到组件顶部 */
			/** 提交一份尺寸（显式传值，不依赖 sizeRef 的生命周期）。 */
			const commitSize = (size) => {
				const panel = panelRef.current;
				if (!panel || !size || size.w === undefined) return false;
				store.overlaySize = { w: size.w, h: size.h === undefined ? null : size.h };
				applyGeom(panel);
				store.overlayPos = clampPos((store.overlayPos || { x: 8 }).x, (store.overlayPos || { y: 8 }).y, panel);
				panel.style.transform = "translate3d(" + store.overlayPos.x + "px," + store.overlayPos.y + "px,0)";
				return true;
			};
			const applyPendingSize = () => {
				sizeRafRef.current = 0;
				commitSize(sizeRef.current);
			};
			const onSizeDown = (e) => {
				if (e.button !== 0) return;
				const panel = panelRef.current;
				if (!panel) return;
				e.preventDefault();
				e.stopPropagation();
				const rect = panel.getBoundingClientRect();
				sizeRef.current = Object.assign({ startX: e.clientX, startY: e.clientY, w0: rect.width, h0: rect.height });
				try { panel.setPointerCapture(e.pointerId); } catch (err) { /* 合成指针无捕获 */ }
				beacon("resize-start", { w: Math.round(rect.width), h: Math.round(rect.height) });
			};
			const onSizeMove = (e) => {
				const st = sizeRef.current;
				const panel = panelRef.current;
				if (!st || !panel || st.w0 === undefined) return;
				const next = clampSize(st.w0 + (e.clientX - st.startX), st.h0 + (e.clientY - st.startY));
				sizeRef.current = Object.assign({}, st, next);
				if (sizeRafRef.current === 0) sizeRafRef.current = requestAnimationFrame(applyPendingSize);
			};
			const onSizeUp = (e) => {
				const st = sizeRef.current;
				if (!st) return;
				// 关键：先用当前拖拽值提交，再清状态 —— 否则最后一次位移（快速拖拽时是全部）会被丢掉
				if (sizeRafRef.current !== 0) { cancelAnimationFrame(sizeRafRef.current); sizeRafRef.current = 0; }
				const committed = commitSize(st);
				sizeRef.current = null;
				try { if (panelRef.current) panelRef.current.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
				beacon("resize-done", { size: store.overlaySize, committed, moved: { dx: Math.round(e.clientX - st.startX), dy: Math.round(e.clientY - st.startY) } });
				persistUi();
				emit();
			};
			const base = store.overlayPos || { x: Math.max(8, window.innerWidth - 480), y: 96 };
			const pos = clampPos(base.x, base.y, null);
			store.overlayPos = pos;
			const size = store.overlaySize || {};
			const panelStyle = { transform: "translate3d(" + pos.x + "px," + pos.y + "px,0)" };
			if (size.w) panelStyle.width = size.w + "px";
			panelStyle.height = size.h ? size.h + "px" : "auto";
			panelStyle.maxHeight = size.h ? "none" : "min(78vh,660px)";
			return h("div", {
				ref: panelRef,
				className: "dpo-overlay" + (dragRef.current ? " dpo-dragging" : "") + (sizeRef.current ? " dpo-sizing" : ""),
				"data-dpo": "overlay",
				"data-state": (() => { const st = store.run ? store.run.status : null; return st === "running" || st === "connecting" ? "running" : st === "done" ? "done" : st === "error" ? "error" : "idle"; })(),
				style: panelStyle,
				onPointerMove: (e) => { onSizeMove(e); onPointerMove(e); },
				onPointerUp: (e) => { onSizeUp(e); onPointerUp(e); },
				onPointerCancel: (e) => { onSizeUp(e); onPointerUp(e); },
			},
				h("div", { className: "dpo-overlay-head", "data-dpo": "drag-handle", onPointerDown, title: L("按住拖动（右下角可改大小）") },
					h("span", { className: "dpo-head-title", "data-dpo": "head-title" }, L("提示词优化")),
					h("span", { className: "dpo-head-tier", "data-dpo": "head-tier" }, L((TIERS.find((x) => x.id === (store.run ? store.run.tier : store.tier)) || {}).label || "")),
					store.intercepts.length > 0 ? h("span", { className: "dpo-head-count", "data-dpo": "head-count", title: L("本会话累计拦截次数") }, String(store.intercepts.length)) : null,
					h("span", { className: "dpo-head-hint" }, store.overlaySize && store.overlaySize.w ? (store.overlaySize.w + "×" + (store.overlaySize.h || L("自动"))) : "↘"),
				),
				h("div", { className: "dpo-overlay-scroll" },
					store.rollbackConfirm === true
						? h("div", { className: "dpo-confirm", "data-dpo": "rollback-confirm" },
							h("span", null, L("确定回退？将停止优化、关闭浮层，且不发送任何消息。")),
							h("button", { type: "button", className: "dpo-btn danger", "data-dpo": "rollback-yes", onClick: () => { beacon("rollback-yes", {}); rollbackYes(); } }, L("确定回退")),
							h("button", { type: "button", className: "dpo-btn", "data-dpo": "rollback-no", onClick: () => { beacon("rollback-no", {}); store.rollbackConfirm = false; emit(); } }, L("取消回退")),
						)
						: null,
					runPanes(),
					reviewPane(),
					// 次要信息折叠：原文 / 查证（默认收起，点了才展开）
					o.fullText
						? disclosure("original", L("原文"), String(o.fullText).length + L(" 字"), h("div", { className: "dpo-fold-text" }, o.fullText))
						: null,
					disclosure("trace", L("查证动作"), traceSummary(), traceRows()),
				),
				// 常驻操作栏：在滚动区之外 —— 弹窗再小、内容再长，关键按钮都不会被滚走或裁掉
				h("div", { className: "dpo-overlay-foot", "data-dpo": "overlay-foot" },
					h("div", { className: "dpo-foot-inner" }, overlayFooter()),
				),
				h("div", {
					className: "dpo-size-grip", "data-dpo": "resize", title: L("拖动改大小（记住）"),
					onPointerDown: onSizeDown,
				}),
			);
		}

		/* ══════════ 探针：合成手势 → 观察 → 报告 ══════════ */
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const frame = () => new Promise((r) => {
			// 后台标签页 rAF 不触发：探针/自检绝不能因此挂死（实测踩过一次：演示通道假死 90s 无回执）
			let done = false;
			const fin = () => { if (!done) { done = true; r(); } };
			try { requestAnimationFrame(() => requestAnimationFrame(fin)); } catch (e) { /* noop */ }
			setTimeout(fin, 150);
		});

		function dispatchKey(target, init, tag) {
			const cfg = Object.assign({ key: "Enter", code: "Enter", bubbles: true, cancelable: true, composed: true }, init || {});
			const ev = new KeyboardEvent("keydown", cfg);
			ev.__dpoTag = tag || "dpo";
			try { Object.defineProperty(ev, "keyCode", { get: () => (cfg.isComposing ? 229 : 13) }); } catch (e) { /* noop */ }
			target.dispatchEvent(ev);
			return ev;
		}
		function dispatchClick(target, tag) {
			const ev = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window });
			ev.__dpoTag = tag || "dpo";
			target.dispatchEvent(ev);
			return ev;
		}
		/** 冒泡期间谍：只认本次派发的那个事件，用户真实按键记为 other（不污染判定）。 */
		const probeArtifacts = new Set();
		function releaseProbeArtifacts() {
			for (const fn of [...probeArtifacts]) { try { fn(); } catch (e) { /* noop */ } }
			probeArtifacts.clear();
		}
		function spyBubble(type, tag) {
			const box = { reached: false, other: 0 };
			const fn = (e) => {
				if (!tag) { box.reached = true; return; }
				if (e.__dpoTag === tag) box.reached = true;
				else box.other += 1;
			};
			window.addEventListener(type, fn, false);
			const stop = () => { window.removeEventListener(type, fn, false); probeArtifacts.delete(stop); };
			probeArtifacts.add(stop);
			return { box, stop };
		}

		async function post(path, body) {
			const res = await fetch(API + path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			return res.json().catch(() => ({}));
		}

		/** 若应用在"本应被拦"的路径上仍把消息排进官方队列，则请宿主撤销该待处理项（零污染）。 */
		async function cleanupQueued(ctx, marker) {
			const snap = sessionOf();
			const row = (snap.queue || []).find((r) => String(r.text || "").includes(marker));
			if (!row) return { found: false };
			let removed = false;
			let error = null;
			try {
				const res = await post("/queued/remove", { sessionId: store.latest.sessionId, itemId: row.id });
				if (!res || res.ok !== true) error = (res && res.error) || "remove-failed";
				await sleep(700);
				removed = !(sessionOf().queue || []).some((r) => r.id === row.id);
			} catch (e) { error = String(e); }
			return { found: true, itemId: row.id, removed, error };
		}

		async function runProbe(ctx, token) {
			releaseProbeArtifacts();
			const steps = [];
			// 探针会改写档位/权限/浮层几何：先快照，收尾时还原成用户的值（探针不得改变用户配置）
			const uiSnapshot = {
				tier: store.tier,
				permission: store.permission,
				size: store.overlaySize ? Object.assign({}, store.overlaySize) : null,
				pos: store.overlayPos ? Object.assign({}, store.overlayPos) : null,
			};
			store.probeUiSnapshot = uiSnapshot;
			const push = (id, name, action, expected, observed, pass) =>
				steps.push({ id, name, action, expected, observed, pass: pass === true });
			const windowStart = Date.now();
			const actions = store.latest.actions;
			const initialDraft = draftFromHook();
			const card = cardOf(store.node);
			const editor = editorOf(card);
			const sendBtn = sendButtonOf(card);
			const pill = card ? card.querySelector('[data-dpo="pill"]') : null;

			push("S0", "骨架在位", "读取真实 DOM 结构",
				"卡片/编辑器/发送按钮均定位到",
				{
					card: Boolean(card), editor: Boolean(editor), sendButton: Boolean(sendBtn),
					sendLabel: sendBtn ? sendBtn.getAttribute("aria-label") : null,
					labelSet: [...SEND_LABELS],
					cardButtons: buttonsOf(card).map((b) => b.getAttribute("aria-label")),
					lastButton: lastButtonOf(card) ? lastButtonOf(card).getAttribute("aria-label") : null,
					sessionId: String(store.latest.sessionId || ""),
					running: runningNow(),
					actions: Boolean(actions),
				},
				Boolean(card && editor && sendBtn && actions));

			// ENV 闸门：环境不齐备就整轮中止，避免在被切换后的会话上误测（t15 的教训）
			const envPerm = buttonsOf(card).find((b) => String(b.getAttribute("aria-label")).includes(L("访问模式")));
			const envModel = buttonsOf(card).find((b) => String(b.getAttribute("aria-label")).includes(L("选择模型")));
			const envReady = Boolean(card && editor && actions && envPerm && envModel);
			if (!envReady && !(window.__DPO_FORCE_ENV__ === true)) {
				const aborted = {
					plugin: NS, token, kind: "selftest-aborted", reason: "environment-not-ready",
					sessionId: String(store.latest.sessionId || ""), windowStart, windowEnd: Date.now(),
					env: {
						card: Boolean(card), editor: Boolean(editor), actions: Boolean(actions),
						permissionSelect: Boolean(envPerm), modelSeat: Boolean(envModel), running: runningNow(),
					},
					steps, passed: 0, total: steps.length,
				};
				try { await post("/report", aborted); } catch (e) { /* noop */ }
				window.__DPO_PROBE_RUNNING__ = false;
				return aborted;
			}

			if (editor && actions) {
				// ── E2：IME 组合态回车不得误拦 ──
				setOverlay({ open: false });
				if (actions) actions.setDraft("DPO-IME-组合态测试");
				await frame();
				if (editor) editor.focus();
				const before2 = store.intercepts.length;
				const spy2 = spyBubble("keydown", "e2");
				const ev2 = dispatchKey(editor, { isComposing: true }, "e2");
				await sleep(400);
				spy2.stop();
				const clean2 = await cleanupQueued(ctx, "DPO-IME-组合态测试");
				const pass2 = store.intercepts.length === before2 && !store.overlay.open;
				push("E2", "IME 组合态回车不误拦",
					"setDraft→focus→派发 isComposing:true 的 Enter",
					"拦截计数不变、占位浮层不出现、消息不落库",
					{ interceptsBefore: before2, interceptsAfter: store.intercepts.length, overlayOpen: store.overlay.open, defaultPrevented: ev2.defaultPrevented, reachedBubble: spy2.box.reached, other: spy2.box.other, queuedCleanup: clean2 },
					pass2);
				if (actions) actions.setDraft("");
				await frame();

				// ── E1：正常回车必须被拦 ──
				setOverlay({ open: false });
				if (actions) actions.setDraft("DPO-回车拦截测试：把那个东西弄一下");
				await frame();
				if (editor) editor.focus();
				const before1 = store.intercepts.length;
				const spy1 = spyBubble("keydown", "e1");
				const ev1 = dispatchKey(editor, {}, "e1");
				await sleep(400);
				spy1.stop();
				const last1 = store.intercepts[store.intercepts.length - 1] || {};
				const clean1 = await cleanupQueued(ctx, "DPO-回车拦截测试");
				const pass1 = store.intercepts.length === before1 + 1 && store.overlay.open === true && spy1.box.reached === false;
				push("E1", "正常回车被拦截",
					"setDraft→focus→派发普通 Enter",
					"拦截计数 +1、占位浮层出现、事件未传播到冒泡期、消息不落库",
					{ interceptsBefore: before1, interceptsAfter: store.intercepts.length, overlayOpen: store.overlay.open, overlaySrc: store.overlay.src, overlayText: String(store.overlay.text).slice(0, 60), reachedBubble: spy1.box.reached, other: spy1.box.other, defaultPrevented: ev1.defaultPrevented, interceptedKind: last1.kind, queuedCleanup: clean1 },
					pass1);
				if (actions) actions.setDraft("");
				setOverlay({ open: false });
				await frame();

				// ── E4：对照——非发送按钮一律不得被拦（逐按钮求值 + 编辑器点击行为） ──
				setOverlay({ open: false });
				if (actions) actions.setDraft("DPO-对照测试：随便写点什么");
				await frame();
				const cardNow = cardOf(store.node);
				const table = buttonsOf(cardNow).map((b) => ({
					label: b.getAttribute("aria-label"),
					would: wouldInterceptClick(b),
					byLabel: isSendLabel(b.getAttribute("aria-label")),
					isLast: lastButtonOf(cardNow) === b,
					isStop: STOP_LABELS.has(b.getAttribute("aria-label") || ""),
				}));
				const trueCount = table.filter((r) => r.would).length;
				const before4 = store.intercepts.length;
				if (editor) dispatchClick(editor, "e4");
				await sleep(200);
				const pass4 = trueCount === 1 && store.intercepts.length === before4;
				push("E4", "非发送按钮不拦截（对照）",
					"对卡片内每个按钮求值 wouldInterceptClick + 向编辑器派发 click",
					"仅发送按钮被判为接管（1 个 true）；编辑器点击不触发拦截",
					{ table, trueCount, interceptsBefore: before4, interceptsAfter: store.intercepts.length },
					pass4);
				setOverlay({ open: false });
				if (actions) actions.setDraft("");
				await frame();

				// ── E3：真实发送按钮 click 必须被拦（先放入草稿，主按钮此时才是"发送"角色） ──
				setOverlay({ open: false });
				if (actions) actions.setDraft("DPO-按钮拦截测试：把那个东西弄一下");
				await frame();
				const liveSend = sendButtonOf(card) || sendBtn;
				const before3 = store.intercepts.length;
				let reachedClick = null;
				if (liveSend) {
					const spy3 = spyBubble("click", "e3");
					const ev3 = dispatchClick(liveSend, "e3");
					await sleep(400);
					spy3.stop();
					reachedClick = spy3.box.reached;
					const spy3Other = spy3.box.other;
					const clean3 = await cleanupQueued(ctx, "DPO-按钮拦截测试");
					const pass3 = store.intercepts.length === before3 + 1 && store.overlay.open === true && reachedClick === false;
					push("E3", "发送按钮 click 被拦截",
						"setDraft→派发 click 到主按钮（标签或结构位命中）",
						"拦截计数 +1、占位浮层出现、事件未传播、消息不落库",
						{ interceptsBefore: before3, interceptsAfter: store.intercepts.length, overlayOpen: store.overlay.open, overlaySrc: store.overlay.src, reachedBubble: reachedClick, other: spy3Other, label: liveSend.getAttribute("aria-label"), byLabel: isSendLabel(liveSend.getAttribute("aria-label")), isLast: lastButtonOf(card) === liveSend, defaultPrevented: ev3.defaultPrevented, queuedCleanup: clean3 },
						pass3);
				} else {
					push("E3", "发送按钮 click 被拦截", "派发 click 到真实发送按钮", "命中并拦截", { error: "未定位到发送按钮" }, false);
				}
				if (actions) actions.setDraft("");
				setOverlay({ open: false });
				await frame();

				// ── E5：setDraft → 投影回读（中文 / 超长） ──
				const cn = "中文草稿：把那个东西弄一下，尽量说清楚";
				if (actions) actions.setDraft(cn);
				await frame();
				const back1 = draftFromHook();
				const long = "长文本测试：" + "段落内容".repeat(300);
				if (actions) actions.setDraft(long);
				await frame();
				const back2 = draftFromHook();
				const pass5 = back1 === cn && back2 === long;
				push("E5", "setDraft 投影回读",
					"setDraft(中文) → 回读；setDraft(超长) → 回读",
					"两次回读与写入完全一致",
					{ cnLen: cn.length, cnBackLen: back1.length, cnEqual: back1 === cn, longLen: long.length, longBackLen: back2.length, longEqual: back2 === long },
					pass5);
				if (actions) actions.setDraft("");
				await frame();

				// ── E6：交付链路 + 正控（需会话 running，避免污染） ──
				if (!runningNow()) {
					push("E6", "交付链路+正控", "临时解除拦截后派发 Enter", "文本进入官方待处理队列并可撤销",
						{ skipped: true, reason: "会话当前非 running（idle 提交会直接落库，故意不测）" }, false);
				} else {
					const marker = "DPO-交付链路测试-" + token;
					store.armed = false;
					if (actions) actions.setDraft(marker);
					await frame();
					if (editor) editor.focus();
					const echoBefore = (sessionOf().pendingSubmissions || []).length;
					dispatchKey(editor, {}, "g");
					// 轮询等待"进入官方链路"的取证（最多 ~3.6s，避开单次采样竞态）
					let rowObserved = null;
					for (let i = 0; i < 12 && rowObserved === null; i += 1) {
						await sleep(300);
						rowObserved = (sessionOf().queue || []).find((r) => String(r.text || "").includes(marker)) || null;
					}
					const snap = sessionOf();
					const echoAfter = (snap.pendingSubmissions || []).length;
					// 宿主权威撤销：按文本匹配，不依赖客户端快照能否及时看到该行
					let removedByText = null;
					try { removedByText = await post("/queued/remove-by-text", { match: marker }); } catch (e) { removedByText = { error: String(e) }; }
					await sleep(700);
					const stillInQueue = (sessionOf().queue || []).some((r) => String(r.text || "").includes(marker));
					store.armed = true;
					if (actions) actions.setDraft("");
					const removedCount = removedByText && Array.isArray(removedByText.removed) ? removedByText.removed.length : 0;
					const pass6 = removedCount > 0 && stillInQueue === false;
					push("E6", "交付链路+正控",
						"解除拦截 → setDraft(标记文本) → 派发 Enter → 观察官方队列 → 宿主按文本权威撤销",
						"合成事件抵达官方发送入口（官方队列/收件箱出现该文本）、setDraft 内容被完整提交、撤销后队列干净",
						{ running: true, echoBefore, echoAfter, queuedRowObserved: Boolean(rowObserved), queuedText: rowObserved ? String(rowObserved.text).slice(0, 60) : null, removedByText, removedCount, stillInQueue },
						pass6);
				}
			}

			// ══════════ 1.2 三控件落位 ══════════
			const controlsEl = store.node;
			const cardF = cardOf(controlsEl);
			const rectOf = (el) => {
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
			};
			const officialButtons = () => buttonsOf(cardF).filter((b) => b.getAttribute("aria-label") && !(b.closest && b.closest('[data-dpo="controls"]')));
			const snapshotRects = () => officialButtons().map((b) => ({ label: b.getAttribute("aria-label"), r: rectOf(b) }));
			const follows = (a, b) => Boolean(a && b) && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

			const tierEl = cardF ? cardF.querySelector('[data-dpo="tier"]') : null;
			const permEl = cardF ? cardF.querySelector('[data-dpo="perm"]') : null;
			const modelEl = cardF ? cardF.querySelector('[data-dpo="model"]') : null;
			const permOfficial = officialButtons().find((b) => String(b.getAttribute("aria-label")).includes(L("访问模式")));
			const modelOfficial = officialButtons().find((b) => String(b.getAttribute("aria-label")).includes(L("选择模型")));
			const sameRow = rectOf(tierEl) && rectOf(permOfficial) ? Math.abs(rectOf(tierEl).y - rectOf(permOfficial).y) <= 2 : false;
			const f1pass = Boolean(tierEl && permEl && modelEl && permOfficial && modelOfficial)
				&& follows(permOfficial, tierEl) && follows(tierEl, permEl) && follows(permEl, modelEl) && follows(modelEl, modelOfficial)
				&& sameRow;
			push("F1", "三控件落位",
				"定位三个控件，并与官方「访问模式」「选择模型」做文档顺序 + 几何核对",
				"三控件存在；顺序为 权限设置 → 档位 → 权限 → 模型入口 → 官方模型座位；与权限设置同一行",
				{
					exists: { tier: Boolean(tierEl), perm: Boolean(permEl), model: Boolean(modelEl), permOfficial: Boolean(permOfficial), modelOfficial: Boolean(modelOfficial) },
					order: { permBeforeTier: follows(permOfficial, tierEl), tierBeforePerm: follows(tierEl, permEl), permBeforeModel: follows(permEl, modelEl), modelBeforeOfficial: follows(modelEl, modelOfficial) },
					rects: { tier: rectOf(tierEl), perm: rectOf(permEl), model: rectOf(modelEl), permOfficial: rectOf(permOfficial), modelOfficial: rectOf(modelOfficial) },
					sameRow,
					text: { tier: tierEl ? tierEl.textContent : null, perm: permEl ? permEl.textContent : null, model: modelEl ? modelEl.textContent : null },
				},
				f1pass);

			const segBtn = (name, id) => (cardF ? cardF.querySelector('[data-dpo="' + name + "-" + id + '"]') : null);
			const permButtons = permEl ? Array.from(permEl.querySelectorAll("button")) : [];
			const tierBeforeF2 = store.tier;
			const permBeforeF2 = store.permission;
			const offBtn = segBtn("tier", "off");
			if (offBtn) dispatchClick(offBtn);
			await sleep(200);
			const offState = {
				tier: store.tier, armed: store.armed,
				disabled: permButtons.map((b) => b.disabled),
				permOpacity: permEl ? getComputedStyle(permEl).opacity : null,
			};
			const permBeforeClick = store.permission;
			if (permButtons[1]) dispatchClick(permButtons[1]);
			await sleep(120);
			const permAfterClickWhileOff = store.permission;
			const basicBtn = segBtn("tier", "basic");
			if (basicBtn) dispatchClick(basicBtn);
			await sleep(200);
			const onState = {
				tier: store.tier, armed: store.armed,
				disabled: permButtons.map((b) => b.disabled),
				permOpacity: permEl ? getComputedStyle(permEl).opacity : null,
			};
			if (permButtons[1]) dispatchClick(permButtons[1]);
			await sleep(120);
			const permAfterClickWhileOn = store.permission;
			const f2pass = permButtons.length === 2
				&& offState.disabled.every((d) => d === true)
				&& offState.armed === false
				&& permAfterClickWhileOff === permBeforeClick
				&& onState.disabled.every((d) => d === false)
				&& onState.armed === true
				&& permAfterClickWhileOn === "auto";
			push("F2", "档位=关闭 → 权限置灰联动",
				"真实点击「关闭」段 → 试点权限段 → 点回「普通」段 → 再点权限段",
				"关闭档：权限段 disabled 且点击无效、拦截停用；回到普通档：权限段恢复可点且能切换",
				{ offState, permBeforeClick, permAfterClickWhileOff, onState, permAfterClickWhileOn, permOpacityOff: offState.permOpacity, permOpacityOn: onState.permOpacity },
				f2pass);
			setPermission("review", "probe-reset");
			if (tierBeforeF2 !== store.tier) setTier(tierBeforeF2, "probe-restore");
			if (permBeforeF2 === "auto") setPermission("auto", "probe-restore");

			const beforeA = snapshotRects();
			if (controlsEl) controlsEl.style.display = "none";
			await frame();
			const withoutOurs = snapshotRects();
			if (controlsEl) controlsEl.style.display = "";
			await frame();
			const afterA = snapshotRects();
			const drift = [];
			for (const item of beforeA) {
				const other = withoutOurs.find((x) => x.label === item.label);
				if (!other) { drift.push({ label: item.label, missingWhenHidden: true }); continue; }
				if (Math.abs(other.r.x - item.r.x) > 1 || Math.abs(other.r.w - item.r.w) > 1 || Math.abs(other.r.y - item.r.y) > 1) {
					drift.push({ label: item.label, withOurs: item.r, hidden: other.r });
				}
			}
			const overflow = controlsEl ? { scrollW: controlsEl.scrollWidth, clientW: controlsEl.clientWidth } : null;
			const restored = beforeA.every((item) => {
				const back = afterA.find((x) => x.label === item.label);
				return back && Math.abs(back.r.x - item.r.x) <= 1 && Math.abs(back.r.w - item.r.w) <= 1;
			});
			const f3pass = beforeA.length >= 5 && drift.length === 0 && (!overflow || overflow.scrollW <= overflow.clientW + 1) && restored;
			push("F3", "零位移/零遮挡（A/B）",
				"记录官方控件 rect → 隐藏本插件控件 → 复测 → 恢复后再测",
				"隐藏前后官方控件 rect 完全一致（±1px）；本插件内容不横向溢出；恢复后位置回到原样",
				{ officialCount: beforeA.length, drift, overflow, restored, ourRect: rectOf(controlsEl), samples: beforeA.slice(0, 4) },
				f3pass);

			// ══════════ 1.3 手势边界与放行白名单 ══════════
			const fakeEnter = (over) => Object.assign({
				key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
				isComposing: false, keyCode: 13,
			}, over || {});
			const passRows = [];

			// G1：Shift+Enter 换行（真实派发）
			if (actions) actions.setDraft("DPO-换行测试");
			await frame();
			if (editor) editor.focus();
			let gBefore = store.intercepts.length;
			let gSpy = spyBubble("keydown", "g");
			dispatchKey(editor, { shiftKey: true }, "g");
			await sleep(300);
			gSpy.stop();
			passRows.push({
				id: "G1", name: "Shift+Enter 换行", mode: L("真实派发"),
				intercepted: store.intercepts.length > gBefore,
				reachedBubble: gSpy.box.reached,
				draftLenAfter: draftLive().length,
				hasNewline: draftLive().includes("\n"),
			});

			// G5：卡片外回车（临时 input 挂在 body 上，等价于设置页/重命名框）
			const outsideInput = document.createElement("input");
			outsideInput.setAttribute("data-dpo-probe", "outside");
			outsideInput.style.cssText = "position:fixed;left:-9999px;top:0";
			document.body.appendChild(outsideInput);
			probeArtifacts.add(() => { try { outsideInput.remove() } catch (e) { /* noop */ } });
			outsideInput.focus();
			await sleep(80);
			const gCard = cardOf(store.node);
			gBefore = store.intercepts.length;
			gSpy = spyBubble("keydown", "g");
			const g5Event = dispatchKey(outsideInput, {}, "g");
			await sleep(250);
			gSpy.stop();
			passRows.push({
				id: "G5", name: "卡片外回车（设置页/重命名框同类）", mode: L("真实派发"),
				activeOutsideCard: Boolean(gCard && !gCard.contains(document.activeElement)),
				intercepted: store.intercepts.length > gBefore,
				reachedBubble: gSpy.box.reached,
				defaultPrevented: g5Event.defaultPrevented,
			});
			outsideInput.remove();
			if (editor) editor.focus();
			await sleep(80);

			// G2：空白草稿（等价空草稿 steer 手势；真实派发）
			if (actions) actions.setDraft("   ");
			await frame();
			if (editor) editor.focus();
			gBefore = store.intercepts.length;
			const g2QueueBefore = (sessionOf().queue || []).length;
			gSpy = spyBubble("keydown", "g");
			dispatchKey(editor, {}, "g");
			await sleep(400);
			gSpy.stop();
			const g2QueueAfter = (sessionOf().queue || []).length;
			passRows.push({
				id: "G2", name: "空白草稿（空草稿 steer 手势）", mode: L("真实派发"),
				intercepted: store.intercepts.length > gBefore,
				reachedBubble: gSpy.box.reached,
				queueBefore: g2QueueBefore, queueAfter: g2QueueAfter,
			});
			if (actions) actions.setDraft("");
			await frame();

			// G3：/ 命令 —— 真实派发（用已注册的 /permission；popupSelect 型：只进入 claimed，不落任何副作用）
			if (actions) actions.setDraft("/goal 边界测试");
			await frame();
			if (editor) editor.focus();
			const g3Predicate = interceptKey(fakeEnter());
			const g3AccessBefore = (officialButtons().find((b) => String(b.getAttribute("aria-label")).includes(L("访问模式"))) || {}).getAttribute
				? officialButtons().find((b) => String(b.getAttribute("aria-label")).includes(L("访问模式"))).getAttribute("aria-label")
				: null;
			if (actions) actions.setDraft("/permission");
			await frame();
			if (editor) editor.focus();
			const g3CountBefore = store.intercepts.length;
			const g3Spy = spyBubble("keydown", "g3");
			const g3Event = dispatchKey(editor, {}, "g3");
			await sleep(600);
			g3Spy.stop();
			const g3Input = store.latest.input || {};
			const g3Claim = g3Input.claim && g3Input.claim.token ? String(g3Input.claim.token) : null;
			if (actions) actions.setDraft("");
			await frame();
			dispatchKey(editor, { key: "Escape", code: "Escape" }, "g3esc");
			await sleep(250);
			const g3AccessAfter = officialButtons().find((b) => String(b.getAttribute("aria-label")).includes(L("访问模式")));
			passRows.push({
				id: "G3", name: "/ 命令", mode: "真实派发（/permission，popupSelect 型）",
				predicate: g3Predicate,
				intercepted: store.intercepts.length > g3CountBefore,
				reachedBubble: g3Spy.box.reached,
				other: g3Spy.box.other,
				defaultPrevented: g3Event.defaultPrevented,
				phaseAfterDispatch: g3Input.phase || null,
				claimToken: g3Claim,
				officialEngaged: g3Claim === "/permission" || g3Input.phase === "claimed" || g3Input.phase === "submitting",
				accessUnchanged: g3AccessBefore === (g3AccessAfter ? g3AccessAfter.getAttribute("aria-label") : g3AccessBefore),
			});
			if (actions) actions.setDraft("");
			await frame();

			// G4：仅附件（草稿无文本 ⇒ 同一放行分支；真附件上传无法在探针内构造）
			if (editor) editor.focus();
			const g4Key = interceptKey(fakeEnter());
			const g4Click = wouldInterceptClick(sendButtonOf(cardOf(store.node)));
			passRows.push({
				id: "G4", name: "仅附件发送（草稿文本为空）", mode: "谓词级（判定只看草稿文本）",
				keyPredicate: g4Key, clickPredicate: g4Click,
			});

			// G6：fail-open（复用 E6 正控）+ 无重复 + 无卡死
			const e6 = steps.find((s) => s.id === "E6") || { observed: {} };
			const alive = {
				controlsAlive: Boolean(cardOf(store.node) && cardOf(store.node).querySelector('[data-dpo="controls"]')),
				tier: store.tier, armed: store.armed,
				editorFocusable: Boolean(editorOf(cardOf(store.node))),
				interceptCount: store.intercepts.length,
			};
			const rowsPass = passRows.filter((row) => row.mode === "真实派发").every((row) => row.intercepted === false && row.reachedBubble === true)
				&& g3Predicate === false && g4Key === false && g4Click === false;
			push("G", "放行白名单与 fail-open",
				"逐条复现放行清单（真实派发 + 谓词级）并核对 fail-open 正控",
				"五条放行项均不被接管且事件继续传播；未命中时官方链路照常发出（无重复、无卡死）",
				{
					passRows, alive,
					failOpen: { e6QueuedRowObserved: e6.observed.queuedRowObserved, e6RemovedCount: e6.observed.removedCount, e6StillInQueue: e6.observed.stillInQueue, e6QueuedText: e6.observed.queuedText },
				},
				rowsPass && alive.controlsAlive && alive.armed === true && Boolean(e6.observed.queuedRowObserved));

			// I1：查证 trace 在浮层里可见（小类 2.3 验收 3，渲染层机检）
			let tracePayload = null;
			try { tracePayload = await (await fetch(API + "/trace", { cache: "no-store" })).json(); } catch (e) { tracePayload = { error: String(e) }; }
			store.trace = tracePayload && tracePayload.ok ? tracePayload : null;
			setOverlay({ open: true, text: "查证 trace 渲染测试", src: "i1" });
			await frame();
			await sleep(150);
			const traceRowEls = document.querySelectorAll('[data-dpo="trace-row"]');
			const traceHostEl = document.querySelector('[data-dpo="trace"]');
			const i1pass = Boolean(tracePayload && tracePayload.ok)
				&& Array.isArray(tracePayload.normal) && tracePayload.normal.length > 0
				&& Boolean(traceHostEl) && traceRowEls.length > 0;
			push("I1", "查证动作在浮层可见",
				"拉取 /trace → 打开占位浮层 → 统计渲染出的 trace 行",
				"接口有数据且浮层内渲染出 ≥1 行查证动作（工具/参数/耗时/结果行数）",
				{
					apiOk: Boolean(tracePayload && tracePayload.ok),
					normalSteps: tracePayload && Array.isArray(tracePayload.normal) ? tracePayload.normal.length : null,
					cappedSteps: tracePayload && Array.isArray(tracePayload.capped) ? tracePayload.capped.length : null,
					converged: tracePayload ? tracePayload.converged : null,
					renderedRows: traceRowEls.length,
					hostPresent: Boolean(traceHostEl),
					sample: Array.from(traceRowEls).slice(0, 3).map((el) => String(el.textContent).slice(0, 60)),
				}, i1pass);
			setOverlay({ open: false });
			await frame();
			// J1：可拖动浮层（跟手 / 越界约束 / 点击穿透 / 关闭即清理）
			// 探针期间禁止把几何写进用户偏好，并在结束时还原（用户文件不被测试改写）
			const jUiSnapshot = { size: store.overlaySize ? Object.assign({}, store.overlaySize) : null, pos: store.overlayPos ? Object.assign({}, store.overlayPos) : null };
			store.suppressUiPersist = true;
			store.overlayPos = { x: 220, y: 140 };
			setOverlay({ open: true, text: "拖动测试文本", src: "j1" });
			await frame();
			await sleep(140);
			const jPanel = document.querySelector('[data-dpo="overlay"]');
			const jHead = jPanel ? jPanel.querySelector('[data-dpo="drag-handle"]') : null;
			const jLayer = jPanel ? jPanel.parentElement : null;
			const jRenderBefore = store.renderCount || 0;
			const jR0 = jPanel ? jPanel.getBoundingClientRect() : null;
			const jPt = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1, button: 0, clientX: x, clientY: y });
			if (jHead && jPanel) {
				const sx = jR0.left + Math.round(jR0.width / 2); const sy = jR0.top + 10;
				jHead.dispatchEvent(jPt("pointerdown", sx, sy));
				for (let i = 1; i <= 8; i += 1) jHead.dispatchEvent(jPt("pointermove", sx + 15 * i, sy + 10 * i));
				jHead.dispatchEvent(jPt("pointerup", sx + 120, sy + 80));
			}
			await frame();
			await sleep(90);
			const jR1 = jPanel ? jPanel.getBoundingClientRect() : null;
			const jFollow = jR0 && jR1 ? { dx: Math.round(jR1.left - jR0.left), dy: Math.round(jR1.top - jR0.top) } : null;
			const jRenders = (store.renderCount || 0) - jRenderBefore;
			if (jHead && jPanel) {
				const sx = jR1.left + Math.round(jR1.width / 2); const sy = jR1.top + 10;
				jHead.dispatchEvent(jPt("pointerdown", sx, sy));
				jHead.dispatchEvent(jPt("pointermove", sx + 5000, sy + 5000));
				jHead.dispatchEvent(jPt("pointerup", sx + 5000, sy + 5000));
			}
			await frame();
			await sleep(90);
			const jR2 = jPanel ? jPanel.getBoundingClientRect() : null;
			const jInView = Boolean(jR2) && jR2.left >= 0 && jR2.top >= 0 && jR2.right <= window.innerWidth + 1 && jR2.bottom <= window.innerHeight + 1;
			const jLayerPe = jLayer ? getComputedStyle(jLayer).pointerEvents : null;
			const jPanelPe = jPanel ? getComputedStyle(jPanel).pointerEvents : null;
			const jOutsideEl = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight - 60));
			const jOutsideOurs = Boolean(jOutsideEl && jOutsideEl.closest && jOutsideEl.closest('[data-dpo="overlay"]'));
			const jInsideEl = jR2 ? document.elementFromPoint(Math.round(jR2.left + 12), Math.round(jR2.top + 12)) : null;
			const jInsideOurs = Boolean(jInsideEl && jInsideEl.closest && jInsideEl.closest('[data-dpo="overlay"]'));
			// J1b：把"上一次在更大窗口里留下的视口外坐标"写回 → 重新开窗必须被夹回可见区（用户实测缺陷回归）
			store.overlayPos = { x: window.innerWidth + 4000, y: window.innerHeight + 4000 };
			setOverlay({ open: true });
			await frame();
			await sleep(150);
			const jPanel3 = document.querySelector('[data-dpo="overlay"]');
			const jR3 = jPanel3 ? jPanel3.getBoundingClientRect() : null;
			const jClampOnOpen = Boolean(jR3) && jR3.left >= 0 && jR3.top >= 0
				&& jR3.right <= window.innerWidth + 1 && jR3.bottom <= window.innerHeight + 1;
			const jClampObserved = jR3 ? { left: Math.round(jR3.left), top: Math.round(jR3.top), right: Math.round(jR3.right), bottom: Math.round(jR3.bottom) } : null;
			// J1c：右下角手柄拖拽改尺寸（变大/变小都验），且不得超过视口
			const jGrip = document.querySelector('[data-dpo="resize"]');
			let jResize = null;
			if (jGrip && jPanel3) {
				const r0 = jPanel3.getBoundingClientRect();
				const gx = r0.right - 6; const gy = r0.bottom - 6;
				jGrip.dispatchEvent(jPt("pointerdown", gx, gy));
				jGrip.dispatchEvent(jPt("pointermove", gx - 120, gy - 90));
				jGrip.dispatchEvent(jPt("pointerup", gx - 120, gy - 90));
				await frame();
				await sleep(140);
				const r1 = jPanel3.getBoundingClientRect();
				jResize = {
					w0: Math.round(r0.width), h0: Math.round(r0.height), w1: Math.round(r1.width), h1: Math.round(r1.height),
					dw: Math.round(r1.width - r0.width), dh: Math.round(r1.height - r0.height),
					persisted: store.overlaySize || null,
					withinViewport: r1.right <= window.innerWidth + 1 && r1.bottom <= window.innerHeight + 1,
				};
			}
			const jResizeOk = Boolean(jResize) && jResize.dw <= -100 && jResize.dw >= -140 && jResize.dh <= -70 && jResize.dh >= -110 && jResize.withinViewport === true;
			// J1d：点击守卫回归——在「回退」按钮上按下：不得 preventDefault（否则 click 被浏览器抑制）、不得启动拖动
			const jRollbackBtn = document.querySelector('[data-dpo="rollback"]');
			let jGuard = null;
			if (jRollbackBtn && jPanel3) {
				const bb = jRollbackBtn.getBoundingClientRect();
				const before = jPanel3.getBoundingClientRect();
				const downEv = jPt("pointerdown", bb.left + 4, bb.top + 4);
				jRollbackBtn.dispatchEvent(downEv);
				jRollbackBtn.dispatchEvent(jPt("pointermove", bb.left + 220, bb.top + 160));
				jRollbackBtn.dispatchEvent(jPt("pointerup", bb.left + 220, bb.top + 160));
				await frame();
				await sleep(90);
				const after = jPanel3.getBoundingClientRect();
				jGuard = {
					defaultPrevented: downEv.defaultPrevented === true,
					moved: Math.round(Math.abs(after.left - before.left) + Math.abs(after.top - before.top)),
					reachable: (() => { const el = document.elementFromPoint(Math.round(bb.left + 4), Math.round(bb.top + 4)); return Boolean(el && el.closest && el.closest('[data-dpo="rollback"]')); })(),
				};
			}
			const jGuardOk = Boolean(jGuard) && jGuard.defaultPrevented === false && jGuard.moved === 0 && jGuard.reachable === true;
			setOverlay({ open: false });
			// 几何还原：探针不改变用户的浮层尺寸/位置偏好
			store.suppressUiPersist = false;
			store.overlaySize = jUiSnapshot.size;
			store.overlayPos = jUiSnapshot.pos;
			await frame();
			await sleep(140);
			const jGone = !document.querySelector('[data-dpo="overlay"]');
			const jListeners = store.resizeListeners || 0;
			const jSendBtn = sendButtonOf(cardOf(store.node));
			let jSendReachable = null;
			if (jSendBtn) {
				const rb = jSendBtn.getBoundingClientRect();
				const el = document.elementFromPoint(Math.round(rb.left + rb.width / 2), Math.round(rb.top + rb.height / 2));
				jSendReachable = Boolean(el && (el === jSendBtn || (el.closest && el.closest("button") === jSendBtn)));
			}
			const j1pass = Boolean(jFollow) && Math.abs(jFollow.dx - 120) <= 6 && Math.abs(jFollow.dy - 80) <= 6
				&& jInView && jPanelPe === "auto" && !jOutsideOurs && jInsideOurs && jSendReachable === true
				&& jGone && jListeners === 0 && jRenders <= 2
				&& jClampOnOpen === true && jResizeOk === true && jGuardOk === true;
			push("J1", "可拖动浮层（跟手/边界/穿透/清理/开窗夹紧/改尺寸）",
				"合成 pointerdown→move×8→up 位移(+120,+80)；再拖 +5000；elementFromPoint 验穿透；写回视口外旧坐标后重开；右下角手柄拖拽改尺寸；关闭后查 DOM 与监听计数",
				"位移与手势 1:1（±6px）、面板始终在视口内、容器穿透/面板可点、视口外旧坐标重开后仍在可见区、右下角可改尺寸且不越界、关闭后节点与监听均清理、拖动期间 React 渲染 ≤2",
				{
					follow: jFollow, inView: jInView, layerPointerEvents: jLayerPe, panelPointerEvents: jPanelPe, sendReachable: jSendReachable,
					outsideHitsOurs: jOutsideOurs, insideHitsOurs: jInsideOurs, closedRemoved: jGone,
					resizeListenersAfterClose: jListeners, rendersDuringDrag: jRenders,
					clampOnOpen: jClampOnOpen, clampObserved: jClampObserved, resize: jResize, resizeOk: jResizeOk, clickGuard: jGuard, guardOk: jGuardOk,
					rectAfterClamp: jR2 ? { left: Math.round(jR2.left), top: Math.round(jR2.top), right: Math.round(jR2.right), bottom: Math.round(jR2.bottom) } : null,
					viewport: { w: window.innerWidth, h: window.innerHeight },
				}, j1pass);
			// K1：流式思考与产出（分区 / 增量 / 首字 / 失败态 / 重试）
			const kReq = "把那个页面弄好看点，动画也加上";
			const kT0 = Date.now();
			startRun(kReq, "basic", false);
			await frame();
			let kFirst = null;
			for (let i = 0; i < 60 && kFirst === null; i += 1) {
				await sleep(100);
				const r = store.run;
				if (r && (r.reasoning.length > 0 || r.text.length > 0)) kFirst = Date.now() - kT0;
			}
			const kPaneREarly = Boolean(document.querySelector('[data-dpo="pane-reasoning"]'));
			const kPaneTEarly = Boolean(document.querySelector('[data-dpo="pane-text"]'));
			const kSnap1 = { r: store.run.reasoning.length, t: store.run.text.length };
			await sleep(2500);
			const kSnap2 = { r: store.run.reasoning.length, t: store.run.text.length };
			for (let i = 0; i < 160 && store.run.status === "running"; i += 1) await sleep(250);
			const kRun = store.run;
			const kReason = kRun.reasoning || "";
			const kText = kRun.text || "";
			const kPaneR = document.querySelector('[data-dpo="pane-reasoning"]');
			const kPaneT = document.querySelector('[data-dpo="pane-text"]');
			// 通道身份判据：两栏渲染内容必须分别对应各自事件流的累积（思考通道可能引用结构标题，不能拿标题当判据）
			const kPaneRText = kPaneR ? String(kPaneR.textContent || "") : "";
			const kPaneTText = kPaneT ? String(kPaneT.textContent || "") : "";
			const kRSample = kReason.slice(0, 40);
			const kTSample = kText.slice(0, 40);
			const kSeparated = Boolean(kPaneR && kPaneT)
				&& kPaneR !== kPaneT
				&& kPaneRText !== kPaneTText
				&& (kRSample.length === 0 || kPaneRText.indexOf(kRSample) >= 0)
				&& (kTSample.length === 0 || kPaneTText.indexOf(kTSample) >= 0)
				&& (kReason.length === 0 || kText.length === 0 || kPaneRText.indexOf(kTSample) < 0);
			// 失败态：真实失败路径（未注册 provider）
			startRun(kReq, "basic", true);
			await frame();
			for (let i = 0; i < 100 && store.run.status !== "error" && store.run.status !== "done"; i += 1) await sleep(200);
			const kErrNode = document.querySelector('[data-dpo="run-error"]');
			const kRetryBtn = document.querySelector('[data-dpo="retry"]');
			const kFail = {
				status: store.run.status,
				error: String(store.run.error || "").slice(0, 160),
				errorNodeText: kErrNode ? String(kErrNode.textContent).slice(0, 160) : null,
				hasRetry: Boolean(kRetryBtn),
				textEmpty: (store.run.text || "").length === 0,
			};
			let kRecovered = false;
			if (kRetryBtn) {
				dispatchClick(kRetryBtn, "k1retry");
				for (let i = 0; i < 160 && (store.run.status === "running" || (store.run.text || "").length === 0); i += 1) await sleep(250);
				kRecovered = store.run.status === "done" && (store.run.text || "").length > 0 && !store.run.error;
			}
			const k1pass = kFirst !== null && kFirst <= 2000 && kPaneREarly && kPaneTEarly
				&& (kSnap2.r + kSnap2.t) > (kSnap1.r + kSnap1.t) && kSeparated
				&& kFail.status === "error" && kFail.error.length > 0 && kFail.hasRetry && kFail.textEmpty
				&& kRecovered === true;
			push("K1", "流式思考与产出（分区/增量/首字/失败态/重试）",
				"真实启动一次优化并采样两栏字数；再用未注册 provider 触发真实失败并点重试",
				"两栏独立且不混、字数持续增长、首字 ≤2s（不白屏）、失败有可读原因+重试且产出栏为空、重试后恢复出字",
				{
					firstPaintMs: kFirst, panesEarly: { reasoning: kPaneREarly, text: kPaneTEarly },
					snap1: kSnap1, snap2: kSnap2, separated: kSeparated,
					runStatus: kRun.status, textChars: kText.length, reasoningChars: kReason.length,
					fail: kFail, recovered: kRecovered,
				}, k1pass);
			// L1：审查态与双按钮（可编辑 / 超长可滚 / 同色系 / 红色 / 提交链路）
			const lArea0 = document.querySelector('[data-dpo="review-text"]');
			const lConfirm = document.querySelector('[data-dpo="confirm"]');
			const lRegen = document.querySelector('[data-dpo="regen"]');
			const lLong = "DPO-编辑后-" + "段落内容".repeat(140);
			if (lArea0) {
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
				setter.call(lArea0, lLong);
				lArea0.dispatchEvent(new Event("input", { bubbles: true }));
			}
			await frame();
			await sleep(150);
			const lArea = document.querySelector('[data-dpo="review-text"]');
			const lEdited = Boolean(store.reviewText === lLong);
			const lScroll = lArea ? { scrollH: lArea.scrollHeight, clientH: lArea.clientHeight, overflowY: getComputedStyle(lArea).overflowY } : null;
			const lScrollable = Boolean(lScroll) && lScroll.scrollH > lScroll.clientH && (lScroll.overflowY === "auto" || lScroll.overflowY === "scroll");
			const rgbOf = (s) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(s || "")); return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null; };
			const lSendBtn = sendButtonOf(cardOf(store.node));
			const lSendBg = lSendBtn ? getComputedStyle(lSendBtn).backgroundColor : null;
			const lConfirmBg = lConfirm ? getComputedStyle(lConfirm).backgroundColor : null;
			const lRegenBg = lRegen ? getComputedStyle(lRegen).backgroundColor : null;
			const lRegenRgb = rgbOf(lRegenBg);
			const lRegenIsRed = Boolean(lRegenRgb) && lRegenRgb.r > 140 && lRegenRgb.g < 120 && lRegenRgb.b < 120;
			const lSameAccent = Boolean(lSendBg && lConfirmBg && lSendBg === lConfirmBg);
			const lDraftBefore = draftLive();
			try { await post("/watch/clear", {}); } catch (e) { /* noop（清看门狗以便观测本条，收尾 sweep 会重新挂回） */ }
			const lRunning = runningNow();
			if (lConfirm && lRunning) dispatchClick(lConfirm, "l1confirm");
			if (!lRunning) { push("L1", "审查态与双按钮", "会话 idle：跳过破坏性提交（避免消息永久落库）", "仅验证可编辑/可滚/配色", { skippedSubmit: true, edited: lEdited, scrollable: lScrollable, sameAccent: lSameAccent, regenIsRed: lRegenIsRed }, lEdited && lScrollable && lSameAccent && lRegenIsRed); }
			await frame();
			await sleep(350);
			const lDraftAfter = draftLive();
			let lQueuedRow = null;
			for (let i = 0; i < 14 && !lQueuedRow; i += 1) {
				await sleep(300);
				lQueuedRow = (sessionOf().queue || []).find((r) => String(r.text || "").includes("DPO-编辑后-")) || null;
			}
			let lRemoved = null;
			try { lRemoved = await post("/queued/remove-by-text", { match: "DPO-编辑后-" }); } catch (e) { lRemoved = { error: String(e) }; }
			const lRemovedCount = lRemoved && Array.isArray(lRemoved.removed) ? lRemoved.removed.length : 0;
			const lReviewGone = !document.querySelector('[data-dpo="review"]');
			const l1pass = Boolean(lArea0 && lConfirm && lRegen) && lEdited && lScrollable && lRegenIsRed && lSameAccent
				&& lDraftAfter === "" && lRemovedCount > 0 && lReviewGone;
			push("L1", "审查态与双按钮（可编辑/可滚/配色/提交链路）",
				"写入超长编辑文本→派发 input；取官方发送按钮与『确认提交』计算色；点确认提交→查输入框与官方待处理队列→宿主撤销",
				"编辑值被采纳、超长可滚、确认提交与发送按钮同色、重新生成为红、提交后输入框清空且文本进入官方队列（零污染）",
				{
					hasTextarea: Boolean(lArea0), hasConfirm: Boolean(lConfirm), hasRegen: Boolean(lRegen),
					edited: lEdited, scroll: lScroll, scrollable: lScrollable,
					sendBg: lSendBg, confirmBg: lConfirmBg, sameAccent: lSameAccent,
					regenBg: lRegenBg, regenIsRed: lRegenIsRed,
					draftBeforeLen: String(lDraftBefore || "").length, draftAfterLen: String(lDraftAfter || "").length,
					queuedRow: Boolean(lQueuedRow), queuedText: lQueuedRow ? String(lQueuedRow.text).slice(0, 40) : null,
					removedCount: lRemovedCount, reviewClosed: lReviewGone,
				}, l1pass);
			// M1：回退二次确认（确认行 / 取消不丢状态 / 确定=停+关+不发+原文保持 / 无残留 / 不串台）
			const mOrig = "DPO-原文保持-" + token;
			if (actions) actions.setDraft(mOrig);
			await frame();
			startRun("把那个页面弄好看点，动画也加上", "basic", false);
			for (let i = 0; i < 60 && (store.run.status === "connecting" || (store.run.text || "").length === 0 && (store.run.reasoning || "").length === 0); i += 1) await sleep(200);
			const mRunningBefore = store.run ? store.run.status : null;
			const mRbBtn = document.querySelector('[data-dpo="rollback"]');
			if (mRbBtn) dispatchClick(mRbBtn, "m1rb");
			await frame();
			await sleep(120);
			const mConfirmShown = Boolean(document.querySelector('[data-dpo="rollback-confirm"]'));
			const mStateKeptOnPrompt = store.run ? store.run.status : null;
			const mNoBtn = document.querySelector('[data-dpo="rollback-no"]');
			if (mNoBtn) dispatchClick(mNoBtn, "m1no");
			await frame();
			await sleep(120);
			const mConfirmGone = !document.querySelector('[data-dpo="rollback-confirm"]');
			const mStateKeptAfterCancel = store.run ? store.run.status : null;
			// 再点回退 → 确定
			const mRbBtn2 = document.querySelector('[data-dpo="rollback"]');
			if (mRbBtn2) dispatchClick(mRbBtn2, "m1rb2");
			await frame();
			await sleep(120);
			const mYesBtn = document.querySelector('[data-dpo="rollback-yes"]');
			const mRunIdBefore = store.run ? store.run.runId : null;
			if (mYesBtn) dispatchClick(mYesBtn, "m1yes");
			await frame();
			await sleep(800);
			const mOverlayGone = !document.querySelector('[data-dpo="overlay"]');
			const mRunCleared = store.run === null;
			const mDraftKept = draftLive() === mOrig;
			let mRuns = null;
			try { mRuns = await (await fetch(API + "/runs", { cache: "no-store" })).json(); } catch (e) { mRuns = { error: String(e) }; }
			const mTarget = mRuns && Array.isArray(mRuns.runs) ? mRuns.runs.find((r) => r.id === mRunIdBefore) : null;
			const mNoResidue = Boolean(mTarget) && mTarget.status === "aborted" && mTarget.subs === 0;
			// 不串台：回退后再起一次，应能正常跑完
			startRun("把那个页面弄好看点", "basic", false);
			for (let i = 0; i < 160 && store.run && store.run.status !== "done" && store.run.status !== "error"; i += 1) await sleep(250);
			const mNextOk = Boolean(store.run) && store.run.status === "done" && (store.run.text || "").length > 0;
			const m1pass = Boolean(mRbBtn && mYesBtn) && mConfirmShown && mStateKeptOnPrompt === mRunningBefore
				&& mConfirmGone && (mStateKeptAfterCancel === "running" || mStateKeptAfterCancel === mRunningBefore)
				&& mOverlayGone && mRunCleared && mDraftKept && mNoResidue && mNextOk;
			push("M1", "回退二次确认（确认/取消/中止/原文保持/不串台）",
				"起一次优化→点回退看确认行→取消（状态应不丢）→再点回退并确定→查宿主 /runs 与输入框→再起一次验证不串台",
				"确认行出现、取消后状态不丢、确定后浮层关闭+run 中止且 subs=0+原文逐字保持+不发消息、随后再次优化能正常完成",
				{
					runningBefore: mRunningBefore, confirmShown: mConfirmShown, stateKeptOnPrompt: mStateKeptOnPrompt,
					confirmGoneAfterCancel: mConfirmGone, stateAfterCancel: mStateKeptAfterCancel,
					overlayClosed: mOverlayGone, runCleared: mRunCleared, draftKept: mDraftKept,
					abortedRun: mTarget, noResidue: mNoResidue, nextRunOk: mNextOk,
					nextRunChars: store.run ? (store.run.text || "").length : 0,
				}, m1pass);
			store.rollbackConfirm = false;
			setOverlay({ open: false });
			store.run = null;
			if (actions) actions.setDraft("");
			// N1：优化模型弹层（同源目录 / 独立于对话模型 / 下一次优化生效）
			let nCat = null;
			try { nCat = await (await fetch(API + "/models", { cache: "no-store" })).json(); } catch (e) { nCat = { error: String(e) }; }
			store.modelCatalog = nCat && nCat.ok ? nCat : null;
			const nCard = cardOf(store.node);
			const nSeat = buttonsOf(nCard).find((b) => String(b.getAttribute("aria-label")).includes(L("选择模型")));
			const nSeatBefore = nSeat ? nSeat.getAttribute("aria-label") : null;
			const nGroups = nCat && Array.isArray(nCat.groups) ? nCat.groups : [];
			const nSeatName = nSeatBefore ? (nSeatBefore.match(/当前\s*([^，,]+)/) || [])[1] : null;
			const nNameMatched = Boolean(nSeatName) && nGroups.some((g) => (g.models || []).some((m) => m.name === nSeatName || m.id === nSeatName));
			const nPill = nCard ? nCard.querySelector('[data-dpo="model"]') : null;
			if (nPill) dispatchClick(nPill, "n1open");
			await frame();
			await sleep(180);
			const nPop = document.querySelector('[data-dpo="model-pop"]');
			const nItems = [...document.querySelectorAll('[data-dpo="model-item"]')];
			const nTitles = [...document.querySelectorAll('[data-dpo="model-group-name"]')].map((el) => String(el.textContent));
			const curSel = nCat && nCat.current ? nCat.current : null;
			let nPick = null;
			for (const el of nItems) {
				const p = el.getAttribute("data-provider");
				const m = el.getAttribute("data-model");
				if (!curSel || p !== curSel.provider || m !== curSel.model) { nPick = { provider: p, model: m, name: String(el.textContent) }; break; }
			}
			if (nPick) {
				const target = nItems.find((el) => el.getAttribute("data-provider") === nPick.provider && el.getAttribute("data-model") === nPick.model);
				if (target) dispatchClick(target, "n1pick");
			}
			await frame();
			await sleep(180);
			const nSel = store.modelSel;
			const nSeatAfter = nSeat ? nSeat.getAttribute("aria-label") : null;
			const nPopClosed = !document.querySelector('[data-dpo="model-pop"]');
			let nRunSel = null;
			if (nSel) {
				startRun("把那个页面弄好看点", "basic", false);
				for (let i = 0; i < 40 && !(store.run && store.run.runId); i += 1) await sleep(200);
				await sleep(1200);
				try {
					const rr = await (await fetch(API + "/runs", { cache: "no-store" })).json();
					const mine = rr && Array.isArray(rr.runs) ? rr.runs.find((x) => x.id === (store.run ? store.run.runId : null)) : null;
					nRunSel = mine ? { provider: mine.provider, model: mine.model } : null;
				} catch (e) { nRunSel = { error: String(e) }; }
				if (store.run && store.run.runId) { try { await post("/run/abort", { runId: store.run.runId }); } catch (e) { /* noop */ } }
				store.run = null;
				setOverlay({ open: false });
			}
			const n1pass = Boolean(nPop) && nItems.length > 0 && nGroups.length > 0 && nNameMatched
				&& nTitles.length === nGroups.length && Boolean(nSel) && nSeatAfter === nSeatBefore && nPopClosed
				&& Boolean(nRunSel) && nRunSel.provider === nSel.provider && nRunSel.model === nSel.model;
			push("N1", "优化模型弹层（同源/独立/生效）",
				"拉 /models 与官方座位 aria-label 交叉核对；点胶囊开弹层→选一个不同的模型→查官方座位是否变→再跑一次优化查 /runs 实际模型",
				"弹层分组数=目录分组数且模型名与官方座位同源；选择只影响优化（官方座位 aria-label 一字不变）；下一次运行 provider/model == 新选择",
				{
					catalogGroups: nGroups.length, catalogModels: nGroups.reduce((a, g) => a + (g.models || []).length, 0),
					seatLabelBefore: nSeatBefore, seatModelName: nSeatName, nameMatched: nNameMatched,
					popShown: Boolean(nPop), items: nItems.length, groupTitles: nTitles.slice(0, 4),
					picked: nPick, selection: nSel, seatLabelAfter: nSeatAfter, seatUnchanged: nSeatAfter === nSeatBefore,
					popClosed: nPopClosed, runUsed: nRunSel,
				}, n1pass);
			store.modelSel = null;
			emit();
			// P1：落盘与兜底（不可用模型提示 / 一键回默认 / 双客户端一致）
			const pA = await (await fetch(API + "/state", { cache: "no-store" })).json();
			const pB = await (await fetch(API + "/state", { cache: "no-store" })).json();
			const pConsistent = JSON.stringify(pA.state) === JSON.stringify(pB.state);
			store.modelSel = { provider: "ollama", model: "qwen3:8b", name: "qwen3:8b（本地）" };
			persistState();
			startRun("落盘兜底测试：把那个页面弄好看点", "basic", false);
			for (let i = 0; i < 100 && store.run && store.run.status !== "error" && store.run.status !== "done"; i += 1) await sleep(250);
			await frame();
			await sleep(150);
			const pErr = document.querySelector('[data-dpo="run-error"]');
			const pReset = document.querySelector('[data-dpo="reset-model"]');
			const pFail = { status: store.run ? store.run.status : null, msg: pErr ? String(pErr.textContent).slice(0, 110) : null, hasReset: Boolean(pReset) };
			let pRecovered = false;
			if (pReset) {
				dispatchClick(pReset, "p1reset");
				for (let i = 0; i < 140 && store.run && (store.run.status === "running" || store.run.status === "connecting"); i += 1) await sleep(250);
				pRecovered = Boolean(store.run) && store.run.status === "done" && (store.run.text || "").length > 0 && !store.modelSel;
			}
			const pAfter = await (await fetch(API + "/state", { cache: "no-store" })).json();
			if (store.run && store.run.runId) { try { await post("/run/abort", { runId: store.run.runId }); } catch (e) { /* noop */ } }
			const p1pass = pConsistent && pFail.status === "error" && Boolean(pFail.msg) && pFail.hasReset
				&& pRecovered === true && pAfter.state.model === null;
			push("P1", "落盘与兜底（提示/一键回默认/一致性）",
				"选一个真实不可用的模型（ollama 本机未启动）起跑→看错误提示与恢复按钮→点『恢复默认模型并重试』→查是否用回默认且落盘清空；并两次读 /state 比对",
				"失败有可读原因、有『恢复默认』入口、点击后回到默认模型并成功出字、落盘 model=null、两次读取一致",
				{
					consistent: pConsistent, before: { tier: pA.state.tier, permission: pA.state.permission, model: pA.state.model }, fail: pFail,
					recovered: pRecovered, after: { tier: pAfter.state.tier, permission: pAfter.state.permission, model: pAfter.state.model, revision: pAfter.state.revision },
					finalChars: store.run ? (store.run.text || "").length : 0,
				}, p1pass);
			store.run = null;
			setOverlay({ open: false });
			// H1：真·A/B 基线 —— 拆净本插件全部监听后，同一手势应原样进入官方链路
			const baselineMarker = "DPO-基线测试-" + token;
			const h1BeforeQueue = (sessionOf().queue || []).length;
			let h1Baseline = { executed: false };
			let h1Removed = null;
			let h1Restored = false;
			try {
				if (typeof window.__DPO_DISPOSE__ === "function") window.__DPO_DISPOSE__();
				await sleep(250);
				if (actions) actions.setDraft(baselineMarker);
				await frame();
				if (editor) editor.focus();
				// H1 基线用"当前页面上的活编辑器"重新解析（拆净插件后旧引用可能已脱离文档）
				const liveEditor = document.querySelector('[contenteditable="true"]');
				if (liveEditor) liveEditor.focus();
				const h1CountBefore = store.intercepts.length;
				dispatchKey(liveEditor || editor, {}, "h1");
				let h1Row = null;
				for (let i = 0; i < 12 && h1Row === null; i += 1) {
					await sleep(300);
					h1Row = (sessionOf().queue || []).find((r) => String(r.text || "").includes(baselineMarker)) || null;
				}
				h1Baseline = {
					executed: true,
					interceptedWhileDisposed: store.intercepts.length > h1CountBefore,
					queueBefore: h1BeforeQueue,
					queuedRow: Boolean(h1Row),
					queuedText: h1Row ? String(h1Row.text).slice(0, 50) : null,
					controlsNodeGone: !(store.node && store.node.isConnected),
				};
				try { h1Removed = await post("/queued/remove-by-text", { match: baselineMarker }); } catch (e) { h1Removed = { error: String(e) }; }
			} catch (e) {
				h1Baseline = { executed: false, error: String(e) };
			} finally {
				try { exports.apply(ctx); } catch (e) { /* 恢复失败在下一步断言里体现 */ }
				await sleep(400);
				const back = cardOf(store.node);
				h1Restored = Boolean(back && back.querySelector('[data-dpo="tier"]'));
			}
			push("H1", "真·A/B 基线（插件拆净）",
				"调用自身 dispose 移除全部监听与 UI → 派发同一 Enter → 宿主权威核对官方队列 → 撤销 → 重新装载",
				"无监听时同一手势原样进入官方待处理队列；撤销成功；重新装载后三控件回到原位",
				{
					baseline: h1Baseline, removed: h1Removed, restored: h1Restored,
					removedCount: h1Removed && Array.isArray(h1Removed.removed) ? h1Removed.removed.length : 0,
					note: "拆净后客户端快照不再刷新，故以宿主权威撤销结果为准（queuedRow 字段仅作参考）",
				},
				h1Baseline.interceptedWhileDisposed === false
					&& Boolean(h1Removed && Array.isArray(h1Removed.removed) && h1Removed.removed.length > 0)
					&& h1Restored === true);

			const windowEnd = Date.now();
			// 自清场：把本探针可能在官方队列里留下的标记项全部撤掉（宿主侧权威扫描）
			let sweep = null;
			try { sweep = await post("/inbox/sweep", {}); } catch (e) { sweep = { error: String(e) }; }
			if (actions) {
				if (actions) actions.setDraft(initialDraft || "");
				await frame();
			}
			const report = {
				plugin: NS, token, kind: "selftest",
				sessionId: String(store.latest.sessionId || ""),
				windowStart, windowEnd,
				userAgent: String(navigator.userAgent || ""),
				env: { sendLabels: [...SEND_LABELS], interceptCount: store.intercepts.length, intercepts: store.intercepts.slice(-8) },
				steps,
				sweep,
				passed: steps.filter((s) => s.pass).length,
				total: steps.length,
			};
			releaseProbeArtifacts();
			// 收尾还原用户配置（档位/权限/浮层几何）——探针绝不能留下"档位被关掉"这类副作用
			const snap = store.probeUiSnapshot;
			if (snap) {
				if (snap.tier && snap.tier !== store.tier) setTier(snap.tier, "probe-restore");
				if (snap.permission && snap.permission !== store.permission) setPermission(snap.permission, "probe-restore");
				store.overlaySize = snap.size || null;
				store.overlayPos = snap.pos || null;
				setOverlay({ open: false });
				beacon("probe-restored", { tier: store.tier, permission: store.permission, size: store.overlaySize });
			}
			window.__DPO_PROBE_RUNNING__ = false;
			const res = await post("/report", report);
			store.lastReport = { ok: Boolean(res && res.ok), file: res && res.file, userMessageCount: res && res.userMessageCount };
			emit();
			return report;
		}

		/* ══════════ 插件体 ══════════ */
		exports.inject = ["slots", "locale"];

		exports.apply = function apply(ctx) {
			// HMR/重复 apply：新实例接管前先拆掉旧实例全部副作用（防双轮询 → 双探针 → 队列残留）
			const previousToken = (() => { try { return window.__DPO_ACTIVE__ || null; } catch (e) { return null; } })();
			try { if (typeof window.__DPO_DISPOSE__ === "function") window.__DPO_DISPOSE__(); } catch (e) { /* noop */ }
			// 抢注单例 token：此后旧实例的拦截与渲染一律作废（旧实例"后台跑、无 UI"的根因）
			try { window.__DPO_ACTIVE__ = INSTANCE_TOKEN; } catch (e) { /* noop */ }
			const ownDisposers = [];
			const own = (register, label) => {
				const dispose = ctx.effect(register, label);
				ownDisposers.push(typeof dispose === "function" ? dispose : () => {});
			};
			window.__DPO_DISPOSE__ = () => {
				for (const d of ownDisposers) { try { d(); } catch (e) { /* noop */ } }
				ownDisposers.length = 0;
				window.__DPO_PROBE_RUNNING__ = false;
			};
			localeService = ctx.locale;
			if (localeService && typeof localeService.subscribe === "function") {
				own(() => localeService.subscribe(() => { loadSendLabels(); beacon("labels", { labels: [...SEND_LABELS] }); }), NS + ": locale watch");
			}
			const labels = loadSendLabels();
			ctx.logger?.info?.("[" + NS + "] send labels = " + JSON.stringify(labels));
			fetch(API + "/state", { cache: "no-store" }).then((r) => r.json()).then((d) => {
				const st = d && d.ok ? d.state : null;
				if (!st) return;
				// 几何（尺寸/位置）无论用户是否刚改过档位都恢复——它不影响拦截语义
				if (st.ui) {
					const w = typeof st.ui.w === "number" ? st.ui.w : null;
					const h = typeof st.ui.h === "number" ? st.ui.h : null;
					if (w || h) store.overlaySize = clampSize(w || 520, h || null);
					if (typeof st.ui.x === "number" && typeof st.ui.y === "number") store.overlayPos = { x: st.ui.x, y: st.ui.y };
					beacon("ui-restored", { size: store.overlaySize || null, pos: store.overlayPos || null });
				}
				// 按会话的档位/权限：先装入表（无论用户是否刚改过，都要装上）
				if (st.perSession && typeof st.perSession === "object") {
					for (const k of Object.keys(st.perSession)) {
						const v = st.perSession[k] || {};
						if (typeof v.tier === "string") store.tierBySession[k] = v.tier;
						if (typeof v.permission === "string") store.permissionBySession[k] = v.permission;
					}
					beacon("per-session-restored", { sessions: Object.keys(st.perSession).length, current: store.viewSessionId || null });
				}
				// 若用户在请求返回前已手动改过档位/权限，绝不让迟到的落盘值回写覆盖
				if (store.touched === true) { beacon("state-skip-stale", { tier: store.tier, permission: store.permission }); emit(); return; }
				if (st.tier && st.tier !== store.tier) setTier(st.tier, "init");
				if (st.permission && st.permission !== store.permission) setPermission(st.permission, "init");
				// 表里有当前会话的值 → 以它为准（覆盖全局默认）
				applyTierPermissionFor(store.viewSessionId);
				if (typeof st.turns === "number") store.turns = st.turns;
				if (st.historyMode === "turns" || st.historyMode === "full") store.historyMode = st.historyMode;
				store.fullOn = st.fullOn === true;
				store.modelSel = st.model ? { provider: st.model.provider, model: st.model.model, name: st.model.name || st.model.model } : null;
				beacon("state-loaded", { tier: store.tier, permission: store.permission, model: st.model ? st.model.provider + "/" + st.model.model : null, revision: st.revision, perSessionHit: Boolean(st.perSession && st.perSession[store.viewSessionId || ""]) });
				emit();
			}).catch(() => {});
			beacon("apply", { build: "v0.2.2-beta.1", token: INSTANCE_TOKEN, previousToken, hasBoundary: String(OverlayBoundary).indexOf("getDerivedStateFromError") >= 0, hasGrip: String(Overlay).indexOf("dpo-size-grip") >= 0 });
			// 启动即兜底自清场，并每 60s 复扫一次：任何 DPO- 标记若仍在待处理队列，立刻撤掉
			window.setTimeout(() => { try { if (isActiveInstance()) void post("/inbox/sweep", {}); } catch (e) { /* noop */ } }, 1200);
			own(() => {
				const t = window.setInterval(() => { try { void post("/inbox/sweep", {}); } catch (e) { /* noop */ } }, 60000);
				return () => window.clearInterval(t);
			}, NS + ": marker sweep");
			// 目录预热：开弹层时无需等待（首次打开即已是本地数据）
			window.setTimeout(() => { try { if (isActiveInstance()) void loadCatalog("apply", false); } catch (e) { /* noop */ } }, 600);
			// 样式落地自检：读真实注入的样式表，确认"更大默认尺寸 + 内层滚动 + 改尺寸手柄"确实生效
			window.setTimeout(() => {
				try {
					const rules = [];
					for (const sheet of Array.from(document.styleSheets)) {
						try { for (const r of Array.from(sheet.cssRules || [])) rules.push(r.cssText || ""); } catch (e) { /* 跨域表 */ }
					}
					const blob = rules.join("\n").replace(/\s+/g, ""); // 浏览器会规范化 cssText（冒号后补空格），去空白后比较
					const has = (needle) => blob.indexOf(needle) >= 0;
					beacon("css-probe", {
						rules: rules.length,
						bigger: has("max-height:min(78vh,660px)") && has("width:520px"),
						innerScroll: has(".dpo-overlay-scroll") && has("flex:11auto"),
						overflowY: has("overflow-y:auto"),
						grip: has(".dpo-size-grip") && has("cursor:nwse-resize"),
						stickyReview: has(".dpo-review.dpo-overlay-actions") && has("bottom:0"),
						regenStyles: has(".dpo-regen-input"),
						// v51 精致化视觉层
						polish: has("@keyframesdpo-pop-in") && has("@keyframesdpo-ov-rise") && has("@keyframesdpo-pulse") && has("@keyframesdpo-tick") && has("@keyframesdpo-shimmer"),
						glass: has("backdrop-filter:blur(16px)"),
						accMix: has("--dpo-acc:var(--dsw-alias-state-business-primary"),
						stateDot: has(".dpo-overlay[data-state=\"running\"]"),
						liveCaret: has(".dpo-pane[data-live=\"true\"]"),
						selHighlight: has(".dpo-pop-item[data-selected=\"true\"]"),
						reduceMotion: has("prefers-reduced-motion:reduce"),
						// v52 舒适层
						comfort: has("flex:01148px") && has("min-width:124px") && has("--dpo-fs-2:13px") && has("width:308px") && has("max-height:132px") && has("min-height:150px"),
					});
				} catch (e) { beacon("css-probe", { error: String(e) }); }
			}, 400);

			// 捕获阶段拦截：注册在 window 上，早于 React 根容器与编辑器自身处理器
			own(() => {
				let staleBeacons = 0;
				const stale = (how) => {
					if (staleBeacons < 3) { staleBeacons += 1; beacon("stale-instance-ignored", { how, token: INSTANCE_TOKEN, active: String(window.__DPO_ACTIVE__ || "").slice(-12) }); }
					return true;
				};
				const onFocus = (e) => {
					const card = cardOf(store.node);
					lastFocusInComposer = Boolean(card && e.target && card.contains(e.target));
				};
				const onKey = (e) => {
					if (!isActiveInstance()) return stale("keydown");
					if (e.key !== "Enter") {
						const now = Date.now();
						if (now - lastKeyBeacon > 800) {
							lastKeyBeacon = now;
							beacon("keydown-any", {
								key: e.key, trusted: e.isTrusted === true,
								draftHookLen: draftFromHook().length,
								draftDomLen: draftFromDom() === null ? null : draftFromDom().length,
								inside: insideComposer(),
							});
						}
						return;
					}
					const verdict = interceptKey(e);
					beacon("keydown-enter", {
						verdict,
						trusted: e.isTrusted === true,
						isComposing: e.isComposing === true,
						keyCode: e.keyCode,
						shift: e.shiftKey,
						armed: store.armed,
						card: Boolean(cardOf(store.node)),
						inside: insideComposer(),
						lastFocusInComposer,
						activeTag: document.activeElement ? document.activeElement.tagName : null,
						activeCE: document.activeElement ? document.activeElement.isContentEditable === true : null,
						draftLen: draftLive().length,
						draftHookLen: draftFromHook().length,
						draftDomLen: draftFromDom() === null ? null : draftFromDom().length,
					});
					if (!verdict) return;
					e.preventDefault();
					e.stopPropagation();
					// 功能载荷必须是草稿原文：record() 是遥测行，会把 text 截断到 160 字（PR#4 报告的真实缺陷）
					const full = draftLive();
					record("keydown-enter", full);
					interceptAndOptimize(full);
				};
				const onClick = (e) => {
					if (!isActiveInstance()) return stale("click");
					const btn = e.target && e.target.closest ? e.target.closest("button") : null;
					if (!btn) return;
					const card = cardOf(store.node);
					if (!card || !card.contains(btn)) return;
					const verdict = interceptClick(e);
					const label = btn.getAttribute("aria-label");
					beacon("click-button", {
						verdict, label, isLast: lastButtonOf(card) === btn,
						byLabel: isSendLabel(label), labels: [...SEND_LABELS], armed: store.armed,
					});
					if (!verdict) return;
					e.preventDefault();
					e.stopPropagation();
					const full = draftLive(); // 同上：遥测截断不得进入功能链路
					record("click-send", full, { label });
					interceptAndOptimize(full);
				};
				document.addEventListener("focusin", onFocus, true);
				document.addEventListener("focusout", onFocus, true);
				window.addEventListener("keydown", onKey, true);
				window.addEventListener("click", onClick, true);
				return () => {
					document.removeEventListener("focusin", onFocus, true);
					document.removeEventListener("focusout", onFocus, true);
					window.removeEventListener("keydown", onKey, true);
					window.removeEventListener("click", onClick, true);
				};
			}, NS + ": capture listeners");

			// 样式（随插件卸载移除）
			own(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", NS);
				style.textContent = [
					
					
					
					
					
					
					
					".dpo-controls{display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}",
					".dpo-slider{display:inline-flex;align-items:center;gap:6px;height:24px;flex:0 1 auto;min-width:0}",
					".dpo-slider[data-disabled=\"true\"]{opacity:.45}",
					".dpo-slider-track{position:relative;display:flex;flex:0 1 68px;min-width:36px;height:16px;touch-action:none;cursor:pointer;align-items:center}",
					".dpo-slider-track::before{content:\"\";position:absolute;left:0;right:0;top:6px;height:4px;background:var(--dsw-alias-border-l1,#4a4a4a);border-radius:2px}",
					".dpo-slider-fill{position:absolute;left:0;top:6px;height:4px;background:var(--dsw-alias-state-business-primary,#4a9eff);border-radius:2px;pointer-events:none;transition:width .18s cubic-bezier(.4,0,.2,1)}",
					".dpo-slider-thumb{position:absolute;top:2px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4a9eff);box-shadow:0 0 0 2px var(--dsw-specific-tip,#1b1b1b),0 1px 4px rgba(0,0,0,.45);pointer-events:none;transition:left .18s cubic-bezier(.4,0,.2,1),transform .12s ease}",
					".dpo-stop{flex:1;min-width:0;height:100%;background:transparent;border:none;padding:0;cursor:pointer}",
					".dpo-stop:disabled{cursor:not-allowed}",
					".dpo-slider-value{flex:0 0 auto;font-size:11px;font-weight:500;color:var(--dsw-alias-label-primary,#eee);white-space:nowrap}",					".dpo-model{display:inline-flex;align-items:center;gap:5px;height:24px;flex:0 1 auto;min-width:46px;max-width:130px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1,#444);border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:11px;cursor:pointer;white-space:nowrap}",
					".dpo-model:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff)}",
					".dpo-model-k{color:var(--dsw-alias-label-caption,#777);flex:0 0 auto}",
					".dpo-model-v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
					".dpo-pop{position:fixed;z-index:90;width:258px;overflow:auto;background:var(--dsw-specific-tip,#1b1b1b);border:1px solid var(--dsw-alias-border-l1,#444);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);font-size:12px;padding:6px}",
					".dpo-pop-sliders{display:flex;gap:12px;padding:2px 6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#333);margin-bottom:6px}",
					".dpo-pop-head{padding:4px 6px 6px;color:var(--dsw-alias-label-tertiary,#999);font-size:11px}",
					".dpo-pop-group{margin-bottom:4px}",
					".dpo-pop-gtitle{padding:3px 6px;color:var(--dsw-alias-label-caption,#777);font-size:11px}",
					".dpo-pop-item{display:block;width:100%;text-align:left;border:none;background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer}",
					".dpo-pop-item:hover{background:rgba(74,158,255,.16)}",
					".dpo-pop-empty{padding:6px;color:var(--dsw-alias-label-caption,#777)}",
					".dpo-pop-foot{display:flex;gap:6px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1,#333)}",
										"@media (max-width:1480px){.dpo-slider-track{flex-basis:104px;min-width:88px}.dpo-model{max-width:132px}.dpo-controls{gap:10px}}",
					"@media (max-width:1240px){.dpo-slider-track{flex-basis:88px;min-width:76px}.dpo-model{max-width:112px}.dpo-slider-value{font-size:12px}.dpo-controls{gap:9px}}",
					"@media (max-width:1080px){.dpo-model .dpo-model-k{display:none}}",					".dpo-notice{flex:0 0 auto;font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(74,158,255,.15);color:var(--dsw-alias-state-business-primary,#4a9eff);white-space:nowrap}",
					".dpo-count{flex:0 0 auto;font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(74,158,255,.15);color:#4a9eff}",
					".dpo-overlay{position:fixed;left:0;top:0;width:460px;max-height:min(78vh,660px);min-width:360px;min-height:240px;display:flex;flex-direction:column;pointer-events:auto;will-change:transform;touch-action:none;background:var(--dsw-specific-tip,#1b1b1b);border:1px solid var(--dsw-alias-border-l1,#444);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);font-size:12px;overflow:hidden}",
					".dpo-overlay-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column}",
					".dpo-overlay.dpo-sizing{user-select:none}",
					".dpo-size-grip{position:absolute;right:2px;bottom:2px;width:14px;height:14px;cursor:nwse-resize;border-right:2px solid var(--dsw-alias-label-tertiary,#888);border-bottom:2px solid var(--dsw-alias-label-tertiary,#888);border-bottom-right-radius:4px;opacity:.75}",
					".dpo-size-grip:hover{opacity:1;border-color:var(--dsw-alias-state-business-primary,#4a9eff)}",
					".dpo-head-hint{color:var(--dsw-alias-label-caption,#777);font-size:10px;white-space:nowrap;cursor:grab}",
					".dpo-overlay-head{cursor:grab;user-select:none}",
					".dpo-dragging .dpo-overlay-head{cursor:grabbing}",
					".dpo-overlay-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#333);color:var(--dsw-alias-label-primary,#eee);position:sticky;top:0;z-index:2;background:var(--dsw-specific-tip,#1b1b1b);border-radius:12px 12px 0 0}",
					".dpo-x{border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1}",
					".dpo-overlay-src{padding:4px 10px;color:var(--dsw-alias-label-tertiary,#888);font-size:11px}",
					".dpo-overlay-body{padding:8px 10px;overflow:auto;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,#ccc)}",
					".dpo-run{display:flex;flex-direction:column;gap:6px;padding:8px 10px}",
					".dpo-run-status{color:var(--dsw-alias-label-tertiary,#999);font-size:11px}",
					".dpo-pane{border:1px solid var(--dsw-alias-border-l1,#333);border-radius:8px;padding:6px 8px;max-height:84px;overflow:auto}",
					".dpo-pane-title{color:var(--dsw-alias-label-tertiary,#888);font-size:11px;margin-bottom:4px}",
					".dpo-pane-body{white-space:pre-wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#ccc)}",
					".dpo-review{display:flex;flex-direction:column;gap:6px;padding:8px 10px}",
					".dpo-review-text{width:100%;box-sizing:border-box;min-height:110px;max-height:220px;overflow-y:auto;resize:vertical;white-space:pre-wrap;background:var(--dsw-alias-bg-l1,#141414);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l1,#444);border-radius:8px;padding:6px 8px;font-size:12px;line-height:1.5;font-family:inherit}",
					".dpo-btn.danger{flex:1;height:26px;border-radius:8px;border:1px solid #d9534f;background:#d9534f;color:#fff;font-size:11px;cursor:pointer}",
					".dpo-btn.primary{flex:1;height:26px;border-radius:8px;border:1px solid var(--dsw-alias-state-business-primary,#4a9eff);background:var(--dsw-alias-state-business-primary,#4a9eff);color:#fff;font-size:11px;cursor:pointer}",
					".dpo-run-error{display:flex;align-items:center;gap:8px;color:#f2777a;font-size:11px;word-break:break-all}",
					".dpo-trace{border-top:1px solid var(--dsw-alias-border-l1,#333);max-height:92px;overflow:auto}",
					".dpo-trace-head{padding:4px 10px;color:var(--dsw-alias-label-tertiary,#888);font-size:11px}",
					".dpo-trace-row{display:flex;gap:6px;padding:2px 10px;font-size:11px;color:var(--dsw-alias-label-secondary,#bbb)}",
					".dpo-trace-tool{flex:0 0 auto;color:var(--dsw-alias-state-business-primary,#4a9eff)}",
					".dpo-trace-args{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
					".dpo-trace-meta{flex:0 0 auto;color:var(--dsw-alias-label-caption,#777)}",
					".dpo-trace-empty{padding:6px 10px;color:var(--dsw-alias-label-caption,#777);font-size:11px}",
					".dpo-overlay-actions{display:flex;gap:8px;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1,#333)}",
					".dpo-review .dpo-overlay-actions{position:sticky;bottom:0;z-index:2;background:var(--dsw-specific-tip,#1b1b1b)}",
					".dpo-regen-ask{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1,#444);border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-l1,#141414)}",
					".dpo-regen-input{width:100%;box-sizing:border-box;height:26px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#444);background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:12px;padding:0 8px;font-family:inherit}",
					".dpo-btn{flex:1;height:26px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#444);background:transparent;color:var(--dsw-alias-label-secondary,#ccc);font-size:11px;cursor:pointer}",
					".dpo-btn.primary{border-color:var(--dsw-alias-state-business-primary,#4a9eff);background:var(--dsw-alias-state-business-primary,#4a9eff);color:#fff}",

					/* ══════════ v51 精致化视觉层（追加覆写：只改观感与动效，不动几何/拦截逻辑） ══════════ */
					".dpo-controls,.dpo-pop,.dpo-overlay{",
					"  --dpo-acc:var(--dsw-alias-state-business-primary,#4a9eff);",
					"  --dpo-acc-2:color-mix(in srgb,var(--dpo-acc) 62%,#ffffff);",
					"  --dpo-acc-12:color-mix(in srgb,var(--dpo-acc) 12%,transparent);",
					"  --dpo-acc-22:color-mix(in srgb,var(--dpo-acc) 22%,transparent);",
					"  --dpo-acc-40:color-mix(in srgb,var(--dpo-acc) 40%,transparent);",
					"  --dpo-surface:var(--dsw-specific-tip,#1b1b1b);",
					"  --dpo-line:var(--dsw-alias-border-l1,#3a3a3a);",
					"  --dpo-hi:rgba(255,255,255,.07);",
					"  --dpo-ease:cubic-bezier(.22,1,.36,1);",
					"  --dpo-spring:cubic-bezier(.34,1.56,.64,1);",
					"  --dpo-shadow-1:0 1px 2px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.24);",
					"  --dpo-shadow-2:0 2px 6px rgba(0,0,0,.30),0 18px 48px rgba(0,0,0,.42);",
					"}",
					"@keyframes dpo-pop-in{from{opacity:0;transform:translateY(10px) scale(.965)}to{opacity:1;transform:none}}",
					"@keyframes dpo-ov-in{from{opacity:0}to{opacity:1}}",
					"@keyframes dpo-ov-rise{from{opacity:0;transform:translateY(6px) scale(.988)}to{opacity:1;transform:none}}",
					"@keyframes dpo-caret{0%,45%{opacity:1}50%,100%{opacity:0}}",
					"@keyframes dpo-pulse{0%{box-shadow:0 0 0 0 var(--dpo-acc-40)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}",
					"@keyframes dpo-shimmer{from{background-position:-160% 0}to{background-position:260% 0}}",
					"@keyframes dpo-notice-in{from{opacity:0;transform:translateY(-4px) scale(.96)}to{opacity:1;transform:none}}",
					"@keyframes dpo-tick{0%{transform:scale(1)}45%{transform:scale(1.22)}100%{transform:scale(1)}}",
					/* 滚动条精致化 */
					".dpo-overlay-scroll::-webkit-scrollbar,.dpo-pane::-webkit-scrollbar,.dpo-pop::-webkit-scrollbar,.dpo-overlay-body::-webkit-scrollbar,.dpo-trace::-webkit-scrollbar,.dpo-review-text::-webkit-scrollbar{width:8px;height:8px}",
					".dpo-overlay-scroll::-webkit-scrollbar-thumb,.dpo-pane::-webkit-scrollbar-thumb,.dpo-pop::-webkit-scrollbar-thumb,.dpo-overlay-body::-webkit-scrollbar-thumb,.dpo-trace::-webkit-scrollbar-thumb,.dpo-review-text::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-caption,#777) 45%,transparent);border-radius:8px;border:2px solid transparent;background-clip:padding-box}",
					".dpo-overlay-scroll::-webkit-scrollbar-thumb:hover,.dpo-pane::-webkit-scrollbar-thumb:hover,.dpo-pop::-webkit-scrollbar-thumb:hover{background:var(--dpo-acc-40);background-clip:padding-box}",
					".dpo-overlay-scroll::-webkit-scrollbar-track,.dpo-pane::-webkit-scrollbar-track,.dpo-pop::-webkit-scrollbar-track{background:transparent}",
					/* 控件行：滑块 */
					".dpo-controls{gap:10px}",
					".dpo-slider{height:26px;gap:8px}",
					".dpo-slider-track{height:18px}",
					".dpo-slider-track::before{top:7px;height:4px;border-radius:999px;background:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,.10));box-shadow:inset 0 1px 2px rgba(0,0,0,.45),0 1px 0 var(--dpo-hi)}",
					".dpo-slider-fill{top:7px;height:4px;border-radius:999px;background:linear-gradient(90deg,var(--dpo-acc),var(--dpo-acc-2));box-shadow:0 0 10px var(--dpo-acc-40);transition:width .26s var(--dpo-ease)}",
					".dpo-slider-thumb{top:2px;width:14px;height:14px;margin-left:-7px;background:radial-gradient(circle at 35% 30%,#fff,var(--dpo-acc-2) 45%,var(--dpo-acc));box-shadow:0 0 0 2px var(--dpo-surface),0 0 0 3px var(--dpo-acc-22),0 2px 6px rgba(0,0,0,.45);transition:left .26s var(--dpo-ease),transform .18s var(--dpo-spring),box-shadow .2s ease}",
					".dpo-slider:hover .dpo-slider-thumb{transform:scale(1.1);box-shadow:0 0 0 2px var(--dpo-surface),0 0 0 4px var(--dpo-acc-22),0 3px 10px rgba(0,0,0,.5)}",
					".dpo-slider:active .dpo-slider-thumb{transform:scale(.94)}",
					".dpo-slider[data-disabled=\"true\"] .dpo-slider-thumb{animation:none}",
					".dpo-stop{position:relative}",
					".dpo-stop::after{content:\"\";position:absolute;left:50%;top:5px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:var(--dsw-alias-label-caption,#777);opacity:.5;transition:transform .22s var(--dpo-spring),background .2s,opacity .2s}",
					".dpo-stop[data-on=\"true\"]::after{background:var(--dpo-acc);opacity:1;transform:scale(1.5)}",
					".dpo-slider:hover .dpo-stop::after{opacity:.85}",
					".dpo-slider-value{font-weight:600;letter-spacing:.2px;padding:1px 7px;border-radius:999px;background:var(--dpo-acc-12);border:1px solid transparent;transition:background .2s,color .2s,transform .18s var(--dpo-spring)}",
					".dpo-slider[data-disabled=\"true\"] .dpo-slider-value{background:transparent;color:var(--dsw-alias-label-caption,#777)}",
					".dpo-slider-value{animation:dpo-tick .32s var(--dpo-spring)}",
					/* 控件行：模型胶囊 */
					".dpo-model{height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dpo-line);background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 5%,transparent),transparent);box-shadow:var(--dpo-shadow-1);transition:transform .16s var(--dpo-spring),border-color .2s,color .2s,box-shadow .22s}",
					".dpo-model:hover{transform:translateY(-1px);border-color:var(--dpo-acc);color:var(--dpo-acc);box-shadow:0 2px 10px var(--dpo-acc-22),var(--dpo-shadow-1)}",
					".dpo-model:active{transform:translateY(0) scale(.98)}",
					".dpo-model[data-open=\"true\"]{border-color:var(--dpo-acc);color:var(--dpo-acc);box-shadow:0 0 0 3px var(--dpo-acc-12),var(--dpo-shadow-1)}",
					".dpo-model-k{font-size:10px;opacity:.85}",
					".dpo-model-caret{flex:0 0 auto;font-size:9px;opacity:.6;transition:transform .22s var(--dpo-spring)}",
					".dpo-model[data-open=\"true\"] .dpo-model-caret{transform:rotate(180deg);opacity:1}",
					".dpo-model::before{content:none}",
					".dpo-model[data-default=\"true\"]{color:var(--dsw-alias-label-tertiary,#999)}",
					/* 计数与提示 */
					".dpo-count{background:var(--dpo-acc-12);border:1px solid var(--dpo-acc-22);font-weight:600;letter-spacing:.2px}",
					".dpo-notice{animation:dpo-notice-in .26s var(--dpo-spring);background:var(--dpo-acc-12);border:1px solid var(--dpo-acc-22);box-shadow:0 2px 12px var(--dpo-acc-12);font-weight:500}",
					/* 模型弹层 */
					".dpo-pop{width:272px;padding:8px;border-radius:14px;border:1px solid color-mix(in srgb,var(--dpo-line) 80%,transparent);box-shadow:var(--dpo-shadow-2);animation:dpo-pop-in .24s var(--dpo-spring);transform-origin:bottom left;scrollbar-gutter:stable}",
					"@supports (backdrop-filter:blur(1px)){.dpo-pop{background:color-mix(in srgb,var(--dpo-surface) 86%,transparent);backdrop-filter:blur(18px) saturate(1.3)}}",
					".dpo-pop-head{padding:2px 8px 8px;font-size:11px;letter-spacing:.3px;text-transform:none;color:var(--dsw-alias-label-tertiary,#999)}",
					".dpo-pop-sliders{border-bottom:1px solid color-mix(in srgb,var(--dpo-line) 70%,transparent);padding-bottom:10px;margin-bottom:8px}",
					".dpo-pop-group{margin-bottom:2px}",
					".dpo-pop-gtitle{display:flex;align-items:center;gap:6px;padding:6px 8px 3px;font-size:10.5px;letter-spacing:.4px;color:var(--dsw-alias-label-caption,#8a8a8a)}",
					".dpo-pop-gtitle::after{content:\"\";flex:1 1 auto;height:1px;background:linear-gradient(90deg,color-mix(in srgb,var(--dpo-line) 80%,transparent),transparent)}",
					".dpo-pop-item{position:relative;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:9px;font-size:12px;transition:background .16s ease,color .16s ease,padding-left .2s var(--dpo-ease),box-shadow .18s ease;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
					".dpo-pop-item:hover{background:var(--dpo-acc-12);color:var(--dpo-acc);padding-left:13px;box-shadow:inset 2px 0 0 var(--dpo-acc)}",
					".dpo-pop-item[data-selected=\"true\"]{background:var(--dpo-acc-12);color:var(--dpo-acc);font-weight:600}",
					".dpo-pop-item[data-selected=\"true\"]::after{content:\"✓\";margin-left:auto;font-size:11px;opacity:.9}",
					".dpo-pop-item[data-session=\"true\"]::before{content:\"\";flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:var(--dpo-acc);box-shadow:0 0 6px var(--dpo-acc-40)}",
					".dpo-pop-chip{margin-left:auto;font-size:9.5px;padding:1px 6px;border-radius:999px;background:var(--dpo-acc-12);color:var(--dpo-acc);letter-spacing:.2px}",
					".dpo-pop-empty{padding:10px 8px;font-size:11px;color:var(--dsw-alias-label-caption,#888)}",
					".dpo-pop-foot{gap:6px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--dpo-line) 70%,transparent)}",
					/* 浮层 */
					".dpo-overlay{border-radius:16px;border:1px solid color-mix(in srgb,var(--dpo-line) 85%,transparent);box-shadow:var(--dpo-shadow-2),inset 0 1px 0 var(--dpo-hi);animation:dpo-ov-in .2s var(--dpo-ease)}",
					"@supports (backdrop-filter:blur(1px)){.dpo-overlay{background:color-mix(in srgb,var(--dpo-surface) 88%,transparent);backdrop-filter:blur(16px) saturate(1.2)}}",
					".dpo-overlay-scroll{animation:dpo-ov-rise .3s var(--dpo-spring)}",
					".dpo-overlay-head{padding:9px 12px;border-bottom:1px solid color-mix(in srgb,var(--dpo-line) 70%,transparent);background:linear-gradient(180deg,var(--dpo-hi),transparent)}",
					".dpo-overlay-head::before{content:\"\";flex:0 0 auto;width:7px;height:7px;margin-right:8px;border-radius:50%;background:var(--dsw-alias-label-caption,#777);transition:background .2s}",
					".dpo-overlay[data-state=\"running\"] .dpo-overlay-head::before{background:var(--dpo-acc);animation:dpo-pulse 1.6s ease-out infinite}",
					".dpo-overlay[data-state=\"done\"] .dpo-overlay-head::before{background:#3ecf8e;box-shadow:0 0 8px rgba(62,207,142,.5)}",
					".dpo-overlay[data-state=\"error\"] .dpo-overlay-head::before{background:#f2777a;box-shadow:0 0 8px rgba(242,119,122,.5)}",
					".dpo-x{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 9px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:11px;cursor:pointer;transition:background .18s,color .18s,border-color .18s,transform .16s var(--dpo-spring)}",
					".dpo-x:hover{background:rgba(242,119,122,.14);color:#f2777a;border-color:rgba(242,119,122,.35);transform:translateX(-1px)}",
					".dpo-x:active{transform:translateX(-1px) scale(.97)}",
					".dpo-head-hint{font-size:10px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-caption,#777) 14%,transparent)}",
					".dpo-overlay-src{padding:5px 12px;font-size:10.5px;letter-spacing:.2px}",
					".dpo-run{padding:10px 12px;gap:8px}",
					".dpo-run-status{display:flex;align-items:center;gap:8px;font-size:10.5px;letter-spacing:.2px}",
					".dpo-overlay[data-state=\"running\"] .dpo-run-status::after{content:\"\";flex:1 1 auto;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,var(--dpo-acc),transparent);background-size:160% 100%;animation:dpo-shimmer 1.4s linear infinite;opacity:.7}",
					".dpo-pane{border-radius:12px;padding:8px 10px;border-color:color-mix(in srgb,var(--dpo-line) 80%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 3%,transparent),transparent);box-shadow:inset 0 1px 0 var(--dpo-hi);transition:border-color .2s,box-shadow .2s}",
					".dpo-pane:hover{border-color:var(--dpo-acc-22);box-shadow:inset 0 1px 0 var(--dpo-hi),0 2px 12px rgba(0,0,0,.18)}",
					".dpo-pane-title{display:flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.4px;text-transform:none}",
					".dpo-pane-title::before{content:\"\";width:5px;height:5px;border-radius:50%;background:var(--dpo-acc);opacity:.75}",
					".dpo-pane[data-kind=\"text\"] .dpo-pane-title::before{background:#c08cff}",
					".dpo-pane[data-live=\"true\"] .dpo-pane-title::before{animation:dpo-pulse 1.5s ease-out infinite}",
					".dpo-pane[data-live=\"true\"] .dpo-pane-body::after{content:\"▍\";margin-left:1px;color:var(--dpo-acc);animation:dpo-caret 1.05s steps(1,end) infinite}",
					".dpo-pane-body{font-size:11.5px;line-height:1.55}",
					".dpo-review{gap:8px;padding:10px 12px}",
					".dpo-review-text{border-radius:12px;padding:9px 11px;line-height:1.6;background:color-mix(in srgb,var(--dsw-alias-bg-l1,#141414) 92%,transparent);box-shadow:inset 0 1px 2px rgba(0,0,0,.35);transition:border-color .2s,box-shadow .2s}",
					".dpo-review-text:focus{outline:none;border-color:var(--dpo-acc);box-shadow:inset 0 1px 2px rgba(0,0,0,.35),0 0 0 3px var(--dpo-acc-12)}",
					".dpo-regen-ask{border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-l1,#141414) 70%,transparent);box-shadow:inset 0 1px 0 var(--dpo-hi);animation:dpo-notice-in .24s var(--dpo-spring)}",
					".dpo-regen-input{border-radius:10px;height:28px;transition:border-color .2s,box-shadow .2s}",
					".dpo-regen-input:focus{outline:none;border-color:var(--dpo-acc);box-shadow:0 0 0 3px var(--dpo-acc-12)}",
					".dpo-overlay-actions{padding:10px 12px;gap:8px;background:linear-gradient(0deg,var(--dpo-hi),transparent)}",
					".dpo-btn{height:28px;border-radius:10px;font-weight:500;letter-spacing:.2px;transition:transform .16s var(--dpo-spring),box-shadow .22s,background .2s,border-color .2s,color .2s}",
					".dpo-btn:hover{border-color:var(--dpo-acc);color:var(--dpo-acc);box-shadow:0 2px 10px var(--dpo-acc-12)}",
					".dpo-btn:active{transform:scale(.975)}",
					".dpo-btn.primary{border-color:transparent;background:linear-gradient(180deg,var(--dpo-acc-2),var(--dpo-acc));box-shadow:0 2px 10px var(--dpo-acc-22),inset 0 1px 0 rgba(255,255,255,.22)}",
					".dpo-btn.primary:hover{color:#fff;box-shadow:0 4px 16px var(--dpo-acc-40),inset 0 1px 0 rgba(255,255,255,.28)}",
					".dpo-btn.danger{border-color:transparent;background:linear-gradient(180deg,#e2685f,#cf4a41);box-shadow:0 2px 10px rgba(207,74,65,.28),inset 0 1px 0 rgba(255,255,255,.18)}",
					".dpo-btn.danger:hover{color:#fff;box-shadow:0 4px 16px rgba(207,74,65,.42)}",
					".dpo-run-error{border-radius:10px;padding:7px 9px;background:rgba(242,119,122,.10);border:1px solid rgba(242,119,122,.28)}",
					".dpo-trace{border-top:1px solid color-mix(in srgb,var(--dpo-line) 60%,transparent)}",
					".dpo-trace-row{padding:3px 12px;border-radius:8px;transition:background .16s}",
					".dpo-trace-row:hover{background:var(--dpo-acc-12)}",
					".dpo-trace-tool{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px}",
					".dpo-size-grip{width:16px;height:16px;right:3px;bottom:3px;border:none;border-radius:5px;opacity:.7;background:linear-gradient(135deg,transparent 42%,var(--dsw-alias-label-caption,#888) 42%,var(--dsw-alias-label-caption,#888) 52%,transparent 52%,transparent 62%,var(--dsw-alias-label-caption,#888) 62%,var(--dsw-alias-label-caption,#888) 72%,transparent 72%);transition:opacity .18s,transform .18s var(--dpo-spring),background .2s}",
					".dpo-size-grip:hover{opacity:1;transform:scale(1.12);background:linear-gradient(135deg,transparent 42%,var(--dpo-acc) 42%,var(--dpo-acc) 52%,transparent 52%,transparent 62%,var(--dpo-acc) 62%,var(--dpo-acc) 72%,transparent 72%)}",
					/* 降级面板也要好看 */
					".dpo-overlay[data-dpo-degraded=\"1\"] .dpo-overlay-head::before{background:#e0a33e;box-shadow:0 0 8px rgba(224,163,62,.5)}",
					/* 无障碍：尊重系统"减少动态效果" */
					"@media (prefers-reduced-motion:reduce){.dpo-controls *,.dpo-pop *,.dpo-overlay *{animation:none!important;transition:none!important}}",

					/* ══════════ v52 舒适层：更长的滑块 / 更疏朗的留白 / 更大的字号 ══════════ */
					".dpo-controls,.dpo-pop,.dpo-overlay{--dpo-fs-1:12px;--dpo-fs-2:13px;--dpo-fs-3:11.5px}",
					".dpo-controls{gap:10px}",
					".dpo-slider{gap:7px;height:30px}",
					".dpo-slider-track{flex:0 1 148px;min-width:124px;height:20px}",
					".dpo-slider-track::before{top:8px;height:5px}",
					".dpo-slider-fill{top:8px;height:5px}",
					".dpo-slider-thumb{top:3px;width:15px;height:15px;margin-left:-7.5px}",
					".dpo-stop::after{top:6px}",
					".dpo-slider-value{font-size:12.5px;padding:2px 4px}",
					".dpo-model{height:32px;box-sizing:border-box;padding:0 11px;font-size:12px;max-width:124px}",
					".dpo-model-k{font-size:11px}",
					".dpo-notice{font-size:12px;padding:3px 10px}",
					".dpo-count{font-size:11px;padding:2px 8px}",
					".dpo-overlay{width:520px;min-width:400px;font-size:var(--dpo-fs-2)}",
					".dpo-overlay-head{padding:12px 16px;gap:10px}",
					".dpo-x{height:26px;padding:0 11px;font-size:12px}",
					".dpo-head-hint{font-size:11px;padding:2px 9px}",
					".dpo-overlay-src{padding:7px 16px;font-size:11.5px;line-height:1.6}",
					".dpo-run{padding:14px 16px;gap:12px}",
					".dpo-run-status{font-size:11.5px}",
					".dpo-pane{padding:11px 13px;max-height:132px;border-radius:13px}",
					".dpo-pane-title{font-size:11.5px;margin-bottom:7px;letter-spacing:.5px}",
					".dpo-pane-body{font-size:var(--dpo-fs-2);line-height:1.68}",
					".dpo-overlay-body{padding:12px 16px;font-size:var(--dpo-fs-2);line-height:1.65}",
					".dpo-review{gap:11px;padding:14px 16px}",
					".dpo-review-text{font-size:var(--dpo-fs-2);line-height:1.72;min-height:150px;max-height:300px;padding:12px 14px;border-radius:13px}",
					".dpo-review .dpo-pane-title{font-size:12px;margin-bottom:2px}",
					".dpo-regen-ask{gap:9px;padding:11px 13px;border-radius:13px}",
					".dpo-regen-ask .dpo-pane-title{font-size:12px}",
					".dpo-regen-input{height:32px;font-size:var(--dpo-fs-2);border-radius:11px;padding:0 11px}",
					".dpo-overlay-actions{padding:13px 16px;gap:10px}",
					".dpo-btn{height:32px;font-size:var(--dpo-fs-1);border-radius:11px}",
					".dpo-run-error{font-size:11.5px;padding:9px 11px;line-height:1.6}",
					".dpo-trace{max-height:120px}",
					".dpo-trace-head{padding:7px 16px;font-size:11.5px}",
					".dpo-trace-row{padding:4px 16px;font-size:var(--dpo-fs-3);gap:8px}",
					".dpo-trace-tool{font-size:11.5px}",
					".dpo-trace-empty{padding:9px 16px;font-size:11.5px}",
					".dpo-size-grip{width:18px;height:18px;right:4px;bottom:4px;z-index:6}"   /* 必须高于 .dpo-overlay-foot(z-index:3)，否则被底栏盖住拖不动 */,
					".dpo-pop{width:308px;padding:11px;border-radius:15px}",
					".dpo-pop-head{padding:3px 10px 10px;font-size:12px}",
					".dpo-pop-gtitle{padding:8px 10px 5px;font-size:11.5px}",
					".dpo-pop-item{padding:8px 12px;font-size:var(--dpo-fs-2);border-radius:11px;gap:9px}",
					".dpo-pop-item:hover{padding-left:15px}",
					".dpo-pop-chip{font-size:10.5px;padding:2px 8px}",
					".dpo-pop-empty{padding:12px 10px;font-size:12px;line-height:1.6}",
					".dpo-pop-foot{padding-top:11px;gap:8px}",
					"@media (max-width:1480px){.dpo-controls{gap:10px}.dpo-slider-track{flex-basis:104px;min-width:88px}.dpo-model{max-width:132px}}",
					"@media (max-width:1240px){.dpo-controls{gap:9px}.dpo-slider-track{flex-basis:88px;min-width:76px}.dpo-model{max-width:112px}}",
					"@media (max-width:1080px){.dpo-controls{gap:8px}.dpo-slider-track{flex-basis:72px;min-width:60px}}",
					/* ══════════ v56 优雅层：内联标签 / 浮动通知 / 折叠区块 / 极简标题栏 ══════════ */
					".dpo-slider-name{flex:0 0 auto;font-size:11px;letter-spacing:.3px;color:var(--dsw-alias-label-caption,#8a8a8a);user-select:none}",
					".dpo-slider:hover .dpo-slider-name,.dpo-slider:focus-within .dpo-slider-name{color:var(--dsw-alias-label-secondary,#b9b9b9)}",
					".dpo-divider{flex:0 0 auto;width:1px;height:16px;margin:0 2px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--dpo-line) 90%,transparent),transparent)}",
					".dpo-help{border-color:transparent;background:transparent;box-shadow:none;color:var(--dsw-alias-label-caption,#8a8a8a)}",
					".dpo-help:hover{background:var(--dpo-acc-12);box-shadow:none}",
					".dpo-toast{position:fixed;z-index:95;left:50%;transform:translateX(-50%);bottom:118px;max-width:min(560px,80vw);padding:7px 14px;border-radius:999px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#eee);background:color-mix(in srgb,var(--dpo-surface) 92%,transparent);border:1px solid var(--dpo-acc-22);box-shadow:0 6px 24px rgba(0,0,0,.35),0 0 0 1px var(--dpo-acc-12);animation:dpo-toast-in .28s var(--dpo-spring);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
					"@supports (backdrop-filter:blur(1px)){.dpo-toast{backdrop-filter:blur(14px) saturate(1.2)}}",
					"@keyframes dpo-toast-in{from{opacity:0;transform:translateX(-50%) translateY(8px) scale(.97)}to{opacity:1;transform:translateX(-50%)}}",
					".dpo-head-title{font-size:12px;letter-spacing:.4px;color:var(--dsw-alias-label-secondary,#c9c9c9);margin-left:8px}",
					".dpo-head-tier{font-size:11px;font-weight:600;letter-spacing:.3px;padding:1px 8px;border-radius:999px;background:var(--dpo-acc-12);color:var(--dpo-acc);border:1px solid var(--dpo-acc-22);margin-left:8px}",
					".dpo-head-count{font-size:10px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-caption,#777) 14%,transparent);color:var(--dsw-alias-label-caption,#8a8a8a);margin-left:6px}",
					".dpo-head-hint{margin-left:auto;font-size:10px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-caption,#777) 12%,transparent);color:var(--dsw-alias-label-caption,#8a8a8a);opacity:0;transition:opacity .22s ease}",
					".dpo-overlay:hover .dpo-head-hint{opacity:1}",
					".dpo-overlay-head{gap:0}",
					".dpo-fold{border-top:1px solid color-mix(in srgb,var(--dpo-line) 55%,transparent)}",
					".dpo-fold:first-child{border-top:none}",
					".dpo-fold-head{display:flex;align-items:center;gap:8px;width:100%;padding:8px 16px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#999);font-size:11.5px;text-align:left;cursor:pointer;transition:color .18s,background .18s}",
					".dpo-fold-head:hover{color:var(--dsw-alias-label-primary,#eee);background:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 3%,transparent)}",
					".dpo-fold-caret{flex:0 0 auto;font-size:12px;transition:transform .24s var(--dpo-spring);color:var(--dsw-alias-label-caption,#777)}",
					".dpo-fold[data-open=\"true\"] .dpo-fold-caret{transform:rotate(90deg)}",
					".dpo-fold-title{flex:0 0 auto;letter-spacing:.4px}",
					".dpo-fold-sum{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption,#7d7d7d);font-size:11px}",
					".dpo-fold-head .dpo-tok-chip{margin-left:auto}",
					".dpo-fold-body{padding:0 12px 10px}",
					".dpo-fold .dpo-pane{margin:0 0 0 8px;max-height:min(132px,26vh)}",
					".dpo-fold-text{padding:9px 11px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-l1,#141414) 60%,transparent);color:var(--dsw-alias-label-secondary,#c9c9c9);font-size:12.5px;line-height:1.65;white-space:pre-wrap;max-height:min(180px,30vh);overflow:auto}",
					".dpo-run-status{padding:2px 0}",
					".dpo-run{gap:9px}",
					".dpo-confirm{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 14px 2px;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#c9c9c9);background:rgba(242,119,122,.10);border:1px solid rgba(242,119,122,.28);animation:dpo-notice-in .22s var(--dpo-spring)}",
					".dpo-confirm .dpo-btn{height:28px;flex:0 0 auto;padding:0 12px}",
					".dpo-btn.ghost{flex:0 0 auto;min-width:0;padding:0 12px;border-color:transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#999)}",
					".dpo-btn.ghost:hover{color:#f2777a;border-color:rgba(242,119,122,.35);background:rgba(242,119,122,.10);box-shadow:none}",
										".dpo-foot-inner .dpo-overlay-actions{padding:11px 16px}",
					/* ══════════ v57 语义色 + 刻度层（学自社区 PR：色=状态、点=档位、一套坐标） ══════════ */
					".dpo-slider{--dpo-tone:var(--dpo-acc)}",
					".dpo-slider[data-tone=\"tier\"][data-value=\"off\"]{--dpo-tone:#8b8f98}",
					".dpo-slider[data-tone=\"tier\"][data-value=\"basic\"]{--dpo-tone:#4a9eff}",
					".dpo-slider[data-tone=\"tier\"][data-value=\"advanced\"]{--dpo-tone:#a970ff}",
					".dpo-slider[data-tone=\"tier\"][data-value=\"extreme\"]{--dpo-tone:#ff8a3d}",
					".dpo-slider[data-tone=\"perm\"][data-value=\"review\"]{--dpo-tone:#3ecf8e}",
					".dpo-slider[data-tone=\"perm\"][data-value=\"auto\"]{--dpo-tone:#f2c14e}",
					".dpo-slider-fill{background:linear-gradient(90deg,color-mix(in srgb,var(--dpo-tone) 55%,transparent),var(--dpo-tone));box-shadow:0 0 10px color-mix(in srgb,var(--dpo-tone) 38%,transparent)}",
					".dpo-slider-thumb{background:radial-gradient(circle at 35% 30%,#fff,color-mix(in srgb,var(--dpo-tone) 75%,#fff) 45%,var(--dpo-tone));box-shadow:0 0 0 2px var(--dpo-surface),0 0 0 3px color-mix(in srgb,var(--dpo-tone) 26%,transparent),0 2px 6px rgba(0,0,0,.45)}",
					".dpo-slider:hover .dpo-slider-thumb{box-shadow:0 0 0 2px var(--dpo-surface),0 0 0 5px color-mix(in srgb,var(--dpo-tone) 22%,transparent),0 3px 10px rgba(0,0,0,.5)}",
					".dpo-slider-value{color:var(--dpo-tone);background:color-mix(in srgb,var(--dpo-tone) 14%,transparent);border-color:color-mix(in srgb,var(--dpo-tone) 26%,transparent)}",
					".dpo-slider[data-disabled=\"true\"]{--dpo-tone:var(--dsw-alias-label-caption,#777)}",
					/* 刻度点：绝对定位在 i/(n-1)，与拇指同源；视觉清晰但仍是可点命中区 */
					".dpo-tickdot{position:absolute;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;padding:0;border:none;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-caption,#8a8a8a) 72%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-bg-l1,#141414) 70%,transparent);cursor:pointer;transition:transform .22s var(--dpo-spring),background .2s,box-shadow .2s}",
					".dpo-tickdot:hover{transform:scale(1.25);background:color-mix(in srgb,var(--dpo-tone) 70%,transparent)}",
					".dpo-tickdot[data-on=\"true\"]{background:transparent;transform:scale(.7);box-shadow:none}",
					".dpo-tickdot:disabled{cursor:not-allowed}",
					".dpo-tickdot:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dpo-tone) 30%,transparent)}",
					".dpo-slider-track:focus-visible{outline:none}",
					".dpo-slider-track:focus-visible .dpo-slider-thumb{box-shadow:0 0 0 2px var(--dpo-surface),0 0 0 5px color-mix(in srgb,var(--dpo-tone) 34%,transparent),0 3px 10px rgba(0,0,0,.5)}",
					/* ══════════ v58 胶囊滑块：一个长圆框，里面小滑块滑动 ══════════ */
					".dpo-cap{position:relative;display:flex;align-items:center;flex:0 1 auto;min-width:118px;height:26px;padding:2px;border-radius:999px;border:1px solid var(--dpo-line);background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 4%,transparent),transparent),color-mix(in srgb,var(--dsw-alias-bg-l1,#141414) 55%,transparent);box-shadow:inset 0 1px 2px rgba(0,0,0,.28);cursor:pointer;overflow:hidden;transition:border-color .2s,box-shadow .22s,opacity .2s;--dpo-tone:var(--dpo-acc)}",
					".dpo-cap[data-tone=\"tier\"][data-value=\"off\"]{--dpo-tone:#8b8f98}",
					".dpo-cap[data-tone=\"tier\"][data-value=\"basic\"]{--dpo-tone:#4a9eff}",
					".dpo-cap[data-tone=\"tier\"][data-value=\"advanced\"]{--dpo-tone:#a970ff}",
					".dpo-cap[data-tone=\"tier\"][data-value=\"extreme\"]{--dpo-tone:#ff8a3d}",
					".dpo-cap[data-tone=\"perm\"][data-value=\"review\"]{--dpo-tone:#3ecf8e}",
					".dpo-cap[data-tone=\"perm\"][data-value=\"auto\"]{--dpo-tone:#f2c14e}",
					/* 上下文用量程滑块：沿用体系主色（不自创色值） */
					".dpo-cap[data-tone=\"ctx\"]{--dpo-tone:var(--dpo-acc)}",
					".dpo-cap:hover{border-color:color-mix(in srgb,var(--dpo-tone) 55%,transparent);box-shadow:inset 0 1px 2px rgba(0,0,0,.28),0 0 0 3px color-mix(in srgb,var(--dpo-tone) 12%,transparent)}",
					".dpo-cap:focus-visible{outline:none;border-color:var(--dpo-tone);box-shadow:inset 0 1px 2px rgba(0,0,0,.28),0 0 0 3px color-mix(in srgb,var(--dpo-tone) 26%,transparent)}",
					".dpo-cap[data-disabled=\"true\"]{opacity:.5;cursor:not-allowed;--dpo-tone:var(--dsw-alias-label-caption,#777)}",
					".dpo-cap[data-tone=\"tier\"]{width:152px}",
					/* 上下文量程滑块：左轨道自适应 + 右数字区独立（数字不压滑块、不裁切） */
					".dpo-cap[data-tone=\"ctx\"]{width:auto;flex:0 1 auto;min-width:150px;max-width:210px}",
					".dpo-range{gap:0;padding:3px 4px}",
					".dpo-range-rail{position:relative;flex:1 1 auto;min-width:56px;height:22px;margin:0 9px}",
					".dpo-range-inner{position:absolute;left:8px;right:8px;top:0;bottom:0}",
					".dpo-range-rail::before{content:\"\";position:absolute;left:0;right:0;top:9px;height:4px;border-radius:999px;background:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,.10));box-shadow:inset 0 1px 2px rgba(0,0,0,.45)}",
					".dpo-range-fill{position:absolute;left:0;top:9px;height:4px;border-radius:999px;background:linear-gradient(90deg,var(--dpo-tone),color-mix(in srgb,var(--dpo-tone) 62%,#ffffff));box-shadow:0 0 8px color-mix(in srgb,var(--dpo-tone) 34%,transparent);transition:width .14s var(--dpo-ease)}",
					".dpo-range-knob{position:absolute;top:2px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,color-mix(in srgb,var(--dpo-tone) 78%,#fff) 46%,var(--dpo-tone));box-shadow:0 0 0 2px var(--dpo-surface),0 0 0 3px color-mix(in srgb,var(--dpo-tone) 26%,transparent),0 2px 6px rgba(0,0,0,.42);transition:left .14s var(--dpo-ease),transform .18s var(--dpo-spring)}",
					".dpo-range:hover .dpo-range-knob{transform:scale(1.12)}",
					".dpo-range:active .dpo-range-knob{transform:scale(.96)}",
					".dpo-range-sep{flex:0 0 auto;width:1px;height:16px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--dpo-line) 90%,transparent),transparent)}",
					".dpo-range-num{flex:0 0 auto;min-width:34px;padding-right:2px;text-align:right;font-size:12px;font-weight:600;letter-spacing:.2px;color:var(--dpo-tone);font-variant-numeric:tabular-nums}",
					".dpo-cap[data-disabled=\"true\"] .dpo-range-num{color:var(--dsw-alias-label-caption,#888)}",
					/* 归一化：三枚胶囊 + 模型胶囊 + 帮助按钮统一 30px 高、统一字号与圆角 */
					".dpo-cap{height:32px;box-sizing:border-box}",
					".dpo-cap-opt{font-size:12px}",
					".dpo-cap[data-tone=\"perm\"]{width:98px}",
					"@media (max-width:1480px){.dpo-cap[data-tone=\"tier\"]{width:140px}.dpo-cap[data-tone=\"perm\"]{width:92px}}",
					"@media (max-width:1240px){.dpo-cap[data-tone=\"tier\"]{width:128px}.dpo-cap[data-tone=\"perm\"]{width:86px}}",
					"@media (max-width:1080px){.dpo-cap[data-tone=\"tier\"]{width:116px}.dpo-cap[data-tone=\"perm\"]{width:80px}}",
					".dpo-cap-track{position:absolute;inset:2px;border-radius:999px}",
					".dpo-cap-knob{position:absolute;top:0;bottom:0;border-radius:999px;background:linear-gradient(180deg,color-mix(in srgb,var(--dpo-tone) 30%,transparent),color-mix(in srgb,var(--dpo-tone) 18%,transparent));border:1px solid color-mix(in srgb,var(--dpo-tone) 55%,transparent);box-shadow:0 1px 4px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.10);transition:left .3s var(--dpo-spring),width .2s ease,background .2s,border-color .2s}",
					".dpo-cap-opt{position:absolute;top:0;bottom:0;border:none;background:transparent;padding:0;font-size:11.5px;letter-spacing:.2px;color:var(--dsw-alias-label-caption,#8a8a8a);cursor:pointer;transition:color .2s,font-weight .2s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
					".dpo-cap-opt:hover{color:var(--dsw-alias-label-secondary,#c9c9c9)}",
					".dpo-cap-opt[data-on=\"true\"]{color:var(--dpo-tone);font-weight:600}",
					".dpo-cap-opt:disabled{cursor:not-allowed}",
					".dpo-cap-value{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}",
					".dpo-slider-name{display:none}",
					/* 旧 .dpo-stop 规则保留但不再使用（避免影响历史样式钩子） */
					/* 结果悬浮球：发送后收成一颗小球（拖动移动 / 单击展开） */
					".dpo-ball{position:fixed;left:0;top:0;z-index:88;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;width:46px;height:46px;border-radius:50%;cursor:grab;touch-action:none;color:#fff;background:radial-gradient(circle at 34% 28%,color-mix(in srgb,var(--dpo-ball-tone) 55%,#fff),var(--dpo-ball-tone) 72%);box-shadow:0 6px 20px rgba(0,0,0,.38),0 0 0 1px rgba(255,255,255,.12) inset,0 0 0 4px color-mix(in srgb,var(--dpo-ball-tone) 18%,transparent);animation:dpo-ball-in .32s var(--dpo-spring);transition:box-shadow .22s ease,opacity .2s ease}",
					".dpo-ball:hover{box-shadow:0 8px 26px rgba(0,0,0,.44),0 0 0 1px rgba(255,255,255,.16) inset,0 0 0 7px color-mix(in srgb,var(--dpo-ball-tone) 24%,transparent)}",
					".dpo-ball:active{cursor:grabbing}",
					"@keyframes dpo-ball-in{from{opacity:0;transform:translate3d(var(--dpo-ball-x,0),var(--dpo-ball-y,0),0) scale(.4)}to{opacity:1}}",
					".dpo-ball-icon{font-size:15px;line-height:1;opacity:.95}",
					".dpo-ball-label{font-size:9px;letter-spacing:.5px;opacity:.9}",
					".dpo-ball[data-sent=\"true\"]{opacity:.82}",
					".dpo-sent-tag{flex:1 1 auto;font-size:11.5px;color:var(--dsw-alias-label-caption,#8a8a8a);letter-spacing:.3px}",
					/* 常驻操作栏 + token 徽标（v54） */
					".dpo-overlay-foot{flex:0 0 auto;position:relative;z-index:3;border-top:1px solid color-mix(in srgb,var(--dpo-line) 70%,transparent);background:linear-gradient(0deg,var(--dpo-hi),transparent)}",
					".dpo-foot-inner{display:flex;flex-direction:column}",
					".dpo-foot-inner .dpo-overlay-actions{border-top:none;padding:10px 22px 10px 14px}",
					".dpo-overlay-foot .dpo-btn{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
					"@media (max-height:640px){.dpo-pane{max-height:min(132px,22vh)}.dpo-review-text{min-height:min(150px,20vh)}.dpo-trace{max-height:72px}}",
					"@media (max-height:470px){.dpo-pane{max-height:min(132px,18vh)}.dpo-review-text{min-height:min(150px,16vh)}.dpo-trace{display:none}.dpo-overlay-head{padding:9px 13px}.dpo-overlay-src{display:none}}",
					".dpo-tok-chip{margin-left:auto;font-size:10.5px;font-weight:600;letter-spacing:.2px;padding:1px 7px;border-radius:999px;background:var(--dpo-acc-12);color:var(--dpo-acc);border:1px solid var(--dpo-acc-22);white-space:nowrap}",
					".dpo-pane-title .dpo-tok-chip{margin-left:0}",
					".dpo-pane-title .dpo-tok-chip:first-of-type{margin-left:auto}",
					".dpo-pane-title{gap:7px}",
					".dpo-tok-muted{background:color-mix(in srgb,var(--dsw-alias-label-caption,#777) 14%,transparent);color:var(--dsw-alias-label-caption,#8a8a8a);border-color:transparent;font-weight:500}",
					".dpo-tok-live{animation:dpo-pulse 1.6s ease-out infinite}",
					".dpo-hint-quiet{font-size:10.5px;color:var(--dsw-alias-label-caption,#8a8a8a);line-height:1.5}",
					".dpo-help-meta{margin-top:12px;padding-top:9px;border-top:1px solid color-mix(in srgb,var(--dpo-line) 60%,transparent);font-size:10.5px;color:var(--dsw-alias-label-caption,#8a8a8a);text-align:center;letter-spacing:.2px}",
					/* 使用帮助 */
					".dpo-help{flex:0 0 auto;box-sizing:border-box;width:32px;height:32px;padding:0;border-radius:50%;border:1px solid var(--dpo-line);background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 5%,transparent),transparent);color:var(--dsw-alias-label-secondary,#aaa);font-size:14px;font-weight:600;line-height:1;cursor:pointer;box-shadow:var(--dpo-shadow-1);transition:transform .16s var(--dpo-spring),border-color .2s,color .2s,box-shadow .22s}",
					".dpo-help:hover{transform:translateY(-1px) rotate(8deg);border-color:var(--dpo-acc);color:var(--dpo-acc);box-shadow:0 2px 10px var(--dpo-acc-22)}",
					".dpo-help:active{transform:scale(.96)}",
					".dpo-help[data-open=\"true\"]{border-color:var(--dpo-acc);color:var(--dpo-acc);box-shadow:0 0 0 3px var(--dpo-acc-12)}",
					".dpo-help-pop{width:396px;padding:14px 16px}",
					".dpo-help-sec{margin:12px 0 6px;font-size:11.5px;letter-spacing:.4px;color:var(--dsw-alias-label-caption,#8a8a8a);display:flex;align-items:center;gap:8px}",
					".dpo-help-sec::after{content:\"\";flex:1 1 auto;height:1px;background:linear-gradient(90deg,color-mix(in srgb,var(--dpo-line) 80%,transparent),transparent)}",
					".dpo-help-sec:first-of-type{margin-top:4px}",
					".dpo-help-row{display:flex;gap:10px;padding:3px 0;font-size:12px;line-height:1.6}",
					".dpo-help-k{flex:0 0 62px;color:var(--dpo-acc);font-weight:600}",
					".dpo-help-v{flex:1 1 auto;color:var(--dsw-alias-label-secondary,#c9c9c9)}",
					".dpo-help-tip{margin-top:13px;padding:10px 12px;border-radius:11px;background:var(--dpo-acc-12);border:1px solid var(--dpo-acc-22);color:var(--dsw-alias-label-primary,#eee);font-size:12.5px;line-height:1.6;font-weight:600}",
					/* ══════════ v60 扁平极简层：去渐变/去内阴影/去玻璃，统一圆角与 26px 同高；底栏贴底不挤输入框 ══════════ */
					".dpo-controls,.dpo-pop,.dpo-overlay{--dpo-r:7px;--dpo-flat:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 5%,transparent);--dpo-flat-2:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 9%,transparent);--dpo-shadow-1:none;--dpo-shadow-2:0 6px 20px rgba(0,0,0,.26)}",
					".dpo-controls{align-items:flex-end;align-self:flex-end;gap:6px;height:26px}",
					".dpo-cap{height:26px;box-sizing:border-box;padding:2px;border-radius:var(--dpo-r);border:1px solid var(--dpo-line);background:var(--dpo-flat);box-shadow:none;transition:background .16s ease,border-color .16s ease}",
					".dpo-cap:hover{border-color:color-mix(in srgb,var(--dpo-tone) 42%,transparent);background:var(--dpo-flat-2);box-shadow:none}",
					".dpo-cap:focus-visible{border-color:var(--dpo-tone);box-shadow:0 0 0 2px color-mix(in srgb,var(--dpo-tone) 22%,transparent)}",
					".dpo-cap[data-tone=tier]{width:128px}",
					".dpo-cap[data-tone=perm]{width:84px}",
					".dpo-cap[data-tone=ctx]{width:auto;min-width:164px;max-width:none}",
					".dpo-cap-track{inset:2px;border-radius:5px}",
					".dpo-cap-knob{border-radius:5px;background:color-mix(in srgb,var(--dpo-tone) 18%,transparent);border:1px solid color-mix(in srgb,var(--dpo-tone) 40%,transparent);box-shadow:none;transition:left .22s var(--dpo-ease),width .18s ease,background .16s ease}",
					".dpo-cap-opt{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
					".dpo-cap-opt[data-on=true]{color:var(--dpo-tone);font-weight:600}",
					/* 量程滑块：扁平细轨 + 扁平圆钮（12px，两端各内缩 6px 保证不越界） */
					".dpo-range-rail{height:100%;min-width:64px;margin:0 7px}",
					".dpo-range-inner{position:absolute;left:6px;right:6px;top:0;bottom:0}",
					".dpo-range-rail::before{top:50%;height:3px;margin-top:-1.5px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 13%,transparent);box-shadow:none}",
					".dpo-range-fill{top:50%;height:3px;margin-top:-1.5px;border-radius:999px;background:var(--dpo-tone);box-shadow:none;transition:width .12s linear}",
					".dpo-range-knob{top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--dpo-tone);box-shadow:0 0 0 2px var(--dpo-surface);transition:left .12s linear,transform .16s var(--dpo-spring)}",
					".dpo-range:hover .dpo-range-knob{transform:scale(1.08)}",
					".dpo-range:active .dpo-range-knob{transform:scale(.96)}",
					".dpo-range-rail:focus-visible{outline:none}",
					".dpo-range-rail:focus-visible .dpo-range-knob{box-shadow:0 0 0 2px var(--dpo-surface),0 0 0 4px color-mix(in srgb,var(--dpo-tone) 30%,transparent)}",
					".dpo-range-sep{width:1px;height:13px;margin:0 1px;background:var(--dpo-line)}",
					".dpo-range-num{min-width:22px;padding:0 7px 0 0;font-size:12px;font-weight:600;letter-spacing:0;color:var(--dpo-tone)}",
					".dpo-range[data-mode=full] .dpo-range-num{min-width:16px}",
					/* 模式转化按钮：贴着数字右侧、竖线分隔、扁平；两态 回合 / 全文 */
					".dpo-ctx-mode{flex:0 0 auto;align-self:stretch;margin:-2px -2px -2px 0;padding:0 10px;border:none;border-left:1px solid var(--dpo-line);border-radius:0 6px 6px 0;background:transparent;color:var(--dsw-alias-label-secondary,#b5b5b5);font-size:11.5px;font-weight:600;letter-spacing:.2px;cursor:pointer;transition:background .16s ease,color .16s ease}",
					".dpo-ctx-mode:hover{background:var(--dpo-acc-12);color:var(--dpo-acc)}",
					".dpo-ctx-mode[data-mode=full]{color:var(--dpo-acc)}",
					".dpo-ctx-mode:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--dpo-acc-22)}",
					/* 模型胶囊 / 帮助按钮：同高、同圆角、同底色 */
					".dpo-model{height:26px;box-sizing:border-box;padding:0 9px;border-radius:var(--dpo-r);border:1px solid var(--dpo-line);background:var(--dpo-flat);box-shadow:none;transform:none;font-size:11.5px}",
					".dpo-model:hover{transform:none;background:var(--dpo-flat-2);border-color:color-mix(in srgb,var(--dpo-acc) 42%,transparent);box-shadow:none}",
					".dpo-model:active{transform:none}",
					".dpo-model[data-open=true]{border-color:var(--dpo-acc);box-shadow:0 0 0 2px var(--dpo-acc-12)}",
					".dpo-model-caret{font-size:8px}",
					".dpo-help{width:26px;height:26px;border-radius:var(--dpo-r);border:1px solid var(--dpo-line);background:var(--dpo-flat);box-shadow:none;font-size:13px}",
					".dpo-help:hover{transform:none;background:var(--dpo-flat-2);border-color:color-mix(in srgb,var(--dpo-acc) 42%,transparent);box-shadow:none}",
					".dpo-help[data-open=true]{box-shadow:0 0 0 2px var(--dpo-acc-12)}",
					".dpo-divider{width:1px;height:14px;margin:0 1px;background:var(--dpo-line)}",
					/* 弹层 / 浮层 / 悬浮球：扁平化（去玻璃、去渐变、去内高光） */
					".dpo-pop{border-radius:10px;border:1px solid var(--dpo-line);background:var(--dpo-surface);box-shadow:var(--dpo-shadow-2);backdrop-filter:none}",
					".dpo-pop-item{border-radius:6px}",
					".dpo-pop-item:hover{padding-left:10px;box-shadow:none}",
					".dpo-pop-item[data-selected=true]{border-radius:5px}",
					".dpo-pop-item[data-selected=true]::after{content:none}",
					".dpo-overlay{border-radius:10px;background:var(--dpo-surface);box-shadow:var(--dpo-shadow-2)}",
					".dpo-overlay-head{background:var(--dpo-surface);border-bottom:1px solid var(--dpo-line)}",
					".dpo-overlay-head::before{box-shadow:none}",
					".dpo-overlay[data-state=done] .dpo-overlay-head::before{box-shadow:none}",
					".dpo-overlay[data-state=error] .dpo-overlay-head::before{box-shadow:none}",
					".dpo-overlay-actions{background:transparent}",
					".dpo-overlay-foot{background:transparent}",
					".dpo-pane{background:transparent;box-shadow:none;border-radius:8px}",
					".dpo-pane:hover{box-shadow:none}",
					".dpo-pane-title::before{width:4px;height:4px}",
					".dpo-btn{border-radius:7px;box-shadow:none}",
					".dpo-btn:hover{box-shadow:none}",
					".dpo-btn.primary{background:var(--dpo-acc);box-shadow:none}",
					".dpo-btn.primary:hover{box-shadow:none}",
					".dpo-btn.danger{background:#d9534f;box-shadow:none}",
					".dpo-review-text{border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-l1,#141414) 80%,transparent);box-shadow:none}",
					".dpo-review-text:focus{box-shadow:0 0 0 2px var(--dpo-acc-12)}",
					".dpo-regen-ask{border-radius:8px;box-shadow:none;background:transparent}",
					".dpo-regen-input{border-radius:7px}",
					".dpo-toast{border-radius:8px;box-shadow:var(--dpo-shadow-2);backdrop-filter:none}",
					".dpo-ball{background:var(--dpo-ball-tone);box-shadow:0 4px 14px rgba(0,0,0,.28)}",
					".dpo-ball:hover{box-shadow:0 6px 18px rgba(0,0,0,.34)}",
					".dpo-size-grip{opacity:.55;border-radius:3px}",
					".dpo-head-tier,.dpo-head-count,.dpo-pop-chip,.dpo-tok-chip{border-radius:5px}",
					".dpo-help-tip{border-radius:8px}",
					"@media (max-width:1480px){.dpo-cap[data-tone=tier]{width:120px}.dpo-cap[data-tone=perm]{width:80px}.dpo-controls{gap:6px}}",
					"@media (max-width:1240px){.dpo-cap[data-tone=tier]{width:110px}.dpo-cap[data-tone=perm]{width:76px}.dpo-range-num{font-size:11.5px}.dpo-controls{gap:5px}}",
					"@media (max-width:1080px){.dpo-cap[data-tone=tier]{width:100px}.dpo-controls{gap:4px}}",
				].join("\n");
				document.head.appendChild(style);
				return () => { style.remove(); };
			}, NS + ": styles");

			// 语言：跟随 DSH 设置里的语言（zh / en）；没有 locale 服务时保持中文
			own(() => {
				let loc = null
				try { loc = ctx.get("locale") } catch (e) { loc = null }
				if (!loc || typeof loc.getSnapshot !== "function") { beacon("locale", { available: false, using: store.locale }); return () => {} }
				const sync = () => {
					let id = "zh"
					try { const snap = loc.getSnapshot(); id = String((snap && snap.active) || "zh") } catch (e) { id = "zh" }
					store.locale = id.toLowerCase().indexOf("en") === 0 ? "en" : "zh"
					beacon("locale", { available: true, active: id, using: store.locale })
					emit()
				}
				sync()
				if (typeof loc.subscribe === "function") { const off = loc.subscribe(sync); return () => { try { if (typeof off === "function") off() } catch (e) { /* noop */ } } }
				return () => {}
			}, "prompt-optimizer: locale")
			own(() => ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "prompt-optimizer",
				order: 20,
			}, Controls)), NS + ": composer controls");

			// 自愈：HMR 拆卸竞态后若控件没挂上，延时重挂一次（防"UI 全消失"）
			own(() => {
				let tries = 0;
				const timer = window.setInterval(() => {
					tries += 1;
					if (document.querySelector('[data-dpo="controls"]')) {
						if (tries > 1) beacon("controls-healed", { tries });
						window.clearInterval(timer);
						return;
					}
					beacon("remount-controls", { tries, order: 20 - tries });
					// 换优先级重挂：同 id 同优先级会被 slot 系统判为重复条目（shadow 需不同优先级）
					own(() => ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
						name: "conversation.input.left", id: "prompt-optimizer", order: 20 - tries,
					}, Controls)), NS + ": composer controls (retry " + tries + ")");
					if (tries >= 8) {
						beacon("remount-give-up", { tries });
						window.clearInterval(timer);
					}
				}, 1200);
				return () => window.clearInterval(timer);
			}, NS + ": controls self-heal (repeating)");
			own(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "prompt-optimizer-overlay",
				order: 60,
			}, OverlayHost)), NS + ": placeholder overlay");
			// 浮层自愈：store 说"开着"但 DOM 里没有节点 → 重挂一次（防"弹窗无声消失"）
			own(() => {
				let tries = 0;
				const timer = window.setInterval(() => {
					tries += 1;
					if (!store.overlay.open) { if (tries > 1) window.clearInterval(timer); return; }
					if (document.querySelector('[data-dpo="overlay"]')) {
						if (tries > 1) { beacon("overlay-healed", { tries }); window.clearInterval(timer); }
						return;
					}
					beacon("remount-overlay", { tries, runStatus: store.run ? store.run.status : null, tier: store.tier });
					own(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
						name: "shell.overlay", id: "prompt-optimizer-overlay", order: 60,
					}, OverlayHost)), NS + ": overlay retry " + tries);
					if (tries >= 6) { beacon("overlay-slot-missing", { tries }); window.clearInterval(timer); }
				}, 1500);
				return () => window.clearInterval(timer);
			}, NS + ": overlay self-heal");
			// 全局异常埋点：任何未捕获错误/拒绝都留痕（浮层消失类问题的最后一层证据）
			own(() => {
				const onErr = (e) => beacon("client-error", {
					message: String((e && (e.message || e.error)) || "").slice(0, 300),
					stack: String((e && e.error && e.error.stack) || "").slice(0, 700),
					source: String((e && e.filename) || "").slice(0, 140), line: (e && e.lineno) || null,
				});
				const onRej = (e) => beacon("client-rejection", { reason: String((e && e.reason && (e.reason.stack || e.reason.message)) || (e && e.reason) || "").slice(0, 700) });
				window.addEventListener("error", onErr);
				window.addEventListener("unhandledrejection", onRej);
				return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
			}, NS + ": error beacons");

			// 探针触发：轮询 host 命令通道（evidence/cmd.json），token 变化即跑一轮
			let lastToken = window.__DPO_LAST_TOKEN__ || null;
			own(() => {
				const t = window.setInterval(() => {
					fetch(API + "/trace", { cache: "no-store" }).then((r) => r.json()).then((d) => {
						store.trace = d && d.ok ? d : null;
						emit();
					}).catch(() => { /* best effort */ });
				}, 3000);
				return () => window.clearInterval(t);
			}, NS + ": trace poll");
			own(() => {
				const timer = window.setInterval(() => {
					fetch(API + "/cmd", { cache: "no-store" })
						.then((r) => r.json())
						.then((d) => {
							const cmd = d && d.cmd;
							if (!cmd || !cmd.run || !cmd.token || cmd.token === lastToken) return;
							beacon("cmd-seen", { run: cmd.run, token: cmd.token, ageMs: d.cmdAgeMs === undefined ? null : d.cmdAgeMs });
							// 探针互斥：真自检运行中不并发跑演示；但"卡住的旧标记"必须能自愈（否则演示通道假死，实测已踩过一次）
							if (window.__DPO_PROBE_RUNNING__ === true) {
								const busyAge = Date.now() - Number(window.__DPO_PROBE_STARTED_AT__ || 0);
								if (busyAge < 90000) { beacon("probe-skip", { run: cmd.run, token: cmd.token, busyAgeMs: busyAge }); return; }
								window.__DPO_PROBE_RUNNING__ = false; window.__DPO_PROBE_STARTED_AT__ = 0;
								beacon("probe-stale-reset", { run: cmd.run, token: cmd.token, busyAgeMs: busyAge });
							}
							// 模型弹层自检（宿主下发）：打开弹层 → 数一遍真实渲染出来的条目 → 关闭
							if (cmd.run === "popover-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								const popT0 = Date.now();
								store.modelPop = { x: 200, bottom: 260, maxH: 420 };
								store.modelPopOpen = true;
								emit();
								window.setTimeout(() => {
									const pop = document.querySelector('[data-dpo="model-pop"]');
									const r = pop ? pop.getBoundingClientRect() : null;
									beacon("popover-demo", {
										open: Boolean(pop),
										items: document.querySelectorAll('[data-dpo="model-item"]').length,
										groups: document.querySelectorAll('[data-dpo="model-group"]').length,
										loading: Boolean(document.querySelector('[data-dpo="model-loading"]')),
										error: Boolean(document.querySelector('[data-dpo="model-error"]')),
										catalogLoading: store.modelCatalogLoading === true,
										catalogAgeMs: store.modelCatalogAt ? Date.now() - store.modelCatalogAt : null,
										rect: r ? { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
										viewport: { w: window.innerWidth, h: window.innerHeight },
										inView: Boolean(r) && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
										scrollH: pop ? pop.scrollHeight : null, clientH: pop ? pop.clientHeight : null,
										elapsedMs: Date.now() - popT0,
										firstItemText: (() => { const el = document.querySelector('[data-dpo="model-item"]'); return el ? String(el.textContent).slice(0, 40) : null; })(),
										// v51：胶囊状态 + 选中/会话高亮 + 动效是否生效
										pillOpen: (() => { const el = document.querySelector('[data-dpo="model"]'); return el ? el.getAttribute("data-open") : null; })(),
										selectedCount: document.querySelectorAll('[data-dpo="model-item"][data-selected="true"]').length,
										sessionCount: document.querySelectorAll('[data-dpo="model-item"][data-session="true"]').length,
										sessionChips: document.querySelectorAll(".dpo-pop-chip").length,
										popAnim: pop ? getComputedStyle(pop).animationName : null,
										popBlur: pop ? (getComputedStyle(pop).backdropFilter || getComputedStyle(pop).webkitBackdropFilter || null) : null,
									});
									store.modelPopOpen = false;
									emit();
								}, 900);
								return;
							}
							// 端到端自检（宿主下发）：跑一次真优化，只允许在"需要审查"下进行 —— 绝不发送消息
							if (cmd.run === "run-demo") {
								if (store.permission !== "review") { beacon("run-demo-refused", { permission: store.permission }); lastToken = cmd.token; return; }
								if (store.run && (store.run.status === "connecting" || store.run.status === "running")) { beacon("run-demo-deferred", { status: store.run.status }); return; }
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								beacon("run-demo-start", { token: cmd.token, tier: cmd.tier || "basic", permission: store.permission });
								startRun(String(cmd.text || "（自检）把那个页面弄好看点"), cmd.tier || "basic", false);
								const t = window.setInterval(() => {
									if (store.run && store.run.status !== "connecting" && store.run.status !== "running") {
										window.clearInterval(t);
										window.setTimeout(() => {
											beaconOverlayGeom("run-demo-done");
											beacon("run-demo-ui", {
												status: store.run ? store.run.status : null,
												chars: store.run ? String(store.run.text || "").length : 0,
												hasReviewText: Boolean(document.querySelector('[data-dpo="review-text"]')),
												hasConfirm: Boolean(document.querySelector('[data-dpo="confirm"]')),
												hasRegen: Boolean(document.querySelector('[data-dpo="regen"]')),
												hasRollback: Boolean(document.querySelector('[data-dpo="rollback"]')),
												hasGrip: Boolean(document.querySelector('[data-dpo="resize"]')),
												hasFoot: Boolean(document.querySelector('[data-dpo="overlay-foot"]')),
												footButtons: Array.from(document.querySelectorAll('[data-dpo="overlay-foot"] button')).map((b) => b.getAttribute("data-dpo")),
												footInView: (() => { const el = document.querySelector('[data-dpo="overlay-foot"]'); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1; })(),
												tokReasoning: (() => { const el = document.querySelector('[data-dpo="token-reasoning"]'); return el ? String(el.textContent) : null; })(),
												tokNone: Boolean(document.querySelector('[data-dpo="token-reasoning-none"]')),
												tokTotal: (() => { const el = document.querySelector('[data-dpo="token-total"]'); return el ? String(el.textContent) : null; })(),
												usage: store.run && store.run.usage ? Object.keys(store.run.usage).slice(0, 12) : null,												// v56 极简 UI 形态
												head: { title: (() => { const el = document.querySelector('[data-dpo="head-title"]'); return el ? el.textContent : null; })(), tier: (() => { const el = document.querySelector('[data-dpo="head-tier"]'); return el ? el.textContent : null; })() },
												folds: ['thinking', 'original', 'trace'].map((k) => { const el = document.querySelector('[data-dpo="fold-' + k + '"]'); return { key: k, exists: Boolean(el), open: el ? el.getAttribute("data-open") : null, summary: (() => { const s = el && el.querySelector(".dpo-fold-sum"); return s ? s.textContent : null; })() }; }),
												redundantTextPane: Boolean(document.querySelector('[data-dpo="pane-text"]')),
												hasOldSrcRow: Boolean(document.querySelector('.dpo-overlay-src')),
												controlsLabels: Array.from(document.querySelectorAll('.dpo-slider-name')).map((el) => el.textContent),
												hasCountChip: Boolean(document.querySelector('[data-dpo="count"]')),
												toastTest: (() => { try { showNotice(L("UI 自检通知")); window.setTimeout(() => { beacon("toast-check", { visible: Boolean(document.querySelector('[data-dpo="notice"]')), text: (document.querySelector('[data-dpo="notice"]') || {}).textContent || null, cls: (document.querySelector('[data-dpo="notice"]') || {}).className || null }); }, 220); return "scheduled"; } catch (e) { return 'err:' + e.message; } })(),
											});
											// 自检收尾：不留浮层、不留运行（演示不产生任何用户可见残留）
											store.run = null;
											store.reviewText = null;
											setOverlay({ open: false });
											beacon("run-demo-end", {});
										}, 200);
									}
								}, 400);
								return;
							}
							// 使用帮助自检（宿主下发）：打开帮助面板 → 数条目/查推荐语 → 关闭
							if (cmd.run === "help-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								const hb = document.querySelector('[data-dpo="help"]');
								const r0 = hb ? hb.getBoundingClientRect() : null;
								store.helpPos = r0 ? { x: Math.max(8, Math.min(r0.left - 260, window.innerWidth - 360)), bottom: Math.max(8, window.innerHeight - r0.top + 6), maxH: Math.max(200, r0.top - 16) } : { x: 200, bottom: 260, maxH: 420 };
								store.helpOpen = true;
								emit();
								window.setTimeout(() => {
									const pop = document.querySelector('[data-dpo="help-pop"]');
									const r = pop ? pop.getBoundingClientRect() : null;
									beacon("help-demo", {
										button: Boolean(hb),
										open: Boolean(pop),
										rows: document.querySelectorAll('.dpo-help-row').length,
										sections: document.querySelectorAll('.dpo-help-sec').length,
										tip: (() => { const el = document.querySelector('[data-dpo="help-tip"]'); return el ? String(el.textContent).trim() : null; })(),
										meta: (() => { const el = document.querySelector('[data-dpo="help-meta"]'); return el ? String(el.textContent).trim() : null; })(),
										rect: r ? { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
										inView: Boolean(r) && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
										scrollH: pop ? pop.scrollHeight : null, clientH: pop ? pop.clientHeight : null,
										diag: pop ? { vh: window.innerHeight, maxHCss: getComputedStyle(pop).maxHeight, bottomCss: getComputedStyle(pop).bottom, overflow: getComputedStyle(pop).overflowY, posBottom: store.helpPos ? store.helpPos.bottom : null, posMaxH: store.helpPos ? store.helpPos.maxH : null } : null,
									});
									store.helpOpen = false;
									emit();
								}, 500);
								return;
							}
							// 语言自检（宿主下发）：报告 locale 服务状态，并强制 en / zh 各渲染一次，核对关键文案
							if (cmd.run === "i18n-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								void (async () => {
									const keep = store.locale;
									const out = { serviceActive: null, samples: {} };
									try { const loc = ctx.get("locale"); if (loc && loc.getSnapshot) out.serviceActive = (loc.getSnapshot() || {}).active || null } catch (e) { /* no service */ }
									const probe = async (lang) => {
										store.locale = lang; store.helpOpen = true; emit(); await frame(); await sleep(260);
										const head = document.querySelector(".dpo-help-pop .dpo-pop-head");
										const rows = [...document.querySelectorAll(".dpo-help-row")].map((el) => String(el.textContent || ""));
										const secs = [...document.querySelectorAll(".dpo-help-sec")].map((el) => String(el.textContent || ""));
										const tip = document.querySelector("[data-dpo=\"help-tip\"]");
										const meta = document.querySelector("[data-dpo=\"help-meta\"]");
										const tierCap = document.querySelector("[data-dpo=\"tier\"] .dpo-cap-opt[data-on=\"true\"]");
										const res = {
											head: head ? String(head.textContent || "").slice(0, 60) : null,
											tip: tip ? String(tip.textContent || "").slice(0, 60) : null,
											meta: meta ? String(meta.textContent || "").slice(0, 90) : null,
											tierLabel: tierCap ? String(tierCap.textContent || "") : null,
											// 注意：这里的比较基准必须是"字面量"，不能用 L()（否则等于拿本地化后的串比本地化后的串）
											secHasTier: secs.some((s) => s.indexOf(lang === "en" ? "Tier" : "档位") >= 0),
											rowHasSubstance: rows.some((r) => r.indexOf(lang === "en" ? "Substance first" : "实质优先") >= 0),
											rowHasProcess: rows.some((r) => r.indexOf(lang === "en" ? "Process weight" : "流程长度") >= 0),
											// 第 ④ 行是"界面语言跟随 DSH"，行键是 ④，所以按正文断言（不能按"界面语言"字样断言）
											rowHasLang: rows.some((r) => r.indexOf(lang === "en" ? "follows DSH" : "跟随 DSH") >= 0),
											secs: secs.length,
											rows: rows.length,
										};
										store.helpOpen = false; emit(); await frame();
										return res;
									};
									try {
										out.samples.en = await probe("en");
										out.samples.zh = await probe("zh");
									} catch (e) { out.error = String(e); }
									store.locale = keep; emit();
									const en = out.samples.en || {}; const zh = out.samples.zh || {};
									out.pass = Boolean(
										en.head && en.head.indexOf("Help") >= 0 && en.secHasTier && en.rowHasSubstance && en.rowHasProcess && en.rowHasLang && en.tip && en.tip.indexOf("Extreme") >= 0
										&& zh.head && zh.head.indexOf("使用帮助") >= 0 && zh.secHasTier && zh.rowHasSubstance && zh.rowHasProcess && zh.rowHasLang
									);
									beacon("i18n-demo", out);
								})().catch((e) => beacon("i18n-demo", { error: String(e) }));
								return;
							}
							// 浮层语言覆盖自检（宿主下发）：构造一个"审查态"运行 + trace + 原文，强制 en / zh 各渲染一次，
							// 收集浮层内所有文本节点，断言 en 下不再出现中文（作者署名除外）。
							if (cmd.run === "i18n-overlay-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								void (async () => {
									const keep = { locale: store.locale, run: store.run, overlay: store.overlay, permission: store.permission, reviewText: store.reviewText, trace: store.trace, panes: store.panes, tier: store.tier };
									const out = { samples: {} };
									const probe = async (lang) => {
										store.locale = lang;
										store.permission = "review";
										store.reviewText = null;
										store.panes = { thinking: true, original: true, trace: true };
										store.trace = { normal: [{ step: 1, tool: "read_file", args: "README.md", ms: 12, resultLines: 3 }], capped: [], converged: true, rounds: 1 };
										store.run = {
											status: "done", tier: "extreme", version: 1, sent: false, request: "Sample original request.",
											reasoning: "Sample reasoning line.", text: "Sample optimized command body.",
											usage: { reasoning: 120, total: 420 }, firstPaintMs: 800,
											history: { turns: 2, userTurns: 2, chars: 120 }, sessionId: store.viewSessionId,
										};
										setOverlay({ open: true, text: "Sample optimized command body.", fullText: "Sample original message.", src: "demo" });
										emit(); await frame(); await sleep(320);
										const ov = document.querySelector('[data-dpo="overlay"]');
										const segs = [];
										if (ov) {
											for (const el of ov.querySelectorAll("*")) {
												for (const n of el.childNodes) {
													if (n.nodeType !== 3) continue;
													const s = String(n.textContent || "").trim();
													if (s) segs.push(s);
												}
											}
										}
										const cjk = segs.filter((s) => /[\u4e00-\u9fff]/.test(s) && s.indexOf("啃轮胎的西狐") < 0);
										const btns = ov ? [...ov.querySelectorAll(".dpo-btn")].map((b) => String(b.textContent || "").trim()) : [];
										const res = { open: Boolean(ov), segs: segs.length, cjk, btns, status: ov ? String((ov.querySelector('[data-dpo="run-status"]') || {}).textContent || "").slice(0, 80) : null };
										setOverlay({ open: false }); store.run = null; emit(); await frame();
										// 模型弹层：同一语言的覆盖检查（分组/条目名来自宿主目录，语言中立；此处只查插件自己的文案）
										store.modelPop = { x: 200, bottom: 260, maxH: 420 }; store.modelPopOpen = true; emit(); await sleep(320);
										const segsOf = (root) => {
											const out2 = [];
											if (!root) return out2;
											for (const el of root.querySelectorAll("*")) {
												for (const n of el.childNodes) {
													if (n.nodeType !== 3) continue;
													const s = String(n.textContent || "").trim();
													if (s) out2.push(s);
												}
											}
											return out2;
										};
										const popSegs = segsOf(document.querySelector('[data-dpo="model-pop"]'));
										res.popSegs = popSegs.length;
										res.popCjk = popSegs.filter((s) => /[\u4e00-\u9fff]/.test(s));
										store.modelPopOpen = false; emit(); await frame();
										return res;
									};
									try { out.samples.en = await probe("en"); out.samples.zh = await probe("zh"); } catch (e) { out.error = String(e); }
									store.locale = keep.locale; store.run = keep.run; store.overlay = keep.overlay; store.permission = keep.permission;
									store.reviewText = keep.reviewText; store.trace = keep.trace; store.panes = keep.panes; store.tier = keep.tier; emit();
									const en = out.samples.en || {}; const zh = out.samples.zh || {};
									out.pass = Boolean(
										en.open && en.cjk && en.cjk.length === 0 && en.btns && en.btns.some((b) => /send|confirm|roll/i.test(b))
										&& en.popSegs > 0 && en.popCjk && en.popCjk.length === 0
										&& zh.open && zh.btns && zh.btns.some((b) => /确认|回退/.test(b))
									);
									beacon("i18n-overlay-demo", out);
								})().catch((e) => beacon("i18n-overlay-demo", { error: String(e) }));
								return;
							}
							// 真·跟随 DSH 设置自检（宿主下发）：调用 locale 服务的 setLocale 真实切换语言，采样 UI 文案后再切回原值。
							// 这是"跟随 DSH 语言设置"的端到端验证（不是靠内部 store.locale 模拟）；无论成功失败都会还原原语言。
							if (cmd.run === "locale-switch-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								void (async () => {
									const out = { before: null, samples: {} };
									const loc = ctx.get("locale");
									if (!loc || typeof loc.setLocale !== "function") { beacon("locale-switch-demo", { error: "no-setLocale" }); return; }
									out.before = (loc.getSnapshot() || {}).active || null;
									const sample = async (lang) => {
										await sleep(360);
										const tier = document.querySelector('[data-dpo="tier"] .dpo-cap-opt[data-on="true"]');
										const help = document.querySelector('[data-dpo="help"]');
										const txt = tier ? String(tier.textContent || "") : "";
										return {
											active: (loc.getSnapshot() || {}).active || null,
											storeLocale: store.locale,
											tierLabel: txt || null,
											cjkInTier: /[\u4e00-\u9fff]/.test(txt),
											helpAria: help ? String(help.getAttribute("aria-label") || help.getAttribute("title") || "") : null,
										};
									};
									try {
										loc.setLocale("en");
										out.samples.en = await sample("en");
										loc.setLocale(out.before || "zh");
										out.samples.back = await sample("back");
									} catch (e) { out.error = String(e); }
									// 无论如何都还原到原语言（宁可多调一次也不能把用户界面留在别的语言上）
									try { if (((loc.getSnapshot() || {}).active || null) !== out.before) loc.setLocale(out.before || "zh"); } catch (e) { /* noop */ }
									await sleep(200);
									out.after = (loc.getSnapshot() || {}).active || null;
									const en = out.samples.en || {}; const back = out.samples.back || {};
									out.pass = Boolean(
										en.active === "en" && en.storeLocale === "en" && en.tierLabel && en.cjkInTier === false
										&& back.active === out.before && back.storeLocale === out.before
										&& out.after === out.before
									);
									beacon("locale-switch-demo", out);
								})().catch((e) => beacon("locale-switch-demo", { error: String(e) }));
								return;
							}
							// 档位/权限按会话独立 自检（宿主下发）：A 改 → 切 B 改 → 切回 A 应保持 A 的值
							if (cmd.run === "tier-session-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								const realSid = store.viewSessionId;
								const t0 = store.tier;
								const p0 = store.permission;
								const other = "__dpo_other_session__";
								setTier(t0 === "advanced" ? "extreme" : "advanced", "ui");
								const tierA = store.tier;
								const permA = store.permission;
								window.setTimeout(() => {
									onViewSessionChange(other);
									setTier("off", "ui");
									const permB0 = store.permission;
									window.setTimeout(() => {
										const bState = { tier: store.tier, permission: permB0, sessionId: store.viewSessionId };
										onViewSessionChange(realSid);
										window.setTimeout(() => {
											const backA = { tier: store.tier, permission: store.permission, sessionId: store.viewSessionId };
											beacon("tier-session-demo", {
												realSid, other,
												a: { tier: tierA, permission: permA },
												b: bState,
												backA,
												pass: bState.tier === "off" && backA.sessionId === realSid && backA.tier === tierA && tierA !== "off",
												mapKeys: Object.keys(store.tierBySession).length,
											});
											// 还原用户原值
											store.tierBySession[realSid] = t0;
											store.permissionBySession[realSid] = p0;
											setTier(t0, "probe-restore");
											if (p0 !== store.permission) setPermission(p0, "probe-restore");
											emit();
										}, 260);
									}, 260);
								}, 260);
								return;
							}
							// v57 自检（宿主下发）：刻度/拇指同源 + 逐点点击准确 + 键盘可达 + 长草稿不截断
							if (cmd.run === "slider-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								void (async () => {
								const cap = document.querySelector('[data-dpo="tier"]');
								const track = document.querySelector('[data-dpo="tier-track"]');
								const knob = document.querySelector('[data-dpo="tier-knob"]');
								const ticks = Array.from(document.querySelectorAll('[data-dpo^="tier-"]')).filter((el) => el.className === "dpo-cap-opt");
								const r0 = track ? track.getBoundingClientRect() : null;
								const posOf = (el) => { const r = el.getBoundingClientRect(); return r0 ? Math.round(((r.left + r.width / 2 - r0.left) / Math.max(1, r0.width)) * 1000) / 10 : null; };
								const N = Math.max(1, ticks.length);
								const geometry = ticks.map((el, i) => ({ id: el.getAttribute("data-dpo"), expectPct: Math.round(((i + 0.5) / N) * 1000) / 10, actualPct: posOf(el) }));
								const thumbPct = knob ? posOf(knob) : null;
								const aria = cap ? { role: cap.getAttribute("role"), now: cap.getAttribute("aria-valuenow"), text: cap.getAttribute("aria-valuetext"), tab: cap.getAttribute("tabindex") } : null;
								const tierBefore = store.tier;
								const clicks = [];
								ticks.forEach((el) => {
									const want = String(el.getAttribute("data-dpo")).replace("tier-", "");
									el.click();
									clicks.push({ clicked: want, got: store.tier, ok: want === store.tier });
								});
								setTier(tierBefore, "probe-restore");
								const clickOk = clicks.length === 4 && clicks.every((c) => c.ok);
								// 单元对齐：当前档位的滑块中心应落在该格中心
								const knobOk = thumbPct !== null && Math.abs(thumbPct - ((store.tier === "extreme" ? 3 : (store.tier === "advanced" ? 2 : (store.tier === "basic" ? 1 : 0))) + 0.5) / 4 * 100) <= 2;
								const geomOk = geometry.length === 4 && geometry.every((g2) => Math.abs(g2.expectPct - g2.actualPct) <= 1.5) && knobOk;
								// 长草稿：临时把 interceptAndOptimize 换成记录器，验证功能载荷是完整原文（社区 PR#4 缺陷回归）
								const origIntercept = interceptAndOptimize;
								let captured = null;
								interceptAndOptimize = (t) => { captured = String(t || ""); };
								const long = "长草稿测试：" + "甲乙丙丁戊己庚辛壬癸".repeat(24) + "（结尾标记END）";
								try {
									store.latest.actions.setDraft(long);
									await frame();
									dispatchKey(editorOf(cardOf(store.node)) || document.body, { key: "Enter" }, "v57");
									await frame();
								} finally {
									interceptAndOptimize = origIntercept;
									store.latest.actions.setDraft("");
									await frame();
								}
								const lenOk = captured !== null && captured.length === long.length && String(captured).indexOf("结尾标记END") > 0;
								beacon("slider-demo", {
									geometry, thumbPct, aria, clicks, clickOk, geomOk,
									longDraft: { sent: long.length, captured: captured === null ? null : String(captured).length, lenOk },
									knobOk, pass: geomOk && clickOk && Boolean(aria) && aria.role === "slider" && aria.tab === "0" && lenOk,
								});
								})().catch((e) => beacon("slider-demo", { error: String(e) }));
								return;
							}
							// 量程滑块自检（宿主下发）：0/10/100 三点的数字是否在框内、是否压住圆钮
							if (cmd.run === "range-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								const keep = store.turns; const keepMode = store.historyMode; const keepFull = store.fullOn;
								const cap = document.querySelector('[data-dpo="turns"]');
								const rail = document.querySelector('[data-dpo="turns-track"]');
								const knob = document.querySelector('[data-dpo="turns-knob"]');
								const num = document.querySelector('[data-dpo="turns-value"]');
								const modeBtn = document.querySelector('[data-dpo="turns-mode"]');
								const R = (el) => { const r = el && el.getBoundingClientRect(); return r ? { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null; };
								const ariaOf = (el) => el ? { role: el.getAttribute("role"), min: el.getAttribute("aria-valuemin"), max: el.getAttribute("aria-valuemax"), now: el.getAttribute("aria-valuenow"), text: el.getAttribute("aria-valuetext"), tab: el.getAttribute("tabindex") } : null;
								// 等滑块过渡真正停稳再量：固定 sleep 偶发踩到过渡中（后台标签页计时器被节流时更明显，实测出过一次 pass=false 假失败）
								const settleKnob = async () => {
									let prev = null; let same = 0;
									for (let i = 0; i < 16; i++) {
										await sleep(60);
										const cur = knob ? String(knob.style.left) : "";
										if (cur === prev) { same += 1; if (same >= 2) return; } else { same = 0; prev = cur; }
									}
								};
								const capR = R(cap); const railR = R(rail);
								const cs = cap ? getComputedStyle(cap) : null;
								const measure = (v, want) => {
									const nr = R(num); const kr = R(knob);
									// 基准必须"活体"：全文态的胶囊比回合态窄，轨道会自适应加宽（实测 64 → 69px）
									const liveRail = R(rail); const liveCap = R(cap);
									const lr = R(rail ? rail.querySelector(".dpo-range-inner") : null);
									const mx = Math.max(1, Number(rail && rail.getAttribute("aria-valuemax")) || 1);
									const got = kr && liveRail ? Math.round(((kr.l + kr.w / 2 - liveRail.l) / Math.max(1, liveRail.w)) * 1000) / 10 : null;
									const wantPct = lr && liveRail ? Math.round(((lr.l - liveRail.l + (v / mx) * lr.w) / Math.max(1, liveRail.w)) * 1000) / 10 : null;
									return {
										value: v, text: num ? String(num.textContent) : null,
										textMatches: num ? String(num.textContent) === String(want) : false,
										numInsideCapsule: Boolean(nr && liveCap && nr.l >= liveCap.l && nr.r <= liveCap.r && nr.t >= liveCap.t && nr.b <= liveCap.b),
										noKnobOverlap: Boolean(nr && kr && nr.l >= kr.r - 0.5),
										knobInsideRail: Boolean(kr && liveRail && kr.l >= liveRail.l - 1 && kr.r <= liveRail.r + 1),
										knobCenterPct: got, wantPct,
										knobPctOk: Boolean(got !== null && wantPct !== null && Math.abs(got - wantPct) <= 1.5),
										knobRect: kr, innerRect: lr, railLive: liveRail, capLive: liveCap, styleLeft: knob ? knob.style.left : null,
									};
								};
								void (async () => {
									const samples = [];
									// ① 回合模式：0 / 5 / 10（量程 0~10）；每次等过渡动画走完再量（left 有 120ms transition）
									store.historyMode = "turns"; store.fullOn = false; emit(); await frame(); await sleep(200);
									for (const v of [0, 5, 10]) { store.turns = v; emit(); await frame(); await sleep(120); await settleKnob(); samples.push(measure(v, String(v))); }
									const turnAria = ariaOf(rail);
									// ② 全文模式：两档 关 / 开
									store.historyMode = "full"; emit(); await frame(); await sleep(200);
									const twoSamples = [];
									for (const v of [0, 1]) { store.fullOn = v === 1; emit(); await frame(); await sleep(120); await settleKnob(); twoSamples.push(measure(v, v === 0 ? L("关") : L("开"))); }
									const fullAria = ariaOf(rail);
									const modeRect = R(modeBtn);
									// ③ 转化按钮：真的点两下（回合 → 全文 → 回合）
									store.historyMode = "turns"; emit(); await frame(); await sleep(120);
									const before = store.historyMode;
									let after = null; let back = null;
									if (modeBtn) { modeBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); await frame(); after = store.historyMode; }
									if (modeBtn) { modeBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); await frame(); back = store.historyMode; }
									// ④ 扁平化与"不挤压输入框"取证
									const st = cs ? { bgImage: cs.backgroundImage, boxShadow: cs.boxShadow, radius: cs.borderRadius, height: cs.height } : null;
									const flat = Boolean(st && st.bgImage === "none" && st.boxShadow === "none" && Math.round(parseFloat(st.height)) === 26);
									const numRect = R(num);
									// 禁用态（档位=off）下 tabIndex 本就该是 -1，断言按状态取值，不把"关着"误判成缺陷
									const capDisabled = cap ? cap.getAttribute("data-disabled") === "true" : false;
									const wantTab = capDisabled ? "-1" : "0";
									const modeFlush = Boolean(modeRect && capR && capR.r - modeRect.r <= 5 && modeRect.h >= capR.h - 6 && (!numRect || modeRect.l >= numRect.r - 1));
									const row = document.querySelector('[data-dpo="controls"]');
									const rowR = R(row);
									// 父链上第一个"真正占位"的祖先（壳里常见 display:contents 包装层，量到的是 0×0）
									let host = row ? row.parentElement : null;
									let hops = 0;
									while (host && hops < 5 && (!host.getBoundingClientRect().width || !host.getBoundingClientRect().height)) { host = host.parentElement; hops += 1; }
									const hostR = R(host);
									const hostCs = host ? getComputedStyle(host) : null;
									const bar = {
										row: rowR, hops,
										host: hostR, hostTag: host ? host.tagName : null, hostClass: host ? String(host.className || "").slice(0, 60) : null,
										hostDisplay: hostCs ? hostCs.display : null, hostAlign: hostCs ? hostCs.alignItems : null,
										bottomAligned: Boolean(rowR && hostR && Math.abs(rowR.b - (hostR.b - (hostCs ? parseFloat(hostCs.paddingBottom) || 0 : 0))) <= 3),
										fitsHeight: Boolean(rowR && hostR && rowR.h <= hostR.h),
									};
									store.turns = keep; store.historyMode = keepMode; store.fullOn = keepFull; emit(); await frame();
									beacon("range-demo", {
										capsule: capR, rail: railR, modeRect, numRect, style: st, bar, turnAria, fullAria, samples, twoSamples,
										disabled: capDisabled, wantTab,
										modeToggle: { before, after, back, flipped: before === "turns" && after === "full" && back === "turns" },
										modeFlush, flat,
										pass: samples.length === 3 && samples.every((s) => s.textMatches && s.numInsideCapsule && s.noKnobOverlap && s.knobInsideRail && s.knobPctOk)
											&& twoSamples.length === 2 && twoSamples.every((s) => s.textMatches && s.numInsideCapsule && s.noKnobOverlap && s.knobInsideRail && s.knobPctOk)
											&& Boolean(turnAria) && turnAria.role === "slider" && turnAria.max === "10" && turnAria.tab === wantTab && turnAria.now === "10"
											&& Boolean(fullAria) && fullAria.max === "1"
											&& flat && modeFlush && bar.bottomAligned && bar.fitsHeight
											&& before === "turns" && after === "full" && back === "turns",
									});
								})().catch((e) => beacon("range-demo", { error: String(e) }));
								return;
							}							// 放行/回退 竞态自检（宿主下发）：用户先终结运行，done 到达时不得再自动发出第二条
							// 提交用"计数桩"（不真发消息），因此对真实会话零副作用；草稿与权限跑完还原。
							if (cmd.run === "release-race-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								void (async () => {
									const actions = store.latest.actions;
									const out = { cases: {}, submits: [], error: null };
									if (!actions || typeof actions.submit !== "function") { beacon("release-race-demo", { error: "no-inputActions" }); return; }
									const realSubmit = actions.submit;
									const realSetDraft = actions.setDraft;
									const keepDraft = draftLive();
									const keepPerm = store.permission;
									actions.submit = function () { out.submits.push({ t: Date.now(), draft: String(draftLive() || "").slice(0, 48) }); return undefined; };
									try {
										// ① 放行原文：只应有放行那一次 submit；done 到达后不得再发
										startRun("DPO-竞态-放行 " + Date.now(), "basic", false);
										const r1 = store.run;
										await sleep(500);
										const n1 = out.submits.length;
										releaseOriginal();
										await sleep(7000);
										out.cases.release = { settled: r1 ? r1.settled : null, submitDelta: out.submits.length - n1, sentFlag: r1 ? r1.sent === true : null, status: r1 ? r1.status : null };
										// ② 确定回退：承诺"不发送任何消息" → 一次 submit 都不该有
										const n2 = out.submits.length;
										startRun("DPO-竞态-回退 " + Date.now(), "basic", false);
										const r2 = store.run;
										await sleep(500);
										rollbackYes();
										await sleep(7000);
										out.cases.rollback = { settled: r2 ? r2.settled : null, submitDelta: out.submits.length - n2, status: r2 ? r2.status : null };
										// ③ 守卫本体：不关流，让 done 真的到达（复现原缺陷场景）——标记已终结后不得自动发送
										const n3 = out.submits.length;
										startRun("DPO-竞态-守卫 " + Date.now(), "basic", false);
										const r3 = store.run;
										await sleep(300);
										if (r3) r3.settled = "test-guard";   // 模拟"用户已终结"而流仍活着
										for (let i = 0; i < 200; i++) { await sleep(150); if (r3 && r3.status !== "running" && r3.status !== "connecting") break; }
										await sleep(800);
										out.cases.guard = { settled: r3 ? r3.settled : null, status: r3 ? r3.status : null, submitDelta: out.submits.length - n3, textChars: r3 ? String(r3.text || "").length : 0 };
									} catch (e) { out.error = String(e); }
									actions.submit = realSubmit;
									try { if (realSetDraft) realSetDraft(keepDraft); } catch (e) { /* noop */ }
									store.permission = keepPerm;
									out.totalSubmits = out.submits.length;
									out.pass = Boolean(out.cases.release && out.cases.release.submitDelta === 1 && out.cases.release.settled === "released")
										&& Boolean(out.cases.rollback && out.cases.rollback.submitDelta === 0 && out.cases.rollback.settled === "rolled-back")
										&& Boolean(out.cases.guard && out.cases.guard.submitDelta === 0 && out.cases.guard.status === "done" && out.cases.guard.textChars > 0);
									beacon("release-race-demo", out);
								})().catch((e) => beacon("release-race-demo", { error: String(e) }));
								return;
							}
							// 悬浮球自检（宿主下发）：收球 → 点球展开（只读）→ 重复发送守卫 → 关闭
							if (cmd.run === "ball-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								void (async () => {
									const fake = { status: "done", tier: "extreme", reasoning: "r", text: "（自检）这是一条已发送的结果正文", request: L("原文"), sessionId: store.viewSessionId, sent: true, firstPaintMs: 100, usage: null, version: 1 };
									store.run = fake;
									store.overlay = Object.assign({}, store.overlay, { open: false, sessionId: store.viewSessionId });
									showBall(fake, true);
									await frame(); await sleep(200);
									beacon("ball-step", { step: "after-show", ballInStore: Boolean(store.ball && store.ball.visible) });
									const ball = document.querySelector('[data-dpo="ball"]');
									const r = ball ? ball.getBoundingClientRect() : null;
									const tone = ball ? getComputedStyle(ball).getPropertyValue("--dpo-ball-tone").trim() : null;
									const label = ball ? String((ball.querySelector('[data-dpo="ball-label"]') || {}).textContent || "") : null;
									beacon("ball-step", { step: "dom", exists: Boolean(ball), tone, label });
									ball && ball.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: r.left + 20, clientY: r.top + 20 }));
									ball && ball.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: r.left + 20, clientY: r.top + 20 }));
									await frame(); await sleep(240);
									beacon("ball-step", { step: "after-click", open: store.overlay.open === true, ballVisible: store.ball.visible === true });
									const panel = document.querySelector('[data-dpo="overlay"]');
									const sentTag = document.querySelector('[data-dpo="sent-tag"]');
									const confirmBtn = document.querySelector('[data-dpo="confirm"]');
									// 防重复发送：已发送态点确认/放行不得改动输入框草稿
									const draftBefore = draftLive();
									try { confirmSubmit(); } catch (e) { beacon("ball-step", { step: "confirm-threw", error: String(e) }); }
									try { releaseOriginal(); } catch (e) { beacon("ball-step", { step: "release-threw", error: String(e) }); }
									await frame();
									const draftAfter = draftLive();
									const guardOk = draftBefore === draftAfter;
									const reopened = Boolean(panel) && Boolean(sentTag) && !confirmBtn;
									beacon("ball-demo", {
										ballExists: Boolean(ball),
										ballRect: r ? { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
										ballTone: tone, ballLabel: label,
										reopened, hasSentTag: Boolean(sentTag), hasConfirm: Boolean(confirmBtn),
										guardOk, draftLen: String(draftAfter || "").length,
										pass: Boolean(ball) && reopened && guardOk && String(tone).indexOf("ff8a3d") >= 0,
									});
									setOverlay({ open: false }); hideBall(); store.run = null; emit();
								})().catch((e) => beacon("ball-demo", { error: String(e) }));
								return;
							}							// 改尺寸自检（宿主下发）：验手柄没被底栏盖住 + 拖拽真的改变尺寸
							if (cmd.run === "resize-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								const keepSize = store.overlaySize ? Object.assign({}, store.overlaySize) : null;
								store.suppressUiPersist = true;
								setOverlay({ open: true, text: "改尺寸自检", fullText: "", src: "demo", sessionId: store.viewSessionId });
								emit();
								window.setTimeout(() => {
									const panel = document.querySelector('[data-dpo="overlay"]');
									const grip = document.querySelector('[data-dpo="resize"]');
									const r0 = panel ? panel.getBoundingClientRect() : null;
									const g = grip ? grip.getBoundingClientRect() : null;
									const hit = g ? document.elementFromPoint(Math.round(g.left + g.width / 2), Math.round(g.top + g.height / 2)) : null;
									const hitIsGrip = Boolean(hit && hit.closest && hit.closest('[data-dpo="resize"]'));
									if (grip && panel && g) {
										const pt = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1, button: 0, clientX: x, clientY: y });
										const cx = g.left + g.width / 2; const cy = g.top + g.height / 2;
										grip.dispatchEvent(pt("pointerdown", cx, cy));
										grip.dispatchEvent(pt("pointermove", cx - 130, cy - 100));
										grip.dispatchEvent(pt("pointerup", cx - 130, cy - 100));
									}
									window.setTimeout(() => {
										const r1 = panel ? panel.getBoundingClientRect() : null;
										const delta = r0 && r1 ? { dw: Math.round(r1.width - r0.width), dh: Math.round(r1.height - r0.height) } : null;
										beacon("resize-demo", {
											exists: Boolean(panel), gripExists: Boolean(grip),
											gripRect: g ? { l: Math.round(g.left), t: Math.round(g.top), w: Math.round(g.width), h: Math.round(g.height) } : null,
											hitIsGrip, hitWhat: hit ? String((hit.getAttribute && hit.getAttribute("data-dpo")) || hit.className || hit.tagName) : null,
											before: r0 ? { w: Math.round(r0.width), h: Math.round(r0.height) } : null,
											after: r1 ? { w: Math.round(r1.width), h: Math.round(r1.height) } : null,
											delta, stored: store.overlaySize || null,
											pass: Boolean(panel && grip && hitIsGrip && delta && delta.dw <= -120 && delta.dw >= -145 && delta.dh <= -90 && delta.dh >= -115),
										});
										store.overlaySize = keepSize;
										store.suppressUiPersist = false;
										setOverlay({ open: false, sessionId: store.viewSessionId });
										emit();
									}, 260);
								}, 300);
								return;
							}
							// 会话隔离自检（宿主下发）：开一个弹窗 → 切到别的会话 → 切回 → 用 DOM 判定
							if (cmd.run === "session-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								const real = store.viewSessionId;
								setOverlay({ open: true, text: "会话隔离自检", fullText: "会话隔离自检", src: "demo", sessionId: real });
								emit();
								window.setTimeout(() => {
									const before = { open: store.overlay.open === true, dom: Boolean(document.querySelector('[data-dpo="overlay"]')), text: store.overlay.text };
									onViewSessionChange("__dpo_other_session__");
									window.setTimeout(() => {
										const away = { open: store.overlay.open === true, dom: Boolean(document.querySelector('[data-dpo="overlay"]')), viewSessionId: store.viewSessionId };
										onViewSessionChange(real);
										window.setTimeout(() => {
											const back = { open: store.overlay.open === true, dom: Boolean(document.querySelector('[data-dpo="overlay"]')), text: store.overlay.text, viewSessionId: store.viewSessionId };
											beacon("session-demo", {
												realSession: real, before, away, back,
												pass: before.dom === true && away.dom === false && back.dom === true && back.text === before.text && away.viewSessionId === "__dpo_other_session__",
											});
											setOverlay({ open: false, sessionId: real });
											store.stash = {};
											emit();
										}, 320);
									}, 320);
								}, 320);
								return;
							}
							// 控件行自检（宿主下发）：量滑块长度/字号/是否换行或被裁 —— 验证"舒适度"是数字而不是感觉
							if (cmd.run === "controls-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								window.setTimeout(() => {
									const box = document.querySelector('[data-dpo="controls"]');
									const tierTrack = document.querySelector('[data-dpo="tier-track"]');
									const permTrack = document.querySelector('[data-dpo="perm-track"]');
									const tierVal = document.querySelector('[data-dpo="tier-value"]');
									const permVal = document.querySelector('[data-dpo="perm-value"]');
									const pill = document.querySelector('[data-dpo="model"]');
									const r = box ? box.getBoundingClientRect() : null;
									const fs = (el) => (el ? getComputedStyle(el).fontSize : null);
									const tw = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null);
									beacon("controls-demo", {
										exists: Boolean(box),
										controls: r ? { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), right: Math.round(r.right) } : null,
										viewport: { w: window.innerWidth, h: window.innerHeight },
										tierTrackW: tw(tierTrack), permTrackW: tw(permTrack),
										trackH: tierTrack ? Math.round(tierTrack.getBoundingClientRect().height) : null,
										fonts: { tierValue: fs(tierVal), permValue: fs(permVal), model: fs(pill) },
										wrapped: Boolean(r) && r.height > 40,
										clipped: box ? box.scrollWidth > box.clientWidth + 1 : null,
										overflowRight: Boolean(r) && r.right > window.innerWidth,
										narrow: store.narrow === true,
									});
								}, 400);
								return;
							}
							// 纯可见性自检（宿主下发）：只开关一次浮层，不跑优化、不改档位、不发消息
							if (cmd.run === "overlay-demo") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								beacon("overlay-demo-start", { token: cmd.token, activeInstance: isActiveInstance(), tier: store.tier, permission: store.permission });
								setOverlay({ open: true, text: "浮层可见性自检（不优化、不发送）", fullText: "", src: "demo" });
								window.setTimeout(() => { beaconOverlayGeom("demo"); }, 300);
								window.setTimeout(() => { setOverlay({ open: false }); beacon("overlay-demo-end", {}); }, 7000);
								return;
							}
							// 用户忙就不抢：优化在跑 / 浮层开着 / 输入框有草稿 → 让路（不消耗 token，稍后再试）
							const busyRun = store.run && (store.run.status === "connecting" || store.run.status === "running");
							const draftBusy = String(draftLive() || "").trim().length > 0;
							if (busyRun || store.overlay.open || draftBusy) {
								beacon("probe-deferred", {
									reason: busyRun ? "run-in-flight" : (store.overlay.open ? "overlay-open" : "draft-non-empty"),
									token: cmd.token, tier: store.tier, permission: store.permission,
								});
								return;
							}
							// 只有明确的 selftest + 显式投递授权才允许跑探针：
							// 探针会做"真投递"验证（会向会话提交带标记的消息），未授权时一律拒绝，
							// 避免"未知命令回落整套探针 → 标记泄漏进真实会话"。
							if (cmd.run !== "selftest") {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								beacon("cmd-unknown", { run: String(cmd.run), token: cmd.token });
								return;
							}
							if (cmd.deliver !== true) {
								lastToken = cmd.token;
								window.__DPO_LAST_TOKEN__ = cmd.token;
								beacon("probe-refused", { token: cmd.token, reason: "no-deliver-grant", hint: "宿主命令需带 deliver:true" });
								return;
							}
							window.__DPO_PROBE_RUNNING__ = true;
							window.__DPO_PROBE_STARTED_AT__ = Date.now();
							lastToken = cmd.token;
							window.__DPO_LAST_TOKEN__ = cmd.token;
							beacon("probe-start", { token: cmd.token, cmdAgeMs: d.cmdAgeMs === undefined ? null : d.cmdAgeMs, tier: store.tier, permission: store.permission });
							runProbe(ctx, cmd.token).catch((e) => {
								window.__DPO_PROBE_RUNNING__ = false;
								store.probeError = String(e);
								emit();
								void post("/report", { plugin: NS, token: cmd.token, kind: "selftest-error", error: String(e), windowStart: Date.now(), windowEnd: Date.now(), steps: [], passed: 0, total: 0 });
							});
						})
						.catch(() => { /* host 未就绪时静默 */ });
				}, 2000);
				return () => window.clearInterval(timer);
			}, NS + ": probe poll");

			// 控制台手测入口（与探针同一套判定真源）
			window.__DPO__ = {
				store,
				labels: () => [...SEND_LABELS],
				interceptKey,
				wouldInterceptClick,
				cardOf,
				editorOf,
				disarm: () => { store.armed = false; return store.armed; },
				arm: () => { store.armed = true; return store.armed; },
				probe: (token) => runProbe(ctx, token || "manual-" + Date.now()),
			};
		};

		return module.exports;
	}
});
