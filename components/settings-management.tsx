"use client";
import ContentDialog from "./content-dialog";
import AutomationSelect from "./automation-select";

import { ArrowUpDown, KeyRound, Save, Server, Settings, ShieldCheck, Trash2, UserPlus, Users, WandSparkles } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Asset, BrandKit, Brief, Competitor, CompetitorResult, Opportunity, PersonaProfile, Platform, PromptTemplates, PublishItem, SocialAudit, Workspace } from "@/lib/types";

export type AdminAppData = {
  user: { id: string; email: string; name: string; role: string };
  workspace: Workspace;
  brandKit: BrandKit;
  personaProfile: PersonaProfile;
  competitors: Competitor[];
  competitorResults: CompetitorResult[];
  socialAudits: SocialAudit[];
  connectedSocialAccounts: {
    platform: Platform;
    handle: string;
    displayName: string;
    imageUrl?: string;
    reauthRequired?: boolean;
    url: string;
  }[];
  opportunities: Opportunity[];
  briefs: Brief[];
  assets: Asset[];
  publishQueue: PublishItem[];
  promptTemplates: PromptTemplates;
  researchScans: unknown[];
  activity: { id: string; message: string; createdAt: string }[];
  debugLogs: {
    id: string;
    action: string;
    label: string;
    status: "started" | "success" | "failed" | "info";
    provider?: "apify" | "kie" | "upload-post" | "local" | "system";
    prompt?: string;
    details?: Record<string, unknown>;
    error?: string;
    createdAt: string;
  }[];
};

export type IntegrationData = Record<string, { configured?: boolean; ok?: boolean; status?: number; error?: string; baseUrl?: string; actor?: string }> & {
  apiKeyOverrides?: Record<string, { envConfigured?: boolean; overrideConfigured?: boolean; updatedAt?: string; updatedBy?: string }>;
};

export type AdminUserData = {
  users: {
    id: string;
    email: string;
    name: string;
    role: string;
    workspaceId: string;
    workspaceName: string;
    emailVerified: boolean;
    disabled: boolean;
    disabledAt: string;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string;
  }[];
  roles: string[];
  permissions: Record<string, string[]>;
  actorPermissions: string[];
  permissionCatalog: { key: string; label: string; group: string; description: string }[];
};

type RunAction = (a: string, p?: Record<string, unknown>, m?: string) => Promise<unknown>;
type RunAdminAction = (method: "POST" | "PATCH", payload: Record<string, unknown>, message?: string) => Promise<unknown>;
type AdminUser = AdminUserData["users"][number];
type UserSortKey = "name" | "username" | "email" | "role" | "status" | "createdAt";

function PanelCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const Icon=title.includes("User")?Users:title.includes("Permission")?ShieldCheck:title.includes("Prompt")?WandSparkles:title.includes("API")?KeyRound:Server;
  return (
    <article className="card admin-card">
      <div className="admin-card-head">
        <h3><Icon size={22}/>{title}</h3>
        {action}
      </div>
      {children}
    </article>
  );
}

