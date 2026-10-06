import test from 'node:test'
import assert from 'node:assert/strict'
import {protectEnglishLiterals,restoreEnglishTranslation,validateEnglishExcerpt,createEnglishMode,prepareEnglishInterpretation,finishEnglishInput} from '../lib/english-mode.js'
import {EN_INTERPRETER,EN_CAPABILITY,EN_SELECT,EN_FEEDBACK} from '../lib/english-prompts.js'
import {parseInterpreterOutput} from '../lib/interpreter.js'
import {reduce} from '../lib/reducer.js'
import {createState} from '../lib/schema.js'
import {compileAudited} from '../lib/compiler.js'
import {createCapability} from '../lib/capability.js'
import {normalizeSettings} from '../lib/settings.js'
import {effectiveSettings} from '../lib/policy.js'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const cfg={provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'max'}
const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.children)]
async function* response(text){yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}}}
test('literal protection keeps code, paths, URLs, numbers and exact UI text intact',()=>{
 const source='不要读取其它文件。创建 '+String.fromCharCode(96)+'变量中文'+String.fromCharCode(96)+'，保存到 @"D:/项目/结果.html"，网址 https://example.com/a?v=3 ，按钮文字必须为“开始”，数量为 12。'
 const p=protectEnglishLiterals(source)
 assert.ok(p.literals.some(l=>l.value==='开始'))
 const english='Do not read other files. '+p.literals.map(l=>l.token).join(' ')
 const result=restoreEnglishTranslation(p,english)
 for(const l of p.literals)assert.ok(result.text.includes(l.value))
 assert.throws(()=>restoreEnglishTranslation(p,english.replace(p.literals[0].token,'')),/literal/)
 assert.throws(()=>restoreEnglishTranslation(p,english+' '+p.literals[0].token),/literal/)
})
test('original requirement and translated excerpt stay separate through reducer/compiler',()=>{
 const p=parseInterpreterOutput(JSON.stringify({ops:[{op:'add_item',item:{id:'req-1',kind:'user_requirement',quote:'不要读取其它文件',englishQuote:'Do not read other files',text:'Do not read other files',scope:'turn',sourceRefs:[{kind:'human',sessionId:'s',messageId:'m'}]}}],understanding:{summary:'Build the requested result',relation:'new',action:'execute'}}),{userText:'不要读取其它文件，制作单HTML。',sessionId:'s',messageId:'m',baseRevision:0,baseInputRevision:0,englishMode:true})
 assert.equal(p.patch.ops[0].item.text,'不要读取其它文件')
 const state=reduce(createState({sessionId:'s',taskId:'t'}),p.patch).state
 assert.equal(state.items[0].sourceQuote,'不要读取其它文件')
 assert.equal(state.items[0].englishText,'Do not read other files')
 const result=compileAudited(state,{language:'en',budget:3000})
 assert.equal(result.ok,true);assert.match(result.text,/Do not read other files/);assert.ok(!result.text.includes('不要读取'))
 assert.equal(validateEnglishExcerpt('保存到 D:/目录/a.html','Save to D:/other/a.html'),false)
})
test('translation uses no tools or new output cap, caches separately, and refuses late records',async()=>{
 const home=mkdtempSync(join(tmpdir(),'english-mode-'));try{
 let calls=0,request
 const service=createEnglishMode({home})
 const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:'low'},{id:'max'}]}}),stream:o=>{calls++;request=o;return response(JSON.stringify({translation:'Do not read other files. Create a single HTML application.'}))}}
 const first=await service.translate('不要读取其它文件。制作单HTML。',{llm,cfg})
 assert.equal(request.reasoningEffort,'low');assert.deepEqual(request.tools,[]);assert.equal(request.maxTokens,undefined)
 assert.equal(first.translated,true)
 assert.equal((await service.translate('不要读取其它文件。制作单HTML。',{llm,cfg})).cached,true);assert.equal(calls,1)
 assert.equal((await service.translate('Reply in Chinese.',{llm,cfg})).text,'Reply in Chinese.');assert.equal(calls,1)
 const stale=service.begin('s','m1','旧任务'),fresh=service.begin('s','m2','新任务')
 assert.throws(()=>service.record(stale,'old task'),/superseded/)
 service.record(fresh,'new task');assert.equal(service.get('s').originalText,'新任务')
 assert.equal(service.bind('s','real-m2','new task'),true)
 const restored=createEnglishMode({home});assert.equal(restored.get('s').translatedText,'new task')
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('submitted English binds the same source task rather than resetting it',()=>{
 const c=createCapability(),token=c.beginInput('s','po06-intercept-m','不要读取其它文件')
 c.settle('s',token,{understanding:{summary:'Do not read other files',relation:'new',action:'execute'}})
 c.bindTranslation('s','Do not read other files')
 assert.equal(c.observe({id:'s'},{type:'user/message',seq:2,data:{id:'real-m',source:{kind:'user'},content:[{type:'text',text:'Do not read other files'}]}}),'submitted')
 assert.equal(c.taskContext({id:'s'}).inputs[0].text,'不要读取其它文件')
 assert.match(c.render('s','','','en'),/Current task understanding/)
})
test('English toggle is independent and adds no response-language forcing',()=>{
 assert.equal(normalizeSettings({}).settings.englishMode,false)
 assert.equal(effectiveSettings({assist:'off',bySession:{A:{englishMode:true}}},'A').englishMode,true)
 assert.equal(effectiveSettings({bySession:{A:{englishMode:true}}},'B').englishMode,false)
 for(const prompt of [EN_INTERPRETER,EN_CAPABILITY,EN_SELECT,EN_FEEDBACK])assert.ok(!/[\u3400-\u9fff]/.test(prompt))
 assert.ok(!/always (reply|respond).*English/i.test(EN_INTERPRETER))
})
test('Chinese UI offers English toggle and selects translated outgoing task only when enabled',()=>{
 const registrations=[],slots=[];const win={__ModuleLoader__:{load:r=>registrations.push(r)}}
 const react={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'F',useState:v=>[typeof v==='function'?v():v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useMemo:f=>f(),useCallback:f=>f}
 const require=name=>name==='react'?react:{}
 new Function('window','require',readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'))(win,require)
 const client=registrations[0].factory(require),dispose=client.apply({slots:{register:(o,c)=>{slots.push({o,c});return()=>{}},inject:(_s,cb)=>cb()},locale:'zh'})
 const saved=[],tree=client.__debug.EnglishControls({settings:{englishMode:false},save:p=>saved.push(p),ready:true})
 const slot=nodes(tree).find(n=>n.props&&n.props.name==='english-mode')
 assert.ok(slot,'英文模式必须是与权限同款的两档控件')
 assert.deepEqual(slot.props.options,['off','on'],'两档：关闭 / 开启')
 assert.equal(slot.props.value,'off','默认关闭')
 const seg=nodes(client.__debug.Segmented({...slot.props,failTick:0})).find(n=>n.props['data-po06']==='english-mode')
 assert.ok(seg,'分段控件必须带可核对的标记')
 seg.props.onKeyDown({key:'End',preventDefault(){}})
 assert.deepEqual(saved,[{englishMode:true}])
 assert.equal(client.__debug.outgoingUserText({text:'原话',outgoingText:'English task',englishMode:true}),'English task')
 assert.equal(client.__debug.outgoingUserText({text:'原话',outgoingText:'English task',englishMode:false}),'原话')
 assert.equal(slots.filter(s=>s.o.name==='conversation.input.left').length,1)
 dispose()
})

test('expanded translated excerpt absent from the actual task cannot acquire authority',()=>{
 const p=parseInterpreterOutput(JSON.stringify({ops:[{op:'add_item',item:{id:'req-1',kind:'user_requirement',quote:'改成蓝色',text:'Change to blue',englishQuote:'Change to blue and deploy to production',sourceRefs:[{kind:'human',sessionId:'s',messageId:'m'}]}}]}),{userText:'改成蓝色',translatedText:'Change to blue',englishMode:true,sessionId:'s',messageId:'m',baseRevision:0,baseInputRevision:0})
 assert.equal(p.patch.ops[0].item.text,'改成蓝色')
 assert.equal(p.patch.ops[0].item.englishText,undefined)
})

test('literal JSON and exact requested reply remain untouched; disabling invalidates in-flight translation',()=>{
 const p=protectEnglishLiterals('只回复“完成”，数据为 {"name":"中文","x":3}')
 const restored=restoreEnglishTranslation(p,'Reply only '+p.literals.map(l=>l.token).join(' and '))
 assert.ok(restored.text.includes('完成'));assert.ok(restored.text.includes('{"name":"中文","x":3}'))
 const c=createEnglishMode(),token=c.begin('A','m','原话');c.settingsChanged(()=>false)
 assert.throws(()=>c.record(token,'original text'),/superseded/)
})

test('greeting Hello survives original Chinese in focus without inventing a task or reply language',()=>{
 const original='你好'
 const response={englishTask:'Hello',ops:[{op:'add_item',item:{id:'req-hi',kind:'user_requirement',text:'Greeting',quote:original,englishQuote:'Hello',sourceRefs:[{kind:'human',sessionId:'s',messageId:'m'}]}}],understanding:{summary:'The user has only said hello.',relation:'new',action:'acknowledge',focus:'the bare greeting "你好" and the still-unstated task'},support:{mode:'clarify',nextAction:'Greet back briefly in Chinese and ask which file to edit.'}}
 const ready=prepareEnglishInterpretation(response,original)
 assert.equal(ready.translation.text,'Hello');assert.equal(response.understanding.focus,'the bare greeting "你好" and the still-unstated task')
 assert.equal(ready.value.understanding.focus,'the bare greeting "Hello" and the still-unstated task')
 assert.deepEqual(ready.value.ops,[]);assert.deepEqual(ready.value.support,{mode:'none'})
 const parsed=parseInterpreterOutput(JSON.stringify(ready.value),{userText:original,translatedText:ready.translation.text,englishMode:true,sessionId:'s',messageId:'m',baseRevision:0,baseInputRevision:0})
 assert.equal(parsed.ok,true);assert.equal(parsed.patch,null);assert.equal(parsed.understanding.action,'acknowledge')
})
test('untranslated optional advice is omitted while valid user task and source quotes survive',()=>{
 const value={englishTask:'Build one HTML file',ops:[{op:'add_item',item:{id:'req-html',kind:'user_requirement',quote:'制作一个HTML文件',text:'Build one HTML file',englishQuote:'Build one HTML file'}}],understanding:{summary:'Build a page',action:'execute',focus:'这项任务'},support:{mode:'develop',reason:'Provide a usable file',contribution:'更精细的内部说明'},hardNote:'保持精细'}
 const result=prepareEnglishInterpretation(value,'制作一个HTML文件')
 assert.equal(result.translation.text,'Build one HTML file');assert.equal(result.value.ops[0].item.quote,'制作一个HTML文件')
 assert.equal(result.value.support.contribution,'');assert.equal(result.value.understanding.focus,'')
 assert.ok(result.warnings.some(w=>w.reason==='untranslated-optional-assistance-omitted'))
})
test('valid translated task completes even when optional assistance is absent, without another translation',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好');let calls=0
 const out=await finishEnglishInput({service,token,enabled:()=>true,produced:{outcome:'understood',englishTranslation:{text:'Hello'}},translate:async()=>{calls++;throw new Error('not needed')}})
 assert.equal(out.ok,true);assert.equal(out.translation.text,'Hello');assert.equal(calls,0)
})
test('failed interpretation translates the original once and retains the actual failure reason',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好');let calls=0
 const out=await finishEnglishInput({service,token,enabled:()=>true,produced:{outcome:'interpret-threw',trace:[{step:'interpret',ok:false,error:'malformed-optional-output'}]},translate:async()=>{calls++;return {text:'Hello'}}})
 assert.equal(calls,1);assert.equal(out.ok,true);assert.equal(out.fallback,true)
 assert.equal(out.translation.assistanceReason,'malformed-optional-output')
 const broken=await finishEnglishInput({service,token,enabled:()=>true,produced:null,translate:async()=>{throw new Error('english-translation-incomplete')}})
 assert.equal(broken.ok,false);assert.equal(broken.reason,'english-translation-incomplete')
})
test('superseded cancelled and disabled inputs never launch fallback translation',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好');let calls=0
 const opts={service,token,enabled:()=>true,produced:null,translate:async()=>{calls++;return {text:'Hello'}}}
 const disabled=await finishEnglishInput({...opts,enabled:()=>false});assert.equal(disabled.reason,'english-mode-disabled')
 const ac=new AbortController();ac.abort();assert.equal((await finishEnglishInput({...opts,signal:ac.signal})).reason,'aborted')
 assert.equal((await finishEnglishInput({...opts,produced:{outcome:'superseded-input'}})).reason,'english-input-superseded')
 service.begin('s','new','下一条');assert.equal((await finishEnglishInput(opts)).reason,'english-input-superseded')
 assert.equal(calls,0)
})
test('a fallback translation finishing after newer input is rejected',async()=>{
 const service=createEnglishMode(),token=service.begin('s','m','你好');let resolve
 const result=finishEnglishInput({service,token,enabled:()=>true,produced:null,translate:()=>new Promise(r=>{resolve=r})})
 service.begin('s','new','新输入');resolve({text:'Hello'})
 const out=await result;assert.equal(out.ok,false);assert.equal(out.reason,'english-input-superseded')
})

