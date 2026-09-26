// Test port based on the host's Win32 Job Object primitives.
// 与上一版的关键差别：终止靠作业句柄（Job），不靠 taskkill /T 的父链遍历——
// 实测 MSYS 的 fork 会让 sleep.exe 脱离父链，taskkill /T 杀不掉它。
import { openSync, closeSync, readFileSync } from "node:fs";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

// ── 位置无关地找宿主的 Win32 Job 原语（0.7.4 修）────────────────────────
// ⚠ 这里以前写的是**作者本机的绝对路径**：
//     file:///C:/Users/<打包者>/AppData/Roaming/npm/.../dsh-win32-process/lib/index.js
//   而且是**顶层 await import** ⇒ 别人机器上该 import 直接抛 ⇒ 本模块加载失败 ⇒
//   index.js 的 load('pg-jobport.mjs') 落到 catch ⇒ **每次调用都回「插件运行时模块加载失败」**。
//   工具在工具表里、却完全跑不动——外部用户反馈的"硬编码路径导致不可用"就是这一处。
// 现在改成：多种候选位置依次尝试；**全失败也不抛**，改为降级到 taskkill 路径（见文件底部），
// 保证任何机器上至少能用。
function candidateRoots() {
  const out = [];
  const push = (v) => { if (v && typeof v === "string" && !out.includes(v)) out.push(v); };
  push(process.env.DSH_CHECKOUT);
  if (process.env.APPDATA) push(join(process.env.APPDATA, "npm"));
  // 从宿主入口脚本推导：argv[1] 通常形如 <root>/node_modules/@deepseek-ai/dsh/...
  const argv1 = process.argv && process.argv[1];
  if (argv1) {
    const m = /^(.*)[\\/]node_modules[\\/]@deepseek-ai[\\/]/.exec(argv1);
    if (m) push(m[1]);
  }
  try { push(join(dirname(process.execPath), "node_modules")); } catch { /* ignore */ }
  return out;
}

const REL_WIN32 = join("node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-win32-process", "lib", "index.js");

async function loadWin32() {
  const tried = [];
  try {
    const mod = await import("@deepseek-ai/dsh-win32-process");
    return { mod, via: "bare", tried };
  } catch (e) {
    tried.push("bare:" + String((e && e.code) || (e && e.message) || e).slice(0, 60));
  }
  for (const root of candidateRoots()) {
    try {
      const mod = await import(pathToFileURL(join(root, REL_WIN32)).href);
      return { mod, via: root, tried };
    } catch (e) {
      tried.push(root + ":" + String((e && e.code) || "").slice(0, 24));
    }
  }
  return { mod: null, via: null, tried };
}

const found = await loadWin32();
/** 兼容旧引用：拿不到时为 null，只有 win32 版实现会用到。 */
const win32 = found.mod;
/** 排障/自测开关：置 1 强制走降级路径（验证"没有 win32 原语时仍可用"）。 */
const forceFallback = process.env.DSH_BASH_FORCE_FALLBACK === "1";
/** win32 Job 原语；**拿不到时为 null**（此时走降级实现，而不是让模块挂掉）。 */
export const jobApi = (!forceFallback && found.mod) ? found.mod.loadWin32ProcessBindings() : null;
export const jobPortMode = jobApi ? "win32-job" : "fallback-taskkill";
export const jobPortDiagnostics = { via: found.via, tried: found.tried };
if (found.mod) {
  try { found.mod.probeCurrentTokenJobSupport(jobApi); } catch { /* 诊断用，失败不影响可用性 */ }
}

/** 独立扫描：按命令行特征找进程，与父链无关。 */
export function sweepByCommandLine(marker) {
  const ps = "Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*" + marker + "*') -and ($_.Name -like 'sleep*' -or $_.Name -like 'bash*') } | ForEach-Object { '{\"pid\":' + $_.ProcessId + ',\"ppid\":' + $_.ParentProcessId + ',\"name\":\"' + $_.Name + '\",\"created\":\"' + $_.CreationDate + '\"}' }";
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 30000 });
  const text = (r.stdout || "").trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function createJobPort({ cwd, makePaths }) {
  if (jobApi) return createWin32JobPort({ cwd, makePaths });
  return createFallbackJobPort({ cwd, makePaths });
}

/**
 * 降级版（0.7.4）：拿不到宿主的 Win32 Job 原语时使用（别人的机器上很常见）。
 * 普通 spawn + taskkill /T /F 终止整棵树。
 * ⚠ 已知弱点：MSYS 的 fork 会让子进程脱离父链，taskkill /T 可能漏杀个别孙进程——
 *   这恰恰是 win32 作业对象要解决的问题。但"偶尔漏杀"远好于"工具完全跑不起来"：
 *   可用性优先，能力按环境浮动。
 */
