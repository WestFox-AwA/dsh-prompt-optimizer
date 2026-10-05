import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdvisorProgress, ADVISOR_THINK_LIMIT } from '../lib/advisor-progress.js'
import { createAdvisor } from '../lib/advisor.js'
import { runReadOnlyToolLoop } from '../lib/read-tools.js'
import { createControlHandler } from '../lib/control-api.js'

const events = [{ type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'验收运行'}]} },
  { type:'tool/result',data:{message:{content:[{type:'text',text:'tests passed'}]}} }]
const report = { verdict:'pass',summary:'运行证据已取得',findings:[],checks:[{criterion:'运行',status:'satisfied',evidenceRefs:['E1']}],nextStep:'交付',stopCondition:'出现反例后重审' }
const exec = { callId:'nested-call',agent:{session:{id:'s1',snapshotEvents:()=>events}} }
const runtime = {ok:true,cfg:{provider:'p',model:'m'},readTools:false}

test('按 session/call 隔离，真实流有界，完结后停止修改', () => {
  let time=100
  const store=createAdvisorProgress({now:()=>time})
  const id=store.start({sessionId:'s1',callId:'c1',mode:'review_result',question:'q'})
  store.delta(id,{reasoning:'x'.repeat(ADVISOR_THINK_LIMIT+100),text:'draft'})
  store.event(id,{kind:'round',round:2,final:true})
  assert.equal(store.get('s2',{runId:id}),null)
  assert.equal(store.get('s1',{callId:'not-c1'}),null)
  const live=store.get('s1',{callId:'c1'})
  assert.equal(live.reasoning.length,ADVISOR_THINK_LIMIT)
  assert.equal(live.reasoningTruncated,true)
  assert.equal(live.draft,'')
  assert.equal(live.stage,'conclude')
  time=200;store.finish(id,{ok:true,report})
  store.delta(id,{reasoning:'after end'})
  assert.equal(store.get('s1',{runId:id}).stage,'done')
  assert.equal(store.get('s1',{runId:id}).finishedAt,200)
})

test('完成内容刷新后可回放，在途宿主重启标中断，历史数量有界', () => {
  const home=mkdtempSync(join(tmpdir(),'po06-advisor-ui-'))
  try {
    const store=createAdvisorProgress({home,limit:2})
    const a=store.start({sessionId:'s1',callId:'a'})
    store.delta(a,{reasoning:'真实思考'})
    store.finish(a,{ok:true,report})
    store.start({sessionId:'s1',callId:'b'})
    const restored=createAdvisorProgress({home,limit:2})
    assert.equal(restored.get('s1',{callId:'a'}).reasoning,'真实思考')
    assert.equal(restored.get('s1',{callId:'b'}).stage,'interrupted')
    const c=restored.start({sessionId:'s1',callId:'c'})
    assert.ok(c)
    assert.equal(restored.get('s1',{callId:'a'}),null)
  } finally {rmSync(home,{recursive:true,force:true})}
})

test('无工具路径在调用中就能读到 provider reasoning，最终产出不会含思考副本', async () => {
  const store=createAdvisorProgress()
  let release, emitted
  const ready=new Promise(resolve=>{emitted=resolve})
  const hold=new Promise(resolve=>{release=resolve})
  const invoke=createAdvisor({progress:store,resolveRuntime:async()=>({...runtime,llm:{stream:()=>(async function*(){
    yield {type:'reasoning-delta',text:'先核对原始结果'};emitted();await hold
    yield {type:'text-delta',text:JSON.stringify(report)}
  })()}})})
  const pending=invoke({mode:'review_result',question:'检查运行'},exec)
  await ready
  const live=store.get('s1',{callId:'nested-call'})
  assert.equal(live.reasoning,'先核对原始结果')
  assert.equal(live.stage,'thinking')
  release();const out=await pending
  assert.equal(out.ok,true)
  assert.ok(out.uiRunId)
  assert.ok(!JSON.stringify(out).includes('先核对原始结果'),'仅供界面，不复制给执行模型')
  assert.equal(store.get('s1',{runId:out.uiRunId}).result.report.summary,report.summary)
})

test('只读查证路径收到阶段、活动和实际 delta', async () => {
  const store=createAdvisorProgress()
  const invoke=createAdvisor({progress:store,resolveRuntime:async()=>({...runtime,readTools:true,cwd:tmpdir()}),runLoop:async o=>{
    o.onEvent({kind:'round',round:1,final:false})
    o.onDelta({reasoning:'正在验证',text:''})
    o.onEvent({kind:'tool',tool:'read',target:'sample.js',round:1,ok:true})
    o.onEvent({kind:'round',round:2,final:true})
    o.onDelta({text:JSON.stringify(report)})
    return {text:JSON.stringify(report),trace:[],toolCalls:1}
  }})
  const out=await invoke({mode:'review_result',question:'核对'},exec)
  assert.equal(out.ok,true)
  const row=store.get('s1',{runId:out.uiRunId})
  assert.equal(row.reasoning,'正在验证')
  assert.equal(row.activities[0].target,'sample.js')
  assert.equal(row.round,2)
})

test('到点且无完整报告时，交回思考尾部与查证记录（不能只回一句超时）', async () => {
  const store = createAdvisorProgress()
  const invoke = createAdvisor({ progress: store, timeoutMs: 40, resolveRuntime: async () => ({ ...runtime, readTools: true, cwd: tmpdir() }),
    runLoop: async (o) => {
      o.onEvent({ kind: 'tool', tool: 'read', target: 'evidence.txt', round: 1, ok: true })
      o.onDelta({ reasoning: '正在核对渲染结果与验收点', text: '' })
      // 故意只拿思考、不返回任何报告文本，模拟到点时还没形成 JSON
      await new Promise((resolve) => o.signal.addEventListener('abort', resolve, { once: true }))
      return { text: '', trace: [], toolCalls: 1 }
    } })
  const out = await invoke({ mode: 'review_result', question: '验收' }, exec)
  assert.equal(out.reason, 'advisor-timeout')
  assert.equal(out.partial, true, '到点也要标成部分产出')
  assert.ok(String(out.partialReasoning).includes('正在核对渲染结果'), '要交回思考尾部')
  assert.equal(out.activities[0].target, 'evidence.txt', '要交回查证记录')
})

