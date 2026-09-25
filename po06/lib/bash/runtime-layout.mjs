/**
 * runtime-layout — 内置 Bash runtime 的安装布局、版本清单与卸载边界。
 *
 * 三条硬约束：
 * 1) 隔离：只读写 <pluginRoot> 与 per-user data 目录；**绝不修改 PATH**，绝不写系统目录。
 * 2) 可定位：给定仓库与目标三元组，能解析出 runtime 根与 bash 绝对路径，并验证清单。
 * 3) 卸载安全：卸载计划只允许落在显式白名单根内；越界、根外、reparse point 一律拒绝。
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, rmSync, rmdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const LAYOUT_VERSION = "1";
export const SUPPORTED_TARGETS = Object.freeze(["win32-x64", "win32-arm64", "linux-x64", "darwin-arm64"]);

export function detectPlatformArch(platform, arch) {
  const p = platform === undefined ? process.platform : platform;
  const a = arch === undefined ? process.arch : arch;
  const key = p + "-" + a;
  if (!SUPPORTED_TARGETS.includes(key)) {
    throw new Error("UNSUPPORTED_TARGET: " + key + " (supported: " + SUPPORTED_TARGETS.join(", ") + ")");
  }
  return Object.freeze({ platform: p, arch: a, key });
}

function requireAbsolute(value, field) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(field + " must be a non-empty string");
  if (!isAbsolute(value)) throw new TypeError(field + " must be absolute: " + value);
  return resolve(value);
}

/** 布局：runtime 在 <pluginRoot>/runtimes/<target>/；用户数据在用户目录，不在插件目录内。 */
export function resolveLayout(input) {
  const platform = input.platform === undefined ? process.platform : input.platform;
  const arch = input.arch === undefined ? process.arch : input.arch;
  const target = detectPlatformArch(platform, arch);
  const pluginRoot = requireAbsolute(input.pluginRoot, "pluginRoot");
  const userDataRoot = requireAbsolute(input.userDataRoot, "userDataRoot");
  const runtimeRoot = join(pluginRoot, "runtimes", target.key);
  const pluginDataRoot = join(userDataRoot, "plugin-data");
  return Object.freeze({
    layoutVersion: LAYOUT_VERSION,
    target,
    pluginRoot,
    runtimeRoot,
    manifestPath: join(runtimeRoot, "manifest.json"),
    // MSYS 布局：usr/bin/bash.exe（与 Runtime 选型的实测布局一致）
    bashPath: join(runtimeRoot, "usr", "bin", platform === "win32" ? "bash.exe" : "bash"),
    pluginDataRoot,
    userDataRoot
  });
}

const SHA256_RE = /^[0-9a-f]{64}$/;

export function validateManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("manifest must be an object");
  if (typeof raw.version !== "string" || raw.version.length === 0) throw new TypeError("manifest.version required");
  if (typeof raw.target !== "string" || !SUPPORTED_TARGETS.includes(raw.target)) throw new TypeError("manifest.target unsupported: " + String(raw.target));
  if (!Array.isArray(raw.files) || raw.files.length === 0) throw new TypeError("manifest.files must be a non-empty array");
  for (const f of raw.files) {
    if (!f || typeof f !== "object") throw new TypeError("manifest file entry must be an object");
    if (typeof f.path !== "string" || f.path.length === 0) throw new TypeError("file.path required");
    if (isAbsolute(f.path) || f.path.includes("..")) throw new TypeError("file.path must be runtime-relative without ..: " + f.path);
    if (typeof f.sha256 !== "string" || !SHA256_RE.test(f.sha256)) throw new TypeError("file.sha256 must be 64 hex chars: " + f.path);
  }
  if (typeof raw.bash !== "string" || raw.bash.length === 0) throw new TypeError("manifest.bash required");
  if (isAbsolute(raw.bash) || raw.bash.includes("..")) throw new TypeError("manifest.bash must be runtime-relative without ..");
  if (typeof raw.licenses !== "string" || raw.licenses.length === 0) throw new TypeError("manifest.licenses required (再分发义务)");
  return Object.freeze({ version: raw.version, target: raw.target, files: Object.freeze(raw.files.slice()), bash: raw.bash, licenses: raw.licenses });
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

