import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
const clone=v=>JSON.parse(JSON.stringify(v))
const terminal=s=>['done','failed','cancelled','interrupted'].includes(s)
export function createInferenceTrace({home,namespace='default',now=Date.now,limit=200}={}) {
 const directory=home?join(home,'po06-inference',createHash('sha256').update(String(namespace)).digest('hex').slice(0,16)):null
 const rows=new Map(),bodies=new Map(),lastSaved=new Map()
 const index=directory?join(directory,'index.json'):null
 const problem={value:null}
 if(index&&existsSync(index))try{for(const row of JSON.parse(readFileSync(index,'utf8'))){if(!row?.runId||!row.sessionId)continue;if(!terminal(row.stage)){row.stage='interrupted';row.reason='host-restarted';row.finishedAt=now()}rows.set(row.runId,row)}}catch(e){problem.value=String(e.message)}
 function atomic(file,data){if(!file)return;try{mkdirSync(directory,{recursive:true});const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(data),'utf8');renameSync(tmp,file)}catch(e){problem.value=String(e.message)}}
 const saveIndex=()=>atomic(index,[...rows.values()].slice(-limit))
 function callPath(runId,callId){return directory?join(directory,runId+'-'+callId+'.json'):null}
 function saveCall(runId,callId,force=false){const key=runId+':'+callId,body=bodies.get(key);if(!body)return;if(!force&&now()-(lastSaved.get(key)||0)<1000)return;lastSaved.set(key,now());atomic(callPath(runId,callId),body)}
 function findCall(row,id){return row?.calls.find(c=>c.callId===id)}
 return {
  start(sessionId,settings,route){
   while(rows.size>=limit){const first=[...rows.values()].find(r=>terminal(r.stage));if(!first)break;rows.delete(first.runId)}
   const runId=randomUUID(),row={runId,sessionId:String(sessionId),stage:'candidates',settings:clone(settings),route:clone(route),startedAt:now(),updatedAt:now(),calls:[],decisions:[],selectedCallId:null,summary:'',reason:null}
   rows.set(runId,row);saveIndex();return runId
  },
  patch(runId,value){const row=rows.get(runId);if(!row)return;Object.assign(row,value,{updatedAt:now()});saveIndex()},
  startCall(runId,{kind,label,round=0,input,route}){
   const row=rows.get(runId);if(!row)return null
   const callId=randomUUID(),c={callId,kind,label,round,route:clone(route),stage:'running',startedAt:now(),updatedAt:now(),textChars:0,reasoningChars:0,toolCount:0,usage:null,finish:null,error:null}
   row.calls.push(c);row.updatedAt=now();bodies.set(runId+':'+callId,{callId,input:clone(input),text:'',reasoning:'',tools:[],blocks:{},reasoningBlocks:{}});saveCall(runId,callId,true);saveIndex();return callId
  },
  chunk(runId,callId,chunk){
   const row=rows.get(runId),c=findCall(row,callId),body=bodies.get(runId+':'+callId);if(!c||!body)return
   if(chunk.type==='text-delta')body.blocks[chunk.index]=(body.blocks[chunk.index]||'')+chunk.text
   if(chunk.type==='reasoning-delta')body.reasoningBlocks[chunk.index]=(body.reasoningBlocks[chunk.index]||'')+chunk.text
   if(chunk.type==='block-end'){
    if(chunk.block?.type==='text')body.blocks[chunk.index]=chunk.block.text||''
    if(chunk.block?.type==='reasoning'&&typeof chunk.block.text==='string')body.reasoningBlocks[chunk.index]=chunk.block.text
    if(chunk.block?.type==='tool-call')body.tools.push(clone(chunk.block))
   }
   if(chunk.type==='usage')c.usage=clone(chunk.usage)
   if(chunk.type==='finish')c.finish=clone(chunk.reason)
   body.text=Object.keys(body.blocks).sort((a,b)=>Number(a)-Number(b)).map(i=>body.blocks[i]).join('\n')
   body.reasoning=Object.keys(body.reasoningBlocks).sort((a,b)=>Number(a)-Number(b)).map(i=>body.reasoningBlocks[i]).join('\n')
   c.textChars=body.text.length;c.reasoningChars=body.reasoning.length;c.toolCount=body.tools.length;c.updatedAt=now();row.updatedAt=now();saveCall(runId,callId)
  },
  finishCall(runId,callId,patch={}){const row=rows.get(runId),c=findCall(row,callId);if(!c)return;Object.assign(c,patch,{stage:patch.error?'failed':'done',finishedAt:now(),updatedAt:now()});saveCall(runId,callId,true);saveIndex()},
  body(runId,callId){
   const row=rows.get(runId);if(!findCall(row,callId))return null
   const active=bodies.get(runId+':'+callId);if(active)return clone(active)
   const file=callPath(runId,callId);if(file&&existsSync(file))try{return JSON.parse(readFileSync(file,'utf8'))}catch(e){problem.value=String(e.message)}
   return null
  },
  decision(runId,decision){const r=rows.get(runId);if(!r)return;r.decisions.push({...clone(decision),at:now()});r.updatedAt=now();saveIndex()},
  finish(runId,patch){const r=rows.get(runId);if(!r)return;Object.assign(r,patch,{finishedAt:now(),updatedAt:now()});for(const c of r.calls){saveCall(runId,c.callId,true);if(directory)bodies.delete(runId+':'+c.callId)}saveIndex()},
  list(sessionId){return [...rows.values()].filter(r=>r.sessionId===String(sessionId)).reverse().map(clone)},
  get(sessionId,runId,callId,offsets={}){
   const row=rows.get(runId);if(row?.sessionId!==String(sessionId))return null
   if(!callId)return clone(row)
   const body=this.body(runId,callId);if(!body)return null
   const take=(name,offset)=>{const n=Number(offset);return Number.isSafeInteger(n)&&n>=0&&n<=body[name].length?body[name].slice(n):body[name]}
   return {...clone(findCall(row,callId)),input:offsets.input?body.input:null,textDelta:take('text',offsets.text),reasoningDelta:take('reasoning',offsets.reasoning),textLength:body.text.length,reasoningLength:body.reasoning.length,textReset:Number(offsets.text)>body.text.length,reasoningReset:Number(offsets.reasoning)>body.reasoning.length,tools:body.tools}
  },
  status(){return {directory,problem:problem.value,retainedRuns:rows.size}},
  dispose(){for(const row of rows.values())if(!terminal(row.stage))this.finish(row.runId,{stage:'interrupted',reason:'plugin-unloaded'});saveIndex()}
 }
}
