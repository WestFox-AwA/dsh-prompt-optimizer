import test from 'node:test'
import assert from 'node:assert/strict'
import { createCapability, collectToolEvidence } from '../lib/capability.js'
import { parseInterpreterOutput } from '../lib/interpreter.js'
import { advisorSnapshot, parseAdvisorReport, createAdvisor, registerAdvisorTool, acceptanceBanner } from '../lib/advisor.js'
import { adapter as productionAdapter } from '../lib/index.js'
import { createState } from '../lib/schema.js'
import { reduce, recordUserInput } from '../lib/reducer.js'
const human=(id,text,seq)=>({type:'user/message',seq,data:{id,source:{kind:'user'},content:[{type:'text',text}]}})
const parse=(v,text='继续')=>parseInterpreterOutput(JSON.stringify(v),{userText:text,sessionId:'s1',messageId:'m1',baseRevision:0,baseInputRevision:0})
const session={id:'s1',header:{cwd:process.cwd()},snapshotEvents:()=>[]}
const support={mode:'compare',target:'当前选择',reason:'选择会影响结果',nextAction:'比较两种可逆方法的取舍'}
test('理解完成允许零增量',()=>{const p=parse({ops:[],understanding:{summary:'继续已授权任务',relation:'continue',action:'continue'},support:{mode:'none'}});assert.equal(p.ok,true);assert.equal(p.patch,null);assert.equal(p.understanding.action,'continue')})
test('逐字引文不授权任意扩写（信息量下限）',()=>{
 // ① 被拦住的形状：引文极短却撑起大段要求 ⇒ 降级为机器理解，不写成本轮用户明确要求。
 // 同时给一条**有据**的要求：这样补丁非空，能同时验证"拦掉过薄的、放过有据的"。
 const src='把按钮颜色改成蓝色'
 const thin=parse({ops:[
  {op:'add_item',item:{id:'req-1',kind:'user_requirement',text:'把按钮改成蓝色，同时把部署脚本、回滚方案、监控面板和生产环境的灰度策略一并改好并上线',quote:'蓝色',sourceRefs:[{kind:'human',sessionId:'s1',messageId:'m1'}]}},
  {op:'add_item',item:{id:'req-2',kind:'user_requirement',text:'把按钮颜色改成蓝色',quote:'把按钮颜色改成蓝色',sourceRefs:[{kind:'human',sessionId:'s1',messageId:'m1'}]}},
 ]},src)
 assert.equal(thin.patch.ops.filter((o)=>o.item.id==='req-1').length,0,'过薄的引文不得产出用户要求')
 assert.equal(thin.patch.ops.filter((o)=>o.item.id==='req-2').length,1,'有据的一条照常产出')
 assert.match(thin.claims.find((c)=>c.id==='req-1').interpretation,/部署脚本/,'模型扩写仍留在可回查的记录里')
 // ② 目前**拦不住**的形状（如实标出，不假装挡住了）：短引文 + 短正文里塞进一个新要求。
 //    引文与正文都短，长度比例判据不触发 ⇒ 只能靠 claims 留痕由人复核。
 const sneaky=parse({ops:[{op:'add_item',item:{id:'req-2',kind:'user_requirement',text:'把按钮改成蓝色，同时部署到生产环境',quote:'把按钮颜色改成蓝色',sourceRefs:[{kind:'human',sessionId:'s1',messageId:'m1'}]}}]},'把按钮颜色改成蓝色')
 assert.equal(sneaky.patch.ops[0].item.sourceQuote,'把按钮颜色改成蓝色','引文必须逐字保留')
 assert.match(sneaky.claims[0].interpretation,/部署/,'扩写必须留在审计记录里，便于人工复核')
})
test('追问承接来源，迟到结果不再覆盖',()=>{
 const c=createCapability();let t=c.beginInput('s1','m1','分析来源冲突')
 c.settle('s1',t,{understanding:{summary:'比较结论适用范围',relation:'new',action:'execute'},support})
 const old=t;t=c.beginInput('s1','m2','继续');assert.equal(c.settle('s1',old,{understanding:{summary:'过期',relation:'new'}}).ok,false)
 c.settle('s1',t,{understanding:{summary:'继续来源比较',relation:'continue',action:'continue'},support})
 assert.equal(c.taskContext(session).sourceRequestId,'m1');assert.match(c.render('s1'),/比较两种可逆方法/)
})
test('native和PTC结果都是证据；顾问意见被排除',()=>{
 const rows=[human('m1','检查结果',1),{type:'tool/call',data:{callId:'c1',name:'read',arguments:{file_path:'x'}}},
 {type:'tool/result',data:{message:{toolCallId:'c1',content:[{type:'text',text:'native evidence'}]}}},
 {type:'tool/ptc-dispatch',data:{subCallId:'p1',name:'bash',arguments:{command:'check'},content:[{type:'text',text:'ptc evidence'}]}},
 {type:'tool/ptc-dispatch',data:{subCallId:'p2',name:'consult_task',content:[{type:'text',text:'advisor opinion'}]}}]
 const e=collectToolEvidence(rows).records;assert.equal(e.filter(x=>x.type==='tool/result').length,2);assert.equal(e.some(x=>x.name==='consult_task'),false)
 const s=advisorSnapshot([...rows,human('m2','继续',7)],'review_result',{taskContext:{sourceRequestId:'m1'}})
 assert.match(s.userText,/检查结果/);assert.match(s.userText,/继续/);assert.equal(s.records.filter(x=>x.type==='tool/result').length,2)
})
test('无偏差引用的failed保持未验证',()=>{
 const p=parseAdvisorReport(JSON.stringify({verdict:'gaps',summary:'待核对',findings:[],checks:[{criterion:'结果正确',status:'failed',evidenceRefs:[]}],nextStep:'补证',stopCondition:'资料齐全后复核'}),new Set(),'review_result')
 assert.equal(p.ok,true);assert.equal(p.report.checks[0].status,'unverified')
})
function adapterFor(){
 const a=new productionAdapter.constructor();a.capability=createCapability();a.services.agents={get:()=>({})}
 let state=createState({sessionId:'s1',taskId:'task1'})
 a.intentStateOf=()=>state;a.initIntent=()=>({ok:true,state})
 a.commitUserInput=(_s,input)=>{state=recordUserInput(state,input);return {ok:true,state}}
 a.commit=(_s,patch)=>{const r=reduce(state,patch);if(r.ok)state=r.state;return r}
 return a
}
test('生产adapter入口完成零增量而不是no-packet',async()=>{
 const a=adapterFor(),out=await a.handleInput(session,{messageId:'m1',text:'谢谢',budget:700,policy:{framing:'neutral'},interpret:async()=>JSON.stringify({ops:[],understanding:{summary:'谢谢',relation:'continue',action:'acknowledge'},support:{mode:'none'}})})
 assert.equal(out.outcome,'understood');assert.equal(out.understanding.action,'acknowledge');assert.equal(a.getWorkingText('s1'),'')
})
test('真实并发输入：旧解释不能替换新辅助',async()=>{
 const a=adapterFor();let finish
 const first=a.handleInput(session,{messageId:'m1',text:'原任务',interpret:()=>new Promise(resolve=>{finish=resolve})})
 for(let i=0;i<20 && !finish;i++)await Promise.resolve()
 assert.equal(typeof finish,'function','first input must reach the interpretation hook')
 const next=await a.handleInput(session,{messageId:'m2',text:'当前任务',interpret:async()=>JSON.stringify({ops:[],understanding:{summary:'最新理解',relation:'new',action:'execute'},support})})
 assert.equal(next.outcome,'understood');finish(JSON.stringify({ops:[],understanding:{summary:'过期理解',relation:'new',action:'execute'}}))
 assert.equal((await first).outcome,'superseded-input');assert.match(a.getWorkingText('s1'),/最新理解/);assert.doesNotMatch(a.getWorkingText('s1'),/过期理解/)
})

