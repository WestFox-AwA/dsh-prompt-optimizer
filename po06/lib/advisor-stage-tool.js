import {isRealUserInput,extractUserText} from './wire.js'
import {ADVISOR_SCOPES} from './advisor-scopes.js'
import {toLosslessJson} from './lossless-json.js'

export const ADVISOR_STAGE_PARAMETERS={type:'object',additionalProperties:false,required:['action'],properties:{
 action:{type:'string',enum:['start_task','define_stage','activate_stage','set_subjects','status','advance']},
 title:{type:'string',description:'新任务标题；仅在用户明确切换任务时start_task，普通追问继续原taskId'},
 taskId:{type:'string',description:'使用插件返回的taskId，不自造'},
 stageId:{type:'string',description:'使用插件返回的stageId；补验旧阶段先activate_stage'},
 scope:{type:'string',enum:ADVISOR_SCOPES},focus:{type:'string',description:'本阶段一个相关对象组及结果检查点，不按行业固定阶段'},
 subjectPaths:{type:'array',items:{type:'string'},description:'该阶段实际成果与依赖的相对文件路径，最多8份；视觉阶段必填，不仅填截图，文件可在工作后生成'},
 criteria:{type:'array',items:{type:'string'},description:'最多8个原任务结果检查点；插件生成稳定checkId，顾问只能按id更新'},
}}
export function registerAdvisorStageTool(scope,stages,{resolveAccess=async()=>({ok:false,reason:'stage-access-unavailable'})}={}) {
 return scope.tools.register({name:'advisor_stage',parameters:ADVISOR_STAGE_PARAMETERS,
  description:'顾问阶段契约管理（不调用模型、不修改工程文件）。复杂任务在依赖某项成果继续前define_stage，取得taskId/stageId/checkId，再consult_task定向复核。advance机械拒绝失败/缺证/过期阶段。status只返回当前任务；新任务start_task，旧任务归档保留不持续注入。不得把advance或局部通过当整个任务完成，不替用户接受失败。',
  // 出口收敛：宿主对返回值做无损 JSON 校验，不合规整条丢弃（同 consult_task，见 lossless-json.js）。
  execute:async(args,exec)=>toLosslessJson(await (async(args,exec)=>{
   if(!args || !ADVISOR_STAGE_PARAMETERS.properties.action.enum.includes(args.action))return {ok:false,reason:'invalid-stage-action'}
   const session=exec?.agent?.session || exec?.agent?.getSession?.()
   if(!session?.id)return {ok:false,reason:'session-unavailable'}
   const access=await resolveAccess(session)
   if(!access?.ok)return {ok:false,reason:access?.reason || 'assist-off'}
   const ctx={sessionId:String(session.id),root:session.header?.cwd,readEnabled:access.readTools===true}
   if(args.action==='start_task') {
    const events=session.snapshotEvents?.() || []
    const event=events.filter(isRealUserInput).at(-1)
    if(!event)return {ok:false,reason:'current-human-request-unavailable'}
    const source=extractUserText(event)
    const res=stages.startTask({...ctx,title:args.title,sourceRequestId:'human:'+String(event.seq ?? event.data.id),sourceText:source.slice(0,4000)})
    return {...res,sourceTruncated:source.length>4000}
   }
   const common={...ctx,taskId:args.taskId,stageId:args.stageId}
   if(args.action==='define_stage')return stages.defineStage({...common,scope:args.scope,focus:args.focus,criteria:args.criteria,subjectPaths:args.subjectPaths})
   if(args.action==='activate_stage')return stages.activateStage(common)
   if(args.action==='set_subjects')return stages.setSubjects({...common,subjectPaths:args.subjectPaths})
   if(args.action==='status')return stages.status(common)
   if(args.action==='advance')return stages.advance(common)
   return {ok:false,reason:'invalid-stage-action'}
  })(args,exec)),
  output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}],presentationMeta:(_args,value)=>JSON.parse(JSON.stringify(value || {}))},
  presentCall:args=>({card:'generic',kind:'other',title:'顾问阶段 · '+String(args?.action || 'status')}),
  presentResult:(_call,res)=>({card:'generic',kind:'other',title:'顾问阶段状态',text:JSON.stringify(res?.meta || {})}),
 })
}