export function PromptAdminCard({ data, run, canEdit }: { data: AdminAppData; run: RunAction; canEdit:boolean }) {
  return (
    <PanelCard title="Prompt management">
      <form className="brand-form prompt-admin-form" action={async (form) => { await run("updatePromptTemplates", Object.fromEntries(form.entries()), "Prompt templates saved"); }}>
        <fieldset disabled={!canEdit} className="settings-form-fields"><div className="modal-grid">
          <label>Username<input name="adminUsername" defaultValue="admin" autoComplete="username" /></label>
          <label>Password<input name="adminPassword" type="password" defaultValue="admin" autoComplete="current-password" /></label>
        </div>
        <p className="muted">These templates turn research sources into editable content prompts. Video refinement also uses the creator’s selected duration and reference assets.</p>
        <section className="prompt-module">
          <div className="prompt-module-head">
            <div>
              <b>Research Video Prompt</b>
              <span>One video prompt configuration, executed in two steps.</span>
            </div>
          </div>
          <label><span className="prompt-step">Step 1 - Source to editable prompt</span><textarea name="researchVideoRecreate" defaultValue={data.promptTemplates.researchVideoRecreate} /></label>
          <p className="muted compact">Variables: <code>{"{{sourceMediaUrl}}"}</code>, <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>, <code>{"{{durationLine}}"}</code>, <code>{"{{assetInstruction}}"}</code>, <code>{"{{personaContext}}"}</code>.</p>
          <label><span className="prompt-step">Step 2 - Edited prompt to final G01 JSON</span><textarea name="researchVideoPromptRefine" defaultValue={data.promptTemplates.researchVideoPromptRefine} /></label>
          <p className="muted compact">Variable: <code>{"{{prompt}}"}</code>. Persona context is attached to the source prompt before this step runs.</p>
        </section>
        <section className="prompt-module">
          <div className="prompt-module-head">
            <div>
              <b>Research Image Prompt</b>
              <span>Source image or carousel result to editable image-generation prompt.</span>
            </div>
          </div>
          <label><span className="prompt-step">Step 1 - Source to editable image prompt</span><textarea name="researchImageRecreate" defaultValue={data.promptTemplates.researchImageRecreate} /></label>
          <p className="muted compact">Variables: <code>{"{{sourceMediaUrl}}"}</code>, <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>, <code>{"{{assetInstruction}}"}</code>, <code>{"{{personaContext}}"}</code>.</p>
        </section>
        <section className="prompt-module">
          <div className="prompt-module-head">
            <div>
              <b>Research Text Prompt</b>
              <span>Source text/link result to editable text-post prompt.</span>
            </div>
          </div>
          <label><span className="prompt-step">Step 1 - Source to editable text prompt</span><textarea name="researchTextRecreate" defaultValue={data.promptTemplates.researchTextRecreate} /></label>
          <p className="muted compact">Variables: <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>, <code>{"{{personaContext}}"}</code>.</p>
        </section>
        <button className="primary"><Settings size={14} />Save prompt templates</button></fieldset>
      </form>
    </PanelCard>
  );
}