test('slash commands stay literal and allowlisted commands remain interceptable in English mode',()=>{
 const prepared=protectEnglishLiterals('/vmake 做一辆坦克')
 assert.ok(prepared.literals.some(l=>l.value==='/vmake'),'命令名必须按字面量保护')
 const english='Make a tank. '+prepared.literals.map(l=>l.token).join(' ')
 const restored=restoreEnglishTranslation(prepared,english)
 assert.ok(restored.text.includes('/vmake'),'恢复后命令名与参数原样')
 const source=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8')
 assert.ok(source.includes("data-po06': 'experimental-divider'"),'推理增强必须单独分界为实验性功能')
 assert.match(source,/无法确定它能否稳定提升模型能力/,'必须写清能力提升不确定')
 assert.match(source,/大幅增加/,'必须写清耗时代价')
 assert.ok(source.includes('reasoningOn?h(InferenceMonitor'),'推理过程入口必须跟随推理增强开关')
 assert.ok(source.includes("if (t.startsWith('/') && !slashAllowedDraft(t)) return 'slash-command'"),'英文模式不得整体放行斜杠命令')
 assert.ok(!/englishOn\s*&&\s*draftNow\(\)\.startsWith\('\/'\)/.test(source),'不得因英文模式跳过允许列表命令')
})




