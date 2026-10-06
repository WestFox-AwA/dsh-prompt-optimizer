import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {EventEmitter} from 'node:events'
import {createInferenceTrace} from '../lib/inference-trace.js'
import {createControlHandler} from '../lib/control-api.js'
function client(){const registrations=[],slots=[],win={__ModuleLoader__:{load:r=>registrations.push(r)}};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'F',useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useCallback:f=>f,useMemo:f=>f()};const req=name=>name==='react'?React:{};
 new Function('window','require',readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'))(win,req)
 const mod=registrations[0].factory(req);const dispose=mod.apply({slots:{register:(o,c)=>{slots.push({o,c});return()=>{}},inject:(_s,cb)=>cb()},locale:'zh'});return {mod,slots,dispose}
}
function nodes(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(nodes);return [node,...nodes(node.children)]}

// 「实验性功能」区块必须真的在弹出面板内部：插到面板外面会让它按整条宽度渲染、压住对话区
// （2026-10-06 真机截图事故）。这里用括号配对静态钉住位置，不依赖运行时状态。
test('experimental section lives inside the options popup',()=>{
 const text=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8')
 const popupOpen=text.lastIndexOf("h('div'",text.indexOf('S.optPop'))
 let depth=0,popupClose=-1
 for(let i=popupOpen;i<text.length;i++){const ch=text[i];if(ch==='(')depth++;else if(ch===')'){depth--;if(depth===0){popupClose=i;break}}}
 const divider=text.indexOf("'data-po06': 'experimental-divider'")
 const controls=text.indexOf('h(InferenceControls,{settings:eff',divider)
 assert.ok(divider>popupOpen&&divider<popupClose,'分界标题必须在弹出面板内部')
 assert.ok(controls>popupOpen&&controls<popupClose,'推理增强控件必须在弹出面板内部')
})

test('actual client mounts trace and the switch preserves per-session intent',()=>{
 const c=client();assert.equal(c.slots.filter(s=>s.o.name==='conversation.input.left').length,1)
 const bar=c.slots.find(s=>s.o.id==='prompt-optimizer').c({sessionId:'test-session',inputActions:{}})
 assert.ok(nodes(bar).some(n=>n.props['data-po06']==='options-btn'))
 // 关着「推理增强」时不该出现「推理过程」入口；开关打开才显示（见 english-mode 套件的源码断言）
 assert.ok(!nodes(bar).some(n=>n.type===c.mod.__debug.InferenceMonitor))
 const saved=[],tree=c.mod.__debug.InferenceControls({settings:{reasoningBoost:false,reasoningPace:'fast'},ready:true,save:p=>saved.push(p)})
 const button=nodes(tree).find(n=>n.props['data-po06']==='reasoning-boost')
 assert.ok(button);button.props.onClick();assert.deepEqual(saved,[{reasoningBoost:true}])
 assert.ok(nodes(tree).some(n=>n.props['data-po06']==='reasoning-mode'))
 const pace=nodes(tree).find(n=>n.props['data-po06']==='reasoning-pace')
 assert.equal(pace.props.value,'fast');pace.props.onChange({target:{value:'inherit'}})
 assert.deepEqual(saved[1],{reasoningPace:'inherit'})
 assert.ok(c.mod.__debug.InferenceMonitor({sessionId:'test-session'}))
 c.dispose()
})
function req({url,method='GET',body,headers={}}){const r=new EventEmitter();Object.assign(r,{url,method,headers:{host:'127.0.0.1:19387',...headers}});setImmediate(()=>{if(body)r.emit('data',Buffer.from(JSON.stringify(body)));r.emit('end')});return r}
async function call(handler,options){let status,value;await handler(req(options),{writeHead:s=>status=s,end:text=>value=JSON.parse(text)});return {status,value}}
test('full traces survive reload and API refuses cross-session lookup and untrusted cancellation',async()=>{
 const home=mkdtempSync(join(tmpdir(),'inference-ui-'));try{
  const t=createInferenceTrace({home}),run=t.start('A',{},{}),id=t.startCall(run,{kind:'candidate',label:'one',input:{messages:['original task']},route:{}})
  const output='content'.repeat(10000);t.chunk(run,id,{type:'text-delta',index:0,text:output});t.finishCall(run,id);t.finish(run,{stage:'done',selectedCallId:id})
  const restored=createInferenceTrace({home});assert.equal(restored.get('A',run,id,{input:true}).textDelta,output)
  let cancellations=0
  const h=createControlHandler({home,inferenceList:s=>restored.list(s),inferenceGet:(s,r,c,o)=>restored.get(s,r,c,o),inferenceCancel:()=>{cancellations++;return {ok:true}}})
  writeFileSync(join(home,'po06.json'),JSON.stringify({reasoningBoost:false,bySession:{A:{reasoningBoost:true,reasoningMode:'hybrid',reasoningCandidates:3,reasoningRounds:2,reasoningPace:'balanced'}}}))
  const status=await call(h,{url:'/po06/api/status?session=A'})
  assert.equal(status.value.sessionEffective.reasoningBoost,true)
  assert.equal(status.value.sessionEffective.reasoningMode,'hybrid')
  assert.equal(status.value.sessionEffective.reasoningCandidates,3)
  assert.equal(status.value.sessionEffective.reasoningRounds,2)
  assert.equal(status.value.sessionEffective.reasoningPace,'balanced')
  assert.equal((await call(h,{url:'/po06/api/inference-run?session=B&run='+run+'&call='+id})).status,404)
  const result=await call(h,{url:'/po06/api/inference-run?session=A&run='+run+'&call='+id+'&text=69999&input=1'})
  assert.equal(result.status,200);assert.equal(result.value.value.textDelta,output.slice(69999));assert.deepEqual(result.value.value.input,{messages:['original task']})
  assert.equal((await call(h,{method:'POST',url:'/po06/api/inference-cancel',body:{sessionId:'A',runId:run}})).status,403)
  assert.equal(cancellations,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})