function createFallbackJobPort({ cwd, makePaths }) {
  let counter = 0;
  return {
    graceMs: 3000,
    async spawn(request) {
      const paths = makePaths(++counter);
      const stdoutFd = openSync(paths.stdout, "w");
      const stderrFd = openSync(paths.stderr, "w");
      let child;
      try {
        child = nodeSpawn(request.command, request.args || [], {
          cwd: request.cwd || cwd,
          env: { ...process.env, ...(request.env || {}) },
          stdio: ["ignore", stdoutFd, stderrFd],
          windowsHide: true,
        });
      } finally {
        closeSync(stdoutFd); closeSync(stderrFd);
      }
      let exited = false;
      const done = new Promise((resolve) => {
        child.on("exit", (code, signal) => resolve({ exitCode: typeof code === "number" ? code : undefined, signal: signal || null }));
        child.on("error", (e) => resolve({ exitCode: undefined, signal: null, error: String((e && e.message) || e) }));
      });
      done.then(() => { exited = true; });
      const limit = Number(request.stdoutMaxBytes || 4096);
      const bound = (file) => {
        try {
          const buf = readFileSync(file);
          if (buf.length <= limit) return { bytes: buf, truncated: false };
          return { bytes: buf.subarray(buf.length - limit), truncated: true, spillPath: file };
        } catch { return { bytes: Buffer.alloc(0), truncated: false }; }
      };
      return {
        pid: child.pid,
        done,
        terminate() {
          try { spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 15000 }); } catch { /* best effort */ }
          try { child.kill("SIGKILL"); } catch { /* best effort */ }
        },
        async waitForExit(ms) {
          const until = Date.now() + Number(ms || 3000);
          while (!exited && Date.now() < until) await new Promise((r) => setTimeout(r, 40));
          return exited;
        },
        output() {
          const out = bound(paths.stdout);
          const err = bound(paths.stderr);
          return {
            stdoutBytes: out.bytes, stdoutTruncated: out.truncated, stdoutSpillPath: out.spillPath,
            stderrBytes: err.bytes, stderrTruncated: err.truncated, stderrSpillPath: err.spillPath,
          };
        },
      };
    },
  };
}

/** win32 作业对象版（原实现）：终止靠 Job，MSYS 的 fork 逃不掉。 */
function createWin32JobPort({ cwd, makePaths }) {
  let counter = 0;
  return {
    async spawn(request) {
      const paths = makePaths(++counter);
      const stdinFd = openSync("\\\\.\\NUL", "r");
      const stdoutFd = openSync(paths.stdout, "w");
      const stderrFd = openSync(paths.stderr, "w");
      let spawned;
      try {
        spawned = win32.spawnCurrentTokenJobProcess(jobApi, {
          command: request.command,
          applicationName: request.command,
          args: request.args || [],
          cwd: request.cwd || cwd,
          env: { ...process.env, ...(request.env || {}) },
          stdio: { stdin: stdinFd, stdout: stdoutFd, stderr: stderrFd }
        });
      } finally {
        closeSync(stdinFd); closeSync(stdoutFd); closeSync(stderrFd);
      }
      const limit = Number(request.stdoutMaxBytes || 4096);
      let settled = null;
      const done = (async () => {
        for (;;) {
          const code = win32.pollProcessExit(jobApi, spawned.process);
          if (code !== undefined) { settled = { exitCode: code, signal: null }; return settled; }
          await new Promise((r) => setTimeout(r, 40));
        }
      })();
      return {
        pid: spawned.pid,
        job: spawned.job,
        done,
        terminate() { try { win32.terminateJob(jobApi, spawned.job, 1); } catch (e) { return String(e && e.message || e); } },
        async waitForExit(ms) {
          const until = Date.now() + ms;
          for (;;) {
            if (win32.isJobEmpty(jobApi, spawned.job)) return true;
            if (Date.now() > until) return win32.isJobEmpty(jobApi, spawned.job);
            await new Promise((r) => setTimeout(r, 40));
          }
        },
        jobEmpty() { return win32.isJobEmpty(jobApi, spawned.job); },
        release() { try { win32.closeHandleChecked(jobApi, spawned.job, "test-job"); } catch (e) { return String(e && e.message || e); } },
        output() {
          const bound = (file) => {
            const buf = readFileSync(file);
            if (buf.length <= limit) return { bytes: buf, truncated: false };
            return { bytes: buf.subarray(buf.length - limit), truncated: true, spillPath: file };
          };
          const out = bound(paths.stdout);
          const err = bound(paths.stderr);
          return {
            stdoutBytes: out.bytes, stdoutTruncated: out.truncated, stdoutSpillPath: out.spillPath,
            stderrBytes: err.bytes, stderrTruncated: err.truncated, stderrSpillPath: err.spillPath
          };
        }
      };
    }
  };
}