test('具体解题贡献和待核前提完整经过解释、状态与工作注入',()=>{
 const contribution='对目标先确定真正的瓶颈，再选择具体方法：'+('说明方法为何适用，必要事实仍须查证。'.repeat(70))
 const value={ops:[],understanding:{summary:'选择有价值的解法',relation:'new',action:'execute'},support:{mode:'develop',contribution,assumptions:['数据是否满足所需条件']}}
 const p=parse(value),c=createCapability(),token=c.beginInput('s1','m1','请分析这个问题')
 c.settle('s1',token,p)
 assert.ok(c.render('s1').includes(contribution));assert.match(c.render('s1'),/数据是否满足所需条件/)
 assert.equal(c.status('s1').current.contributionChars,contribution.length)
})
test('新解题顾问走真实执行与投影出口，但不能计入成果通过',async()=>{
 let modelPrompt;let recorded=0
 const r={verdict:'suggestion',summary:'先用不同的信息组织方式降低复杂度',contribution:'按当前依赖构造最小可执行路径，先解决阻塞条件，再组合独立部分；不先堆全部功能。',assumptions:['依赖图需要从项目资料确认'],findings:[],checks:[],nextStep:'确定阻塞依赖并形成最小路径',stopCondition:'新的依赖证据与当前推导冲突时调整'}
 const invoke=createAdvisor({resolveRuntime:async()=>({ok:true,cfg:{provider:'test',model:'stub'},readTools:false,llm:{stream:o=>{modelPrompt=o.system;return (async function*(){yield {type:'text-delta',text:JSON.stringify(r)}})()}}}),coverage:{record:()=>{recorded++}}})
 let definition;registerAdvisorTool({tools:{register:d=>{definition=d;return()=>{}}}},invoke)
 const out=await definition.execute({mode:'develop_approach',question:'给出有实际帮助的办法'},{agent:{session:{id:'s1',snapshotEvents:()=>[human('m1','实现目标',1)]}}})
 assert.equal(out.ok,true);assert.equal(out.solutionAvailable,true);assert.equal(out.reviewPassed,false);assert.equal(out.completionClaimAllowed,false)
 assert.equal(recorded,0);assert.match(modelPrompt,/独立解题合作者/)
 const denied=await createAdvisor({resolveRuntime:async()=>({ok:false,reason:'assist-off'})})({mode:'develop_approach',question:'q'},{agent:{session}})
 assert.equal(denied.solutionAvailable,false);assert.equal(denied.reviewPassed,false);assert.equal(denied.completionClaimAllowed,false)
 const meta=definition.output.presentationMeta({},out)
 assert.equal(meta.contribution,r.contribution);assert.match(definition.presentResult({},{meta}).content[0].text,/先解决阻塞条件/)
 assert.match(acceptanceBanner(out),/不是验收结果/)
 assert.ok(definition.parameters.properties.mode.enum.includes('develop_approach'))
 assert.equal(parseAdvisorReport(JSON.stringify({...r,verdict:'pass'}),new Set(),'develop_approach').ok,false)
 assert.equal(parseAdvisorReport(JSON.stringify({...r,contribution:''}),new Set(),'develop_approach').ok,false)
})

