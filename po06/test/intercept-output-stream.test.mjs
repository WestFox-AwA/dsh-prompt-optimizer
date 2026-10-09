import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const source=readFileSync(fileURLToPath(new URL('../lib/client.js',import.meta.url)),'utf8')
function load(){
 const registrations=[]
 const window={innerWidth:1200,innerHeight:900,__ModuleLoader__:{load:x=>registrations.push(x)}}
 const React={createElement:(type,props,...children)=>({type,props:props || {},children}),Fragment:'Fragment',useState:v=>[typeof v==='function'?v():v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useCallback:f=>f,useMemo:f=>f()}
 const require=name=>name==='react'?React:{}
 new Function('window','require',source)(window,require)
 const mod=registrations[0].factory(require)
 mod.apply({slots:{register:()=>()=>{},inject:(_slot,cb)=>cb()},locale:'en'})
 return mod.__debug
}
function nodes(node,p,out=[]){
 if(!node || typeof node!=='object')return out
 if(Array.isArray(node)){for(const n of node)nodes(n,p,out);return out}
 if(typeof node.type==='function')return nodes(node.type({...node.props,children:node.children}),p,out)
 if(p(node))out.push(node)
 nodes(node.children,p,out);return out
}
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):''
const raw=JSON.stringify({ops:[{op:'add_item',item:{kind:'quality_interpretation',text:'Visible output grows while generating',rationale:'not output',quote:'not output'}},{op:'add_item',item:{kind:'unknown',text:'Second line',candidates:[{text:'not main text'}]}}]})
test('each live chunk grows real item text before JSON completion',()=>{
 const {interceptDraftOutput:f}=load()
 const marker=raw.indexOf('Visible output')
 const a=f(raw.slice(0,marker+7)),b=f(raw.slice(0,marker+17)),c=f(raw)
 assert.equal(a,'- Visible');assert.equal(b,'- Visible output gr')
 assert.ok(c.startsWith(b));assert.equal(c,'- Visible output grows while generating\n- Second line')
 assert.ok(!c.includes('not output'));assert.ok(!c.includes('not main text'))
})
test('compact output streams intent, clarification, additions and questions before JSON completion',()=>{
 const {interceptDraftOutput:f}=load()
 const raw=JSON.stringify({intent:{text:'Current intent',relation:'continue'},clarify:['Clarify the request'],add:['A useful idea'],ask:['Which audience?']})
 const start=raw.indexOf('A useful idea')
 assert.ok(f(raw.slice(0,start+8)).includes('A useful'))
 const done=f(raw)
 for(const value of ['Current intent','Clarify the request','A useful idea','Which audience?'])assert.ok(done.includes(value))
 assert.ok(!done.includes('continue')&&!done.includes('relation'))
})
test('partial escapes never leak protocol escapes or split Unicode characters',()=>{
 const {interceptDraftOutput:f}=load()
 const prefix='{"ops":[{"item":{"text":"'
 assert.equal(f(prefix+'hello'+String.fromCharCode(92)),'- hello')
 assert.equal(f(prefix+'hello'+String.fromCharCode(92)+'u4F'),' - hello'.trimStart())
 assert.equal(f(prefix+'hello'+String.fromCharCode(92)+'u4F60'),'- hello你')
 assert.equal(f(prefix+'A'+String.fromCharCode(92)+'nB'),'- A\nB')
 assert.equal(f(prefix+String.fromCharCode(92)+'uD83D'),'')
 assert.equal(f(prefix+String.fromCharCode(92)+'uD83D'+String.fromCharCode(92)+'uDE00'),'- 😀')
})
test('actual panel output changes during generation, remains read-only, then uses editable final packet',()=>{
 const d=load(),props={permission:'review',hold:{text:'original'},tier:'standard'}
 const a=d.InterceptPanel({...props,phase:'optimizing',prog:{text:raw.slice(0,raw.indexOf('Visible output')+7)}})
 const b=d.InterceptPanel({...props,phase:'optimizing',prog:{text:raw}})
 const stream=n=>nodes(n,x=>x.props['data-po06']==='intercept-output-stream')[0]
 assert.equal(text(stream(a)),'- Visible');assert.ok(text(stream(b)).includes('Second line'))
 assert.equal(nodes(b,x=>x.type==='textarea').length,0)
 assert.equal(nodes(b,x=>x.props['data-po06']==='intercept-confirm').length,0)
 const packet='【quality】\n- Visible output grows while generating\n- Second line'
 const final=d.InterceptPanel({...props,phase:'review',hold:{text:'original',packet},prog:{text:raw}})
 const textarea=nodes(final,x=>x.type==='textarea')[0]
 assert.equal(textarea.props.value,packet);assert.ok(textarea.props.value.includes(text(stream(a)).slice(2)))
 assert.equal(nodes(final,x=>x.props['data-po06']==='intercept-output-stream').length,0)
})
test('waiting, cancellation and next run do not present previous stream as output',()=>{
 const d=load(),props={permission:'review',hold:{},tier:'standard'}
 for(const phase of ['failed','skipped','sent'])assert.equal(nodes(d.InterceptPanel({...props,phase,prog:{text:raw}}),n=>n.props['data-po06']==='intercept-output-stream').length,0)
 const fresh=d.InterceptPanel({...props,phase:'optimizing',prog:{text:''}})
 assert.equal(nodes(fresh,n=>n.props['data-po06']==='intercept-output-stream').length,0)
 assert.equal(d.interceptDraftOutput('{"ops":[]}'),'')
})