test('超时导致异常也保留已经收到的思考；部分 pass 降为未验证', async () => {
  const store=createAdvisorProgress()
  const invoke=createAdvisor({progress:store,timeoutMs:15,resolveRuntime:async()=>({...runtime,llm:{stream:o=>(async function*(){
    yield {type:'reasoning-delta',text:'还在分析证据'}
    await new Promise(resolve=>o.signal.addEventListener('abort',resolve,{once:true}))
    yield {type:'text-delta',text:JSON.stringify(report)}
  })()}})})
  const out=await invoke({mode:'review_result',question:'验收'},exec)
  assert.equal(out.partial,true)
  assert.equal(out.report.verdict,'unverified')
  assert.equal(store.get('s1',{runId:out.uiRunId}).stage,'timeout')
  assert.equal(store.get('s1',{runId:out.uiRunId}).reasoning,'还在分析证据')
})

test('实际只读循环转发 provider delta、查证事件并按最终 usage 累计', async () => {
  const root=mkdtempSync(join(tmpdir(),'po06-advisor-loop-'))
  writeFileSync(join(root,'evidence.txt'),'real evidence')
  let round=0
  const events=[], deltas=[]
  const llm={stream:()=>(async function*(){
    round++
    yield {type:'reasoning-delta',text:'思考'+round}
    if(round===1) {
      yield {type:'block-end',block:{type:'tool-call',id:'read-1',name:'read',arguments:JSON.stringify({path:'evidence.txt'})}}
      yield {type:'usage',usage:{inputTokens:5}}
      yield {type:'finish',usage:{inputTokens:5}}
    } else {
      yield {type:'text-delta',text:JSON.stringify(report)}
      yield {type:'usage',usage:{inputTokens:2}}
    }
  })()}
  try {
    const out=await runReadOnlyToolLoop({llm,cfg:{provider:'p',model:'m'},root,rootListing:false,
      shape:{make:({callId,content,isError})=>({role:'tool',toolCallId:callId,content,isError})},
      onDelta:d=>deltas.push(d),onEvent:e=>events.push(e)})
    assert.equal(out.toolCalls,1)
    assert.equal(events.find(e=>e.kind==='tool').target,'evidence.txt')
    assert.ok(deltas.some(d=>d.reasoning==='思考1'))
    assert.ok(deltas.some(d=>d.text===JSON.stringify(report)))
    assert.equal(out.usageSum.inputTokens,7,'同一轮的重复 usage 快照不能加两次')
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('进度 API 要求会话和调用，沿用可信源检查，按身份返回', async () => {
  const store=createAdvisorProgress()
  store.start({sessionId:'s1',callId:'c1'})
  const handler=createControlHandler({home:tmpdir(),advisorProgress:(sid,id)=>store.get(sid,id)})
  const request=async (query,headers={host:'127.0.0.1:3080'})=>{
    const res={status:0,body:null,writeHead(c){this.status=c},end(text){this.body=JSON.parse(text)}}
    await handler({method:'GET',url:'/po06/api/advisor-progress'+query,headers},res)
    return res
  }
  assert.equal((await request('?session=s1')).status,400)
  assert.equal((await request('?session=s1&call=c1')).body.run.callId,'c1')
  assert.equal((await request('?session=s2&call=c1')).body.run,null)
  assert.equal((await request('?session=s1&call=c1',{host:'127.0.0.1:3080',origin:'http://evil.example'})).status,403)
})
test('进度 API 透传增量偏移：给了 since 就只回新增，全量字段为空', async () => {
  const store=createAdvisorProgress()
  const id=store.start({sessionId:'s1',callId:'c1'})
  store.delta(id,{reasoning:'一二三',text:'结论一'})
  let seen=null
  const handler=createControlHandler({home:tmpdir(),advisorProgress:(sid,opt)=>{seen=opt;return store.get(sid,opt)}})
  const request=async (query)=>{
    const res={status:0,body:null,writeHead(c){this.status=c},end(text){this.body=JSON.parse(text)}}
    await handler({method:'GET',url:'/po06/api/advisor-progress'+query,headers:{host:'127.0.0.1:3080'}},res)
    return res
  }
  // 不给 since：老行为，全量正文
  const full=await request('?session=s1&call=c1')
  assert.equal(full.body.run.reasoning,'一二三')
  assert.equal(full.body.run.delta,undefined)
  // 给了 since：偏移要真的传到读取层（而不是被路由丢掉），且只回增量
  const inc=await request('?session=s1&call=c1&since=3&draftSince=3')
  assert.equal(seen.since,'3','查询参数必须原样透传给进度读取')
  assert.equal(seen.draftSince,'3')
  assert.equal(inc.body.run.delta,true)
  assert.equal(inc.body.run.reasoning,'','增量模式下全量字段必须为空')
  assert.equal(inc.body.run.reasoningDelta,'')
  store.delta(id,{reasoning:'四五六'})
  const inc2=await request('?session=s1&call=c1&since=3&draftSince=3')
  assert.equal(inc2.body.run.reasoningDelta,'四五六','只回新增的那一截')
  assert.equal(inc2.body.run.reasoningChars,6)
})

