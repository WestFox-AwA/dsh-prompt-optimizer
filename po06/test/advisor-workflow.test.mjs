import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADVISOR_PARAMETERS, ADVISOR_TIMEOUT_MS, ADVISOR_TIMEOUT_MIN_MS, ADVISOR_TIMEOUT_MAX_MS, resolveAdvisorTimeoutMs, ADVISOR_SYSTEM } from '../lib/advisor.js'
import { ADVISOR_WORKFLOW, withAdvisorWorkflow } from '../lib/advisor-workflow.js'

test('short workflow names executable stage actions, preserves authority and avoids fixed review counts',()=>{
 assert.ok(ADVISOR_WORKFLOW.length<1700,'重复协议必须保持小预算')
 for(const token of ['advisor_stage','start_task','define_stage','activate_stage','advance','checkId','taskId','stageId','subjectPaths','diagnose_failure'])assert.ok(ADVISOR_WORKFLOW.includes(token),token)
 assert.ok(ADVISOR_WORKFLOW.includes('不改变用户技术路线'))
 assert.ok(ADVISOR_WORKFLOW.includes('不固定堆次数'))
 assert.ok(ADVISOR_WORKFLOW.includes('失败不是缺证') || ADVISOR_WORKFLOW.includes('failed不是缺证'))
 assert.ok(ADVISOR_WORKFLOW.includes('不能替用户接受偏差'))
 assert.ok(ADVISOR_WORKFLOW.includes('不代表整个任务完成'))
})
test('evidence rules are compact and do not prescribe new assets or workloads',()=>{
 for(const token of ['geometry/appearance','源码不能证明运行','截图不能证明交互/性能','软件预览不能证明实际成品','startLine/endLine','截断/缺失','图像能力未知标未检查','已授权材料'])assert.ok(ADVISOR_WORKFLOW.includes(token),token)
 assert.ok(ADVISOR_WORKFLOW.includes('不开额外网络或重型截图凑材料'))
 assert.ok(ADVISOR_WORKFLOW.includes('delivery只汇总'))
 assert.ok(ADVISOR_WORKFLOW.includes('原checkpoint id'))
})
test('PTC example executes consult task and keeps outer timeout margin',()=>{
 assert.ok(ADVISOR_WORKFLOW.includes('await tools.consult_task'))
 assert.ok(ADVISOR_WORKFLOW.includes('360000'))
 assert.ok(ADVISOR_WORKFLOW.includes('多60秒'))
})
test('context contribution honors off gate and includes bounded feedback only when enabled',()=>{
 assert.equal(withAdvisorWorkflow('',{injectPacket:true}),ADVISOR_WORKFLOW)
 assert.ok(withAdvisorWorkflow('packet',{injectPacket:true},'stage').endsWith('packet\n\nstage'))
 assert.equal(withAdvisorWorkflow('packet',{injectPacket:false},'stage'),'packet')
 assert.equal(withAdvisorWorkflow('packet',undefined,'stage'),'packet')
})
test('顾问限时：默认 5 分钟；环境变量可调并钳制；报告长度设上限',()=>{
  assert.equal(ADVISOR_TIMEOUT_MS, 300000, '默认 5 分钟（150s 真机超时过，太短）')
  assert.equal(resolveAdvisorTimeoutMs({}), ADVISOR_TIMEOUT_MS, '没设环境变量就用默认')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: '600000' }), 600000, '合法值原样采纳')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: '1' }), ADVISOR_TIMEOUT_MIN_MS, '过小钳到下限')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: '99999999' }), ADVISOR_TIMEOUT_MAX_MS, '过大钳到上限')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: 'abc' }), ADVISOR_TIMEOUT_MS, '非法值回落默认，不静默变 0')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: '-5' }), ADVISOR_TIMEOUT_MS, '负数也是非法值')
  // 长输出是超时主因之一：提示词里必须有长度纪律，否则放宽限时只是把超时往后推
  assert.ok(/findings 最多 6 条/.test(ADVISOR_SYSTEM))
  assert.ok(/checks 最多 8 条/.test(ADVISOR_SYSTEM))
})

test('顾问schema不含宿主已确认不支持的maxItems，必填字段和模式保留',()=>{
  // The host renderer was directly checked during diagnosis: maxItems => unknown.
  // Keep this test portable; a standalone node test is not a running DSH host.

  assert.equal(ADVISOR_PARAMETERS.properties.artifacts.maxItems,undefined)
  assert.deepEqual(ADVISOR_PARAMETERS.required,['mode','question'])
  // develop_approach 是 2026-10-05 增加的第三个用途（独立解题）；它不计入验收通过，见 advisor.js 的 completionClaimAllowed。
  assert.deepEqual(ADVISOR_PARAMETERS.properties.mode.enum,['diagnose_failure','review_result','develop_approach'])
})
