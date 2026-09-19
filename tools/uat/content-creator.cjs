const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const base = process.env.UAT_BASE_URL || 'http://localhost:3100';
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const errors=[], mutations=[];
  await context.route('**/api/**',r=>{
    const path=new URL(r.request().url()).pathname;
    if(path==='/api/account/credits')return r.fulfill({json:{user:{id:'creator-uat',name:'Creator UAT',email:'creator@example.test',role:'owner'},workspace:{id:'creator-workspace',name:'Creator test',plan:'Pro',credits:120},providers:[{id:'kie',label:'KIE AI',configured:true,credits:98,unit:'credits',message:'Fixture'}]}});
    if(/credits|credentials|integrations/.test(path))return r.fulfill({json:{credits:0,configured:false}});
    if(path==='/api/drama/brief-jobs')return r.fulfill({json:{ok:true,jobs:[]}});
    if(r.request().method()!=='GET'&&path!=='/api/auth/login'){mutations.push(path);return r.fulfill({status:403,json:{error:'No-spend UAT'}})}
    return r.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/login');await page.getByRole('button',{name:'Enter workspace'}).click();await page.locator('.global-header').waitFor();
  const data=await(await context.request.get(base+'/api/app')).json();
  data.researchScans=[];data.researchResults=[];data.debugLogs=[];data.assets=[];data.publishQueue=[];
  await context.route('**/api/app',r=>r.fulfill({json:data}));
  fs.mkdirSync('.playwright-mcp',{recursive:true});
  const styles=locator=>locator.evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundImage==='none'?s.backgroundColor:s.backgroundImage,border:s.borderColor,radius:s.borderRadius}});
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    await page.goto(base+'/drama-studio?step=1');await page.locator('.page-intro:visible').waitFor();
    const dramaIntro=await styles(page.locator('.page-intro:visible'));
    const libraryStyle=await styles(page.locator('.workspace-library-button:visible'));
    for(const view of ['persona','research','create','publish','automation','audit','analyse','logs']){
      await page.goto(base+'/?view='+view);await page.locator('.page-intro').waitFor();
      assert.equal(await page.locator('.page-intro-kicker').textContent(),'Content Creator');
      const creatorIntro=await styles(page.locator('.page-intro'));
      assert.equal(creatorIntro.radius,dramaIntro.radius,view+' retains shared layout');
      assert.equal(creatorIntro.border,'rgb(213, 223, 206)',view+' original sage border');
      assert(creatorIntro.background.includes('rgb(239, 244, 233)'),view+' original sage introduction');
      assert.notEqual(creatorIntro.background,dramaIntro.background,'Drama retains its own lilac palette');
      assert.equal(await page.locator('.page-context-bar').count(),0);
      const nav=page.locator('.workspace-navigation nav');assert.equal(await nav.getByRole('link').count(),5);
      assert.equal(await nav.getByRole('link',{name:'Settings',exact:true}).count(),0);
      assert.equal(await nav.getByRole('link',{name:'Logs',exact:true}).count(),0);
      const logs=page.locator('.workspace-library-tools').getByRole('link',{name:'Logs',exact:true});
      assert.equal(await logs.count(),1);
      if(view!=='logs') {
        assert.equal((await styles(logs)).radius,libraryStyle.radius);
        assert.equal((await styles(logs)).background,'rgb(242, 246, 235)','Logs uses green workspace palette');
      }
      else {assert.equal(await logs.getAttribute('aria-current'),'page');assert.equal(await nav.locator('[aria-current=page]').count(),0)}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' width '+width);
      if(view==='automation') {
        const mode=await page.locator('.automation-tabs').boundingBox();
        const intro=await page.locator('.page-intro').boundingBox();
        const buttons=page.locator('.automation-tabs > button');
        const first=await buttons.nth(0).boundingBox(), second=await buttons.nth(1).boundingBox();
        assert(Math.abs(mode.width-intro.width)<1,'Automation mode controls span the page');
        assert(Math.abs(first.y-second.y)<1,'Automation modes share one row');
      }
      if(view!=='logs'&&view!=='research')await page.waitForFunction(()=>{
        const active=document.querySelector('.workspace-navigation nav [aria-current="page"]');
        const indicator=document.querySelector('.workspace-tab-indicator');
        if(!active||!indicator)return false;
        const a=active.getBoundingClientRect(),i=indicator.getBoundingClientRect();
        return Math.abs(a.x-i.x)<1&&Math.abs(a.y-i.y)<1&&Math.abs(a.width-i.width)<1;
      });
      if(width===1440||width===390)await page.screenshot({path:`.playwright-mcp/creator-${view}-${width}.png`});
    }
    await page.mouse.move(0,950);await page.goto(base+'/?view=create');await page.locator('.create-page').waitFor();await page.keyboard.press('Escape');
    await page.locator('.workspace-library-tools').getByRole('link',{name:'Logs',exact:true}).click();await page.waitForURL('**/?view=logs');
    await page.goBack();await page.locator('.create-page').waitFor();
    const account=page.getByRole('button',{name:'Open account menu'});
    await account.hover();await page.locator('.account-popover').waitFor({state:'visible'});
    await page.locator('.account-popover').hover();await page.waitForTimeout(300);
    assert(await page.locator('.account-popover').isVisible(),'hover transfer');
    assert.deepEqual(await page.locator('.account-popover > a,.account-popover > button').allTextContents(),[' Account',' Settings',' Log out']);
    const box=await page.locator('.account-popover').boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);
    await page.keyboard.press('Escape');assert.equal(await account.getAttribute('aria-expanded'),'false');assert(await account.evaluate(e=>e===document.activeElement));
    await page.mouse.move(0,950);await account.focus();await page.keyboard.press('Enter');
    await page.waitForTimeout(300);assert(await page.locator('.account-popover').isVisible(),'Keyboard open survives any earlier hover-close timer');
    await page.locator('.account-popover').getByRole('link',{name:'Account',exact:true}).click();await page.waitForURL('**/?view=account');
    await page.getByRole('heading',{name:'Account',exact:true}).waitFor();assert.equal(await page.locator('.workspace-navigation').count(),0);
    assert((await page.locator('.account-details').innerText()).includes(data.user.email));
    await page.reload();await page.getByRole('heading',{name:'Account',exact:true}).waitFor();
    await account.hover();await page.locator('.account-popover').getByRole('link',{name:'Settings',exact:true}).click();await page.waitForURL('**/?view=settings');
    await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();assert.equal(await page.locator('.workspace-navigation').count(),0);
    await page.getByRole('button',{name:'Show Content Creator pages'}).hover();await page.locator('.normal-menu').waitFor({state:'visible'});
    assert.equal(await page.locator('.normal-menu').getByRole('menuitem',{name:/Settings/}).count(),0);
    await page.keyboard.press('Escape');await page.mouse.move(0,950);
    await page.getByRole('button',{name:'Show credit balances'}).hover();await page.locator('.credit-popover').waitFor({state:'visible'});
    assert.equal(await page.locator('.credit-balance-copy strong').first().evaluate(e=>getComputedStyle(e).color),'rgb(63, 75, 84)');
    await page.keyboard.press('Escape');
    console.log('PASS all Content Creator pages, shared layout/green palette, Logs/history, account hover/keyboard/direct routes and neutral credits at',width);
  }
  await page.mouse.move(0,950);await page.goto(base+'/?view=create');await page.locator('.create-page').waitFor();await page.keyboard.press('Escape');
  for(const label of ['Image','Text post','Video']){
    await page.locator('.create-type-grid').getByRole('button',{name:label,exact:false}).click();
    assert(await page.locator('.create-model-options button').first().isVisible());
  }
  await page.goto(base+'/?view=research');await page.locator('.research-page').waitFor();
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:'Search by keywords'}).click();await page.getByPlaceholder('Enter keywords, e.g. sheila majid').waitFor();
  assert.deepEqual(errors,[]);assert.equal(mutations.length,0,'Navigation causes no content/provider mutations');
  const touch=await browser.newContext({storageState:await context.storageState(),viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await touch.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;if(path==='/api/app')return r.fulfill({json:data});if(r.request().method()!=='GET')return r.fulfill({status:403,json:{error:'No-spend'}});if(/credits|integrations/.test(path))return r.fulfill({json:{user:data.user,workspace:data.workspace,providers:[]}});return r.continue()});
  const phone=await touch.newPage();await phone.goto(base+'/?view=persona');await phone.locator('.persona-page').waitFor();
  await phone.getByRole('button',{name:'Open account menu'}).tap();await phone.locator('.account-popover').getByRole('link',{name:'Account',exact:true}).tap();await phone.getByRole('heading',{name:'Account',exact:true}).waitFor();
  console.log('PASS touch account menu, format/model switching, keyword search; no JS exceptions or provider/content writes');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
