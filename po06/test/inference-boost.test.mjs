import test from 'node:test'
import assert from 'node:assert/strict'
import {createInferenceBoost,effortPlan} from '../lib/inference-boost.js'
import {createInferenceTrace} from '../lib/inference-trace.js'
import {normalizeSettings,mergeSettings} from '../lib/settings.js'
import {effectiveSettings} from '../lib/policy.js'
const finish=kind=>({type:'finish',reason:{kind}})
async function* text(s){yield {type:'text-delta',index:0,text:s};yield {type:'block-end',index:0,block:{type:'text',text:s}};yield {type:'usage',usage:{inputTokens:3,outputTokens:2,totalTokens:5}};yield finish('stop')}
async function* tool(id){yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name:'write',argumentsDelta:'{"value":"'+id+'"}'};yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'write',arguments:'{"value":"'+id+'"}'}};yield finish('tool-calls')}
const request=()=>Object.freeze({provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'max',maxTokens:256000,sessionId:'sessionA',messages:Object.freeze([{role:'user',content:[{type:'text',text:'complete task'}]}]),tools:[{name:'write',parameters:{type:'object'}}]})
const collect=async stream=>{const chunks=[];for await(const c of stream)chunks.push(c);return chunks}
function make(responder,config={reasoningBoost:true,reasoningMode:'parallel',reasoningCandidates:2,reasoningRounds:1}){
 const trace=createInferenceTrace(),requests=[]
 const llm={stream(o){requests.push(o);return responder(o,requests.length)}}
 const boost=createInferenceBoost({llm,trace,isWorkingRequest:o=>o.sessionId==='sessionA',settingsFor:()=>config})
 return {boost,trace,requests,llm}
}
test('default off and session settings do not disturb optimizer tier or other sessions',()=>{
 assert.equal(normalizeSettings({}).settings.reasoningBoost,false)
 const raw=mergeSettings({}, {bySession:{sessionA:{reasoningBoost:true,reasoningMode:'loop',reasoningRounds:2}}}).settings
 assert.equal(effectiveSettings(raw,'sessionA').reasoningBoost,true)
 assert.equal(effectiveSettings(raw,'sessionB').reasoningBoost,false)
 assert.equal(effectiveSettings(raw,'sessionA').reasoningRounds,2)
 assert.equal(normalizeSettings({reasoningCandidates:99}).settings.reasoningCandidates,2)
})
test('two candidates submit only the chosen original tool stream; parent and route stay intact',async()=>{
 let copies=0
 const h=make(o=>o.system?text(JSON.stringify({selected:JSON.parse(o.messages[0].content[0].text).material[1].id,reason:'valid second action',summary:'chosen action'})):tool('copy'+(++copies)))
 const base=request(),before=JSON.stringify(base),result=await collect(h.boost.intercept(base,()=>{throw new Error('ordinary path should not run')}))
 assert.equal(result.filter(c=>c.type==='block-end'&&c.block.type==='tool-call').length,1)
 assert.equal(JSON.stringify(base),before)
 assert.equal(h.requests.length,3)
 assert.ok(h.requests.every(o=>o.model==='deepseek-flash'&&o.reasoningEffort==='max'&&o.maxTokens===256000))
 assert.ok(h.requests.every(o=>o.sessionId!==base.sessionId))
 const row=h.trace.list('sessionA')[0]
 assert.equal(row.stage,'done');assert.equal(row.calls.length,3)
 assert.equal(row.calls.filter(c=>c.kind==='selector').length,1)
 assert.equal(row.selectedCallId,row.decisions.at(-1).selected)
 assert.ok(h.trace.get('sessionA',row.runId,row.selectedCallId,{input:true}).tools.length===1)
 assert.equal(h.trace.get('sessionB',row.runId),null)
})
test('bad selection preserves valid baseline and records why',async()=>{
 let n=0
 const h=make(o=>text(o.system?'invalid selector JSON':'candidate '+(++n)))
 const result=await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.ok(result.some(c=>c.type==='text-delta'&&c.text==='candidate 1'))
 assert.equal(h.trace.list('sessionA')[0].decisions.at(-1).fallback,true)
})
test('feedback revision remains eligible against original, and each round stays visible',async()=>{
 let copies=0
 const h=make(o=>{
  if(o.system?.includes('具体反馈者'))return text(JSON.stringify({revise:true,feedback:'fix a concrete issue',summary:'one fix'}))
  if(o.system?.includes('候选选择器')){const a=JSON.parse(o.messages[0].content[0].text);return text(JSON.stringify({selected:a.material.find(x=>x.text==='revision').id,reason:'fixes observed issue',summary:'improved'}))}
  return text(++copies===1?'original':'revision')
 },{reasoningBoost:true,reasoningMode:'loop',reasoningCandidates:2,reasoningRounds:1})
 const result=await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.ok(result.some(c=>c.type==='text-delta'&&c.text==='revision'))
 const row=h.trace.list('sessionA')[0]
 assert.deepEqual(row.calls.map(c=>c.kind),['candidate','feedback','revision','selector'])
 assert.equal(row.summary,'improved')
 assert.ok(row.decisions.some(d=>d.kind==='feedback'&&d.revise===true))
})
test('cancelled parent submits no candidate tool call and does not invoke fallback',async()=>{
 const ac=new AbortController();let released
 const h=make(o=>(async function*(){await new Promise(resolve=>{released=resolve;o.signal.addEventListener('abort',resolve,{once:true})});yield {type:'text-delta',index:0,text:'late'};yield finish('stop')})())
 const pending=collect(h.boost.intercept({...request(),signal:ac.signal},()=>{throw new Error('fallback after abort')}))
 for(let n=0;n<12&&!released;n++)await Promise.resolve()
 ac.abort(new Error('cancel'));assert.deepEqual(await pending,[])
 assert.equal(h.trace.list('sessionA')[0].stage,'cancelled')
})
test('ordinary and auxiliary requests bypass enhancement exactly',async()=>{
 const h=make(()=>{throw new Error('unexpected generation')},{reasoningBoost:false})
 assert.equal((await collect(h.boost.intercept(request(),()=>text('ordinary'))))[0].text,'ordinary')
 assert.equal(h.trace.list('sessionA').length,0)
 const on=make(()=>{throw new Error('unexpected generation')})
 assert.equal((await collect(on.boost.intercept({...request(),sessionId:'auxiliary'},()=>text('aux'))))[0].text,'aux')
})
test('trace exposes full provider text and reasoning with independent offsets',()=>{
 const t=createInferenceTrace(),id=t.start('sessionA',{},{}),call=t.startCall(id,{kind:'candidate',label:'1',input:{},route:{}}),long='x'.repeat(50000)
 t.chunk(id,call,{type:'text-delta',index:0,text:long});t.chunk(id,call,{type:'reasoning-delta',index:1,text:'reported reasoning'})
 assert.equal(t.get('sessionA',id,call,{text:49999,reasoning:9}).textDelta,'x')
 assert.equal(t.get('sessionA',id,call).textLength,long.length)
 assert.equal(t.get('sessionA',id,call).reasoningDelta,'reported reasoning')
})

