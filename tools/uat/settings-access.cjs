const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(path,deps={},env={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,Response,Request,URL,console,process:{env,cwd:()=>process.cwd()},require:name=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name)}});return m.exports;}
(async()=>{
 let user={id:'actor',role:'owner',workspaceId:'a'},keyWrites=0;
 const catalog=load('lib/role-catalog.ts');const roles=catalog.allRoles;const permissions=load('lib/permissions.ts',{'./role-catalog':catalog});
 const db={rolePermissions:{support_admin:['admin.access','users.view','prompts.view','apiKeys.view','permissions.view','system.view'],user:[],admin:['admin.access','apiKeys.view']},users:[{id:'actor',email:'actor@fixture.test',name:'Actor',role:'owner',workspaceId:'a',passwordHash:'never-return-this'},{id:'target',email:'target@fixture.test',name:'Target',role:'user',workspaceId:'a'}],workspaces:[{id:'a',name:'Fixture'}],activity:[]};
 const deps={'@/lib/role-catalog':catalog,'next/server':{NextResponse:Response},'@/lib/session':{currentUser:async()=>user},'@/lib/store':{allRoles:roles,readDb:async()=>db,mutateDb:async fn=>fn(db),id:prefix=> prefix+'_fixture',hashPassword:()=> 'hashed'},'@/lib/permissions':permissions,'@/lib/emailVerification':{createVerificationCode:()=> 'fixture',hashVerificationCode:()=> 'hashed',verificationExpiry:()=> 'date'},'@/lib/providers/brevo':{sendVerificationEmail:async()=>{throw Error('Email must not run')}}};
 const access=load('app/api/settings/access/route.ts',deps),users=load('app/api/admin/users/route.ts',deps),keys=load('app/api/admin/api-keys/route.ts',{...deps,'@/lib/apiKeyOverrides':{apiKeyStatus:async()=>({kie:{overrideConfigured:true}}),saveApiKeyOverride:async()=>{keyWrites++;return {configured:true}}}});
 let data=await(await access.GET()).json();assert(data.actorPermissions.includes('users.delete'));assert(data.permissionCatalog.length>10);assert.equal(data.users.length,0);assert(!JSON.stringify(data).includes('never-return'));
 user={...user,role:'admin'};data=await(await access.GET()).json();assert(data.actorPermissions.includes('apiKeys.view'));assert.equal(Object.keys(data.permissions).length,0);assert.equal(data.permissionCatalog.length,0);assert.equal((await users.GET()).status,403,'Keys-only role does not gain users access');assert.equal((await keys.GET()).status,200);
 user={...user,role:'support_admin'};assert.equal((await users.GET()).status,200);const patch=payload=>new Request('https://fixture.test/api/admin/users',{method:'PATCH',body:JSON.stringify(payload)});
 for(const operation of ['update','delete','resetPassword','updateRolePermissions'])assert.equal((await users.PATCH(patch({operation,userId:'target',name:'Mutated',password:'password123',permissions:{user:['admin.access']}}))).status,403,operation+' stays forbidden');assert.equal(db.users[1].name,'Target');assert.equal((await keys.PATCH(patch({provider:'kie',value:'fixture-key'}))).status,403);assert.equal(keyWrites,0);
 user={...user,role:'user'};data=await(await access.GET()).json();assert.equal(data.actorPermissions.length,0);assert.equal(data.roles.length,0);assert.equal((await users.GET()).status,403);assert.equal((await keys.GET()).status,403);
 user={...user,role:'owner'};
 const originalAdmin=JSON.stringify(db.rolePermissions.admin);
 let response=await users.PATCH(patch({operation:'updateRolePermissions',permissions:{user:['settings.view']},expectedPermissions:{user:[]}}));assert.equal(response.status,200);assert.equal(JSON.stringify(db.rolePermissions.admin),originalAdmin,'Saving one role preserves other roles');assert.equal(db.rolePermissions.user[0],'settings.view');
 response=await users.PATCH(patch({operation:'updateRolePermissions',permissions:{user:[]},expectedPermissions:{user:[]}}));assert.equal(response.status,409,'Stale role save rejected');assert.equal(db.rolePermissions.user[0],'settings.view');
 for(const payload of [{unknown:[]},{user:'bad'},{user:['not.real']}])assert.equal((await users.PATCH(patch({operation:'updateRolePermissions',permissions:payload}))).status,400);
 await users.PATCH(patch({operation:'updateRolePermissions',permissions:{owner:[],super_admin:[]}}));assert(db.rolePermissions.owner.includes('users.delete'));assert(db.rolePermissions.super_admin.includes('users.delete'));
 db.rolePermissions.admin=['admin.access','users.view','users.edit','users.assignRole','users.resetPassword','users.delete'];user={...user,role:'admin'};
 for(const operation of ['update','resetPassword','delete','resendVerification'])assert.equal((await users.PATCH(patch({operation,userId:'actor',role:'user',name:'bad',password:'password123'}))).status,403,'Protected owner '+operation);
 const before=JSON.stringify(db.users[1]);assert.equal((await users.PATCH(patch({operation:'update',userId:'target',name:'Changed illegally',disabled:true}))).status,403);assert.equal(JSON.stringify(db.users[1]),before,'Forbidden disable cannot partially change name');
 user={...user,role:'owner'};assert.equal((await users.PATCH(patch({operation:'update',userId:'actor',role:'user'}))).status,400,'Self demotion blocked');assert.equal((await users.PATCH(patch({operation:'delete',userId:'actor'}))).status,400);assert.equal((await users.PATCH(patch({operation:'unknown',userId:'target'}))).status,400);
 const create=await users.POST(new Request('https://fixture.test/api/admin/users',{method:'POST',body:JSON.stringify({email:'new@fixture.test',password:'fixture-pass123',role:'user',emailVerified:false})}));assert.equal(create.status,502);assert.equal((await create.json()).userCreated,true);assert(db.users.some(p=>p.email==='new@fixture.test'),'Failed email keeps created account recoverable');

 // Custom roles preserve IDs and legacy grants through real normalization.
 const store=load('lib/store.ts',{'./role-catalog':catalog,fs:{promises:{}},path:{default:require('path')},crypto:{default:require('crypto')},'./persona':{normalizePersonaProfile:()=>({})},'./postgresStore':{}});
 const preserved=JSON.stringify(db.rolePermissions.admin);store.normalizeDb(db);
 assert.equal(JSON.stringify(db.rolePermissions.admin),preserved);
 assert.deepEqual(Array.from(catalog.applicationRoles(db),r=>r.id),['developer']);
 assert(db.rolePermissions.developer.includes('users.edit'));assert(db.rolePermissions.developer.includes('settings.edit'));assert(!db.rolePermissions.developer.includes('permissions.manage'));
 response=await users.PATCH(patch({operation:'createRole',name:'Reviewers',description:'Review content',permissions:['admin.access','permissions.view']}));assert.equal(response.status,200);const created=(await response.json()).role;assert.equal(created.id,'custom_fixture');
 assert.equal((await users.PATCH(patch({operation:'createRole',name:'reviewers',permissions:[]}))).status,409);
 for(const name of ['Owner','super_admin','Admin'])assert.equal((await users.PATCH(patch({operation:'createRole',name,permissions:[]}))).status,409);
 assert.equal((await users.PATCH(patch({operation:'createRole',name:'Invalid',permissions:['bad']}))).status,400);
 db.users[1].role=created.id;
 response=await users.PATCH(patch({operation:'editRole',roleId:created.id,name:'Content reviewers',description:'Read only',permissions:['admin.access','permissions.view','users.view'],expectedUpdatedAt:created.updatedAt,expectedPermissions:['admin.access','permissions.view']}));assert.equal(response.status,200);assert.equal(db.users[1].role,created.id,'Rename preserves assignments');
 assert.equal((await users.PATCH(patch({operation:'editRole',roleId:created.id,name:'Stale',permissions:[],expectedUpdatedAt:created.updatedAt,expectedPermissions:[]}))).status,409);
 store.normalizeDb(db);assert.equal(db.applicationRoles.find(r=>r.id===created.id).name,'Content reviewers');assert(db.rolePermissions[created.id].includes('users.view'));assert.equal(db.users[1].role,created.id);
 assert.equal((await users.PATCH(patch({operation:'editRole',roleId:'owner',name:'Owner edit',permissions:[]}))).status,404);
 user={...user,role:'developer'};
 for(const operation of ['createRole','editRole','updateRolePermissions'])assert.equal((await users.PATCH(patch({operation,name:'Denied',roleId:created.id,permissions:[]}))).status,403);
 db.rolePermissions[created.id].push('permissions.manage');
 for(const operation of ['update','resetPassword','resendVerification','delete'])assert.equal((await users.PATCH(patch({operation,userId:'target',name:'Denied',password:'fixture-password'}))).status,403,'Cannot control stronger custom account '+operation);
 db.users.push({id:'lower',email:'lower@fixture.test',name:'Lower',role:'user',workspaceId:'a'});
 assert.equal((await users.PATCH(patch({operation:'update',userId:'lower',role:created.id}))).status,403,'Cannot assign a stronger custom role');
 assert.equal((await users.PATCH(patch({operation:'update',userId:'lower',role:'developer'}))).status,200);
 data=await(await access.GET()).json();assert.deepEqual(Array.from(data.assignableRoles),['developer']);assert(!data.manageableRoles.includes(created.id));
 console.log('PASS role create/edit, duplicates, optimistic concurrency, persistent custom IDs/grants, safe legacy migration, Developer defaults and privilege boundaries.');
 user=null;for(const handler of [access,users,keys])assert.equal((await handler.GET()).status,401);
 const NextResponse={next:()=>({kind:'next'}),redirect:url=>({kind:'redirect',url:String(url)}),rewrite:url=>({kind:'rewrite',url:String(url)}),json:(body,init)=>({body,status:init?.status})};
 const request=path=>({nextUrl:new URL(path,'https://legacy.test'),url:'https://legacy.test'+path,headers:new Headers(),method:'GET'});
 for(const mode of ['combined','frontend']){const m=load('middleware.ts',{'next/server':{NextResponse}},{APP_SURFACE:mode});assert.equal(m.middleware(request('/admin')).url,'https://legacy.test/?view=settings');assert.equal(m.middleware(request('/?view=settings')).kind,'next');}
 const admin=load('middleware.ts',{'next/server':{NextResponse}},{APP_SURFACE:'admin',FRONTEND_SERVICE_URL:'https://frontend.test',API_SERVICE_URL:'https://api.test'});for(const path of ['/admin','/','/login','/admin/old'])assert.equal(admin.middleware(request(path)).url,'https://frontend.test/?view=settings');assert.equal(admin.middleware(request('/api/admin/users')).url,'https://api.test/api/admin/users');
 const api=load('middleware.ts',{'next/server':{NextResponse}},{APP_SURFACE:'api'});assert.equal(api.middleware(request('/admin')).status,404);
 console.log('PASS settings access, owner full permissions, keys-only custom role, read-only support, blocked users/key writes, anonymous401 and combined/frontend/legacy/API routing. No provider/email calls.');
})().catch(error=>{console.error(error);process.exit(1)});
