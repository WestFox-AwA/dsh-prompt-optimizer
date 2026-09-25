/**
 * runtime-integrity — 运行时完整性校验、版本升级、失败回滚与许可证清单。
 *
 * 两条硬性质：
 * 1) 校验失败 = 阻止运行，并给出可操作的修复路径（哪个文件、期望哈希、从哪来、下一步做什么）。
 * 2) 升级失败 = 旧版本仍然可用：版本目录不覆盖，指针原子切换 + 读回校验 + 失败自动回滚。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { verifyRuntime as defaultVerifyRuntime } from "./runtime-layout.mjs";

export const INTEGRITY_VERSION = "1";

/* ── 校验失败 → 阻止运行 + 修复路径 ─────────────────────────────── */

export function repairSteps(problems, { versionsRoot, version, sourceHint }) {
  const steps = [];
  const root = join(versionsRoot, "versions", version);
  for (const p of problems) {
    if (p.problem === "sha256-mismatch") {
      steps.push("文件 " + p.path + " 内容与清单不符（期望 sha256 " + p.expected + "，实际 " + p.actual + "）");
    } else {
      steps.push("文件 " + p.path + " 缺失或不可读");
    }
  }
  steps.push("修复方式一：删除并重新解包版本目录 " + root + "（" + (sourceHint || "从官方归档按清单 sha256 校验后解包") + "）");
  steps.push("修复方式二：若你确认是本地改动，请更新 " + join(root, "manifest.json") + " 中的 sha256 后再激活");
  steps.push("修复后重新执行激活：activate({ versionsRoot: '" + versionsRoot + "', version: '" + version + "' })");
  steps.push("在修复成功前，受管运行入口会持续拒绝启动（RUNTIME_INTEGRITY_FAILED）");
  return steps;
}

export function verifyOrRefuse({ manifest, runtimeRoot, versionsRoot, version, hash, sourceHint }) {
  const verified = defaultVerifyRuntime({ manifest, runtimeRoot, hash });
  if (verified.ok) return { ok: true, bashPath: verified.bashPath, checked: verified.checked };
  const repair = repairSteps(verified.problems, { versionsRoot, version, sourceHint });
  return { ok: false, errno: "RUNTIME_INTEGRITY_FAILED", problems: verified.problems, repair, runtimeRoot, version };
}

/** 受管运行入口：校验不通过就抛错，绝不启动。 */
export function requireRunnable(options) {
  const r = verifyOrRefuse(options);
  if (!r.ok) {
    const error = new Error("RUNTIME_INTEGRITY_FAILED: " + r.problems.map((p) => p.path + " (" + p.problem + ")").join(", "));
    error.code = "RUNTIME_INTEGRITY_FAILED";
    error.problems = r.problems;
    error.repair = r.repair;
    throw error;
  }
  return r.bashPath;
}

/* ── 版本目录 + 激活指针 ───────────────────────────────────────── */

export const defaultIo = {
  exists: (p) => existsSync(p),
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, data) => writeFileSync(p, data),
  rename: (a, b) => { mkdirSync(join(b, ".."), { recursive: true }); renameSync(a, b); },
  remove: (p) => rmSync(p, { recursive: true, force: true }),
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  copy: (a, b) => copyFileSync(a, b),
  list: (p) => (existsSync(p) ? readdirSync(p) : [])
};

export function versionRoot(versionsRoot, version) { return join(versionsRoot, "versions", version); }
export function activePointerPath(versionsRoot) { return join(versionsRoot, "active.json"); }

export function readActive(versionsRoot, io = defaultIo) {
  const p = activePointerPath(versionsRoot);
  if (!io.exists(p)) return null;
  try {
    const parsed = JSON.parse(io.readFile(p));
    if (!parsed || typeof parsed.version !== "string") return { corrupted: true, raw: null };
    return parsed;
  } catch (e) { return { corrupted: true, raw: String(e && e.message || e) }; }
}

/**
 * 激活一个版本：先校验候选，再原子切换指针，再读回确认；任何一步失败都恢复原指针。
 * 版本目录从不被覆盖写，因此失败升级不会破坏旧版本。
 */
