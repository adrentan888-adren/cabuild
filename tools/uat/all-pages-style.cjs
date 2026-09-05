const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const context=await browser.newContext(); const page=await context.newPage(); const errors=[],checks=[],blocked=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;
    if(path==='/api/account/credits')return r.fulfill({json:{user:{name:'Demo User',email:'demo@example.test',role:'owner'},workspace:{name:'Demo',plan:'Demo',credits:120},providers:[]}});
    if(/credits|credentials|integrations/.test(path))return r.fulfill({json:{credits:0,configured:false}});
    if(r.request().method()!=='GET'&&path!=='/api/auth/login'){blocked.push(path);return r.fulfill({status:403,json:{error:'Intercepted for no-spend UAT'}})}
    return r.continue();
  });
  async function inspect(label,width,hasIntro=true){
    await page.waitForTimeout(120);
    const state=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,controls:[...document.querySelectorAll('button,input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&getComputedStyle(e).visibility!=='hidden'&&(r.left < -1 || r.right > innerWidth+1)}).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label')||e.textContent.slice(0,70),right:e.getBoundingClientRect().right}))}));
    let intro=null;if(hasIntro){assert.equal(await page.locator('.page-intro').count(),1,label+' unique intro');intro=await page.locator('.page-intro').boundingBox();assert(intro&&intro.x>=0&&intro.x+intro.width<=width+1,label+' intro bounds');assert.equal(await page.locator('.page-intro .page-artwork').count(),1)}
    if(label==='research'){
      await page.locator('.history-wrap > button').click();
      const menu=await page.locator('.history-menu').boundingBox();
      assert(menu&&menu.x>=0&&menu.x+menu.width<=width+1,'Research History menu stays inside viewport');
      await page.locator('.history-wrap > button').click();
    }
    checks.push({label,width,...state,intro});fs.writeFileSync('.playwright-mcp/all-pages-style.json',JSON.stringify({checks,errors,blocked},null,2));
    assert(state.document<=width+1,label+' document overflow');assert.deepEqual(state.controls,[],label+' control overflow');
    if(width===1440||width===390)await page.screenshot({path:'.playwright-mcp/styled-'+width+'-'+label.replace(/[^a-z0-9]/gi,'-')+'.jpg',quality:75});
  }
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});for(const route of ['/login','/register','/verify-email','/uat-missing-page']){const r=await page.goto('http://localhost:3100'+route);await page.locator('.auth-shell').waitFor();assert.equal(r.status(),route.includes('missing')?404:200);await inspect(route,width,false)}}
  await page.goto('http://localhost:3100/login');await page.getByRole('button',{name:'Enter workspace'}).click();await page.locator('.global-header').waitFor();
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});
    for(const view of ['home','persona','research','create','publish','automation','audit','analyse','logs','settings']){await page.goto('http://localhost:3100/'+(view==='home'?'':'?view='+view));await page.locator(view==='home'?'.welcome-page':'.page-intro').waitFor();await inspect(view,width,view!=='home')}
    for(const route of ['/drama-studio?step=1','/drama-studio?step=2','/drama-studio?step=3','/drama-studio?step=4','/drama-studio?step=5','/drama-studio/info','/drama-studio/assets']){await page.goto('http://localhost:3100'+route);await page.locator('.page-intro').waitFor();await inspect(route,width)}
    await page.goto('http://localhost:3100/admin');await page.locator('.admin-tabs').waitFor();for(const tab of ['User Management','Permission','Prompt Management','API Key Management','System']){await page.locator('.admin-tabs').getByRole('button',{name:tab,exact:true}).click();await inspect('admin-'+tab,width)}
  }
  assert.deepEqual(errors,[]);console.log('PASS',checks.length,'page/tab/viewport checks; no JS exceptions. Intercepted mutation attempts:',blocked.length);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
