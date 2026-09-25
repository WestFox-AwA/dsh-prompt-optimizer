/** Pure shell capability contract. No spawning, backend selection or environment inheritance. */
import { win32, posix } from 'node:path'
export const SHELL_CAPABILITY_VERSION = '1'
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(field + ': object required')
}
function text(value, field, nonempty = false) {
  if (typeof value !== 'string' || value.includes('\0') || (nonempty && !value.trim())) throw new TypeError(field + ': valid string required')
  return value
}
function positive(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(field + ': positive safe integer required')
  return value
}
function paths(platform) {
  if (platform === 'windows') return win32
  if (platform === 'posix') return posix
  throw new TypeError('hostPlatform: windows or posix required')
}
function absolute(value, platform) {
  text(value, 'path', true)
  if (platform === 'windows' && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.test(value)) throw new TypeError('fully qualified Windows path required')
  const p = paths(platform)
  if (!p.isAbsolute(value)) throw new TypeError('absolute path required')
  if (platform === 'windows' && ['//?/', '//./'].some(prefix => value.replaceAll(String.fromCharCode(92), '/').startsWith(prefix))) throw new TypeError('Windows device paths unsupported')
  return p.normalize(value)
}
export function resolveHostPath(value, base, platform) {
  const p = paths(platform)
  const root = absolute(base, platform)
  text(value, 'path', true)
  if (platform === 'windows' && (/^[A-Za-z]:(?![\\/])/.test(value) || /^[\\/](?![\\/])/.test(value))) throw new TypeError('drive-relative or root-relative path is ambiguous')
  return absolute(p.resolve(root, value), platform)
}
/** Explicit host-root to backend-root mapping; no assumed /c or /mnt/c mount. */
export function mapHostPath(value, { hostPlatform, mappings }) {
  const p = paths(hostPlatform)
  const source = absolute(value, hostPlatform)
  if (!Array.isArray(mappings)) throw new TypeError('mappings required')
  const matches = mappings.map(({ hostRoot, backendRoot }) => {
    const root = absolute(hostRoot, hostPlatform)
    text(backendRoot, 'backendRoot', true)
    if (!backendRoot.startsWith('/')) throw new TypeError('absolute backendRoot required')
    const relative = p.relative(root, source)
    const inside = relative === '' || (!p.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + p.sep))
    return { root, relative, backendRoot, inside }
  }).filter(x => x.inside).sort((a, b) => b.root.length - a.root.length)
  if (!matches.length) throw new Error('UNMAPPED_PATH: ' + source)
  if (matches.length > 1 && matches[0].root.length === matches[1].root.length) throw new Error('AMBIGUOUS_PATH_MAPPING')
  const m = matches[0]
  return posix.join(m.backendRoot, ...m.relative.split(p.sep))
}
/** Only explicit overlays; caller supplies already-scrubbed base if desired. No guessing PATH. */
export function normalizeEnv(overrides = {}, base = {}, { hostPlatform = 'posix', managed = false } = {}) {
  object(overrides, 'env'); object(base, 'base env'); paths(hostPlatform)
  const result = new Map()
  for (const layer of [base, overrides]) {
    const seen = new Set()
    for (const [key, value] of Object.entries(layer)) {
      text(key, 'env key', true); text(value, 'env value')
      if (key.includes('=')) throw new TypeError('env key contains =')
      const reserved = key.toUpperCase().startsWith('DSH_')
      if (managed ? !reserved : reserved) throw new TypeError('managed environment namespace violation')
      const identity = hostPlatform === 'windows' ? key.toUpperCase() : key
      if (seen.has(identity)) throw new TypeError('duplicate environment key: ' + key)
      seen.add(identity)
      result.set(identity, [key, value])
    }
  }
  return Object.freeze(Object.fromEntries(result.values()))
}
/** Convert an explicitly tagged PATH list. Empty entries survive (they mean cwd). */
export function convertPathList(value, { from, to, mapEntry }) {
  text(value, 'PATH'); paths(from); paths(to)
  if (typeof mapEntry !== 'function') throw new TypeError('mapEntry required')
  const separator = to === 'windows' ? ';' : ':'
  return value.split(from === 'windows' ? ';' : ':').map(entry => {
    if (entry === '') return ''
    const mapped = text(mapEntry(entry), 'mapped PATH entry', true)
    if (mapped.includes(separator)) throw new TypeError('PATH entry contains target separator')
    return mapped
  }).join(separator)
}
/** Context is trusted: workdir/tempDir already allocated and authorized by the host. */
export function normalizeShellRequest(request, context) {
  object(request, 'request'); object(context, 'context')
  const allowed = new Set(['command', 'args', 'workdir', 'timeoutMs', 'onExpiry', 'stdoutMaxBytes', 'stdin', 'env', 'signal'])
  for (const key of Object.keys(request)) if (!allowed.has(key)) throw new TypeError('unknown request field: ' + key)
  const command = text(request.command, 'command', true)
  const args = request.args ?? []
  if (!Array.isArray(args)) throw new TypeError('args: array required')
  for (const value of args) text(value, 'argument')
  const workdir = resolveHostPath(request.workdir ?? '.', context.workdir, context.hostPlatform)
  const tempDir = absolute(context.tempDir, context.hostPlatform)
  const maxTimeoutMs = positive(context.maxTimeoutMs ?? 600000, 'maxTimeoutMs')
  const timeoutMs = Math.min(positive(request.timeoutMs ?? context.timeoutMs ?? 120000, 'timeoutMs'), maxTimeoutMs)
  const maxBytes = positive(context.maxOutputBytes ?? 4194304, 'maxOutputBytes')
  const stdoutMaxBytes = Math.min(positive(request.stdoutMaxBytes ?? 262144, 'stdoutMaxBytes'), maxBytes)
  const onExpiry = request.onExpiry ?? 'kill'
  if (!['kill', 'none'].includes(onExpiry)) throw new TypeError('onExpiry: kill or none required')
  if (request.stdin !== undefined && typeof request.stdin !== 'string') throw new TypeError('stdin: string required')
  if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) throw new TypeError('AbortSignal required')
  return Object.freeze({ command, args: Object.freeze([...args]), workdir, tempDir,
    hostPlatform: context.hostPlatform, timeoutMs, onExpiry, stdoutMaxBytes,
    stdin: request.stdin, signal: request.signal,
    env: normalizeEnv(request.env, context.env, context),
    dshEnv: normalizeEnv(context.dshEnv, {}, { hostPlatform: context.hostPlatform, managed: true }),
    sandboxPolicy: context.sandboxPolicy })
}
/** Bash positional args, never concatenated into command text. $0 is stable. */
export function bashArgv(executable, spec) {
  return Object.freeze([text(executable, 'executable', true), '--noprofile', '--norc', '-c', spec.command, 'dsh-bash', ...spec.args])
}
export function normalizeStream(stream) {
  object(stream, 'stream')
  if (typeof stream.text !== 'string') throw new TypeError('stream text required')
  const truncated = stream.truncated ?? stream.lossy
  if (typeof truncated !== 'boolean') throw new TypeError('stream loss status required')
  if (stream.truncated !== undefined && stream.lossy !== undefined && stream.truncated !== stream.lossy) throw new TypeError('conflicting loss status')
  return Object.freeze({ text: stream.text, truncated,
    ...(stream.spillPath === undefined ? {} : { spillPath: text(stream.spillPath, 'spillPath', true) }) })
}
/** Preserve official ShellRunResult fields. Backend metadata is additive. */
export function normalizeShellResult(outcome, streams, meta) {
  object(outcome, 'outcome'); object(streams, 'streams'); object(meta, 'meta')
  const exitCode = outcome.exitCode
  if (exitCode !== null && (!Number.isSafeInteger(exitCode) || exitCode < 0)) throw new TypeError('exitCode: nonnegative integer or null required')
  const signal = outcome.signal
  if (signal !== null) text(signal, 'signal', true)
  const reason = meta.reason ?? 'exit'
  if (!['exit', 'timeout', 'cancelled', 'spawn-error'].includes(reason)) throw new TypeError('unknown termination reason')
  if (reason === 'spawn-error' && (exitCode !== null || signal !== null || !meta.spawnError)) throw new TypeError('spawn-error must have null exit facts and error detail')
  if (reason !== 'spawn-error' && meta.spawnError !== undefined) throw new TypeError('unexpected spawnError')
  return Object.freeze({ capabilityVersion: SHELL_CAPABILITY_VERSION,
    backend: text(meta.backend, 'backend', true), exitCode, signal,
    timedOut: reason === 'timeout', aborted: reason === 'cancelled',
    timeoutMs: positive(meta.timeoutMs, 'timeoutMs'),
    stdout: normalizeStream(streams.stdout), stderr: normalizeStream(streams.stderr),
    ...(meta.spawnError === undefined ? {} : { spawnError: text(meta.spawnError, 'spawnError', true) }),
    ...(meta.sandbox === undefined ? {} : { sandbox: meta.sandbox }) })
}
/** Adapter result boundary; scheduling/termination remain owned by the backend. */
export async function exec(request, context, adapter) {
  const spec = normalizeShellRequest(request, context)
  const result = await adapter.execute(spec)
  object(result, 'adapter result')
  return normalizeShellResult(result.outcome, result.streams, {
    backend: adapter.id, timeoutMs: spec.timeoutMs, reason: result.reason,
    spawnError: result.spawnError, sandbox: result.sandbox })
}
