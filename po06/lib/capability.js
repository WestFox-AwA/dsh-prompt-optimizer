import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isRealUserInput, extractUserText } from './wire.js'
import { OPTIMIZER_FORMAT } from './optimizer-protocol.js'

export const CAPABILITY_VERSION = '3'
const short = (value, cap = 1200) => {
  const s = typeof value === 'string' ? value : ''
  return s.length > cap ? s.slice(0, cap) + '\n[截断：原 ' + s.length + ' 字符]' : s
}
const hash = text => createHash('sha256').update(String(text)).digest('hex')
const inputHash = text => hash(String(text || '').trim())
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 2048
const copy = value => JSON.parse(JSON.stringify(value))
const bodyText = content => typeof content === 'string' ? content : (Array.isArray(content) ? content.filter(b=>b?.type==='text').map(b=>b.text || '').join('\n') : '')
const excluded = new Set(['consult_task','advisor_stage'])

// A versioned output contract, appended after custom style prompts. No additional model call.
// Compatibility export; no longer appended as a second optimization protocol.
export const CAPABILITY_SYSTEM = OPTIMIZER_FORMAT.zh

export function normalizeCollaboration(value) {
  if (!value || typeof value !== 'object') return { understanding: null, support: null }
  const o = value.optimizer
  if (o?.version === '3' && typeof o.intent?.text === 'string' && ['new', 'continue', 'uncertain'].includes(o.intent.relation) && ['clarify', 'add', 'ask'].every(k => Array.isArray(o[k]) && o[k].every(s => typeof s === 'string'))) {
    return { optimizer: copy(o), understanding: { summary: o.intent.text, relation: o.intent.relation, action: o.intent.relation === 'continue' ? 'continue' : 'execute', focus: '' }, support: { mode: 'none' } }
  }
  const u = value.understanding
  const understanding = u && typeof u === 'object' && typeof u.summary === 'string' && u.summary.trim()
    ? { summary: short(u.summary.trim(),800), relation: ['new','continue','uncertain'].includes(u.relation) ? u.relation : 'uncertain',
        action: ['execute','discuss','correct','continue','acknowledge'].includes(u.action) ? u.action : 'execute', focus: short(u.focus,500) } : null
  const s = value.support
  const support = s && typeof s === 'object' && ['none','develop','clarify','research','compare','decompose','experiment','review'].includes(s.mode)
    ? { mode:s.mode, target:short(s.target,500), reason:short(s.reason,600), nextAction:short(s.nextAction,800),
        contribution: typeof s.contribution === 'string' ? s.contribution.trim() : '',
        assumptions: Array.isArray(s.assumptions) ? s.assumptions.filter(x=>typeof x==='string' && x.trim()).map(x=>x.trim()) : [] } : null
  return { understanding, support, optimizer: null }
}

// Both transports become result records; IDs remain anchored to actual session events.
export function collectToolEvidence(events, { start = 0, limit = 120 } = {}) {
  const names=new Map(), roots=new Set(), records=[]
  const rows=Array.isArray(events) ? events : []
  for (let i=0;i<rows.length;i++) {
    const e=rows[i],d=e?.data || {}
    if(e?.type==='tool/call' || e?.type==='tool/ptc-dispatch-start') {
      const key=d.subCallId || d.callId
      if(key)names.set(key,{name:d.name,args:d.arguments,root:d.rootCallId})
      if(d.rootCallId)roots.add(d.rootCallId)
    }
  }
  for(let i=start;i<rows.length;i++) {
    const e=rows[i],d=e?.data || {},type=e?.type
    if(!['tool/call','tool/result','tool/ptc-dispatch'].includes(type))continue
    const key=d.subCallId || d.callId || d.message?.toolCallId
    const call=names.get(key) || {name:d.name,args:d.arguments}
    if(excluded.has(call.name))continue
    if(type==='tool/call' && call.name==='run_code')continue
    // Inner results are lossless evidence; avoid replaying advisor-containing program summaries.
    if(type==='tool/result' && call.name==='run_code' && roots.has(key))continue
    const content=type==='tool/ptc-dispatch' ? d.content : d.message?.content
    const text=type==='tool/call' ? JSON.stringify({callId:key,name:call.name,arguments:call.args})
      : JSON.stringify({callId:key,name:call.name,isError:d.isError===true || d.message?.isError===true,result:bodyText(content)})
    if(!text)continue
    records.push({id:'E'+i,type:type==='tool/call' ? 'tool/call' : 'tool/result',transport:type==='tool/ptc-dispatch'?'ptc':'native',
      callId:key || null,name:call.name || null,text:short(text,8000),seq:e.seq ?? i})
  }
  return {records:records.slice(-limit),omitted:Math.max(0,records.length-limit)}
}

