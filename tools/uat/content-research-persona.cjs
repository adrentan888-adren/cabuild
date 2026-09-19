const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.UAT_BASE_URL||'http://localhost:3100';
 const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1000}});
 let data,autoMode='fail',briefMode='fail';const posts=[],blocked=[],errors=[];
 await context.route('**/api/**',async r=>{
  const request=r.request(),path=new URL(request.url()).pathname;
  if(path==='/api/app'&&data)return r.fulfill({json:data});
  if(/credits|credentials|integrations/.test(path))return r.fulfill({json:{user:{name:'Fixture'},workspace:{credits:100},providers:[]}});
  if(path==='/api/drama/brief-jobs')return r.fulfill({json:{ok:true,jobs:[]}});
  if(request.method()!=='GET'&&path!=='/api/auth/login'){
   const body=request.postDataJSON();posts.push(body);
   if(path==='/api/social'&&body.action==='autoFillPersonaProfile'){
    await new Promise(resolve=>setTimeout(resolve,400));
    if(autoMode==='fail')return r.fulfill({status:502,json:{error:'Fixture auto-fill unavailable'}});
    data.personaProfile={...data.personaProfile,displayName:'Autofilled creator',company:'Updated company',updatedAt:new Date().toISOString()};
    return r.fulfill({json:data.personaProfile});
   }
   if(path==='/api/social'&&body.action==='generateBriefWithAi'){
    await new Promise(resolve=>setTimeout(resolve,300));
    return briefMode==='fail'?r.fulfill({status:502,json:{error:'Kie’s brief service is temporarily unavailable. Your idea is still here. Try again shortly, or write the brief manually.',retryable:true}}):r.fulfill({json:{topic:'Recovered brief',format:'Short video 9:16',videoPrompt:'Recovered creation prompt',duration:8,caption:'Recovered caption',hashtags:'#fixture'}});
   }
   if(path==='/api/social'&&body.action==='syncResearchScan')return r.fulfill({json:{ok:true}});
   if(path==='/api/social'&&['scanResearchUrl','scanKeywordResearch'].includes(body.action)){
    const scan={id:'new-scan',url:body.url||'keyword:'+body.keywords,query:body.keywords,platform:'instagram',dimensions:body.dimensions,minViews:Number(body.minViews),status:'done',resultIds:[],createdAt:new Date().toISOString(),source:'apify'};data.researchScans.unshift(scan);return r.fulfill({json:scan});
   }
   blocked.push(path+':'+body.action);return r.fulfill({status:403,json:{error:'No-spend UAT blocked write'}});
  }
  return r.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/login');await page.getByRole('button',{name:'Enter workspace'}).click();await page.locator('.global-header').waitFor();
 data=await(await context.request.get(base+'/api/app')).json();
 const stamp='2026-09-15T10:00:00.000Z';
 const thumb='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#d4e5bc"/><circle cx="320" cy="180" r="90" fill="#6b874f"/></svg>');
 data.competitorResults=[['zero',0,0],['mid',100,20],['high',500,10],['other',10000,1000]].map(([id,views,likes],i)=>({id,workspaceId:data.workspace.id,competitorId:'fixture',platform:'instagram',url:'https://example.test/post/'+id,title:'Fixture '+id,description:'A saved result for UI verification.',mediaType:'image',thumbnailUrl:thumb,views,likes,comments:0,publishedAt:new Date(Date.parse(stamp)+i*86400000).toISOString(),capturedAt:stamp}));
 data.researchScans=[
  {id:'scan-one',url:'keyword:creator ideas',query:'creator ideas',platform:'instagram',dimensions:{actorSources:['instagram'],contentType:'reels',uploadDate:'this-week'},minViews:0,resultIds:['zero','mid','high'],createdAt:stamp,status:'done',source:'apify'},
  {id:'scan-two',url:'https://example.test/another-profile',platform:'tiktok',minViews:50,resultIds:['other'],createdAt:'2026-09-14T10:00:00Z',status:'done',source:'apify'},
  {id:'scan-empty',url:'keyword:empty search',query:'empty search',platform:'youtube',minViews:900,resultIds:[],createdAt:'2026-09-13T10:00:00Z',status:'done',source:'apify'},
  {id:'scan-failed',url:'keyword:failed search',query:'failed search',platform:'youtube',minViews:0,resultIds:[],createdAt:'2026-09-12T10:00:00Z',status:'failed',error:'Fixture provider unavailable',source:'apify'}
 ];
 data.personaProfile.sourceUrls={};data.personaProfile.mediaAssets=[{id:'fixture-logo',role:'logo',label:'Original label',fileName:'fixture.svg',url:thumb,contentType:'image/svg+xml',createdAt:stamp}];data.assets=[];data.debugLogs=[];
 fs.mkdirSync('.playwright-mcp',{recursive:true});
 const titles=()=>page.locator('.result-title-button').allTextContents();
 const bounds=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page horizontal overflow');
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});
  await page.goto(base+'/?view=persona');await page.locator('.persona-page').waitFor();await page.getByRole('button',{name:'Edit mode',exact:true}).click();
  assert.equal(await page.locator('.persona-section-title').count(),3);
  assert(await page.locator('.persona-section-title').first().evaluate(e=>Number(getComputedStyle(e).fontWeight)>=700));
  const sections=await page.locator('.persona-fields > .persona-advanced').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom}}));
  assert(sections.slice(1).every((s,i)=>s.top-sections[i].bottom>=20));
  await page.getByLabel('Display name',{exact:true}).fill('Unsaved name');
  await page.locator('.persona-media-item input').fill('Unsaved media label');
  const open=page.getByRole('button',{name:'Auto-fill',exact:true});await open.click();
  const dialog=page.getByRole('dialog',{name:'Auto-fill persona'});await dialog.waitFor();
  assert(await dialog.evaluate(e=>e.matches(':modal')));assert.equal(await dialog.locator('form form').count(),0);
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert(await open.evaluate(e=>e===document.activeElement));assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'Unsaved name');
  await open.click();await page.getByRole('button',{name:'Auto-fill persona',exact:true}).click();await page.getByRole('alert').filter({hasText:'Add at least'}).waitFor();
  await dialog.getByLabel('Website',{exact:true}).fill('https://example.test');
  await page.screenshot({path:'.playwright-mcp/persona-dialog-'+width+'.png'});
  let r=await dialog.boundingBox();assert(r.x>=0&&r.x+r.width<=width&&r.height<=970);
  await page.keyboard.press('Tab');assert(await dialog.evaluate(e=>e.contains(document.activeElement)));
  await page.getByRole('button',{name:'Auto-fill persona',exact:true}).click();
  assert(await dialog.getByLabel('Website',{exact:true}).isDisabled());await page.keyboard.press('Escape');assert(await dialog.isVisible());
  await page.getByRole('alert').filter({hasText:'couldn’t auto-fill'}).waitFor();assert.equal(await dialog.getByLabel('Website',{exact:true}).inputValue(),'https://example.test');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.locator('.persona-media-item input').inputValue(),'Unsaved media label','Failed auto-fill preserves media edits');
  await bounds();
  await page.goto(base+'/?view=research');await page.locator('.research-history-entry').first().waitFor();
  assert.equal(await page.locator('.result-row').count(),0);assert.equal(await page.locator('.research-form').count(),0);assert.equal(await page.locator('.research-history-entry').count(),3);
  await page.screenshot({path:'.playwright-mcp/research-history-'+width+'.png'});await bounds();
  await page.locator('.research-history-entry').filter({hasText:'creator ideas'}).click();
  assert.equal(await page.locator('.saved-search-summary h2').innerText(),'creator ideas');assert((await page.locator('.saved-search-filters').innerText()).includes('this week'));
  assert.deepEqual(await titles(),['Fixture high','Fixture mid','Fixture zero']);const before=posts.length;
  await page.getByLabel('Minimum view count',{exact:true}).fill('100');assert.deepEqual(await titles(),['Fixture high','Fixture mid']);
  await page.getByLabel('Maximum like count',{exact:true}).fill('10');assert.deepEqual(await titles(),['Fixture high']);
  await page.getByLabel('Minimum like count',{exact:true}).fill('20');assert.equal(await page.locator('.result-row').count(),0);assert(await page.getByText('No results match these view and like counts.',{exact:false}).isVisible());
  await page.getByRole('button',{name:'Clear filters'}).click();
  await page.getByLabel('Maximum view count',{exact:true}).fill('0');assert.deepEqual(await titles(),['Fixture zero']);
  await page.getByRole('button',{name:'Clear filters'}).click();
  await page.getByRole('button',{name:'Descending order. Switch to ascending'}).click();assert.deepEqual(await titles(),['Fixture zero','Fixture mid','Fixture high']);
  await page.getByRole('combobox',{name:/Sort by/}).selectOption('likes');assert.deepEqual(await titles(),['Fixture zero','Fixture high','Fixture mid']);
  await page.getByRole('button',{name:'Ascending order. Switch to descending'}).click();assert.deepEqual(await titles(),['Fixture mid','Fixture high','Fixture zero']);
  assert.equal(posts.length,before,'Local filters/sort do not request scans');
  const thumbBox=await page.locator('.result-thumb').first().boundingBox();assert(thumbBox.width>=140&&thumbBox.height>=100);
  const preview=page.locator('.result-actions').first().getByRole('button',{name:'Preview',exact:true});await preview.click();
  const media=page.getByRole('dialog',{name:'Media preview'});await media.waitFor();assert(await media.evaluate(e=>e.matches(':modal')));
  assert.equal(await media.getByRole('heading',{name:'Fixture mid'}).count(),1);
  assert(await media.locator('img').evaluate(e=>e.complete && e.naturalWidth>0),'Image-only posts use their saved thumbnail');
  await media.locator('img').evaluate(e=>e.dispatchEvent(new Event('error')));
  assert(await media.getByText('This media preview could not be loaded').isVisible());
  await page.screenshot({path:'.playwright-mcp/research-preview-'+width+'.png'});
  r=await media.boundingBox();assert(r.x>=0&&r.x+r.width<=width&&r.height<=970);
  await page.keyboard.press('Escape');assert(await preview.evaluate(e=>e===document.activeElement));
  await page.screenshot({path:'.playwright-mcp/research-results-'+width+'.png'});await bounds();
  await page.getByRole('button',{name:'Research history',exact:true}).click();await page.locator('.research-history-entry').filter({hasText:'another-profile'}).click();assert.deepEqual(await titles(),['Fixture other']);
  await page.reload();await page.locator('.research-history').waitFor();assert.equal(await page.locator('.result-row').count(),0);
  console.log('PASS persona sections/dialog error/focus, history isolation, live filters/arrows, bigger thumbnails and modal preview at',width);
 }
 await page.goto(base+'/?view=persona');await page.getByRole('button',{name:'Edit mode',exact:true}).click();await page.getByRole('button',{name:'Auto-fill',exact:true}).click();await page.getByRole('dialog').getByLabel('Website',{exact:true}).fill('https://example.test');autoMode='success';await page.getByRole('button',{name:'Auto-fill persona',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'Autofilled creator');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'persona-autofill-trigger','Successful auto-fill restores focus after form replacement');
 await page.goto(base+'/?view=research');await page.locator('.research-history-entry').filter({hasText:'empty search'}).click();assert(await page.getByText('This search has no saved results.',{exact:false}).isVisible());await page.getByRole('button',{name:'Research history',exact:true}).click();assert.equal(await page.locator('.research-history-entry').filter({hasText:'failed search'}).count(),0);
 await page.getByRole('button',{name:'New search',exact:true}).click();await page.getByRole('button',{name:'Search by keywords'}).click();await page.getByLabel('Keywords',{exact:true}).fill('New fixture');await page.getByRole('button',{name:'Search',exact:true}).click();await page.locator('.saved-search-summary h2').filter({hasText:'New fixture'}).waitFor();
 await page.goto(base+'/?view=create');await page.getByRole('button',{name:'Fill fields with AI'}).click();const idea=page.locator('textarea[name="idea"]');await idea.fill('Keep my original idea');await page.getByRole('button',{name:'Fill fields',exact:true}).click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal(await idea.inputValue(),'Keep my original idea');assert((await page.locator('.ai-plan-box .provider-error').innerText()).includes('temporarily unavailable'));
 briefMode='success';await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.ai-plan-box').waitFor({state:'hidden'});assert((await page.locator('textarea[name="prompt"]').inputValue()).includes('Recovered creation prompt'));
 assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);console.log('PASS auto-fill success updates fields, empty/failed search, new keyword search and brief failure/manual retry; no real content/provider writes');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
