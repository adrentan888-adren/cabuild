const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
// All generation and content writes are intercepted. Navigation must never submit work.
(async () => {
  fs.mkdirSync('.playwright-mcp', { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], posts = [];
  const base = process.env.UAT_BASE_URL || 'http://localhost:3100', id = crypto.randomUUID();
  let completeHiddenImage = false, statusCalls = 0;
  const promptPosts = [], heldPrompts = [], imagePosts = [];
  const until = async (condition, message) => { const deadline=Date.now()+12000; while(!condition()){assert(Date.now()<deadline,message);await page.waitForTimeout(50);} };
  let nextPromptFailure = false;
  const snapshot = { completed: [1,2,4], title: 'Tidal Letters', generatedBrief: 'A courier discovers a city under the sea.', roughStory: 'A courier discovers a city under the sea.', episodes: 2, episodeLength: 3, style: 'Cinematic', language: 'English', aspectRatio: '9:16', pacing: 'Balanced', audience: 'Adults', rating: 'PG-13', tone: ['Mystery'], continuity: 'Strict', storyline: 'Mara follows the letters through the hidden city.', episodePlan: [{ number: 1, title: 'The first letter', summary: 'Mara discovers a mysterious envelope.' }, { number: 2, title: 'The gate', summary: 'Mara finds the city gate.' }], characters: [{ name: 'Mara', role: 'Courier' }, { name: 'Finn', role: 'Guide' }], assets: [{ id: 'mara', name: 'Mara', type: 'Character', detail: 'Courier in a blue coat', visualPrompt: 'Mara in blue at the harbour', selected: true, status: 'planned' }, { id: 'finn', name: 'Finn', type: 'Character', detail: 'A guide', visualPrompt: 'Finn at the gate', selected: true, status: 'planned' }, { id: 'gate', name: 'City gate', type: 'Venue', detail: 'The underwater entrance', visualPrompt: 'A stone gate underwater', selected: true, status: 'planned' }], scenes: [{ id: 'E1-S1', episode: 1, title: 'The envelope arrives', duration: 5, prompt: 'Mara opens an envelope in the rain.', safety: 'Safe', selected: true, status: 'draft' }, { id: 'E2-S1', episode: 2, title: 'Opening the gate', duration: 5, prompt: 'Mara opens the city gate.', safety: 'Safe', selected: true, status: 'draft' }], autoFallback: true, assembled: false, episodeDrafts: 2 };
  snapshot.episodes = 12;
  snapshot.episodePlan = Array.from({length:12}, (_, index) => ({number:index+1,title:'Episode title ' + (index+1),summary:'A readable storyline for episode ' + (index+1)}));
  snapshot.scenes = snapshot.episodePlan.map(episode => ({id:'E'+episode.number+'-S1',episode:episode.number,title:'Scene title ' + episode.number,duration:5,prompt:'A readable scene prompt ' + episode.number,safety:'Safe',selected:true,status:'draft'}));
  snapshot.scenes.push(...Array.from({length:3},(_,index)=>({id:'E1-S'+(index+2),episode:1,title:'Additional scene '+(index+2),duration:5,prompt:'Another readable scene prompt for the first episode.',safety:'Safe',selected:true,status:'draft'})));
  snapshot.assets = Array.from({length:10}, (_, index) => ({id:'character-'+index,name:'Character '+(index+1),type:'Character',detail:'An important role in the story',visualPrompt:'Readable image prompt for character '+(index+1),selected:true,status:index===9?'generating':'planned',...(index===9?{taskId:'hidden-task'}:{})}));
  snapshot.assets[8].error = 'A prior generation failed.';
  snapshot.assets.push({id:'venue',name:'City gate',type:'Venue',detail:'The underwater entrance',visualPrompt:'A stone gate underwater',selected:true,status:'planned'});
  const job = {id,stage:2,snapshot,status:'ready',model:'gemini-2.5-flash',createdAt:new Date().toISOString()};
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/api/**', async route => {
    const request=route.request(), url=new URL(request.url());
    if(url.pathname==='/api/drama/generate/stage'&&request.method()==='POST'){
      const body=request.postDataJSON(), fail=nextPromptFailure;promptPosts.push(body);
      await new Promise(resolve=>heldPrompts.push(resolve));
      return route.fulfill(fail?{status:503,json:{message:'Simulated prompt provider outage'}}:{json:{ok:true,model:body.model,result:{scenes:body.snapshot.episodePlan.map(episode=>({id:'E'+episode.number+'-S1',episode:episode.number,title:'New prompt '+episode.number,duration:5,prompt:'Regenerated readable scene '+episode.number,safety:'Safe'}))}}});
    }
    if(url.pathname==='/api/drama/brief-jobs')return route.fulfill({json:{ok:true,jobs:[job]}});
    if(url.pathname==='/api/drama/generate/media'&&request.method()==='POST'){imagePosts.push(request.postDataJSON());return route.fulfill({status:503,json:{message:'Simulated image provider outage'}});}
    if(url.pathname==='/api/drama/generate/media'&&request.method()==='GET'){statusCalls++;return route.fulfill({json:completeHiddenImage?{state:'success',resultUrls:['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7']}:{state:'generating',progress:30}});}
    if(url.pathname==='/api/account/credits')return route.fulfill({json:{user:{name:'Demo',email:'demo@example.test',role:'owner'},workspace:{credits:1000},providers:[]}});
    if(url.pathname.includes('credentials'))return route.fulfill({json:{configured:true,statuses:{kie:{connected:true}}}});
    if(request.method()!=='GET'&&url.pathname!=='/api/auth/login'){posts.push(url.pathname);return route.fulfill({status:400,json:{message:'No-spend test blocked mutation'}});}
    return route.continue();
  });
  await page.goto(base+'/login');await page.getByRole('button',{name:'Enter workspace'}).click();await page.waitForURL(url=>!url.pathname.startsWith('/login'));
  await page.goto(base+'/drama-studio?step=2');
  const card=page.locator('.story-library-card');await card.getByRole('button',{name:'Expand Tidal Letters'}).click();
  const workspace=card.locator('.story-studio-workspace');
  const mainTabs=workspace.getByRole('tablist',{name:'Story workspace',exact:true});
  const section=async name=>mainTabs.getByRole('tab',{name:new RegExp('^'+name+'(?: |$)')}).click();
  const episodes=workspace.getByRole('tablist',{name:'Story episodes',exact:true});
  assert.equal(await episodes.getByRole('tab').count(),12);
  assert.equal(await workspace.getByRole('textbox',{name:/Episode .* title/}).count(),1,'One episode editor is mounted for a twelve-episode series');
  assert.equal(await workspace.locator('.story-studio-scenes article').count(),4,'All four selected-episode prompts are mounted');
  const episodeOne=workspace.getByLabel('Episode 1 title',{exact:true});await episodeOne.fill('Edited first episode');
  const firstTab=episodes.getByRole('tab').first();await firstTab.focus();await page.keyboard.press('End');
  assert.equal(await episodes.getByRole('tab').last().getAttribute('aria-selected'),'true');
  await workspace.getByLabel('Episode 12 title',{exact:true}).waitFor();
  await page.keyboard.press('Home');await episodeOne.waitFor();assert.equal(await episodeOne.inputValue(),'Edited first episode');
  await firstTab.focus();await page.keyboard.press('ArrowRight');await workspace.getByLabel('Episode 2 title',{exact:true}).waitFor();
  await page.keyboard.press('ArrowLeft');await episodeOne.waitFor();
  assert.equal(await workspace.locator('.compact-episode-workspace details').count(),1,'Only model settings use disclosure, matching Image settings');
  assert.equal(await workspace.locator('.story-studio-scenes details').count(),0,'All episode prompts stay open');
  assert.equal(await workspace.getByRole('slider',{name:'Episodes to generate'}).count(),0,'No episode-count control is shown');
  const settings=workspace.locator('details[aria-label="Episode generation settings"]');
  await settings.locator('summary').click();await settings.getByRole('radio').first().waitFor();await settings.locator('summary').click();
  const tooltip=page.locator('.studio-tab-status-tooltip[role="tooltip"]');
  const episodeTab=mainTabs.getByRole('tab',{name:/^Episodes/});
  const imageTab=mainTabs.getByRole('tab',{name:/^Images/});
  const statusRows=tooltip.locator('.studio-tab-status-detail-row');
  const hoverStatus=async tab=>{await page.mouse.move(2,880);await tab.hover();await tooltip.waitFor();};
  await hoverStatus(episodeTab);assert.equal(await statusRows.count(),12);assert.match(await statusRows.first().innerText(),/Episode 1\s+Ready/);await page.keyboard.press('Escape');
  await hoverStatus(imageTab);assert.equal(await statusRows.count(),11);assert.deepEqual(await tooltip.locator('.studio-tab-status-category').allTextContents(),['Characters','Places']);assert.match(await statusRows.nth(9).innerText(),/Character 10\s+Generating/);assert.match(await statusRows.nth(8).innerText(),/Character 9\s+Failed/);await page.keyboard.press('Escape');
  await section('Series');await workspace.getByLabel('Series storyline',{exact:true}).fill('Revised series outline');
  await section('Images');const groups=workspace.getByRole('tablist',{name:'Image groups',exact:true});
  assert.equal(await workspace.getByRole('tablist',{name:'Character images',exact:true}).count(),0,'There are no individual image tabs');
  const imageCards=workspace.locator('.story-studio-asset');
  assert.equal(await imageCards.count(),10,'All ten characters are shown together');
  assert.match(await imageCards.last().getByRole('status').innerText(),/Generating/);
  assert.match(await imageCards.nth(8).getByRole('status').innerText(),/Failed/);
  assert.match(await imageCards.first().getByRole('status').innerText(),/Not generated/);
  assert(await workspace.getByRole('button',{name:'Generating with Kie AI',exact:true}).isDisabled());
  await imageCards.first().getByRole('textbox').fill('Edited character gallery prompt');
  await groups.getByRole('tab',{name:/^Places & objects/}).focus();await page.keyboard.press('Enter');await workspace.getByRole('heading',{name:'City gate',exact:true}).waitFor();
  await hoverStatus(groups.getByRole('tab',{name:/^Places & objects/}));assert.equal(await statusRows.count(),1);assert.deepEqual(await tooltip.locator('.studio-tab-status-category').allTextContents(),['Places']);await page.keyboard.press('Escape');
  assert.equal(await imageCards.count(),1);
  completeHiddenImage=true;await groups.getByRole('tab',{name:/^Characters/}).getByText(/1\/10 ready/).waitFor({timeout:12000});
  assert.equal(await groups.getByRole('tab',{name:/^Places & objects/}).getAttribute('aria-selected'),'true','Hidden completion never changes the image category');assert(statusCalls>0);
  await groups.getByRole('tab',{name:/^Characters/}).click();assert.equal(await imageCards.count(),10);assert.match(await imageCards.last().getByRole('status').innerText(),/Ready/);
  assert.equal(await imageCards.first().getByRole('textbox').inputValue(),'Edited character gallery prompt');
  await section('Episodes');assert.equal(await episodeOne.inputValue(),'Edited first episode');
  await section('Series');assert.equal(await workspace.getByLabel('Series storyline',{exact:true}).inputValue(),'Revised series outline');
  if(await page.getByRole('button',{name:'Dismiss notification'}).count())await page.getByRole('button',{name:'Dismiss notification'}).click();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    for(const name of ['Series','Episodes','Images']){
      await section(name);
      if(name==='Images'){await groups.getByRole('tab',{name:/^Characters/}).click();}
      await workspace.scrollIntoViewIfNeeded();await page.waitForTimeout(250);
      await page.keyboard.press('Escape');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Document overflow '+name+' '+width);
      for(const asset of await workspace.locator('.story-studio-asset').all())assert(await asset.evaluate(el=>el.scrollWidth<=el.clientWidth),'Ready image card overflow '+width);
      if(name==='Images'){
        const layout=await imageCards.first().evaluate(el=>{const rect=selector=>{const r=el.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {image:rect('.story-studio-asset-visual'),prompt:rect('.story-image-prompt'),title:rect('.story-studio-asset-copy'),actions:rect('.story-studio-asset-actions')};});
        assert(layout.image.height>=280,'Large image preview '+width);
        assert(layout.prompt.height>=250,'Large visible prompt '+width);
        assert(await imageCards.first().getByRole('textbox').isVisible());
        assert.equal(await imageCards.locator('details').count(),0,'Image prompts never collapse');
        const boxes=await imageCards.evaluateAll(cards=>cards.slice(0,3).map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y}}));
        assert(boxes[1].y>boxes[0].y && boxes[2].y>boxes[1].y,'Exactly one gallery card per row at '+width);
        if(width>=768){assert(Math.abs(layout.image.y-layout.prompt.y)<2,'Image and prompt top aligned');assert(Math.abs(layout.title.y-layout.actions.y)<2,'Title and actions aligned');assert(layout.prompt.x>layout.image.x && layout.prompt.width>layout.image.width,'Prompt is wider than image');const actions=await imageCards.first().locator('.story-studio-asset-actions > button, .story-studio-asset-actions > .generation-cost-action > button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}}));assert.equal(actions.length,2);assert(Math.abs(actions[0].y-actions[1].y)<2 && actions[1].x>=actions[0].x+actions[0].width,'Image action buttons stay side by side');}
        await imageCards.first().scrollIntoViewIfNeeded();await page.screenshot({path:'.playwright-mcp/story-image-open-'+width+'.png'});
      }
      if(name==='Episodes'){
        const promptList=workspace.locator('.story-studio-scenes');
        assert.equal(await promptList.locator('article').count(),4);
        assert(await promptList.evaluate(el=>{const style=getComputedStyle(el);return el.clientHeight>640 && el.scrollHeight<=el.clientHeight+1 && !['auto','scroll'].includes(style.overflowY)}),'Four prompts use document scrolling at '+width);
      }
      await hoverStatus(imageTab);const statusBounds=await tooltip.boundingBox();assert(statusBounds.x>=0 && statusBounds.x+statusBounds.width<=width+1 && statusBounds.y>=0 && statusBounds.y+statusBounds.height<=901,'Tooltip stays in viewport '+width);assert(await tooltip.evaluate(el=>el.scrollWidth<=el.clientWidth),'Status tooltip has no horizontal overflow');await tooltip.hover();await page.waitForTimeout(220);assert(await tooltip.isVisible(),'Tooltip remains hoverable');await page.keyboard.press('Escape');await tooltip.waitFor({state:'hidden'});
      for(const tablist of await workspace.getByRole('tablist').all())assert(await tablist.evaluate(el=>el.scrollWidth<=el.clientWidth),'Tab overflow '+name+' '+width);
      await card.screenshot({path:'.playwright-mcp/story-compact-'+name.toLowerCase()+'-'+width+'.png'});
    }
  }
  assert.deepEqual(posts,[],'Tab navigation and editing never submit generation or content writes');
  assert.equal(promptPosts.length,0,'Tab navigation never submits prompt generation');
  await page.setViewportSize({width:1440,height:1000});await section('Episodes');
  const assertOnlyFirstBusy=async()=>{
    assert.match(await episodes.getByRole('tab').first().innerText(),/Generating/);
    for(let index=1;index<12;index++){
      assert.doesNotMatch(await episodes.getByRole('tab').nth(index).innerText(),/Generating/,'Untargeted episode '+(index+1)+' must not appear generating');
      assert.match(await episodes.getByRole('tab').nth(index).innerText(),/prompt.*ready/);
    }
  };
  for(const fail of [true,false]){
    nextPromptFailure=fail;
    await workspace.getByRole('button',{name:'Regenerate episode prompts',exact:true}).click();
    await until(()=>heldPrompts.length===1,'Held first-episode prompt submission received');
    assert.equal(promptPosts.at(-1).snapshot.episodePlan.length,1);await assertOnlyFirstBusy();
    assert(await workspace.getByRole('button',{name:'Regenerating',exact:true}).isDisabled(),'Running episode cannot submit again');
    assert(await workspace.getByRole('button',{name:'Regenerate all episode prompts',exact:true}).isDisabled(),'Overlapping bulk generation is locked');
    assert.match(await episodeTab.innerText(),/11\/12 ready · 1 generating/);
    await hoverStatus(episodeTab);assert.match(await statusRows.first().innerText(),/Episode 1\s+Generating/);assert.match(await statusRows.nth(1).innerText(),/Episode 2\s+Ready/);await page.keyboard.press('Escape');
    await section('Series');await section('Episodes');await assertOnlyFirstBusy();
    await card.getByRole('button',{name:'Collapse Tidal Letters'}).click();await card.getByRole('button',{name:'Expand Tidal Letters'}).click();await assertOnlyFirstBusy();
    assert.match(await episodeTab.innerText(),/11\/12 ready · 1 generating/,'Collapse/remount preserves captured targets');
    assert.equal(promptPosts.length,fail?1:2,'Navigation and remount never resubmit generation');
    heldPrompts.shift()();
    await workspace.getByRole('button',{name:'Regenerate episode prompts',exact:true}).waitFor();
    assert(await workspace.getByRole('button',{name:'Regenerate all episode prompts',exact:true}).isEnabled());
    for(const tab of await episodes.getByRole('tab').all())assert.doesNotMatch(await tab.innerText(),/Generating/,'Completion/failure clears captured busy targets');
    if(fail){await page.locator('.status-notice-message').getByText('Simulated prompt provider outage',{exact:true}).waitFor();assert.equal(await page.locator('.status-notice-message b').innerText(),'Failed');assert.match(await episodeTab.innerText(),/11\/12 ready · 1 failed/);await hoverStatus(episodeTab);assert.match(await statusRows.first().innerText(),/Episode 1\s+Failed/);await page.keyboard.press('Escape');await page.reload();await card.getByRole('button',{name:'Expand Tidal Letters'}).click();assert.match(await episodeTab.innerText(),/11\/12 ready · 1 failed/,'Failure status survives refresh');}
    else {assert.match(await episodeTab.innerText(),/12\/12 ready/);await hoverStatus(episodeTab);assert.match(await statusRows.first().innerText(),/Episode 1\s+Ready/);await page.keyboard.press('Escape');}
  }
  assert.equal(promptPosts.length,2,'Only the two explicit generation actions submit work');
  await section('Images');await groups.getByRole('tab',{name:/^Characters/}).click();await page.keyboard.press('Escape');
  await workspace.getByRole('button',{name:'Generate all characters',exact:true}).click();
  await until(()=>imagePosts.length===10,'One explicit group action attempts each character once');
  await groups.getByRole('tab',{name:/^Characters/}).getByText(/0\/10 ready · 10 failed/).waitFor();
  await hoverStatus(groups.getByRole('tab',{name:/^Characters/}));
  for(const row of await statusRows.all())assert.match(await row.innerText(),/Failed/);
  await page.keyboard.press('Escape');
  assert.equal(await imageCards.locator('.story-studio-asset-error').filter({hasText:'Simulated image provider outage'}).count(),10,'Full submission error remains on every affected card');
  await page.waitForTimeout(500);assert.equal(imagePosts.length,10,'Failed image submission does not automatically retry');
  assert.deepEqual(errors,[]);
  console.log('PASS compact Story Studio: four open prompts use page scrolling, matching model settings without episode count, one wide image card per row, aligned controls, categorized status tooltips, captured episode readiness through failure/refresh/retry, hidden completion, keyboard navigation and responsive 1440/768/390/320. No provider spend.');
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
