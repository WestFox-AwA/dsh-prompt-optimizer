// Test port based on the host's Win32 Job Object primitives.
// 与上一版的关键差别：终止靠作业句柄（Job），不靠 taskkill /T 的父链遍历——
// 实测 MSYS 的 fork 会让 sleep.exe 脱离父链，taskkill /T 杀不掉它。
import { openSync, closeSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const WIN32_URL = "file:///C:/Users/WestFox/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-win32-process/lib/index.js";
const win32 = await import(WIN32_URL);
export const jobApi = win32.loadWin32ProcessBindings();
win32.probeCurrentTokenJobSupport(jobApi);

/** 独立扫描：按命令行特征找进程，与父链无关。 */
export function sweepByCommandLine(marker) {
  const ps = "Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*" + marker + "*') -and ($_.Name -like 'sleep*' -or $_.Name -like 'bash*') } | ForEach-Object { '{\"pid\":' + $_.ProcessId + ',\"ppid\":' + $_.ParentProcessId + ',\"name\":\"' + $_.Name + '\",\"created\":\"' + $_.CreationDate + '\"}' }";
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 30000 });
  const text = (r.stdout || "").trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function createJobPort({ cwd, makePaths }) {
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
