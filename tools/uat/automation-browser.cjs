const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('fs');
(async()=>{
 const base=process.env.UAT_BASE_URL||'http://localhost:3100';
 const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
 let data,failSave=false;const posts=[],errors=[],blocked=[];
 await context.route('**/api/**',async r=>{
  const req=r.request(),path=new URL(req.url()).pathname;
  if(path==='/api/app'&&data)return r.fulfill({json:data});
  if(/credits|credentials|integrations/.test(path))return r.fulfill({json:{user:{name:'Fixture'},workspace:{credits:100},providers:[]}});
  if(path==='/api/drama/brief-jobs')return r.fulfill({json:{jobs:[]}});
  if(req.method()!=='GET'&&path!=='/api/auth/login'){
   const body=req.postDataJSON();posts.push(body);const action=body.action;
   if(path==='/api/social'){
    const source=action.includes('SourceWatcher'),rows=source?data.automationSourceWatchers:data.automationRules;
    if(action.startsWith('update')||action.startsWith('create')){if(failSave)return r.fulfill({status:500,json:{error:'Fixture save failure'}});const row=rows.find(row=>row.id===body.id);if(row)Object.assign(row,{...body,sourceUrls:String(body.sourceUrls||'').split('\n').filter(Boolean),keywords:String(body.keywords||'').split('\n').filter(Boolean)});else rows.push({...structuredClone(data.automationRules[0]),...body,id:'new-fixture'});return r.fulfill({json:row||rows.at(-1)});}
    if(action.startsWith('pause')||action.startsWith('resume')){const row=rows.find(row=>row.id===body.id);row.status=action.startsWith('pause')?'paused':'active';return r.fulfill({json:row});}
    if(action==='approveAutomationContent'){const item=data.publishQueue.find(item=>item.id===body.id);item.approvalStatus='approved';return r.fulfill({json:item});}
    if(['runAutomationNow','runSourceWatcherNow','generateAutomationDraft','pollAsset'].includes(action))return r.fulfill({json:{ok:true}});
   }
   blocked.push(path+':'+action);return r.fulfill({status:403,json:{error:'No-spend UAT blocked write'}});
  }
  return r.continue();
 });
 await context.route('https://fixture.test/**',r=>r.fulfill({status:200,body:''}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{errors.push('Unexpected browser dialog '+dialog.message());await dialog.dismiss();});
 await page.goto(base+'/login');await page.getByRole('button',{name:'Enter workspace'}).click();await page.locator('.global-header').waitFor();
 data=await(await context.request.get(base+'/api/app')).json();
 const stamp='2026-09-23T02:00:00Z',thumb='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#adc99a"/></svg>');
 const common={workspaceId:data.workspace.id,instruction:'Create useful brand stories',contentType:'image',model:'gpt-image-2',aspectRatio:'4:5',frequency:'weekly',postingDays:['Mon','Fri'],postingTime:'10:00',timezone:'Asia/Singapore',approvalMode:'generate-and-wait',status:'active',nextRunAt:'2099-09-23T02:00:00Z',createdAt:stamp,updatedAt:stamp,referenceAssets:[{role:'logo',fileName:'logo.svg',url:thumb}],sourceUrls:['https://fixture.test/source'],duplicateProtection:{mode:'standard',sourceWindowDays:90,topicWindowDays:45,similarityThreshold:82,maxRetries:2}};
 data.automationRules=[{...common,lastError:'Fixture generation failure',id:'rule-a',name:'Weekly brand stories',goal:'awareness',platforms:['Facebook','Instagram'],quantityPerRun:1,researchMode:'none',keywords:['brand'],restrictions:'Avoid unsupported claims'}];
 data.automationSourceWatchers=[{...common,id:'watcher-a',name:'Creator inspiration',rankingMode:'views',minViews:100,referenceUrls:{},status:'paused'}];
 data.automationJobs=[{id:'job-a',workspaceId:data.workspace.id,automationRuleId:'rule-a',title:'Saved scheduled draft',prompt:'Draft prompt',caption:'Draft caption',createdAt:stamp,status:'ready-for-generation',duplicateCheck:{reason:'No close duplicate found',similarityScore:0}}];data.automationSourceRuns=[];
 data.assets=['image','video','image'].map((type,i)=>({id:'asset-'+i,workspaceId:data.workspace.id,title:'Output '+i,type,status:i===2?'rendering':'ready',progress:i===2?35:100,provider:'kie',providerTaskId:i===2?'task-fixture':undefined,assetUrl:type==='image'?thumb:'https://fixture.test/video.mp4',createdAt:stamp}));
 data.publishQueue=data.assets.map((asset,i)=>({id:'pub-'+i,workspaceId:data.workspace.id,assetId:asset.id,title:asset.title,platform:'Instagram',caption:'Caption for '+asset.title,hashtags:['#brand'],generationType:asset.type,generationModel:'gpt-image-2',generationSettings:{automationRuleId:'rule-a',approvalMode:'generate-and-wait',inputPrompt:'Submitted instruction first'},status:i===2?'generating':'done',approvalStatus:'pending',createdAt:stamp,scheduledAt:stamp,prompt:'Prompt sent to AI second'}));
 fs.mkdirSync('.playwright-mcp',{recursive:true});
 await page.goto(base+'/?view=automation');await page.getByRole('heading',{name:'Automation',exact:true}).waitFor();assert.equal(await page.locator('.automation-list-card').count(),2);assert.equal(await page.locator('.automation-builder').count(),0);assert.equal(posts.length,0,'Opening does not run automations');
 await page.getByRole('combobox',{name:'Automation status'}).click();await page.getByRole('option',{name:'Needs attention',exact:true}).click();assert.equal(await page.locator('.automation-list-card').count(),1);await page.getByRole('combobox',{name:'Automation status'}).click();await page.getByRole('option',{name:'All automations',exact:true}).click();
 const source=page.locator('.automation-list-card').filter({hasText:'Creator inspiration'});await source.getByRole('button',{name:'Run now',exact:true}).click();assert.equal(posts.at(-1).action,'runSourceWatcherNow');await source.getByRole('switch').click();await page.waitForFunction(()=>document.querySelectorAll('[role=switch][aria-checked=true]').length===2);
 await page.locator('.automation-list-card').filter({hasText:'Weekly brand stories'}).getByRole('button',{name:'View details'}).click();await page.getByRole('heading',{name:'Schedule & status'}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),2);
 await page.getByRole('button',{name:'Preview Output 0',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 await page.locator('.automation-output').filter({has:page.getByRole('heading',{name:'Output 0',exact:true})}).getByRole('button',{name:'Approve',exact:true}).click();await page.locator('.automation-output').filter({has:page.getByRole('heading',{name:'Output 0',exact:true})}).getByRole('button',{name:'Publish now',exact:true}).waitFor();assert.equal(posts.at(-1).action,'approveAutomationContent');
 await page.locator('.automation-output').filter({has:page.getByRole('heading',{name:'Output 0',exact:true})}).getByText('Content information',{exact:true}).click();const info=await page.locator('.automation-output').filter({has:page.getByRole('heading',{name:'Output 0',exact:true})}).locator('.automation-output-info').innerText();assert(info.indexOf('Submitted instruction')<info.indexOf('Prompt sent to AI'));
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Detail fits '+width);await page.screenshot({path:'.playwright-mcp/automation-detail-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('heading',{name:'Edit automation',exact:true}).waitFor();assert.equal(await page.locator('input[name=name]').inputValue(),'Weekly brand stories');assert.equal(await page.locator('select').count(),0);assert.equal(await page.locator('input[name=platforms]:checked').count(),2);assert.equal(await page.locator('.automation-reference-preview img').count(),1);
 await page.locator('input[name=name]').fill('Edited brand stories');failSave=true;await page.getByRole('button',{name:'Save automation',exact:true}).click();await page.getByText('Could not save. Your edits are still here; please try again.',{exact:true}).waitFor();assert.equal(await page.locator('input[name=name]').inputValue(),'Edited brand stories','Failed save retains entered text');failSave=false;
 await page.getByRole('button',{name:'Save automation',exact:true}).click();await page.getByRole('heading',{name:'Edited brand stories',exact:true}).waitFor();assert.equal(posts.at(-1).referenceAssets.length,1);assert.deepEqual(posts.at(-1).platforms.slice().sort(),['Facebook','Instagram']);
 await page.reload();await page.getByRole('heading',{name:'Edited brand stories',exact:true}).waitFor();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('input[name=name]').fill('Unsaved');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('heading',{name:'Edited brand stories',exact:true}).waitFor();
 await page.getByRole('button',{name:'Automations',exact:true}).click();await page.getByRole('button',{name:'Create automation',exact:true}).click();await page.getByRole('heading',{name:'Create automation',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});await page.getByRole('combobox',{name:'Approval mode',exact:true}).click();await page.getByRole('option',{name:'Generate asset, wait for approval',exact:true}).click();assert.equal(await page.locator('input[name=approvalMode]').inputValue(),'generate-and-wait');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Editor fits '+width);await page.screenshot({path:'.playwright-mcp/automation-editor-'+width+'.png',fullPage:true});
 }
 const combo=page.getByRole('combobox',{name:'Frequency',exact:true});await combo.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await page.locator('input[name=frequency]').inputValue(),'custom');assert(await combo.evaluate(e=>e===document.activeElement));
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('heading',{name:'Automation',exact:true}).waitFor();await page.getByRole('searchbox',{name:'Search automations'}).fill('no matching');await page.getByRole('heading',{name:'No matching automations'}).waitFor();
 assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);await browser.close();console.log('PASS Automation list-first, paused Run now, toggles, detail/approval/media-only modal, edit persistence/errors/cancel, refresh, themed keyboard menus and 1440/768/390/320 layouts. All writes mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