test('failed ordinary fallback stays failed and its call is visible',async()=>{
 const incomplete=()=> (async function*(){yield finish('error')})()
 const h=make(incomplete)
 await collect(h.boost.intercept(request(),incomplete))
 const row=h.trace.list('sessionA')[0]
 assert.equal(row.stage,'failed');assert.equal(row.calls.at(-1).kind,'fallback')
 assert.equal(row.selectedCallId,row.calls.at(-1).callId)
})

test('fast effort uses supported low/off roles without changing model, parent or output ceiling',async()=>{
 const h=make(o=>o.system?text(JSON.stringify({selected:JSON.parse(o.messages[0].content[0].text).material[0].id,reason:'direct comparison',summary:'use candidate'})):tool('action'+h.requests.length))
 const info={reasoning:{efforts:[{id:'off'},{id:'low'},{id:'high'},{id:'max'}],defaultEffort:'high'}}
 h.llm.resolveModelInfo=async()=>info
 const base=request(),before=JSON.stringify(base);await collect(h.boost.intercept(base,()=>text('ordinary')))
 assert.deepEqual(h.requests.map(o=>o.reasoningEffort),['low','low','off'])
 assert.ok(h.requests.every(o=>o.model===base.model&&o.maxTokens===base.maxTokens))
 assert.equal(JSON.stringify(base),before)
 assert.deepEqual(effortPlan(base,'balanced',info).candidate,'high')
 assert.equal(effortPlan(base,'balanced',info).review,'low')
 assert.equal(effortPlan(base,'inherit',info).review,'max')
 assert.equal(effortPlan(base,'fast',{}).candidate,'max')
 assert.equal(h.trace.list('sessionA')[0].effortPlan.review,'off')
})
test('same proposed tools with different IDs and JSON key order bypass the selector visibly',async()=>{
 let n=0
 const h=make(()=> (async function*(){const argumentsText=++n===1?'{"a":1,"b":2}':'{"b":2,"a":1}';yield {type:'block-end',index:0,block:{type:'tool-call',id:'different'+n,name:'write',arguments:argumentsText}};yield finish('tool-calls')})())
 const result=await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.equal(h.requests.length,2);assert.equal(result.filter(c=>c.block?.type==='tool-call').length,1)
 const row=h.trace.list('sessionA')[0]
 assert.ok(row.decisions.some(d=>d.skipped&&d.reason.includes('相同')))
})
test('hybrid selection reuses its feedback rather than launching a second review',async()=>{
 let n=0
 const h=make(o=>{
  if(o.system)return text(JSON.stringify({selected:JSON.parse(o.messages[0].content[0].text).material[0].id,reason:'valid action',summary:'no change',revise:false,feedback:'no material error'}))
  return tool('action'+(++n))
 },{reasoningBoost:true,reasoningMode:'hybrid',reasoningCandidates:2,reasoningRounds:3})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 const row=h.trace.list('sessionA')[0]
 assert.deepEqual(row.calls.map(c=>c.kind),['candidate','candidate','selector'])
 const feedback=row.decisions.find(d=>d.kind==='feedback')
 assert.equal(feedback.callId,row.calls[2].callId);assert.equal(feedback.revise,false)
})
test('unchanged revisions stop before another selection or feedback round',async()=>{
 const h=make(o=>o.system?text(JSON.stringify({revise:true,feedback:'suggest an adjustment',summary:'review'})):text('same answer'),{reasoningBoost:true,reasoningMode:'loop',reasoningCandidates:2,reasoningRounds:3})
 await collect(h.boost.intercept(request(),()=>text('ordinary')))
 const row=h.trace.list('sessionA')[0]
 assert.deepEqual(row.calls.map(c=>c.kind),['candidate','feedback','revision'])
 assert.ok(row.decisions.some(d=>d.skipped&&d.reason.includes('未产生新')))
})
test('rejected revision ends the cycle and preserves the original result',async()=>{
 let n=0
 const h=make(o=>{
  if(o.system?.includes('具体反馈者'))return text(JSON.stringify({revise:true,feedback:'possible correction',summary:'review'}))
  if(o.system){const a=JSON.parse(o.messages[0].content[0].text);return text(JSON.stringify({selected:a.material.find(c=>c.text==='original').id,reason:'original better',summary:'keep original'}))}
  return text(++n===1?'original':'revised')
 },{reasoningBoost:true,reasoningMode:'loop',reasoningCandidates:2,reasoningRounds:3})
 const result=await collect(h.boost.intercept(request(),()=>text('ordinary')))
 assert.equal(h.requests.length,4);assert.ok(result.some(c=>c.text==='original'))
 assert.ok(h.trace.list('sessionA')[0].decisions.some(d=>d.skipped&&d.reason.includes('原方案仍优')))
})


