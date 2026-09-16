const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
(async()=>{
 const mod={exports:{}};let responses=[],calls=[],delays=[],key='fixture';
 const source=ts.transpileModule(fs.readFileSync('lib/providers/kie.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{module:mod,exports:mod.exports,Response,AbortSignal,process:{env:{}},console,
  require:name=>{assert.equal(name,'@/lib/apiKeyOverrides');return{getProviderApiKey:async()=>key}},
  setTimeout:(fn,ms)=>{delays.push(ms);fn()},fetch:async(url,opts)=>{calls.push({url,opts});const next=responses.shift();if(next instanceof Error)throw next;assert(next,'Unexpected retry');return next}
 });
 const plan={topic:'Fixture brief',videoPrompt:'A useful creation prompt',format:'Short video 9:16'};
 const good=()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]});
 const run=async(items)=>{responses=items;calls=[];delays=[];return mod.exports.generateContentPlanWithGpt55({idea:'Fixture idea',niche:'Fixture niche'})};
 assert.equal((await run([good()])).topic,plan.topic);
 assert.equal(calls[0].url,'https://api.kie.ai/codex/v1/responses');
 const body=JSON.parse(calls[0].opts.body);assert.equal(body.model,'gpt-5-5');assert.equal(body.stream,false);assert.equal(body.input[0].content[0].type,'input_text');assert(calls[0].opts.signal);
 assert.equal((await run([new Response('Server exception',{status:500}),good()])).topic,plan.topic);assert.equal(calls.length,2);assert.deepEqual(delays,[1000]);
 await assert.rejects(run([new Response('Down',{status:503,headers:{'retry-after':'30'}}),new Response('Down',{status:500})]),e=>e instanceof mod.exports.KieBriefError && e.retryable && /temporarily unavailable/.test(e.userMessage));assert.equal(calls.length,2);assert.deepEqual(delays,[5000]);
 for(const status of [400,401,403,429]){await assert.rejects(run([new Response('Rejected',{status})]),e=>e instanceof mod.exports.KieBriefError);assert.equal(calls.length,1);assert.equal(delays.length,0)}
 for(const value of [new Error('Connection reset'),new DOMException('Timed out','TimeoutError')]){await assert.rejects(run([value]),e=>/connection to Kie was interrupted/.test(e.userMessage));assert.equal(calls.length,1)}
 for(const payload of [null,{}, {status:'incomplete',output:[]},{error:{message:'Server exception'}},{code:500,msg:'Server error'},{status:'completed',output:[]},{status:'completed',output:[{content:[{type:'output_text',text:'not JSON'}]}]},{output:[{content:[{type:'output_text',text:JSON.stringify({topic:'Missing prompt'})}]}]}]){await assert.rejects(run([Response.json(payload)]),e=>e instanceof mod.exports.KieBriefError);assert.equal(calls.length,1)}
 await assert.rejects(run([new Response('<html>Gateway</html>')]),e=>/incomplete brief/.test(e.userMessage));
 key='';await assert.rejects(run([]),e=>/not configured/.test(e.userMessage));assert.equal(calls.length,0);
 console.log('PASS Kie brief request contract; bounded server retry; auth/quota/network handling; incomplete/error/invalid output rejection; no provider requests');
})().catch(e=>{console.error(e);process.exit(1)});