export function UserManagementCard({ adminData, runAdmin }: { adminData: AdminUserData | null; runAdmin: RunAdminAction }) {
  const roles = adminData?.roles || [];
  const canCreate = Boolean(adminData?.actorPermissions.includes("users.create"));
  const canEdit = Boolean(adminData?.actorPermissions.includes("users.edit"));
  const canDelete = Boolean(adminData?.actorPermissions.includes("users.delete"));
  const canReset = Boolean(adminData?.actorPermissions.includes("users.resetPassword"));
  const [sort, setSort] = useState<{ key: UserSortKey; direction: "asc" | "desc" }>({ key: "createdAt", direction: "desc" });
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting,setDeleting]=useState(false);
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const canAssign=Boolean(adminData?.actorPermissions.includes("users.assignRole"));
  const canDisable=Boolean(adminData?.actorPermissions.includes("users.disable"));
  const username = (user: AdminUser) => user.email.split("@")[0] || user.name;
  const status = (user: AdminUser) => user.disabled ? "Disabled" : "Active";
  const sortableUsers = [...(adminData?.users || [])].sort((a, b) => {
    const values: Record<UserSortKey, [string | number, string | number]> = {
      name: [a.name.toLowerCase(), b.name.toLowerCase()],
      username: [username(a).toLowerCase(), username(b).toLowerCase()],
      email: [a.email.toLowerCase(), b.email.toLowerCase()],
      role: [a.role.toLowerCase(), b.role.toLowerCase()],
      status: [status(a).toLowerCase(), status(b).toLowerCase()],
      createdAt: [new Date(a.createdAt || 0).getTime(), new Date(b.createdAt || 0).getTime()]
    };
    const [av, bv] = values[sort.key];
    const result = av > bv ? 1 : av < bv ? -1 : 0;
    return sort.direction === "asc" ? result : -result;
  });
  function toggleSort(key: UserSortKey) {
    setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "createdAt" ? "desc" : "asc" });
  }
  async function saveUser(form:FormData) {
    if(!editing||lock.current)return;lock.current=true;setBusy(true);
    try {
      if(canEdit){const result=await runAdmin('PATCH',{operation:'update',userId:editing.id,name:form.get('name'),...(canAssign?{role:form.get('role')}:{ }),...(canDisable?{disabled:form.get('disabled')==='true'}:{ })},'User updated');if(!result)return;}
      const password=String(form.get('password')||'');
      if(password&&canReset){const result=await runAdmin('PATCH',{operation:'resetPassword',userId:editing.id,password},'Password reset');if(!result)return;}
      setEditing(null);
    }finally{lock.current=false;setBusy(false);}
  }
  async function deleteUser() {
    if(!editing||lock.current)return;lock.current=true;setBusy(true);
    try{const result=await runAdmin('PATCH',{operation:'delete',userId:editing.id},'User deleted');if(result){setEditing(null);setDeleting(false);}}finally{lock.current=false;setBusy(false);}
  }
  return (
    <PanelCard title="User management" action={<span className="admin-pill">{adminData?.users.length || 0} users</span>}>
      {canCreate && <form className="admin-create-user" action={async (form) => {
        if(lock.current)return;lock.current=true;setBusy(true);try{await runAdmin("POST", { ...Object.fromEntries(form.entries()), emailVerified: false }, "User created");}finally{lock.current=false;setBusy(false);}
      }}>
        <div className="admin-section-title">
          <b>Create user</b>
          <span>Invite a person to the application. New accounts must verify their email before signing in.</span>
        </div>
        <div className="modal-grid">
          <label>Email<input name="email" type="email" required autoComplete="off" /></label>
          <label>Temporary password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
          <label>Name<input name="name" placeholder="Optional display name" /></label>
          <div className="settings-field"><span>Role</span><AutomationSelect label="New user role" name="role" defaultValue="user">{roles.map((role) => <option key={role} value={role}>{role}</option>)}</AutomationSelect></div>
        </div>
        <button className="primary" disabled={busy}><UserPlus size={14} />{busy?"Creating…":"Create user"}</button>
      </form>}

      <div className="admin-user-table-wrap">
        <table className="admin-user-table">
          <thead>
            <tr>
              {[
                ["name", "Name"],
                ["username", "Username"],
                ["email", "Email address"],
                ["role", "Role"],
                ["status", "Status"],
                ["createdAt", "Created date"]
              ].map(([key, label]) => (
                <th key={key}>
                  <button type="button" onClick={() => toggleSort(key as UserSortKey)}>
                    {label}<ArrowUpDown size={12} />
                  </button>
                </th>
              ))}
              <th><span>Action</span></th>
            </tr>
          </thead>
          <tbody>
            {sortableUsers.map((user) => (
              <tr key={user.id} className={user.disabled ? "disabled" : ""}>
                <td data-label="Name">{user.name}</td>
                <td data-label="Username">{username(user)}</td>
                <td data-label="Email">{user.email}</td>
                <td data-label="Role"><span className="admin-role-pill">{user.role}</span></td>
                <td data-label="Status"><span className={`status ${user.disabled ? "failed" : "done"}`}>{status(user)}</span></td>
                <td data-label="Created">{user.createdAt ? new Date(user.createdAt).toLocaleString() : "Unknown"}</td>
                <td data-label="Actions"><button type="button" onClick={() => {setEditing(user);setDeleting(false);}}>{canEdit||canReset||canDelete?"Edit":"View"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <ContentDialog title={canEdit||canReset||canDelete?'Edit user':'User details'} description={editing.email} busy={busy} onClose={()=>setEditing(null)}>
        <form className="generation-form settings-user-editor" action={saveUser}>
         <div className="modal-grid">
          <label>Name<input name="name" defaultValue={editing.name} readOnly={!canEdit} disabled={busy}/></label>
          <label>Username<input value={username(editing)} readOnly/></label>
          <label>Email address<input value={editing.email} readOnly/></label>
          <fieldset disabled={!canEdit||!canAssign||busy} className="settings-field"><legend>Role</legend><AutomationSelect label="User role" name="role" defaultValue={editing.role}>{Array.from(new Set([...roles,editing.role])).map(role=><option key={role} value={role}>{role}</option>)}</AutomationSelect></fieldset>
          <fieldset disabled={!canEdit||!canDisable||busy} className="settings-field"><legend>Status</legend><AutomationSelect label="User status" name="disabled" defaultValue={String(editing.disabled)}><option value="false">Active</option><option value="true">Disabled</option></AutomationSelect></fieldset>
          <label>Created date<input value={editing.createdAt?new Date(editing.createdAt).toLocaleString():'Not recorded'} readOnly/></label>
         </div>
         {canReset&&<label>Reset password<input name="password" type="password" minLength={8} disabled={busy} placeholder="Leave blank to keep current password"/></label>}
         {deleting&&<div className="settings-delete-confirm" role="alert"><b>Delete this account?</b><p>This removes {editing.email}. Shared content history is kept.</p><div className="row-actions"><button type="button" disabled={busy} onClick={()=>setDeleting(false)}>Keep user</button><button type="button" className="danger-btn" disabled={busy} onClick={deleteUser}>Confirm delete</button></div></div>}
         <div className="modal-actions split-actions"><div>{canDelete&&!deleting&&<button className="danger-btn" type="button" disabled={busy} onClick={()=>setDeleting(true)}><Trash2 size={14}/>Delete user</button>}</div><div className="row-actions"><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button>{(canEdit||canReset)&&<button className="primary" disabled={busy||deleting}><Save size={14}/>{busy?'Saving…':'Save user'}</button>}</div></div>
        </form>
      </ContentDialog>}
    </PanelCard>
  );
}

export function PermissionCard({ adminData, runAdmin }: { adminData: AdminUserData | null; runAdmin: RunAdminAction }) {
  const roles = (adminData?.roles || []).filter((role) => role !== "super_admin" && role !== "owner");
  const catalog = adminData?.permissionCatalog || [];
  const grouped = catalog.reduce((acc, permission) => {
    (acc[permission.group] ||= []).push(permission);
    return acc;
  }, {} as Record<string, typeof catalog>);
  const canManage = Boolean(adminData?.actorPermissions.includes("permissions.manage"));
  return (
    <PanelCard title="Permission management" action={<span className="admin-pill">{roles.length} editable roles</span>}>
      <p className="muted">Configure what each role can do. Owner and super_admin always keep full access and are locked for safety.</p>
      <form className="permission-matrix" action={async (form) => {
        const permissions = roles.reduce((acc, role) => {
          acc[role] = catalog.filter((permission) => form.get(`${role}:${permission.key}`) === "on").map((permission) => permission.key);
          return acc;
        }, {} as Record<string, string[]>);
        await runAdmin("PATCH", { operation: "updateRolePermissions", permissions }, "Permissions saved");
      }}>
        <div className="permission-table-wrap">
          <table className="permission-table">
            <thead>
              <tr>
                <th>Permission</th>
                {roles.map((role) => <th key={role}>{role}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(grouped).map(([group, permissions]) => (
                <Fragment key={group}>
                  <tr className="permission-group" key={group}><td colSpan={roles.length + 1}>{group}</td></tr>
                  {permissions.map((permission) => (
                    <tr key={permission.key}>
                      <td><b>{permission.label}</b><span>{permission.description}</span></td>
                      {roles.map((role) => (
                        <td key={role} data-label={role}>
                          <input
                            aria-label={`${role}: ${permission.label}`}
                            name={`${role}:${permission.key}`}
                            type="checkbox"
                            defaultChecked={Boolean(adminData?.permissions?.[role]?.includes(permission.key))}
                            disabled={!canManage}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button className="primary" disabled={!canManage}><Save size={14} />Save permissions</button>
        </div>
      </form>
    </PanelCard>
  );
}

export function ApiKeyManagementCard({ integrations, adminData, currentRole }: { integrations: IntegrationData | null; adminData: AdminUserData | null; currentRole: string }) {
  const [status, setStatus] = useState(integrations?.apiKeyOverrides || {});
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [failed,setFailed]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const keyLock=useRef(false);
  useEffect(()=>{let live=true;fetch("/api/admin/api-keys",{cache:"no-store"}).then(async res=>{if(!res.ok)throw Error("Provider status could not be loaded.");return res.json();}).then(json=>{if(live){setStatus(json.providers||{});setLoaded(true);}}).catch(error=>{if(live){setFailed(true);setMessage(error.message);}});return ()=>{live=false};},[]);
  const canEdit = currentRole === "owner" || currentRole === "super_admin" || Boolean(adminData?.actorPermissions.includes("apiKeys.edit"));
  const providers = [
    { id: "kie", label: "Kie.ai", hint: "Used for Gemini/GPT prompt generation, Seedance, VEO, and image generation." },
    { id: "apify", label: "Apify primary", hint: "Used for Research, Source Watcher crawling, and persona crawling." },
    { id: "apifyBackup", label: "Apify backup", hint: "Used automatically when the primary Apify token hits quota/auth/rate-limit errors." },
    { id: "uploadPost", label: "Upload-Post", hint: "Used to connect social accounts and publish approved content." }
  ];
  async function saveKey(provider: string, form: FormData) {
    if(keyLock.current)return false;keyLock.current=true;
    setMessage("");setFailed(false);
    setSaving(provider);
    try {
      const value = String(form.get("value") || "").trim();
      const res = await fetch("/api/admin/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, value })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update API key.");
      setStatus(json.providers || {});
      setMessage(`${provider} key updated. Future provider calls will use the saved override.`);
      setLoaded(true);return true;
    } catch (error) {
      setFailed(true);setMessage(error instanceof Error ? error.message : "Could not update API key.");return false;
    } finally {
      keyLock.current=false;setSaving("");
    }
  }
  return (
    <div className="admin-tab-grid">
      <PanelCard title="API key management">
        <p className="muted">Paste a new key to replace a provider at runtime. Stored overrides are encrypted in the app database and raw keys are never displayed after saving.</p>
        {message && <div role={failed?"alert":"status"} className={failed?"provider-error inline":"settings-success"}>{message}</div>}
        <div className="api-key-editor-list">
          {providers.map((provider) => {
            const item = status?.[provider.id] || {};
            return (
              <form className="api-key-editor" key={provider.id} onSubmit={async event=>{event.preventDefault();const form=event.currentTarget;if(await saveKey(provider.id,new FormData(form)))form.reset();}}>
                <div>
                  <b>{provider.label}</b>
                  <span>{provider.hint}</span>
                  <small>Env: {!loaded?"Not loaded":item.envConfigured ? "configured" : "missing"} · Saved replacement: {item.overrideConfigured ? `saved ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ""}` : "not set"}</small>
                </div>
                <input name="value" type="password" aria-label={provider.label+" replacement key"} autoComplete="new-password" required placeholder="Paste new API key" disabled={!canEdit || Boolean(saving)} />
                <button className="primary" disabled={!canEdit || Boolean(saving)}>{saving === provider.id ? "Saving..." : "Save key"}</button>
              </form>
            );
          })}
        </div>
      </PanelCard>
      <PanelCard title="Secret handling">
        <div className="admin-info-list">
          <div><b>Kie</b><span>{integrations?.kie?.configured ? "configured" : "missing"} {integrations?.kie?.baseUrl || "https://api.kie.ai"}</span></div>
          <div><b>Apify</b><span>{integrations?.apify?.configured ? "configured" : "missing"} {integrations?.apify?.actor || "apify/google-search-scraper"}</span></div>
          <div><b>Upload-Post</b><span>{integrations?.uploadPost?.ok ? "verified" : integrations?.uploadPost?.configured ? "configured" : "missing"}</span></div>
          <div><b>Display policy</b><span>Raw API keys are accepted for replacement only and are never returned to the browser.</span></div>
        </div>
      </PanelCard>
    </div>
  );
}

export function SystemCard() {
 return <div className="settings-system-grid"><PanelCard title="Application settings"><p>Workspace context shapes future content briefs. Prompt templates and provider keys apply to future requests; existing content and history stay available.</p><div className="admin-info-list"><div><b>One place to manage the application</b><span>Workspace, connections and authorized management tools now live in Settings.</span></div><div><b>Access follows your permissions</b><span>Each privileged action is checked by the server. Owners and super admins retain full access.</span></div></div></PanelCard><PanelCard title="Credentials and privacy"><p>Current API keys are never shown. Authorized users can replace a provider key from API keys; saved replacements are encrypted.</p><p>Changes to users, permissions and provider configuration use the existing protected services.</p></PanelCard></div>;
}
