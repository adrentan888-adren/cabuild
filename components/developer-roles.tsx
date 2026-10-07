"use client";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, LockKeyhole, Plus, Search, ShieldCheck, Users } from 'lucide-react';
import type { AdminUserData } from './settings-management';

type Role={id:string;name:string;description:string;updatedAt:string};
type Props={access:AdminUserData;run:(method:'POST'|'PATCH',payload:Record<string,unknown>,message?:string)=>Promise<unknown>;confirmLeave:()=>Promise<boolean>;onDirtyChange:(dirty:boolean)=>void};
const starter:Role={id:'developer',name:'Developer',description:'Manage users and content settings without managing roles.',updatedAt:''};
export default function DeveloperRoles(props:Props) {
 const {access}=props;
 const roles=access.roleDefinitions||[starter];
 const [selected,setSelected]=useState<{role:Role;permissions:string[];creating:boolean}|null>(null);
 const canEdit=access.actorPermissions.includes('permissions.manage');
 if(selected)return <RoleForm key={selected.role.id||'new'} {...props} {...selected} onDone={()=>setSelected(null)}/>;
 return <article className="card developer-card role-catalog">
  <div className="developer-card-head"><div><h3>Roles</h3><p>Create reusable access levels for your team.</p></div>{canEdit&&<button className="primary" onClick={()=>setSelected({role:{id:'',name:'',description:'',updatedAt:''},permissions:[],creating:true})}><Plus size={17}/>Create role</button>}</div>
  <div className="role-list">{roles.map(role=><div className="role-list-item" key={role.id}><span className="role-emblem"><ShieldCheck size={23}/></span><div className="role-list-copy"><h4>{role.name}{role.id==='developer'&&<span className="role-badge">Default</span>}</h4>{role.description&&<p>{role.description}</p>}<small>{(access.permissions[role.id]||[]).length} permissions{access.actorPermissions.includes('users.view')?` · ${access.users.filter(person=>person.role===role.id).length} people`:''}</small></div><button aria-label={(canEdit?'Edit ':'View ')+role.name} onClick={()=>setSelected({role:{...role},permissions:[...(access.permissions[role.id]||[])],creating:false})}>{canEdit?'Edit':'View'}<ChevronRight size={16}/></button></div>)}</div>
  <p className="developer-notice"><LockKeyhole size={17}/>Existing accounts retain their access. Owner and Super Admin remain protected; new assignments use the roles above.</p>
 </article>;
}
function RoleForm({access,run,confirmLeave,onDirtyChange,role,permissions,creating,onDone}:Props&{role:Role;permissions:string[];creating:boolean;onDone:()=>void}) {
 const [name,setName]=useState(role.name),[description,setDescription]=useState(role.description),[draft,setDraft]=useState(permissions),[query,setQuery]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false);
 const canEdit=access.actorPermissions.includes('permissions.manage');
 const dirty=canEdit&&(name!==role.name||description!==role.description||JSON.stringify([...draft].sort())!==JSON.stringify([...permissions].sort()));
 useLayoutEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
 useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
 async function leave(){if(!busy&&await confirmLeave()){onDirtyChange(false);onDone();}}
 async function save(event:React.FormEvent){event.preventDefault();if(lock.current||!canEdit)return;lock.current=true;setBusy(true);try{const result=await run('PATCH',{operation:creating?'createRole':'editRole',roleId:role.id,name,description,permissions:draft,expectedUpdatedAt:role.updatedAt,expectedPermissions:permissions},creating?'Role created':'Role saved');if(result){onDirtyChange(false);onDone();}}finally{lock.current=false;setBusy(false);}}
 const filtered=access.permissionCatalog.filter(p=>`${p.group} ${p.label} ${p.description}`.toLowerCase().includes(query.toLowerCase().trim()));
 const grouped=filtered.reduce((acc,p)=>{(acc[p.group]||=[]).push(p);return acc;},{} as Record<string,AdminUserData['permissionCatalog']>);
 const members=access.users.filter(person=>person.role===role.id).length;
 return <form className="role-editor-page" onSubmit={save}>
  <button type="button" className="role-back" disabled={busy} onClick={leave}><ArrowLeft size={16}/>Roles</button>
  <div className="role-editor-heading"><h3>{creating?'Create a role':canEdit?'Edit role':'Role details'}</h3><p>{creating?'Choose a name and the access this role should provide.':`Review the access granted to everyone assigned ${role.name}.`}</p></div>
  <div className="role-editor-layout"><div className="role-editor-main">
   <section className="card role-section"><h4>Role details</h4><label>Role name<input autoComplete="off" required minLength={2} maxLength={50} value={name} readOnly={!canEdit} disabled={busy} onChange={e=>setName(e.target.value)} placeholder="For example, Content editor"/></label><label><span>Description <span className="muted">(optional)</span></span><textarea maxLength={240} rows={2} value={description} readOnly={!canEdit} disabled={busy} onChange={e=>setDescription(e.target.value)} placeholder="Help your team understand when to use this role."/></label></section>
   <section className="card role-section"><div className="developer-card-head"><div><h4>Permissions</h4><p>Select the actions people with this role can perform.</p></div><span className="role-badge">{draft.length} selected</span></div><label className="developer-search"><Search size={17}/><input aria-label="Find permissions" placeholder="Find a permission" value={query} onChange={e=>setQuery(e.target.value)}/></label><p className="step-helper">Enable administration access to open management settings. Each section also needs its view permission.</p>
   <div className="role-permissions">{Object.entries(grouped).map(([group,items])=><fieldset key={group} disabled={!canEdit||busy}><legend>{group}</legend>{items.map(permission=><label key={permission.key}><input type="checkbox" aria-label={permission.label} checked={draft.includes(permission.key)} onChange={event=>setDraft(current=>event.target.checked?[...current,permission.key]:current.filter(key=>key!==permission.key))}/><span><b>{permission.label}</b><small>{permission.description}</small></span></label>)}</fieldset>)}</div>{!filtered.length&&<p className="empty-state">No permissions match your search.</p>}</section>
  </div><aside className="card role-summary"><ShieldCheck size={26}/><h4>{name.trim()||'Your new role'}</h4><p>{description||'Application-wide access'}</p><div><Check size={17}/>{draft.length} permissions selected</div>{!creating&&access.actorPermissions.includes('users.view')&&<div><Users size={17}/>{members} {members===1?'person':'people'} assigned</div>}<hr/><p>Changes apply to everyone with this role. Content ownership stays unchanged.</p>{!canEdit&&<p><LockKeyhole size={15}/>You have view-only access.</p>}</aside></div>
  <div className="developer-role-actions"><span role="status">{dirty?'Unsaved changes':creating?'Start with a name and permissions':'All changes saved'}</span><div className="row-actions"><button type="button" disabled={busy} onClick={leave}>{canEdit?'Cancel':'Back to roles'}</button>{canEdit&&<button className="primary" disabled={busy||!dirty||name.trim().length<2}>{busy?'Saving…':creating?'Create role':'Save changes'}</button>}</div></div>
 </form>;
}
