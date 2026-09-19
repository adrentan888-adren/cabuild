const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.UAT_BASE_URL||'http://localhost:3100';
 const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
 let data;const posts=[],errors=[],blocked=[];
 await context.route('**/api/**',async r=>{
  const req=r.request(),path=new URL(req.url()).pathname;
  if(path==='/api/app'&&data)return r.fulfill({json:data});
  if(/credits|credentials|integrations/.test(path))return r.fulfill({json:{user:{name:'Fixture'},workspace:{credits:100},providers:[]}});
  if(path==='/api/drama/brief-jobs')return r.fulfill({json:{jobs:[]}});
  if(req.method()!=='GET'&&path!=='/api/auth/login'){
   if(path==='/api/uploads'){posts.push({action:'upload'});return r.fulfill({json:{url:'https://fixture.test/replacement.png',storageKey:'fixture/replacement.png',contentType:'image/png'}});}
   const body=req.postDataJSON();posts.push(body);
   if(path==='/api/social'&&body.action==='refineResearchVideoPrompt')return r.fulfill({json:{videoPrompt:'Refined fixture video prompt'}});
   if(path==='/api/social'&&body.action==='generateDirectContent')return r.fulfill({status:502,json:{error:'Fixture queue failure: draft remains editable'}});
   if(path==='/api/social'&&body.action==='pollAsset')return r.fulfill({json:{ok:true}});
   blocked.push(path+':'+body.action);return r.fulfill({status:403,json:{error:'No-spend UAT blocked write'}});
  }
  return r.continue();
 });
 await context.route('https://fixture.test/**',r=>r.fulfill({status:200,body:''}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/login');await page.getByRole('button',{name:'Enter workspace'}).click();await page.locator('.global-header').waitFor();
 data=await(await context.request.get(base+'/api/app')).json();
 const stamp='2026-09-01T10:00:00Z',thumb='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#adc99a"/></svg>');
 data.personaProfile={...data.personaProfile,displayName:'Asset fixture',mediaAssets:['logo','product photo','avatar/persona','audio'].map((role,i)=>({id:'ref-'+i,role,label:'Saved '+role,fileName:'saved-'+i+(i===3?'.mp3':'.svg'),url:i===3?'https://fixture.test/audio.mp3':thumb,contentType:i===3?'audio/mpeg':'image/svg+xml',createdAt:stamp}))};
 data.assets=['video','image','text'].map((type,i)=>({id:'output-'+i,workspaceId:data.workspace.id,briefId:'direct',title:['Zebra video','Apple image','Middle text'][i],type,status:i===0?'rendering':'ready',provider:i===0?'kie':'local',providerTaskId:i===0?'fixture-task':undefined,progress:100,createdAt:stamp,assetUrl:type==='image'?thumb:undefined,generationSettings:{source:'content-creator'}}));
 data.publishQueue=data.assets.map((a,i)=>({id:a.id,assetId:a.id,workspaceId:data.workspace.id,title:a.title,caption:'Library fixture '+i,platform:'Instagram',status:i===0?'generating':i===1?'done':'failed',generationType:a.type,createdAt:`2026-09-0${i+1}T10:00:00Z`,scheduledAt:stamp}));
 data.competitorResults=[{id:'source-a',workspaceId:data.workspace.id,platform:'tiktok',url:'https://fixture.test/source',title:'Research video title',description:'Exact researched caption',mediaType:'video',mediaUrl:'https://fixture.test/source.mp4',thumbnailUrl:thumb,duration:12,views:500,likes:20,comments:3,publishedAt:stamp,capturedAt:stamp}];
 data.researchScans=[{id:'scan-a',url:'keyword:source',query:'source',platform:'tiktok',minViews:0,resultIds:['source-a'],createdAt:stamp,status:'done',source:'apify'}];
 fs.mkdirSync('.playwright-mcp',{recursive:true});
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/?view=create');await page.locator('.creation-asset-grid').waitFor();
  assert.equal(await page.locator('.creation-asset-section').count(),4);assert.equal(await page.locator('.creation-asset-selected').count(),4);
  const platform=page.getByRole('group',{name:'Primary platform',exact:true});
  assert(await platform.evaluate(e=>{const row=e.querySelector('div'),buttons=[...row.querySelectorAll('button')],bounds=row.getBoundingClientRect();return Math.abs(Math.max(...buttons.map(b=>b.getBoundingClientRect().right))-bounds.right)<2}),'Platform buttons fill row');
  const duration=page.getByRole('group',{name:'Duration',exact:true});assert.equal(await duration.getByRole('button').count(),0);assert((await duration.innerText()).includes('8 seconds'));
  await page.getByRole('button',{name:/Seedance 2.0/}).click();const slider=page.getByRole('slider',{name:'Duration in seconds'});await slider.fill('15');assert.equal(await slider.inputValue(),'15');await slider.fill('4');assert.equal(await slider.inputValue(),'4');
  await page.getByRole('button',{name:/Veo Fast/}).click();assert.equal(await page.getByRole('slider').count(),0);
  await page.getByRole('button',{name:'Change Logo',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Choose Logo'});await dialog.waitFor();assert(await dialog.getByRole('radio').isChecked());await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Create fits '+width);
  await page.screenshot({path:'.playwright-mcp/creation-controls-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 const generate=async()=>{const count=posts.filter(p=>p.action==='generateDirectContent').length;await page.getByRole('button',{name:'Generate',exact:true}).click();await page.getByText('Could not queue content. Your edits are still here; please try again.',{exact:true}).waitFor();assert.equal(posts.filter(p=>p.action==='generateDirectContent').length,count+1);return posts.filter(p=>p.action==='generateDirectContent').at(-1)};
 let sent=await generate();assert.equal(sent.assetReferences.length,4);assert.equal(sent.duration,'8');
 await page.getByRole('button',{name:/Seedance 2.0/}).click();await page.getByRole('slider',{name:'Duration in seconds'}).fill('11');sent=await generate();assert.equal(sent.duration,'11');assert.equal(sent.generationModel,'seedance-2.0');
 await page.getByRole('button',{name:'Change Logo',exact:true}).click();await page.getByRole('button',{name:'Upload file',exact:true}).click();await page.getByRole('dialog').locator('input[type=file]').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from('fixture')});assert.equal(posts.filter(p=>p.action==='upload').length,0,'No upload before generation');sent=await generate();assert.equal(sent.assetReferences.filter(r=>r.role==='logo').length,1);assert.equal(sent.assetReferences.find(r=>r.role==='logo').fileName,'replacement.png');
 await page.locator('.create-type-grid').getByRole('button',{name:/Image/}).click();sent=await generate();assert.equal(sent.assetReferences.length,3);assert(!sent.assetReferences.some(r=>r.role==='audio'));
 await page.getByRole('button',{name:/No persona/}).click();sent=await generate();assert.equal(sent.usePersona,false);assert.equal(sent.assetReferences.length,1,'Only explicit upload survives opt-out');
 await page.getByRole('button',{name:'Remove Logo',exact:true}).click();assert.equal(await page.getByText('Not uploaded',{exact:true}).count(),4);await page.getByRole('button',{name:/Asset fixture/}).click();assert.equal(await page.locator('.creation-asset-selected').count(),4,'Selecting Persona restores saved defaults');
 await page.goto(base+'/?view=publish');await page.locator('.content-output-card').first().waitFor();const titles=()=>page.locator('.content-output-card h3').allTextContents();assert.deepEqual(await titles(),['Middle text','Apple image','Zebra video']);
 await page.getByRole('group',{name:'Media type',exact:true}).getByRole('button',{name:'Video',exact:true}).click();assert.deepEqual(await titles(),['Zebra video']);await page.getByRole('group',{name:'Status',exact:true}).getByRole('button',{name:'Ready',exact:true}).click();await page.getByText('No contents match these filters.',{exact:false}).waitFor();await page.getByRole('button',{name:'Reset',exact:true}).click();
 await page.getByRole('group',{name:'Sort contents'}).getByRole('button',{name:'Oldest',exact:true}).click();assert.deepEqual(await titles(),['Zebra video','Apple image','Middle text']);await page.getByRole('button',{name:'Title A–Z',exact:true}).click();assert.deepEqual(await titles(),['Apple image','Middle text','Zebra video']);await page.getByRole('button',{name:'Title Z–A',exact:true}).click();assert.deepEqual(await titles(),['Zebra video','Middle text','Apple image']);
 await page.getByRole('searchbox',{name:'Search contents'}).fill('apple');assert.deepEqual(await titles(),['Apple image']);const pollCount=posts.filter(p=>p.action==='pollAsset').length;await page.waitForTimeout(8300);assert(posts.filter(p=>p.action==='pollAsset').length>pollCount,'Hidden generating videos keep polling');
 await page.setViewportSize({width:320,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'.playwright-mcp/library-filters-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await page.goto(base+'/?view=research');await page.getByRole('button',{name:'Research history',exact:true}).click();await page.locator('.research-history-entry').first().click();const before=posts.filter(p=>/generate|refine/i.test(p.action)).length;await page.getByRole('button',{name:'Generate Content',exact:true}).click();await page.waitForURL('**/?view=create&source=source-a');await page.locator('.create-page').waitFor();assert.equal(await page.locator('#research-inline-editor').count(),0);assert.equal(posts.filter(p=>/generate|refine/i.test(p.action)).length,before,'Handoff starts no paid work');
 assert((await page.getByLabel('Generation prompt',{exact:true}).inputValue()).includes('https://fixture.test/source'));assert.equal(await page.locator('textarea[name=caption]').inputValue(),'Exact researched caption');assert.equal(await page.getByRole('group',{name:'Primary platform',exact:true}).getByRole('button',{name:'TikTok',exact:true}).getAttribute('aria-pressed'),'true');
 await page.reload();await page.locator('.brief-preview').getByText('Research video title',{exact:true}).waitFor();
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'Generate',exact:true}).click();const review=page.locator('.g01-review textarea');await review.waitFor();assert(await review.evaluate(e=>e===document.activeElement),'Review prompt receives keyboard focus');assert(await review.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.top<innerHeight&&r.bottom>0}),'Review prompt is brought into view');await page.getByRole('button',{name:'Back to editing',exact:true}).click();assert(await page.getByLabel('Generation prompt',{exact:true}).evaluate(e=>e===document.activeElement),'Back restores editable prompt focus');
 }
 await page.getByRole('button',{name:'Generate',exact:true}).click();await page.getByRole('button',{name:'Generate video',exact:true}).waitFor();assert.equal(posts.filter(p=>p.action==='generateDirectContent').length,5,'Refinement does not start video generation');
 await page.getByRole('button',{name:'Generate video',exact:true}).click();await page.getByText('We could not queue this content.',{exact:false}).waitFor();sent=posts.filter(p=>p.action==='generateDirectContent').at(-1);assert.equal(sent.sourceResultId,'source-a');assert.equal(sent.sourceUrl,'https://fixture.test/source');assert.equal(sent.sourceMediaUrl,'https://fixture.test/source.mp4');assert.equal(sent.caption,'Exact researched caption');assert.equal(sent.prompt,'Refined fixture video prompt');
 await page.goto(base+'/?view=create&source=unavailable');await page.getByText('This research result is no longer available.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Generate',exact:true}).count(),0);
 assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);console.log('PASS full-row platforms, fixed/slider duration, Persona asset defaults/override/opt-out, image audio exclusion, responsive filters/sort/background polling, refreshable research handoff and explicit review; no paid calls or real content writes');await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});

