/**
 * workspace-semantics — 统一 Windows 路径与 Bash 路径映射、工作区边界、编码与临时目录策略。
 * 只做词法映射与边界判定；实际访问授权由宿主沙箱负责（本层不替代沙箱）。
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

export const WORKSPACE_SEMANTICS_VERSION = "1";

function sepOf(platform) { return platform === "win32" ? sep : "/"; }
function norm(p) { return String(p).replaceAll("/", sep); }

export function createWorkspace(input) {
  const i = input || {};
  const hostPlatform = i.hostPlatform === undefined ? process.platform : i.hostPlatform;
  if (typeof i.hostRoot !== "string" || !isAbsolute(i.hostRoot)) throw new TypeError("hostRoot must be absolute");
  if (typeof i.bashRoot !== "string" || !i.bashRoot.startsWith("/")) throw new TypeError("bashRoot must be an absolute POSIX path");
  return Object.freeze({
    version: WORKSPACE_SEMANTICS_VERSION,
    hostPlatform,
    hostRoot: resolve(i.hostRoot),
    bashRoot: i.bashRoot.replace(/\/+$/, "") || "/",
    tempLeaf: i.tempLeaf === undefined ? ".dsh-tmp" : String(i.tempLeaf)
  });
}

function inside(ws, abs) {
  const rel = relative(ws.hostRoot, abs);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

/** 宿主 → Bash：越界或歧义一律拒绝，返回结构化原因。 */
export function toBashPath(ws, hostPath) {
  const raw = String(hostPath === undefined || hostPath === null ? "" : hostPath);
  if (raw.length === 0) return { ok: false, reason: "EMPTY_PATH" };
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(ws.hostRoot, raw);
  if (!inside(ws, abs)) return { ok: false, reason: "OUTSIDE_WORKSPACE", path: abs, root: ws.hostRoot };
  const rel = relative(ws.hostRoot, abs);
  const parts = rel === "" ? [] : rel.split(sep);
  return { ok: true, hostPath: abs, bashPath: [ws.bashRoot, ...parts].join("/") };
}

/** Bash → 宿主：只接受 bashRoot 前缀且不逃逸。 */
export function toHostPath(ws, bashPath) {
  const raw = String(bashPath === undefined || bashPath === null ? "" : bashPath).replaceAll("\\", "/");
  if (!raw.startsWith("/")) return { ok: false, reason: "NOT_ABSOLUTE_POSIX", path: raw };
  const prefix = ws.bashRoot === "/" ? "/" : ws.bashRoot + "/";
  if (raw !== ws.bashRoot && !raw.startsWith(prefix)) return { ok: false, reason: "OUTSIDE_WORKSPACE", path: raw, root: ws.bashRoot };
  const rest = raw === ws.bashRoot ? "" : raw.slice(prefix.length);
  const abs = rest === "" ? ws.hostRoot : resolve(ws.hostRoot, ...rest.split("/"));
  if (!inside(ws, abs)) return { ok: false, reason: "OUTSIDE_WORKSPACE", path: raw, root: ws.bashRoot };
  return { ok: true, hostPath: abs, bashPath: raw };
}

/** 相对路径（Bash 视角）：用于在子目录里引用工作区内的其他位置。 */
export function relativeBashPath(ws, fromHostDir, toHostTarget) {
  const from = toBashPath(ws, fromHostDir);
  const to = toBashPath(ws, toHostTarget);
  if (!from.ok) return from;
  if (!to.ok) return to;
  const fromParts = from.bashPath.split("/").filter(Boolean);
  const toParts = to.bashPath.split("/").filter(Boolean);
  let n = 0;
  while (n < fromParts.length && n < toParts.length && fromParts[n] === toParts[n]) n += 1;
  const ups = fromParts.length - n;
  const rel = [...Array(ups).fill(".."), ...toParts.slice(n)].join("/");
  return { ok: true, from: from.bashPath, to: to.bashPath, relative: rel === "" ? "." : rel };
}

/** 临时目录：一律落在工作区内、按 runId 隔离，便于清理与边界约束。 */
export function tempDirFor(ws, runId) {
  const id = String(runId === undefined || runId === null ? "" : runId);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) throw new TypeError("runId must be [A-Za-z0-9._-]{1,64}");
  const hostPath = resolve(ws.hostRoot, ws.tempLeaf, id);
  const mapped = toBashPath(ws, hostPath);
  if (!mapped.ok) throw new Error("temp dir escaped workspace: " + mapped.reason);
  return Object.freeze({ hostPath, bashPath: mapped.bashPath, cleanup: "删除 " + ws.tempLeaf + " 下的该 runId 目录；不改动工作区其它内容" });
}

/* ── 编码策略 ───────────────────────────────────────────────────── */

export const ENCODING_POLICY = Object.freeze({
  defaultEncoding: "utf-8",
  bom: "保留检测结果并去除 BOM 后再交给模型；写回时不主动添加 BOM",
  newline: "原样保留（可能为 CRLF）；跨平台比较需显式处理",
  invalidBytes: "诊断（invalid-bytes / window-started-mid-codepoint），不静默替换",
  rule: "路径与内容一律按字节读写；仅在需要文本时解码"
});

export function decodeText(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  const text = body.toString("utf8");
  const crlf = (text.match(/\r\n/g) || []).length;
  const bareLf = (text.match(/(?<!\r)\n/g) || []).length;
  const newline = crlf > 0 && bareLf > 0 ? "mixed" : crlf > 0 ? "crlf" : "lf";
  const hasReplacement = text.includes("\uFFFD");
  return Object.freeze({
    text: hasBom ? text.normalize("NFC") : text,
    encoding: hasBom ? "utf-8-bom" : "utf-8",
    hadBom: hasBom,
    newline,
    invalidBytesSuspected: hasReplacement,
    byteLength: bytes.length,
    note: hasReplacement ? "文本含 U+FFFD：可能是非法字节或截断切在多字节序列中间；需结合字节级诊断判断" : null
  });
}