/** 验证清单与实际文件一致；任一不符即失败（不降级、不忽略）。 */
export function verifyRuntime({ manifest, runtimeRoot, hash = sha256File }) {
  const checked = [];
  const problems = [];
  for (const f of manifest.files) {
    const abs = join(runtimeRoot, f.path);
    if (!existsSync(abs)) { problems.push({ path: f.path, problem: "missing" }); continue; }
    const actual = hash(abs);
    if (actual !== f.sha256) { problems.push({ path: f.path, problem: "sha256-mismatch", expected: f.sha256, actual }); continue; }
    checked.push(f.path);
  }
  const bashAbs = join(runtimeRoot, manifest.bash);
  if (!existsSync(bashAbs)) problems.push({ path: manifest.bash, problem: "bash-missing" });
  return Object.freeze({ ok: problems.length === 0, checked, problems, bashPath: bashAbs });
}

/* ── 卸载边界 ─────────────────────────────────────────────────────── */

function insideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

/** 卸载计划：只允许落在 allowedRoots 内；用户数据默认保留。 */
export function buildUninstallPlan({ pluginRoot, runtimeRoot, pluginDataRoot, removeUserData = false }) {
  const roots = [];
  const plugin = requireAbsolute(pluginRoot, "pluginRoot");
  const runtime = requireAbsolute(runtimeRoot, "runtimeRoot");
  const data = requireAbsolute(pluginDataRoot, "pluginDataRoot");
  if (!insideRoot(plugin, runtime)) throw new Error("runtimeRoot must live inside pluginRoot");
  roots.push(runtime);
  const keep = [];
  if (removeUserData) roots.push(data); else keep.push(data);
  return Object.freeze({
    remove: Object.freeze(roots.slice()),
    keep: Object.freeze(keep.slice()),
    neverTouched: Object.freeze(["system PATH", "system directories", "user files outside the plugin data root"]),
    note: removeUserData ? "用户数据被显式要求删除" : "用户数据默认保留（卸载不删用户文件）"
  });
}

/** 执行前逐条校验：越界、根目录本身、待删路径本身是 reparse point 一律拒绝。 */
export function assertSafeRemoval(paths, allowedRoots) {
  const roots = allowedRoots.map((r) => requireAbsolute(r, "allowedRoot"));
  const approved = [];
  const refused = [];
  for (const p of paths) {
    const abs = requireAbsolute(p, "removal path");
    const isRootItself = roots.includes(abs);
    const parentOfRoot = roots.some((r) => insideRoot(abs, r) && abs !== r);
    const isReparse = existsSync(abs) ? lstatSync(abs).isSymbolicLink() : false;
    const insideSomeRoot = roots.some((r) => insideRoot(r, abs));
    if (isRootItself || parentOfRoot || isReparse || !insideSomeRoot) {
      refused.push({ path: abs, isRootItself, parentOfRoot, isReparse, insideSomeRoot });
    } else approved.push(abs);
  }
  return Object.freeze({ approved: Object.freeze(approved), refused: Object.freeze(refused) });
}


/** 执行卸载：只删除 approved 内的内容，且根目录本身保留为空壳。 */
export function executeUninstall(paths, allowedRoots) {
  const { approved, refused } = assertSafeRemoval(paths, allowedRoots);
  if (refused.length > 0) throw new Error("UNSAFE_REMOVAL_REFUSED: " + JSON.stringify(refused));
  const removed = [];
  const unlinked = [];
  for (const abs of approved) {
    for (const child of existsSync(abs) ? readdirSync(abs) : []) {
      const target = join(abs, child);
      // 关键安全性质：目录内的 reparse point（junction/symlink）**只解除链接**，
      // 绝不递归进入目标——否则一个指向 C:\\Windows 的 junction 会被连带删除。
      if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
        try { rmSync(target, { recursive: false, force: true }); }
        catch { rmdirSync(target); }
        unlinked.push(target);
      } else {
        rmSync(target, { recursive: true, force: true });
        removed.push(target);
      }
    }
  }
  return Object.freeze({ removed: Object.freeze(removed), unlinkedLinks: Object.freeze(unlinked), refused: Object.freeze([]) });
}

export function assertPathUntouched(path) {
  return { path, exists: existsSync(path) };
}