export function activate({ versionsRoot, version, manifestLoader, hash, sourceHint, io = defaultIo, failOnReadback = false }) {
  const candidateRoot = versionRoot(versionsRoot, version);
  const stages = [];
  const before = readActive(versionsRoot, io);
  stages.push({ stage: "read-current", active: before ? before.version : null });

  if (!io.exists(candidateRoot)) {
    return { ok: false, stage: "candidate-missing", activeVersion: before ? before.version : null, errno: "CANDIDATE_MISSING", repair: ["版本目录不存在：" + candidateRoot] };
  }
  let manifest;
  try { manifest = manifestLoader(candidateRoot); }
  catch (e) {
    return { ok: false, stage: "manifest-invalid", activeVersion: before ? before.version : null, errno: "MANIFEST_INVALID", problems: [{ problem: "manifest: " + String(e && e.message || e) }], repair: ["修复 " + join(candidateRoot, "manifest.json") + " 后重试"] };
  }
  const checked = verifyOrRefuse({ manifest, runtimeRoot: candidateRoot, versionsRoot, version, hash, sourceHint });
  stages.push({ stage: "verify-candidate", ok: checked.ok, problems: checked.problems || [] });
  if (!checked.ok) {
    return { ok: false, stage: "verify-candidate", activeVersion: before ? before.version : null, errno: checked.errno, problems: checked.problems, repair: checked.repair, stages };
  }

  const pointer = activePointerPath(versionsRoot);
  const next = { version, activatedAt: new Date().toISOString(), previous: before && before.version ? before.version : null };
  const tmp = pointer + ".tmp";
  try {
    io.mkdir(versionsRoot);
    io.writeFile(tmp, JSON.stringify(next));
    if (before) io.copy(pointer, pointer + ".bak");
    io.rename(tmp, pointer);
    stages.push({ stage: "switch-pointer", ok: true });
  } catch (e) {
    try { io.remove(tmp); } catch {}
    stages.push({ stage: "switch-pointer", ok: false, error: String(e && e.message || e) });
    return { ok: false, stage: "switch-pointer", activeVersion: before ? before.version : null, errno: "POINTER_WRITE_FAILED", repair: ["指针写入失败；旧指针未被改动（active=" + (before ? before.version : "none") + "）", "磁盘/权限修复后重试激活"], stages };
  }

  const readback = readActive(versionsRoot, io);
  const bad = failOnReadback || !readback || readback.corrupted || readback.version !== version;
  stages.push({ stage: "readback", ok: !bad, readback: readback ? readback.version : null });
  if (bad) {
    let restored = false;
    if (before) { try { io.copy(pointer + ".bak", pointer); restored = true; } catch (e) { restored = false; } }
    else { try { io.remove(pointer); restored = true; } catch (e) { restored = false; } }
    return { ok: false, stage: "readback", activeVersion: restored && before ? before.version : null, errno: "READBACK_MISMATCH", rolledBack: restored, repair: ["指针读回不一致，已" + (restored ? "回滚到 " + (before ? before.version : "无活动版本") : "尝试回滚但失败，请人工检查 " + pointer), "检查磁盘写入与杀毒软件拦截后重试"], stages };
  }
  return { ok: true, activeVersion: version, previousVersion: next.previous, stages };
}

/** 显式回滚到指针里记录的上一版本（失败升级后的救援入口）。 */
export function rollback({ versionsRoot, io = defaultIo }) {
  const active = readActive(versionsRoot, io);
  if (!active || active.corrupted) return { ok: false, errno: "NO_ACTIVE_POINTER" };
  const pointer = activePointerPath(versionsRoot);
  if (io.exists(pointer + ".bak")) {
    io.copy(pointer + ".bak", pointer);
    const after = readActive(versionsRoot, io);
    return { ok: true, rolledBackTo: after ? after.version : null, from: active.version };
  }
  if (active.previous) {
    const next = { version: active.previous, activatedAt: new Date().toISOString(), previous: null, rolledBackFrom: active.version };
    io.writeFile(pointer, JSON.stringify(next));
    return { ok: true, rolledBackTo: active.previous, from: active.version };
  }
  return { ok: false, errno: "NO_PREVIOUS_VERSION" };
}

/* ── 许可证清单（再分发义务） ─────────────────────────────────── */

export function licenseInventory({ versionRootPath, manifest, io = defaultIo }) {
  const root = join(versionRootPath, manifest.licenses);
  if (!io.exists(root)) {
    return { ok: false, errno: "LICENSE_ROOT_MISSING", root, notice: "缺少再分发所需的许可证目录：" + root + "；在补齐前不得分发该运行时" };
  }
  const entries = io.list(root).slice().sort();
  const notice = [
    "本运行时随附第三方许可证，位于 " + root + "（共 " + entries.length + " 项）。",
    "运行时本体（msys2-runtime / bash）为 GPL-3.0-or-later：再分发必须随附许可证文本并提供对应源码获取方式。",
    "清单来源：版本清单位于 " + join(versionRootPath, "manifest.json") + "，其 files[].sha256 为该版本的完整性依据。"
  ].join("\n");
  return { ok: true, root, count: entries.length, entries, notice };
}