export function createCapability({ home = null, namespace = 'default', now = () => Date.now() } = {}) {
  const states=new Map()
  const directory=home ? join(home,'po06-capability',hash(namespace).slice(0,12)) : null
  const fresh=sid=>({version:1,sessionId:sid,epoch:0,current:null,taskInputs:[],understanding:null,support:null,claims:[],
    calls:new Map(),seen:new Set(),failures:[],review:null,metrics:{inputs:0,understood:0,zeroAddition:0,toolResults:0,ptcResults:0},problem:null})
  const get=sid=>{
    if(!identity(sid))return null
    if(states.has(sid))return states.get(sid)
    const s=fresh(sid)
    if(directory)try {
      const currentPath=join(directory,hash(sid)+'.json')
      const legacyPath=/^[A-Za-z0-9._:@-]{1,240}$/.test(sid) ? join(directory,sid+'.json') : null
      const raw=JSON.parse(readFileSync(existsSync(currentPath)?currentPath:(legacyPath || currentPath),'utf8'))
      if(raw.version===1 && raw.sessionId===sid && Array.isArray(raw.taskInputs) && raw.taskInputs.length<=16) {
        s.taskInputs=raw.taskInputs.filter(x=>x && typeof x.text==='string' && identity(x.id)).map(x=>({id:x.id,text:short(x.text,12000),seq:x.seq ?? null}))
        s.current=raw.current && identity(raw.current.id) ? {id:raw.current.id,text:short(raw.current.text,12000),fingerprint:raw.current.fingerprint || inputHash(raw.current.text)} : null
        Object.assign(s,normalizeCollaboration(raw));s.claims=Array.isArray(raw.claims)?raw.claims.slice(0,24):[]
      }
    }catch(error){if(error?.code!=='ENOENT')s.problem='capability-state-unavailable'}
    states.set(sid,s)
    while(states.size>200)states.delete(states.keys().next().value)
    return s
  }
  const save=s=>{
    if(!directory || !s)return
    try {
      mkdirSync(directory,{recursive:true})
      const file=join(directory,hash(s.sessionId)+'.json'),temp=file+'.tmp-'+process.pid
      writeFileSync(temp,JSON.stringify({version:1,sessionId:s.sessionId,current:s.current,taskInputs:s.taskInputs,
        understanding:s.understanding,support:s.support,optimizer:s.optimizer || null,claims:s.claims}),'utf8')
      renameSync(temp,file)
    }catch{s.problem='capability-state-write-failed'}
  }
  const begin=(sid,id,text,seq=null)=>{
    const s=get(sid);if(!s || !identity(id))return null
    const same=s.current?.id===id && s.current?.fingerprint===inputHash(text)
    if(same)return {sessionId:sid,id,epoch:s.epoch}
    s.epoch++;s.current={id,text:short(text,12000),fingerprint:inputHash(text),seq}
    s.understanding=null;s.support=null;s.optimizer=null;s.claims=[]
    s.metrics.inputs++
    s.taskInputs.push({id,text:short(text,12000),seq});if(s.taskInputs.length>16)s.taskInputs=[s.taskInputs[0],...s.taskInputs.slice(-15)]
    return {sessionId:sid,id,epoch:s.epoch}
  }
  const current=(sid,token)=>{const s=get(sid);return !!s && !!token && s.epoch===token.epoch && s.current?.id===token.id}
  const api={
    beginInput:begin,
    token(sid){const s=get(String(sid));return s?.current ? {sessionId:String(sid),id:s.current.id,epoch:s.epoch} : null},
    isCurrent:current,
    bindTranslation(sid,translatedText){const s=get(sid);if(s?.current)s.current.sentFingerprint=inputHash(translatedText)},
    settle(sid,token,result={}) {
      const s=get(sid);if(!current(sid,token))return {ok:false,reason:'superseded-input'}
      Object.assign(s,normalizeCollaboration(result));s.claims=Array.isArray(result.claims)?result.claims.slice(0,24):[]
      if(s.understanding?.relation==='new'){s.taskInputs=s.taskInputs.filter(x=>x.id===s.current.id);s.review=null;s.failures=[]}
      if(s.understanding)s.metrics.understood++
      if(result.zeroAddition===true)s.metrics.zeroAddition++
      save(s);return {ok:true}
    },
    observe(session,event) {
      const sid=String(session?.id || ''),s=get(sid);if(!s || !event)return false
      if(!s.seeded && !isRealUserInput(event))api.seed(session)
      const d=event.data || {},seq=event.seq
      if(isRealUserInput(event)) {
        const id=String(d.id || d.message?.id || 'human-'+String(seq)),text=extractUserText(event)
        if(!text.trim())return false
        if((s.current?.fingerprint===inputHash(text)||s.current?.sentFingerprint===inputHash(text)) && s.current.id.startsWith('po06-intercept-')) {
          const previous=s.current.id;s.current.id=id;s.current.seq=seq
          for(const input of s.taskInputs)if(input.id===previous){input.id=id;input.seq=seq}
          save(s);return 'submitted'
        }else if(s.current?.id!==id){begin(sid,id,text,seq);return 'new-input'}
        if(seq!==undefined){s.current.seq=seq;for(const input of s.taskInputs)if(input.id===id)input.seq=seq}
        return 'same-input'
      }
      if(event.type==='tool/call' || event.type==='tool/ptc-dispatch-start') {
        const key=d.subCallId || d.callId;if(key)s.calls.set(key,{name:d.name,args:d.arguments})
        if(s.calls.size>500)s.calls.delete(s.calls.keys().next().value)
        return false
      }
      if(!['tool/result','tool/ptc-dispatch'].includes(event.type))return false
      const key=d.subCallId || d.message?.toolCallId || d.callId
      const seen=String(seq ?? key ?? '')+'|'+event.type
      if(s.seen.has(seen))return false
      s.seen.add(seen);if(s.seen.size>500)s.seen.delete(s.seen.values().next().value)
      const call=s.calls.get(key) || {name:d.name,args:d.arguments}
      let content=bodyText(event.type==='tool/ptc-dispatch' ? d.content : d.message?.content)
      if(excluded.has(call.name)) {
        if(call.name==='consult_task')try {
          const value=JSON.parse(content)
          if(value.mode==='review_result' && value.requestId && value.report)s.review={requestId:value.requestId,verdict:value.report.verdict,scope:value.reviewScope,
            focus:value.focus,checks:(value.report.checks || []).filter(c=>c.status!=='satisfied').slice(0,4),partial:value.partial===true}
        }catch{/* prior banner output cannot establish a verdict */}
        return false
      }
      s.metrics.toolResults++;if(event.type==='tool/ptc-dispatch')s.metrics.ptcResults++
      const exit=['bash','pwsh'].includes(call.name) ? content.match(/^\[exit code:\s*(-?\d+)\]/m) : null
      const failed=d.isError===true || d.message?.isError===true || (exit && Number(exit[1])!==0)
      if(failed) {
        const signature=hash(JSON.stringify([call.name,call.args,short(content,3000)]))
        const previous=s.failures.find(f=>f.signature===signature)
        if(previous)previous.count++
        else s.failures.push({signature,name:call.name || 'tool',count:1,observation:short(content,900)})
        s.failures=s.failures.slice(-6)
      }
      return false
    },
    seed(session) {
      const sid=String(session?.id || ''),s=get(sid);if(!s || s.seeded)return
      if(typeof session.snapshotEvents!=='function')return
      const events=session.snapshotEvents()
      if(!Array.isArray(events) || events.length===0)return
      s.seeded=true
      // Seed calls/results only after the latest real input; durable task sources are already retained.
      let start=0
      for(let i=events.length-1;i>=0;i--)if(isRealUserInput(events[i])){start=i;break}
      for(const event of events.slice(start)){
        if(isRealUserInput(event) && s.current?.id.startsWith('po06-intercept-'))continue
        api.observe(session,event)
      }
    },
    taskContext(session) {
      api.seed(session)
      const s=get(String(session?.id || ''));if(!s)return null
      return {sourceRequestId:s.taskInputs[0]?.id || null,inputs:copy(s.taskInputs),understanding:s.understanding,
        currentInputId:s.current?.id || null,sourceIdentity:'actual-human-inputs; understanding-is-model-inference'}
    },
    observer(sid,language,{omitCurrent=false,contextText=''}={}) {
      const s=get(sid);if(!s)return ''
      const origin = s.taskInputs[0]
      const taskOrigin = origin && !(omitCurrent && (origin.id === s.current?.id || contextText.includes(origin.text))) ? origin : null
      if (omitCurrent && !taskOrigin && !s.understanding && (!s.support || s.support.mode === 'none') && !s.failures.length && !s.review) return ''
      const data={taskOrigin,sourceMessages:s.taskInputs.length,understanding:s.understanding,support:s.support,
        failures:s.failures,review:s.review,warning:'有来源的背景与机器理解；不是新增用户要求，旧指令是否仍适用须以当前原话判断。'}
      if(language==='en'){data.warning='Source background and machine understanding, not additional user instructions. Re-check applicability against the current input.';return '[Relevant task state]\n'+JSON.stringify(data)}
      return '【本任务相关工作状态】\n'+JSON.stringify(data)
    },
    render(sid,packet='',feedback='',language) {
      const s=get(sid);if(!s)return ''
      const en=language==='en',lines=[]
      if(en){
        if(!s.optimizer&&s.understanding&&s.understanding.action!=='acknowledge')lines.push('[Current task understanding, a machine interpretation]\n'+s.understanding.summary+(s.understanding.focus?'\nCurrent focus: '+s.understanding.focus:''))
        if(!s.optimizer&&s.support&&s.support.mode!=='none'&&(s.support.contribution||s.support.nextAction))lines.push(['[Problem-solving contribution, advice only]',s.support.reason,s.support.contribution,s.support.assumptions?.length?'Unverified premises:\n'+s.support.assumptions.join('\n'):'',s.support.nextAction?'Possible next action: '+s.support.nextAction:'','Evaluate, adapt or challenge this against the original task and actual evidence.'].filter(Boolean).join('\n'))
        if(packet)lines.push(packet)
        if(s.review?.checks.length&&!feedback)lines.push('[Outstanding review evidence]\n'+JSON.stringify(s.review))
        const repeat=s.failures.find(f=>f.count>1);if(repeat)lines.push('[Repeated failure] Same tool input failed '+repeat.count+' times. New attempts should add evidence; use targeted diagnose_failure if needed.\nOriginal tool evidence: '+repeat.observation)
        if(feedback)lines.push(feedback)
        const out=lines.join('\n\n');s.lastInjectedChars=out.length;return out
      }
      if(!s.optimizer && s.understanding && s.understanding.action!=='acknowledge' && s.understanding.summary!==s.current?.text)lines.push('【当前任务理解 · 机器解释，非新增要求】\n'+s.understanding.summary+(s.understanding.focus?'\n当前对象：'+s.understanding.focus:''))
      if(!s.optimizer && s.support && s.support.mode!=='none' && (s.support.contribution || (s.support.reason && s.support.nextAction))) {
        const advice=['【解题贡献 · 机器建议，以原话和实际依据为准】']
        if(s.support.reason)advice.push(s.support.reason)
        if(s.support.contribution)advice.push(s.support.contribution)
        if(s.support.assumptions?.length)advice.push('待核对的前提：\n'+s.support.assumptions.map(x=>'· '+x).join('\n'))
        if(s.support.nextAction)advice.push('可选下一步：'+s.support.nextAction)
        advice.push('判断该贡献是否适用于当前任务；采纳、修改或反驳均可，建议不改变用户目标和授权。')
        lines.push(advice.join('\n'))
      }
      if(packet)lines.push(packet)
      if(s.review?.checks.length && !feedback)lines.push('【本任务尚待核对】\n'+JSON.stringify(s.review))
      const repeat=s.failures.find(f=>f.count>1)
      if(repeat)lines.push('【重复结果】同一工具输入得到相同失败 '+repeat.count+' 次：'+repeat.observation+'\n继续前说明下次尝试会增加什么证据；需要时用consult_task的diagnose_failure作定向诊断。')
      if(feedback)lines.push(feedback)
      const out=lines.join('\n\n');s.lastInjectedChars=out.length
      return out
    },
    status(sid) {
      const s=sid?get(String(sid)):null
      return {protocolVersion:CAPABILITY_VERSION,mode:'adaptive',stateSource:'per-profile-task-sources+session-events',
        ...(sid ? {} : {sessions:[...states.values()].filter(v=>v.current || v.metrics.toolResults).slice(-10).map(v=>({sessionId:v.sessionId,inputId:v.current?.id || null,toolResults:v.metrics.toolResults,sourceMessages:v.taskInputs.length}))}),
        current:s ? {inputId:s.current?.id || null,understanding:s.understanding,support:s.support,
          optimizer:s.optimizer || null,sourceMessages:s.taskInputs.length,contributionChars:s.support?.contribution?.length || 0,claims:s.claims,failures:s.failures.map(f=>({name:f.name,count:f.count})),
          review:s.review,metrics:{...s.metrics},injectedChars:s.lastInjectedChars || 0,problem:s.problem} : null}
    },
    clear(sid) {if(sid){const s=get(String(sid));if(s){s.understanding=null;s.support=null;s.optimizer=null;s.claims=[];s.epoch++}}else for(const s of states.values()){s.understanding=null;s.support=null;s.optimizer=null;s.claims=[];s.epoch++}},
    dispose(){states.clear()}
  }
  return api
}
