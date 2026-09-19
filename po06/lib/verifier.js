// dsh-prompt-optimizer 0.6 · 验证记录（纯函数：无 IO、无 LLM、无宿主）
//
// 依据 PLAN-0.6.md §12。三条硬规则：
//   ① **检查什么就只结论什么**：每条结论必须绑定产物版本、验证器身份、测试条件与覆盖范围。
//   ② **症状与诊断分离**：观察到的是 `observation`，推测的原因只能进 `suspectedCause`，
//      且**不得**被当作事实写进返工指令。
//   ③ 结果只有五种：pass / fail / unknown / infrastructure_error / cancelled。
//      **只有 fail 是可返工的**——基础设施故障与未知都不是作品坏了。

export const RESULT = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNKNOWN: 'unknown',
  INFRA_ERROR: 'infrastructure_error',
  CANCELLED: 'cancelled',
})

export const RESULTS = Object.freeze(Object.values(RESULT))

/** 只有这个结果是"作品确实不合格"的证据。 */
export const ACTIONABLE_RESULT = RESULT.FAIL

function isPlainObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) }

/** 校验一条 check。返回错误数组。 */
export function validateCheck(check, i = 0) {
  const p = []
  if (!isPlainObject(check)) return [`checks[${i}] must be an object`]
  if (typeof check.id !== 'string' || !check.id) p.push(`checks[${i}].id required`)
  if (typeof check.property !== 'string' || !check.property) p.push(`checks[${i}].property required`)
  if (!RESULTS.includes(check.result)) p.push(`checks[${i}].result invalid: ${String(check.result)}`)
  // 观察必须有：否则"结论"没有依据
  if (typeof check.observation !== 'string' || check.observation.trim().length === 0) {
    p.push(`checks[${i}].observation required (a conclusion without an observation is not evidence)`)
  }
  // pass / fail 必须有证据引用；unknown / infra / cancelled 允许没有
  if ((check.result === RESULT.PASS || check.result === RESULT.FAIL)
    && (!Array.isArray(check.evidenceRefs) || check.evidenceRefs.length === 0)) {
    p.push(`checks[${i}] result=${check.result} requires evidenceRefs`)
  }
  return p
}

/**
 * 建一条验证记录。
 * @param input { artifact, validator, environmentRef, checks, coverage, notCovered }
 */
export function createRecord(input) {
  const errors = []
  if (!isPlainObject(input)) return { ok: false, errors: ['input must be an object'] }
  const a = input.artifact
  if (!isPlainObject(a)) errors.push('artifact required')
  else {
    if (typeof a.path !== 'string' || !a.path) errors.push('artifact.path required')
    if (typeof a.sha256 !== 'string' || a.sha256.length < 8) {
      errors.push('artifact.sha256 required (a conclusion must bind to an artifact version)')
    }
  }
  const v = input.validator
  if (!isPlainObject(v)) errors.push('validator required')
  else {
    if (typeof v.name !== 'string' || !v.name) errors.push('validator.name required')
    if (typeof v.version !== 'string' || !v.version) errors.push('validator.version required')
  }
  if (typeof input.environmentRef !== 'string' || !input.environmentRef) errors.push('environmentRef required')
  if (!Array.isArray(input.checks) || input.checks.length === 0) errors.push('checks must be a non-empty array')
  else input.checks.forEach((c, i) => { for (const e of validateCheck(c, i)) errors.push(e) })
  // 覆盖范围必须显式声明（哪怕是空数组）：机器检查通过**不等于**作品合格
  if (!Array.isArray(input.coverage)) errors.push('coverage must be an array (declares what this record actually covers)')
  if (!Array.isArray(input.notCovered)) errors.push('notCovered must be an array (declares what it does NOT cover)')

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    record: {
      artifact: { path: a.path, sha256: a.sha256, dependenciesHash: a.dependenciesHash || null },
      validator: { name: v.name, version: v.version, configHash: v.configHash || null },
      environmentRef: input.environmentRef,
      checks: input.checks.map((c) => ({
        id: c.id,
        property: c.property,
        result: c.result,
        observation: c.observation,
        evidenceRefs: Array.isArray(c.evidenceRefs) ? c.evidenceRefs : [],
        suspectedCause: typeof c.suspectedCause === 'string' ? c.suspectedCause : null,
      })),
      coverage: input.coverage.slice(),
      notCovered: input.notCovered.slice(),
      at: typeof input.at === 'string' ? input.at : null,
    },
  }
}

/** 记录里某条检查。 */
export function checkOf(record, checkId) {
  return record && Array.isArray(record.checks) ? record.checks.find((c) => c.id === checkId) || null : null
}

/** 该记录里所有**可返工**的失败（只有 fail）。 */
export function actionableFailures(record) {
  if (!record || !Array.isArray(record.checks)) return []
  return record.checks.filter((c) => c.result === ACTIONABLE_RESULT)
}

/** 该记录是否含基础设施故障（**不得**据此修作品）。 */
export function hasInfrastructureError(record) {
  return Boolean(record && Array.isArray(record.checks)
    && record.checks.some((c) => c.result === RESULT.INFRA_ERROR))
}

/**
 * 记录相对于当前产物是否**已过期**。
 * 产物被改动后，旧记录的 pass **不得**用于新文件。
 */
export function isStale(record, currentSha256) {
  if (!record || !record.artifact) return true
  if (typeof currentSha256 !== 'string' || !currentSha256) return true
  return record.artifact.sha256 !== currentSha256
}

/**
 * 去重键：**产物 + 验证器 + 检查 + 配置**。
 * 只有这四者都相同才算"同一个失败"；换文件版本**不**算同一个（但会消耗任务级总预算）。
 */
export function dedupeKey(record, check) {
  const a = record.artifact.sha256
  const v = record.validator.name + '@' + record.validator.version + '#' + (record.validator.configHash || '-')
  return [a, v, check.id, check.property].join('|')
}

/**
 * 生成**返工指令文本**。
 * 严格约束：只陈述观察到的事实与复现条件，**不把诊断当事实**，
 * 也不新增用户没要求的范围。
 */
export function renderReworkInstruction(record, failures) {
  const lines = []
  lines.push('【交付验证 · 机器结论】下列结论针对具体产物版本，不是我的猜测：')
  lines.push('· 产物：' + record.artifact.path + '（sha256 ' + String(record.artifact.sha256).slice(0, 12) + '…）')
  lines.push('· 验证器：' + record.validator.name + '@' + record.validator.version)
  lines.push('· 环境：' + record.environmentRef)
  for (const f of failures) {
    lines.push('· 未通过：' + f.property + ' —— 观察到的：' + f.observation)
    if (f.suspectedCause) {
      lines.push('  （推测原因，**未证实**，仅供排查参考：' + f.suspectedCause + '）')
    }
  }
  lines.push('· 请围绕上述现象自行诊断并修复，修完复验同一项。不要扩大改动范围。')
  return lines.join('\n')
}
