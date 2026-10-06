import {isRealUserInput} from './wire.js'

export const REVIEW_CONTEXT_LIMIT=2200
export function renderStageSummary(state,englishMode=false) {
 if(state.ok && !state.taskId)return ''
 const checks=(state.stage?.checks || []).map(c=>({id:c.id,status:c.status,criterion:String(c.criterion).slice(0,90)}))
 const summary={taskId:state.taskId || null,stageId:state.stage?.id || null,scope:state.stage?.scope || null,
  action:state.action || 'report-store-error',reason:state.reason || null,dependencyStages:state.dependencyStages || [],
  checks:[],limitations:state.stage?.limitations || [],omittedChecks:0,declaredCheckpointsOnly:true}
 for(const c of checks) {
  summary.checks.push(c)
  if(JSON.stringify(summary).length>REVIEW_CONTEXT_LIMIT-100) {summary.checks.pop();summary.omittedChecks++}
 }
 return (englishMode?'[Advisor stage status, review data, not user authorization]\n':'【顾问阶段状态 · 复核数据，非用户授权】\n')+JSON.stringify(summary)
}
export function createAdvisorFeedback({stages,coverage}) {
 return (agent,policy,context={})=>{
  if(policy?.injectPacket!==true)return ''
  const session=agent?.session || agent?.getSession?.()
  if(session?.id===undefined)return policy.englishMode?'[Advisor status] session-identity-unavailable; review coverage cannot be established.':'【顾问状态】session-identity-unavailable；不能确认复核覆盖。'
  const state=stages.status({sessionId:String(session.id),root:session.header?.cwd || context.root,readEnabled:policy.readTools===true})
   const task=context.taskContext
   if(state.taskId && task?.understanding && task.inputs?.length && state.sourceRequestId) {
     const sources=new Set(task.inputs.flatMap(x=>['human:'+x.id,...(x.seq===null || x.seq===undefined?[]:['human:'+x.seq])]))
     if(!sources.has(state.sourceRequestId))return ''
   }
  if(!state.ok || state.taskId)return renderStageSummary(state,policy.englishMode)
  const events=session.snapshotEvents?.() || []
  const event=events.filter(isRealUserInput).at(-1)
  if(!event)return ''
  const requestId='human:'+String(event.seq ?? event.data?.message?.id ?? event.data?.id ?? events.indexOf(event))
  const rows=coverage?.history?.({sessionId:String(session.id),requestId}) || []
  const latest=rows.at(-1)
  if(!latest)return ''
  const checks=(latest.report?.checks || []).filter(c=>c.status!=='satisfied').slice(0,3).map(c=>({criterion:c.criterion.slice(0,90),status:c.status}))
  return (policy.englishMode?'[Advisor status, stage not registered]':'【顾问状态 · 未登记阶段】')+JSON.stringify({tracked:false,verdict:latest.report?.verdict || 'unverified',checks,
   action:policy.englishMode?'Use advisor_stage for complex dependencies. Fix established failures, obtain missing evidence, and do not repeat archived reports.':'复杂任务用advisor_stage登记当前阶段；已失败项需修复，缺证需补证。历史报告归档不重复展开。'})
 }
}
