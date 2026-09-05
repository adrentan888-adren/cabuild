const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');const assert=require('node:assert/strict');const fs=require('fs');
fs.mkdirSync('.playwright-mcp', {recursive:true});
// Local-only UAT. All social/generation requests are intercepted before login.
// Uses the local demo account; never point this script at production.
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});const context=await browser.newContext({viewport:{width:390,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let mediaCalls=[],socialCalls=[];
await context.route('**/api/drama/generate/media',r=>{mediaCalls.push(r.request().postDataJSON());return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'UAT simulated provider failure'})})});
await context.route('**/api/social',r=>{const b=r.request().postDataJSON();socialCalls.push(b);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b.action==='refineResearchVideoPrompt'?{videoPrompt:'A calm sunrise over the city, smooth camera movement.'}:{ok:true})})});
await page.goto('http://localhost:3100/login');await page.getByRole('button',{name:'Enter workspace'}).click();await page.waitForSelector('.global-header');
await page.goto('http://localhost:3100/drama-studio?step=1');await page.getByRole('button',{name:'Skip to video'}).click();await page.waitForSelector('.create-scene-row');assert.equal(mediaCalls.length,0);
const generate=page.getByRole('button',{name:'Generate selected scenes',exact:true});assert(await generate.isDisabled());await page.getByLabel('Editable generation prompt').fill('A calm sunrise over the city. A slow cinematic tracking shot.');await page.getByLabel('Duration (seconds)').fill('2');assert(await generate.isDisabled());await page.getByLabel('Duration (seconds)').fill('5');assert(await generate.isEnabled());
await page.getByRole('button',{name:'Add scene',exact:true}).click();assert(await generate.isDisabled());await page.getByRole('button',{name:'Remove Scene 2',exact:true}).click();assert(await generate.isEnabled());
await page.waitForTimeout(200);const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes('drama-studio:draft-5')))));assert.equal(draft.snapshot.scenes.length,1);assert.deepEqual(draft.snapshot.completed,[]);
await page.reload();await page.getByRole('button',{name:'Write scene prompts',exact:true}).click();assert.equal(await page.getByLabel('Editable generation prompt').inputValue(),draft.snapshot.scenes[0].prompt);await generate.click();await page.waitForTimeout(250);assert.equal(mediaCalls.length,1);assert.equal(mediaCalls[0].duration,5);assert(mediaCalls[0].prompt.includes('sunrise'));assert(await page.getByLabel('Editable generation prompt').isVisible());
await page.goto('http://localhost:3100/drama-studio?step=1');await page.getByRole('button',{name:'Skip to video'}).click();await page.goBack();await page.waitForTimeout(350);assert.match(await page.locator('.page-intro h1').innerText(),/Creative brief/i);

// A manually entered draft must never be relinked to another saved source on resume.
await page.evaluate((snapshot) => {
  const key = Object.keys(localStorage).find((key) => key.includes('workflow-library-v2:'));
  localStorage.setItem(key, JSON.stringify({ records: [{ id: 'uat-brief', stage: 1, name: 'UAT saved brief', createdAt: new Date().toISOString(), snapshot: { ...snapshot, generatedBrief: 'An unrelated saved brief.' } }], selectedIds: { 1: 'uat-brief' } }));
}, draft.snapshot);
await page.goto('http://localhost:3100/drama-studio?step=2');
await page.getByRole('button', {name: /Create new Story Studio/i}).click();
await page.locator('#create-source-2').selectOption('');
await page.getByLabel('Your brief', {exact: false}).fill('My independent manual story brief.');
await page.reload();
await page.getByRole('button', {name: /Create new Story Studio/i}).click();
assert.equal(await page.locator('#create-source-2').inputValue(), '');
assert.equal(await page.getByLabel('Your brief', {exact: false}).inputValue(), 'My independent manual story brief.');

const appData=await (await page.request.get('http://localhost:3100/api/app')).json();const stamp=new Date().toISOString();appData.competitorResults=[{id:'uat-result',workspaceId:appData.workspace.id,competitorId:'uat',platform:'tiktok',url:'https://example.com/uat-source',title:'UAT source video',description:'A short clip for local UI validation',mediaType:'video',duration:5,views:100,likes:10,comments:1,publishedAt:stamp,capturedAt:stamp}];appData.researchScans=[{id:'uat-scan',workspaceId:appData.workspace.id,url:'https://example.com/uat-source',platform:'tiktok',minViews:0,resultIds:['uat-result'],createdAt:stamp,status:'done'}];
await context.route('**/api/app',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(appData)}));await page.goto('http://localhost:3100/?view=research');await page.getByRole('button',{name:'Generate Content',exact:true}).click();assert.equal(await page.locator('.modal-backdrop').count(),0);await page.waitForSelector('#research-inline-editor');assert(await page.getByRole('heading',{name:'UAT source video',exact:true}).isVisible());
assert.equal(await page.evaluate(() => document.activeElement.id), 'research-inline-editor');
await page.screenshot({path:'.playwright-mcp/research-inline-mobile.png',fullPage:true});
await page.getByRole('button', {name:'Close prompt editor'}).click();
assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Generate Content');
assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);fs.writeFileSync('.playwright-mcp/flow-audit.json',JSON.stringify({passed:true,mediaCalls:mediaCalls.length,errors}));console.log('PASS: direct generation validation, draft recovery, no automatic spend, failed request retains draft, Back navigation, manual source identity, inline source editor focus');await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
