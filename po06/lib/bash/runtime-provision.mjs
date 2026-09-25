/**
 * runtime-provision — 运行时自解析与自带供给。
 * 目标：普通用户不需要手写 D:/other/Git/... 这种机器专属路径。
 * 顺序：env DSH_BASH_PATH → 自带 bundle → Git for Windows 常见位置 → MSYS2 → PATH。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sha256File, validateManifest, verifyRuntime } from "./runtime-layout.mjs";

export const PROVISION_VERSION = "1";

export function candidateRuntimes(options) {
  const o = options || {};
  const env = o.env || {};
  const platform = o.platform || process.platform;
  const bundledRuntimeDir = o.bundledRuntimeDir || null;
  const list = [];
  if (env.DSH_BASH_PATH) list.push({ source: "env", path: env.DSH_BASH_PATH, why: "环境变量 DSH_BASH_PATH 显式指定" });
  if (bundledRuntimeDir) {
    list.push({ source: "bundled", path: join(bundledRuntimeDir, "usr", "bin", platform === "win32" ? "bash.exe" : "bash"), why: "插件自带运行时（无需任何系统依赖）" });
  }
  if (platform === "win32") {
    const pf = env.ProgramFiles || "C:/Program Files";
    const pf86 = env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
    const la = env.LOCALAPPDATA || null;
    for (const base of [pf, pf86]) list.push({ source: "git-for-windows", path: join(base, "Git", "bin", "bash.exe"), why: "已安装 Git for Windows" });
    if (la) list.push({ source: "git-for-windows", path: join(la, "Programs", "Git", "bin", "bash.exe"), why: "已安装 Git for Windows（用户级）" });
    for (const base of ["C:/msys64", "D:/msys64"]) list.push({ source: "msys2", path: join(base, "usr", "bin", "bash.exe"), why: "已安装 MSYS2" });
    list.push({ source: "path", path: "bash.exe", why: "PATH 上的 bash" });
  } else {
    list.push({ source: "path", path: "/bin/bash", why: "系统 bash" });
  }
  return list.map((c) => ({ ...c, explicit: c.source === "env" || c.source === "bundled" }));
}

/**
 * 从 PATH 上的 git 反推运行时位置。
 * 必要性（实测）：本机 Git 在 D:/other/Git，不在 Program Files，标准路径扫描全部落空；
 * 而 git 本身在 PATH 上，可由 git --exec-path 推出 <GitRoot>，再找 <GitRoot>/bin/bash.exe。
 */
export function discoverFromGit(spawn) {
  const run = spawn || spawnSync;
  let r;
  try { r = run("git", ["--exec-path"], { encoding: "utf8", timeout: 15000 }); }
  catch (e) { return null; }
  if (!r || r.error || r.status !== 0) return null;
  const execPath = String(r.stdout || "").trim().replaceAll("/", "\\");
  if (!execPath) return null;
  const parts = execPath.split("\\");
  const idx = parts.lastIndexOf("mingw64");
  if (idx <= 0) return null;
  const root = parts.slice(0, idx).join("\\");
  return {
    source: "git-on-path",
    root,
    why: "PATH 上的 git 指向 " + root + "（非标准安装位置也能发现）",
    candidates: [join(root, "bin", "bash.exe"), join(root, "usr", "bin", "bash.exe")]
  };
}

export function probeRuntime(path, spawn) {
  const run = spawn || spawnSync;
  if (!path) return { ok: false, path: null, reason: "路径为空" };
  const isBare = !path.includes("/") && !path.includes("\\");
  if (!isBare && !existsSync(path)) return { ok: false, path, reason: "文件不存在" };
  let r;
  try { r = run(path, ["--version"], { encoding: "utf8", timeout: 20000 }); }
  catch (e) { return { ok: false, path, reason: "启动异常：" + String(e && e.message || e).slice(0, 80) }; }
  if (r.error) return { ok: false, path, reason: "无法启动：" + String(r.error.message).slice(0, 80) };
  const first = String(r.stdout || "").split("\n")[0].trim();
  if (r.status !== 0 || !/bash/i.test(first)) return { ok: false, path, reason: "不是可用的 bash（exit=" + r.status + "）" + (String(r.stderr || "").slice(0, 80) ? "：" + String(r.stderr).slice(0, 80) : "") };
  return { ok: true, path, version: first };
}

/** 解析出可用运行时；全部失败时给出面向用户的修复步骤。 */
export function resolveBashRuntime(options) {
  const o = options || {};
  const candidates = candidateRuntimes(o);
  const probes = [];
  for (const c of candidates) {
    const p = probeRuntime(c.path, o.spawn);
    probes.push({ ...c, ...p });
    if (p.ok) return { ok: true, path: p.path, version: p.version, source: c.source, why: c.why, probes };
  }
  const fromGit = discoverFromGit(o.spawn);
  if (fromGit) {
    for (const p of fromGit.candidates) {
      const probe = probeRuntime(p, o.spawn);
      probes.push({ source: fromGit.source, path: p, why: fromGit.why, ...probe });
      if (probe.ok) return { ok: true, path: probe.path, version: probe.version, source: fromGit.source, why: fromGit.why, probes };
    }
  }
  return {
    ok: false,
    path: null,
    source: null,
    probes,
    repair: [
      "本机没有找到可用的 Bash 运行时（已依次尝试：" + candidates.map((c) => c.source).join(" → ") + "）",
      "方式一：安装 Git for Windows（含 Git Bash）后重试；安装后无需再配置，插件会自动发现",
      "方式二：让插件自带运行时：把受控运行时解包到 <插件数据目录>/runtime/（含 usr/bin/bash.exe 与 manifest.json），插件会优先使用它",
      "方式三：设置环境变量 DSH_BASH_PATH 指向 bash.exe（明确指定则优先使用）"
    ]
  };
}

/** 从发布包/自带 bundle 供给运行时：先校验清单，再复制到目标目录。 */
export function provisionFromBundle(options) {
  const o = options || {};
  const bundleDir = o.bundleDir;
  const targetDir = o.targetDir;
  if (!bundleDir || !targetDir) throw new TypeError("bundleDir / targetDir required");
  const manifestPath = join(bundleDir, "manifest.json");
  if (!existsSync(manifestPath)) return { ok: false, errno: "BUNDLE_MANIFEST_MISSING", repair: ["bundle 缺少 manifest.json：" + bundleDir] };
  let manifest;
  try { manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8"))); }
  catch (e) { return { ok: false, errno: "BUNDLE_MANIFEST_INVALID", repair: ["修复 " + manifestPath + "：" + String(e && e.message || e)] }; }
  const verified = verifyRuntime({ manifest, runtimeRoot: bundleDir });
  if (!verified.ok) return { ok: false, errno: "BUNDLE_INTEGRITY_FAILED", problems: verified.problems, repair: ["bundle 与清单不符，拒绝安装（不要绕过校验）：" + JSON.stringify(verified.problems.slice(0, 2))] };
  rmSync(targetDir, { recursive: true, force: true });
  const copyTree = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      const f = join(from, entry);
      const t = join(to, entry);
      if (statSync(f).isDirectory()) copyTree(f, t);
      else copyFileSync(f, t);
    }
  };
  copyTree(bundleDir, targetDir);
  const bashPath = join(targetDir, manifest.bash);
  return { ok: true, targetDir, bashPath, version: manifest.version, fileCount: manifest.files.length, bashExists: existsSync(bashPath) };
}
