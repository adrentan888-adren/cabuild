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
  const promptPosts = [], heldPrompts = [];
  const until = async (condition, message) => { const deadline=Date.now()+12000; while(!condition()){assert(Date.now()<deadline,message);await page.waitForTimeout(50);} };
  let nextPromptFailure = false;
  const snapshot = { completed: [1,2,4], title: 'Tidal Letters', generatedBrief: 'A courier discovers a city under the sea.', roughStory: 'A courier discovers a city under the sea.', episodes: 2, episodeLength: 3, style: 'Cinematic', language: 'English', aspectRatio: '9:16', pacing: 'Balanced', audience: 'Adults', rating: 'PG-13', tone: ['Mystery'], continuity: 'Strict', storyline: 'Mara follows the letters through the hidden city.', episodePlan: [{ number: 1, title: 'The first letter', summary: 'Mara discovers a mysterious envelope.' }, { number: 2, title: 'The gate', summary: 'Mara finds the city gate.' }], characters: [{ name: 'Mara', role: 'Courier' }, { name: 'Finn', role: 'Guide' }], assets: [{ id: 'mara', name: 'Mara', type: 'Character', detail: 'Courier in a blue coat', visualPrompt: 'Mara in blue at the harbour', selected: true, status: 'planned' }, { id: 'finn', name: 'Finn', type: 'Character', detail: 'A guide', visualPrompt: 'Finn at the gate', selected: true, status: 'planned' }, { id: 'gate', name: 'City gate', type: 'Venue', detail: 'The underwater entrance', visualPrompt: 'A stone gate underwater', selected: true, status: 'planned' }], scenes: [{ id: 'E1-S1', episode: 1, title: 'The envelope arrives', duration: 5, prompt: 'Mara opens an envelope in the rain.', safety: 'Safe', selected: true, status: 'draft' }, { id: 'E2-S1', episode: 2, title: 'Opening the gate', duration: 5, prompt: 'Mara opens the city gate.', safety: 'Safe', selected: true, status: 'draft' }], autoFallback: true, assembled: false, episodeDrafts: 2 };
  snapshot.episodes = 12;
  snapshot.episodePlan = Array.from({length:12}, (_, index) => ({number:index+1,title:'Episode title ' + (index+1),summary:'A readable storyline for episode ' + (index+1)}));
  snapshot.scenes = snapshot.episodePlan.map(episode => ({id:'E'+episode.number+'-S1',episode:episode.number,title:'Scene title ' + episode.number,duration:5,prompt:'A readable scene prompt ' + episode.number,safety:'Safe',selected:true,status:'draft'}));
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
  assert.equal(await workspace.locator('.story-studio-scenes details').count(),1,'Only selected episode prompts are mounted');
  const episodeOne=workspace.getByLabel('Episode 1 title',{exact:true});await episodeOne.fill('Edited first episode');
  const firstTab=episodes.getByRole('tab').first();await firstTab.focus();await page.keyboard.press('End');
  assert.equal(await episodes.getByRole('tab').last().getAttribute('aria-selected'),'true');
  await workspace.getByLabel('Episode 12 title',{exact:true}).waitFor();
  await page.keyboard.press('Home');await episodeOne.waitFor();assert.equal(await episodeOne.inputValue(),'Edited first episode');
  await firstTab.focus();await page.keyboard.press('ArrowRight');await workspace.getByLabel('Episode 2 title',{exact:true}).waitFor();
  await page.keyboard.press('ArrowLeft');await episodeOne.waitFor();
  assert.equal(await workspace.locator('details').filter({has:page.locator('summary').filter({hasText:'Generation settings'})}).first().getAttribute('open'),null,'Advanced settings start collapsed');
  await section('Series');await workspace.getByLabel('Series storyline',{exact:true}).fill('Revised series outline');
  await section('Images');const groups=workspace.getByRole('tablist',{name:'Image groups',exact:true});
  const characterTabs=workspace.getByRole('tablist',{name:'Character images',exact:true});
  assert.equal(await characterTabs.getByRole('tab').count(),10);assert.equal(await workspace.locator('.story-studio-asset').count(),1,'One image card is mounted for ten characters');
  assert.match(await characterTabs.getByRole('tab').last().innerText(),/Generating/);
  assert.match(await characterTabs.getByRole('tab').nth(8).innerText(),/Failed/);
  assert.match(await characterTabs.getByRole('tab').first().innerText(),/Not generated/);
  await characterTabs.getByRole('tab').first().focus();await page.keyboard.press('End');await workspace.getByRole('heading',{name:'Character 10',exact:true}).waitFor();
  assert(await workspace.getByRole('button',{name:'Generating with Kie AI',exact:true}).isDisabled());
  await page.keyboard.press('Home');await workspace.getByRole('heading',{name:'Character 1',exact:true}).waitFor();
  completeHiddenImage=true;await characterTabs.getByRole('tab').last().getByText(/Ready/).waitFor({timeout:12000});
  assert.equal(await characterTabs.getByRole('tab').first().getAttribute('aria-selected'),'true','Hidden completion never steals selection');assert(statusCalls>0);
  await groups.getByRole('tab',{name:/^Places & objects/}).click();await workspace.getByRole('heading',{name:'City gate',exact:true}).waitFor();
  await section('Episodes');assert.equal(await episodeOne.inputValue(),'Edited first episode');
  await section('Series');assert.equal(await workspace.getByLabel('Series storyline',{exact:true}).inputValue(),'Revised series outline');
  if(await page.getByRole('button',{name:'Dismiss notification'}).count())await page.getByRole('button',{name:'Dismiss notification'}).click();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    for(const name of ['Series','Episodes','Images']){
      await section(name);
      if(name==='Images'){await groups.getByRole('tab',{name:/^Characters/}).click();await characterTabs.getByRole('tab').last().click();}
      await workspace.scrollIntoViewIfNeeded();await page.waitForTimeout(250);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Document overflow '+name+' '+width);
      for(const asset of await workspace.locator('.story-studio-asset').all())assert(await asset.evaluate(el=>el.scrollWidth<=el.clientWidth),'Ready image card overflow '+width);
      for(const tablist of await workspace.getByRole('tablist').all())assert(await tablist.evaluate(el=>el.scrollWidth<=el.clientWidth),'Tab overflow '+name+' '+width);
      await card.screenshot({path:'.playwright-mcp/story-compact-'+name.toLowerCase()+'-'+width+'.png'});
    }
  }
  assert.deepEqual(posts,[],'Tab navigation and editing never submit generation or content writes');
  assert.equal(promptPosts.length,0,'Tab navigation never submits prompt generation');
  await page.setViewportSize({width:1440,height:1000});await section('Episodes');
  const openSettings=async()=>{const details=workspace.locator('.studio-generation-settings');if(await details.getAttribute('open')===null)await details.locator('summary').click();};
  const assertOnlyFirstBusy=async()=>{
    assert.match(await episodes.getByRole('tab').first().innerText(),/Generating/);
    for(let index=1;index<12;index++){
      assert.doesNotMatch(await episodes.getByRole('tab').nth(index).innerText(),/Generating/,'Untargeted episode '+(index+1)+' must not appear generating');
      assert.match(await episodes.getByRole('tab').nth(index).innerText(),/prompt.*ready/);
    }
  };
  for(const fail of [false,true]){
    nextPromptFailure=fail;await openSettings();
    const slider=workspace.getByRole('slider',{name:'Episodes to generate'});await slider.focus();await page.keyboard.press('Home');
    await workspace.getByRole('button',{name:'Regenerate selected episodes',exact:true}).click();
    await until(()=>heldPrompts.length===1,'Held first-episode prompt submission received');
    assert.equal(promptPosts.at(-1).snapshot.episodePlan.length,1);await assertOnlyFirstBusy();
    await slider.focus();await page.keyboard.press('End');assert.equal(await slider.inputValue(),'12');
    assert(await workspace.getByRole('button',{name:'Generating 1 episodes',exact:true}).isDisabled(),'Running count reflects captured targets rather than changed slider');
    await section('Series');await section('Episodes');await assertOnlyFirstBusy();
    await card.getByRole('button',{name:'Collapse Tidal Letters'}).click();await card.getByRole('button',{name:'Expand Tidal Letters'}).click();await assertOnlyFirstBusy();
    await openSettings();assert(await workspace.getByRole('button',{name:'Generating 1 episodes',exact:true}).isDisabled(),'Collapse/remount preserves captured target count');
    heldPrompts.shift()();
    await workspace.getByRole('button',{name:'Regenerate selected episodes',exact:true}).waitFor();
    assert(await workspace.getByRole('button',{name:'Regenerate selected episodes',exact:true}).isEnabled());
    for(const tab of await episodes.getByRole('tab').all())assert.doesNotMatch(await tab.innerText(),/Generating/,'Completion/failure clears captured busy targets');
    if(fail){await page.locator('.status-notice-message').getByText('Simulated prompt provider outage',{exact:true}).waitFor();assert.equal(await page.locator('.status-notice-message b').innerText(),'Failed');}
  }
  assert.equal(promptPosts.length,2,'Only the two explicit generation actions submit work');
  assert.deepEqual(errors,[]);
  console.log('PASS compact Story Studio: 12 episodes and 10 character images render one selected editor/card, readable panels, status-visible hidden completion, Arrow/Home/End focus, edit preservation, no navigation POST, captured batch target/count statuses through slider changes/tab switches/collapse and success/failure, responsive 1440/768/390/320. No provider spend.');
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
