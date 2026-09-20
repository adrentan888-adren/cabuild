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
 const matchedSettings=async()=>{
  const boxes=await page.locator('.generation-choice-grid[data-video=true]').evaluate(grid=>{const duration=grid.querySelector('.fixed-duration,.duration-slider').getBoundingClientRect();return {duration:{x:duration.x,y:duration.y,height:duration.height,bottom:duration.bottom},ratios:[...grid.querySelectorAll('.creation-aspect-ratio button')].map(button=>{const r=button.getBoundingClientRect();return{x:r.x,y:r.y,height:r.height,bottom:r.bottom}})}});
  for(const ratio of boxes.ratios){assert(Math.abs(boxes.duration.height-ratio.height)<2,'Duration and ratio choices have equal height');if(Math.abs(boxes.duration.y-ratio.y)<100)assert(Math.abs(boxes.duration.y-ratio.y)<2&&Math.abs(boxes.duration.bottom-ratio.bottom)<2,'Side-by-side settings align at top and bottom');}
  return boxes.duration.height;
 };
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/?view=create');await page.locator('.creation-asset-grid').waitFor();
  assert.equal(await page.locator('.creation-asset-section').count(),4);assert.equal(await page.locator('.creation-asset-selected').count(),4);
  const platform=page.getByRole('group',{name:'Primary platform',exact:true});
  assert(await platform.evaluate(e=>{const row=e.querySelector('div'),buttons=[...row.querySelectorAll('button')],bounds=row.getBoundingClientRect();return Math.abs(Math.max(...buttons.map(b=>b.getBoundingClientRect().right))-bounds.right)<2}),'Platform buttons fill row');
  const duration=page.getByRole('group',{name:'Duration',exact:true});assert.equal(await duration.getByRole('button').count(),0);assert((await duration.innerText()).includes('8 seconds'));const fixedHeight=await matchedSettings();
  await page.getByRole('button',{name:/Seedance 2.0/}).click();const slider=page.getByRole('slider',{name:'Duration in seconds'});await slider.fill('15');assert.equal(await slider.inputValue(),'15');await slider.fill('4');assert.equal(await slider.inputValue(),'4');assert(Math.abs(await matchedSettings()-fixedHeight)<2,'Model change keeps duration height stable');await page.getByRole('group',{name:'Aspect ratio',exact:true}).getByRole('button',{name:'16:9',exact:true}).click();await matchedSettings();await page.locator('.generation-choice-grid').screenshot({path:'.playwright-mcp/matched-settings-'+width+'.png'});
  await page.getByRole('button',{name:/Veo Fast/}).click();assert.equal(await page.getByRole('slider').count(),0);
  const logo=page.getByRole('region',{name:'Logo',exact:true});assert.equal(await logo.getByRole('button').count(),1);assert((await logo.locator('img').boundingBox()).height>=120,'Image is the main preview');assert(!(await logo.innerText()).includes('saved-0.svg'));
  await page.getByRole('button',{name:'Remove Logo',exact:true}).click();await page.getByRole('button',{name:'Add Logo',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Choose Logo'});await dialog.waitFor();assert.equal(await dialog.getByRole('tab').count(),0);assert(await dialog.getByRole('heading',{name:'From Persona',exact:true}).isVisible());assert(await dialog.getByRole('heading',{name:'From your device',exact:true}).isVisible());assert.equal(await dialog.locator('input[type=file]').count(),1);await page.screenshot({path:'.playwright-mcp/asset-picker-'+width+'.png'});await dialog.getByRole('radio').check();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert(await page.getByRole('button',{name:'Add Logo',exact:true}).evaluate(e=>e===document.activeElement));assert.equal(await logo.locator('img').count(),0,'Cancel does not apply staged Persona selection');
  await page.getByRole('button',{name:'Add Logo',exact:true}).click();await page.getByRole('dialog').getByRole('radio').check();await page.getByRole('button',{name:'Add selected assets',exact:true}).click();assert(await page.getByRole('button',{name:'Remove Logo',exact:true}).evaluate(e=>e===document.activeElement));
  const ratio=page.getByRole('group',{name:'Aspect ratio',exact:true});assert(await ratio.evaluate(e=>{const row=e.querySelector('div'),buttons=[...row.querySelectorAll('button')],r=row.getBoundingClientRect();return Math.abs(buttons.at(-1).getBoundingClientRect().right-r.right)<2&&Math.max(...buttons.map(b=>b.getBoundingClientRect().width))-Math.min(...buttons.map(b=>b.getBoundingClientRect().width))<2}),'Aspect choices expand evenly');await page.locator('.create-type-grid').getByRole('button',{name:/Image/}).click();assert.equal(await ratio.getByRole('button').count(),4);assert(await ratio.evaluate(e=>{const row=e.querySelector('div'),buttons=[...row.querySelectorAll('button')],r=row.getBoundingClientRect();return Math.abs(buttons.at(-1).getBoundingClientRect().right-r.right)<2&&Math.max(...buttons.map(b=>b.getBoundingClientRect().width))-Math.min(...buttons.map(b=>b.getBoundingClientRect().width))<2}),'Image aspect choices expand evenly');await page.locator('.create-type-grid').getByRole('button',{name:/Video/}).click();
  assert(await ratio.getByRole('button').evaluateAll(buttons=>buttons.every(b=>parseFloat(getComputedStyle(b).fontSize)>=22&&b.scrollWidth<=b.clientWidth)),'Larger ratio labels fit');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Create fits '+width);
  await page.screenshot({path:'.playwright-mcp/creation-controls-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 const generate=async()=>{const count=posts.filter(p=>p.action==='generateDirectContent').length;await page.getByRole('button',{name:'Generate',exact:true}).click();await page.getByText('Could not queue content. Your edits are still here; please try again.',{exact:true}).waitFor();assert.equal(posts.filter(p=>p.action==='generateDirectContent').length,count+1);return posts.filter(p=>p.action==='generateDirectContent').at(-1)};
 let sent=await generate();assert.equal(sent.assetReferences.length,4);assert.equal(sent.duration,'8');
 await page.getByRole('button',{name:/Seedance 2.0/}).click();await page.getByRole('slider',{name:'Duration in seconds'}).fill('11');sent=await generate();assert.equal(sent.duration,'11');assert.equal(sent.generationModel,'seedance-2.0');
 await page.getByRole('button',{name:'Remove Logo',exact:true}).click();await page.getByRole('button',{name:'Add Logo',exact:true}).click();await page.getByRole('dialog').locator('input[type=file]').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from('fixture')});assert.equal(posts.filter(p=>p.action==='upload').length,0,'No upload before generation');sent=await generate();assert.equal(sent.assetReferences.filter(r=>r.role==='logo').length,1);assert.equal(sent.assetReferences.find(r=>r.role==='logo').fileName,'replacement.png');
 await page.locator('.create-type-grid').getByRole('button',{name:/Image/}).click();sent=await generate();assert.equal(sent.assetReferences.length,3);assert(!sent.assetReferences.some(r=>r.role==='audio'));
 await page.getByRole('button',{name:/No persona/}).click();sent=await generate();assert.equal(sent.usePersona,false);assert.equal(sent.assetReferences.length,1,'Only explicit upload survives opt-out');
 await page.getByRole('button',{name:'Remove Logo',exact:true}).click();assert.equal(await page.getByText('Not uploaded',{exact:true}).count(),4);await page.getByRole('button',{name:/Asset fixture/}).click();assert.equal(await page.locator('.creation-asset-selected').count(),4,'Selecting Persona restores saved defaults');
 const chooseFilter=async(name,label)=>{await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click()};
 await page.goto(base+'/?view=publish');await page.locator('.content-output-card').first().waitFor();assert.equal(await page.locator('.content-library-filters .choice-buttons').count(),0);assert.equal(await page.locator('.content-library-filters [role=combobox]').count(),3);const titles=()=>page.locator('.content-output-card h3').allTextContents();assert.deepEqual(await titles(),['Middle text','Apple image','Zebra video']);
 await chooseFilter('Media type','Video');assert.deepEqual(await titles(),['Zebra video']);await chooseFilter('Status','Ready');await page.getByText('No contents match these filters.',{exact:false}).waitFor();await page.getByRole('button',{name:'Reset',exact:true}).click();
 await chooseFilter('Sort contents','Oldest');assert.deepEqual(await titles(),['Zebra video','Apple image','Middle text']);await chooseFilter('Sort contents','Title A–Z');assert.deepEqual(await titles(),['Apple image','Middle text','Zebra video']);await chooseFilter('Sort contents','Title Z–A');assert.deepEqual(await titles(),['Zebra video','Middle text','Apple image']);
 await page.getByRole('searchbox',{name:'Search contents'}).fill('apple');assert.deepEqual(await titles(),['Apple image']);const pollCount=posts.filter(p=>p.action==='pollAsset').length;await page.waitForTimeout(8300);assert(posts.filter(p=>p.action==='pollAsset').length>pollCount,'Hidden generating videos keep polling');
 await page.setViewportSize({width:320,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await page.locator('.creator-filter-trigger').evaluateAll(buttons=>buttons.every(button=>button.scrollWidth<=button.clientWidth)),'Selected filter and sort values stay readable on narrow phones');await page.screenshot({path:'.playwright-mcp/library-filters-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.locator('.creator-library-heading').count(),0,'Compact layout has no extra heading');
  assert(await page.locator('.creator-filter-trigger').evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().height===44)),'Compact 44px controls');
  for(const name of ['Media type','Status','Sort contents']){
   const control=page.getByRole('combobox',{name,exact:true});await control.focus();await page.keyboard.press('Enter');
   const menu=page.getByRole('listbox',{name,exact:true});await menu.waitFor();
   assert(await menu.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),'Menu fits viewport');
   assert.equal(await menu.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 254, 251)');
   assert(await page.getByRole('option').evaluateAll(items=>items.every(e=>e.scrollWidth<=e.clientWidth)),'Options fit');
   await page.keyboard.press('End');await page.keyboard.press('Escape');assert.equal(await control.getAttribute('aria-expanded'),'false');
   assert(await control.evaluate(e=>e===document.activeElement),'Escape keeps trigger focus');
  }
  await page.getByRole('combobox',{name:'Status',exact:true}).click();await page.getByRole('listbox',{name:'Status',exact:true}).waitFor();await page.screenshot({path:'.playwright-mcp/compact-dropdown-'+width+'.png'});await page.keyboard.press('Escape');
 }
 const typeControl=page.getByRole('combobox',{name:'Media type',exact:true});await typeControl.focus();await page.keyboard.press('v');await page.keyboard.press('Enter');assert.deepEqual(await titles(),['Zebra video'],'Typeahead selects video');
 await page.keyboard.press('a');await page.keyboard.press('Enter');assert.deepEqual(await titles(),['Middle text','Apple image','Zebra video'],'New menu starts a fresh typeahead query');
 await typeControl.click();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.deepEqual(await titles(),['Apple image'],'Arrow keys select image');
 await typeControl.click();await page.keyboard.press('End');await page.keyboard.press('Tab');assert.equal(await typeControl.getAttribute('aria-expanded'),'false');assert.deepEqual(await titles(),['Apple image'],'Tab does not commit highlight');
 await typeControl.click();await page.locator('.creator-library-summary').click({position:{x:5,y:5}});assert.equal(await page.getByRole('listbox').count(),0,'Outside click dismisses');await page.getByRole('button',{name:'Reset',exact:true}).click();assert.deepEqual(await titles(),['Middle text','Apple image','Zebra video']);
 await typeControl.click();await page.setViewportSize({width:390,height:844});await page.getByRole('listbox',{name:'Media type',exact:true}).waitFor();assert(await page.getByRole('listbox').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),'Open menu repositions on resize');await page.keyboard.press('Escape');
 await page.setViewportSize({width:1440,height:900});await page.getByRole('combobox',{name:'Status',exact:true}).click();await page.setViewportSize({width:320,height:420});await page.waitForFunction(()=>!document.querySelector('[role=listbox]'));await page.setViewportSize({width:1440,height:1000});
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

