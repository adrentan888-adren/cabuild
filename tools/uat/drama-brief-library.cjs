const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const jobs=new Map();let release,posts=0;let nextFailure=false,dropTransport=false; const releases=[];
 const longFailure='Internal Server Error: the writing service could not finish the creative brief. '.repeat(20)+'COMPLETE FAILURE END';
 await context.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/api/drama/brief-jobs'){
   const method=route.request().method();
   if(method==='GET')return route.fulfill({json:{ok:true,jobs:[...jobs.values()]}});
   if(method==='DELETE'){jobs.delete(new URL(route.request().url()).searchParams.get('id'));return route.fulfill({json:{ok:true}});}
   posts++;const body=route.request().postDataJSON();const job={...body,status:'generating',createdAt:new Date().toISOString()};jobs.set(job.id,job);
   if(dropTransport)return route.abort('connectionreset');
   await new Promise(resolve=>{release=resolve;releases.push(resolve)});job.status=nextFailure?'failed':'ready';if(nextFailure)job.error=longFailure;else job.snapshot.generatedBrief='FINISHED BRIEF: A family investigates a mysterious lighthouse.';
   return route.fulfill({json:{ok:true,job}}).catch(()=>{});
  }
  if(p==='/api/account/credits')return route.fulfill({json:{user:{name:'Demo',email:'demo@example.test',role:'owner'},workspace:{credits:1000},providers:[]}});
  if(p.includes('credentials'))return route.fulfill({json:{configured:true,statuses:{kie:{connected:true}}}});
  if(p.includes('credits'))return route.fulfill({json:{credits:1000}});
  if(route.request().method()!=='GET'&&p!=='/api/auth/login')return route.fulfill({status:400,json:{message:'UAT blocked mutation'}});
  return route.continue();
 });
 await page.goto(process.env.UAT_BASE_URL||'http://localhost:3100/login');
 await page.getByRole('button',{name:'Enter workspace'}).click();await page.locator('.global-header').waitFor(); await page.waitForURL(url => !url.pathname.startsWith('/login'));
 const base=new URL(page.url()).origin;
 await page.goto(base+'/drama-studio?step=1');
 await page.getByRole('button',{name:/Create new.*brief/i}).first().click();
 await page.locator('#project-title').fill('Lighthouse mystery');await page.locator('#rough-story').fill('A family investigates a mysterious lighthouse.');
 await page.getByRole('button',{name:'Generate',exact:true}).click();
 const card=page.locator('.brief-library-card').filter({has:page.getByRole('heading',{name:'Lighthouse mystery',exact:true})});
 await card.getByText('Generating',{exact:true}).waitFor();assert.equal(posts,1);
 assert(await card.getByRole('button',{name:'Create Story Studio'}).isDisabled());assert(await card.getByRole('button',{name:'Delete Lighthouse mystery'}).isDisabled());
 assert.equal(await page.locator('.creative-brief-form').count(),0);
 await page.reload();await card.getByText('Generating',{exact:true}).waitFor();assert.equal(posts,1);
 release();await card.getByText('Ready',{exact:true}).waitFor();assert.equal(posts,1);
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`card overflow ${width}`);
  const titleStyle=await card.locator('.brief-library-title h3').evaluate(el=>getComputedStyle(el).fontWeight);assert(Number(titleStyle)>=700);
  await card.getByRole('button',{name:'Info for Lighthouse mystery'}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.locator('input,textarea,select').count(),0);
  assert.match(await dialog.innerText(),/FINISHED BRIEF[\s\S]*Rough story[\s\S]*Writing model[\s\S]*Used in Story Studio/);
  assert.equal(await dialog.getByRole('button').count(),2);
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),`dialog overflow ${width}`);
  await page.screenshot({path:`.playwright-mcp/brief-info-${width}.png`,fullPage:true});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await card.getByRole('button',{name:'Info for Lighthouse mystery'}).evaluate(el=>el===document.activeElement));
 }
 await card.getByRole('button',{name:'Expand Lighthouse mystery'}).click();assert.match(await card.locator('.brief-library-content').innerText(),/FINISHED BRIEF/);
 await card.getByRole('button',{name:'Collapse Lighthouse mystery'}).click();assert.equal(await card.locator('.brief-library-content').count(),0);
 // Saved downstream usage belongs to this brief only.
 const id=[...jobs.keys()][0];await page.evaluate(({id})=>{
  const key=Object.keys(localStorage).find(k=>k.includes('drama-studio:workflow-library-v2'));const lib=JSON.parse(localStorage.getItem(key));const brief=lib.records.find(r=>r.id===id);
  lib.records.push({...brief,id:'uat-story',stage:2,serverJob:false,sourceId:id,name:'Lighthouse Story Studio',snapshot:{...brief.snapshot,storyline:'A story',episodePlan:[],scenes:[]}});localStorage.setItem(key,JSON.stringify(lib));
 },{id});
 await page.reload();await card.getByRole('button',{name:'Info for Lighthouse mystery'}).click();assert.match(await page.getByRole('dialog').innerText(),/Lighthouse Story Studio/);
 await page.getByRole('dialog').getByRole('button',{name:'Create Story Studio'}).click();await page.locator('.brief-library-card').waitFor({state:'detached'});assert.match(page.url(),/step=2/);assert.equal(posts,1);
 await page.goto(base+'/drama-studio?step=1');await page.getByRole('button',{name:/Create new.*brief/i}).first().click();await page.locator('#project-title').fill('Failed lighthouse');await page.locator('#rough-story').fill('A second story.');nextFailure=true;
 await page.getByRole('button',{name:'Generate',exact:true}).click();const failed=page.locator('.brief-library-card').filter({has:page.getByRole('heading',{name:'Failed lighthouse',exact:true})});await failed.getByText('Generating',{exact:true}).waitFor();release();await failed.getByText('Failed',{exact:true}).waitFor();await failed.getByRole('button',{name:'Info for Failed lighthouse'}).click();assert.match(await page.getByRole('dialog').innerText(),/COMPLETE FAILURE END/);await page.keyboard.press('Escape');
 await page.reload();await failed.getByText('Failed',{exact:true}).waitFor();assert.equal(posts,2);
 // A deletion in another session is authoritative; legacy browser-only records are retained.
 jobs.delete(id);await card.waitFor({state:'detached',timeout:12000});
 nextFailure=false;dropTransport=true;
 const create=async title=>{await page.getByRole('button',{name:/Create new.*brief/i}).first().click();await page.locator('#project-title').fill(title);await page.locator('#rough-story').fill('An independent new premise.');await page.getByRole('button',{name:'Generate',exact:true}).click();};
 await create('Recover connection');const recovery=page.locator('.brief-library-card').filter({has:page.getByRole('heading',{name:'Recover connection',exact:true})});
 await recovery.getByText('Failed',{exact:true}).waitFor();await recovery.getByText('Generating',{exact:true}).waitFor({timeout:12000});
 const recoveryJob=[...jobs.values()].find(job=>job.snapshot.title==='Recover connection');recoveryJob.status='ready';recoveryJob.snapshot.generatedBrief='Recovered from server.';
 await recovery.getByText('Ready',{exact:true}).waitFor({timeout:12000});assert.equal(posts,3);
 dropTransport=false;await create('Concurrent first');await page.locator('.brief-library-card').filter({hasText:'Concurrent first'}).getByText('Generating',{exact:true}).waitFor();await create('Concurrent second');await page.locator('.brief-library-card').filter({hasText:'Concurrent second'}).getByText('Generating',{exact:true}).waitFor();assert.equal(posts,5);releases.forEach(resolve=>resolve());
 assert.deepEqual(errors,[]);console.log('PASS immediate status, refresh without resubmission, full failure recovery, readonly Info/settings/usage, next step, collapse, keyboard focus, desktop/mobile, concurrent new drafts, cross-session deletion and connection recovery');await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});



