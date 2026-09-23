const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
(async()=>{
 const module={exports:{}};let signedIn=true,mode='success',calls=0,captured;
 const db={workspaces:[{id:'owner-a',niche:'Owner A niche'},{id:'owner-b',niche:'Owner B niche'}],personaProfiles:[{workspaceId:'owner-a',voice:'A voice'},{workspaceId:'owner-b',voice:'B voice'}],debugLogs:[]};
 class KieBriefError extends Error {constructor(){super('Fixture raw HTTP 500 diagnostic');this.userMessage='Temporary brief outage. Your idea is still here.';this.retryable=true}}
 const deps={
  'next/server':{NextResponse:Response},'@/lib/automation-schedule':{},'@/lib/automation-runner':{},'@/lib/session':{currentUser:async()=>signedIn?{id:'user-a',workspaceId:'owner-a'}:null},
  '@/lib/store':{mutateDb:async callback=>callback(db),id:()=>String(db.debugLogs.length)},
  '@/lib/persona':{buildPersonaContext:profile=>profile.voice},
  '@/lib/providers/kie':{KieBriefError,buildAiBriefPrompt:input=>JSON.stringify(input),generateContentPlanWithGpt55:async input=>{calls++;captured=input;if(mode==='error')throw new KieBriefError();if(mode==='unknown')throw new Error('Internal diagnostic only');return{topic:'Fixture',format:'Short video 9:16',videoPrompt:'Create a fixture video',duration:8,hooks:['Hook']}}}
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/social/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Response,Request,Error,Date,console,require:name=>deps[name]||{}});
 const send=(extra={})=>module.exports.POST(new Request('http://local/api/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generateBriefWithAi',idea:'Fixture idea',workspaceId:'owner-b',requestedFormat:'Short video 9:16',requestedDuration:8,requestedModel:'veo-fast',...extra})}));
 signedIn=false;assert.equal((await send()).status,401);assert.equal(calls,0);assert.equal(db.debugLogs.length,0);
 signedIn=true;assert.equal((await send({idea:' '})).status,400);assert.equal(calls,0);
 let response=await send();assert.equal(response.status,200);const draft=await response.json();assert.equal(draft.topic,'Fixture');assert.match(draft.videoPrompt,/exactly 8 seconds/);assert.equal(captured.niche,'Owner A niche');assert.equal(captured.personaContext,'A voice');assert(db.debugLogs.every(log=>log.workspaceId==='owner-a'));
 mode='error';response=await send();assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'Temporary brief outage. Your idea is still here.',retryable:true});assert.match(db.debugLogs.at(-1).error,/raw HTTP 500/);
 mode='unknown';response=await send();assert.equal(response.status,502);assert.doesNotMatch(JSON.stringify(await response.json()),/Internal diagnostic/);assert.equal(db.debugLogs.at(-1).error,'Internal diagnostic only');
 console.log('PASS actual brief route: auth, blank input, owner-derived persona/workspace, valid draft, safe 502/retry metadata, scoped diagnostic logs; no external calls');
})().catch(e=>{console.error(e);process.exit(1)});
