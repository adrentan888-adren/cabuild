"use client";

import { CheckCircle2, CircleAlert, CircleDashed, Info, KeyRound, Link2Off, Server, Settings, ShieldCheck, Users, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  roleDefinitions?: {id:string;name:string;description:string;updatedAt:string}[];
  assignableRoles?: string[]; manageableRoles?: string[];
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

function ProviderHelp({ id, label, hint }: { id:string; label:string; hint:string }) {
  const [open,setOpen]=useState(false);
  return <div className="settings-provider-help" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}>
    <button type="button" className="settings-provider-info" aria-label={label+' usage information'} aria-describedby={open?id+'-help':undefined} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onClick={()=>setOpen(true)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);}}}><Info size={17}/></button>
    {open&&<div id={id+'-help'} role="tooltip" className="settings-provider-tooltip">{hint}</div>}
  </div>;
}

export function ApiKeyManagementCard({ integrations, adminData, currentRole }: { integrations: IntegrationData | null; adminData: AdminUserData | null; currentRole: string }) {
  const [status, setStatus] = useState(integrations?.apiKeyOverrides || {});
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [failed,setFailed]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [statusFailed,setStatusFailed]=useState(false);
  const [replaced,setReplaced]=useState<string[]>([]);
  const keyLock=useRef(false);
  useEffect(()=>{let live=true;fetch("/api/admin/api-keys",{cache:"no-store"}).then(async res=>{if(!res.ok)throw Error("Provider status could not be loaded.");return res.json();}).then(json=>{if(live){setStatus(json.providers||{});setLoaded(true);}}).catch(error=>{if(live){setFailed(true);setStatusFailed(true);setMessage(error.message);}});return ()=>{live=false};},[]);
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
      setLoaded(true);setStatusFailed(false);setReplaced(current=>[...current,provider]);return true;
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
            const health=replaced.includes(provider.id)?undefined:integrations?.[provider.id];
            const connected=health?.ok===true;
            const hasKey=Boolean(item.envConfigured||item.overrideConfigured);
            const state=statusFailed?'unavailable':!loaded?'loading':!hasKey?'missing':connected?'connected':health?.ok===false||health?.error?'attention':'saved';
            const label={unavailable:'Status unavailable',loading:'Loading',missing:'Not connected',connected:'Connected',attention:'Needs attention',saved:'Key saved'}[state];
            const Icon=state==='connected'?CheckCircle2:state==='saved'?KeyRound:state==='missing'?Link2Off:state==='loading'?CircleDashed:CircleAlert;
            return (
              <form className="api-key-editor" key={provider.id} onSubmit={async event=>{event.preventDefault();const form=event.currentTarget;if(await saveKey(provider.id,new FormData(form)))form.reset();}}>
                <div className="settings-provider-header">
                  <div className="settings-provider-name"><b>{provider.label}</b><ProviderHelp id={provider.id} label={provider.label} hint={provider.hint}/></div>
                  <div className={'settings-provider-status '+state} role="status" aria-label={provider.label+': '+label}><Icon size={17} aria-hidden="true"/>{label}</div>
                </div>
                <input name="value" type="password" aria-label={provider.label+" replacement key"} autoComplete="new-password" required placeholder="Paste new API key" disabled={!canEdit || Boolean(saving)} />
                <button className="primary" disabled={!canEdit || Boolean(saving)}>{saving === provider.id ? "Saving..." : "Save key"}</button>
              </form>
            );
          })}
        </div>
      </PanelCard>

    </div>
  );
}

export function SystemCard() {
 return <div className="settings-system-grid"><PanelCard title="Application settings"><p>Workspace context shapes future content briefs. Prompt templates and provider keys apply to future requests; existing content and history stay available.</p><div className="admin-info-list"><div><b>One place to manage the application</b><span>Workspace, connections and authorized management tools now live in Settings.</span></div><div><b>Access follows your permissions</b><span>Each privileged action is checked by the server. Owners and super admins retain full access.</span></div></div></PanelCard><PanelCard title="Credentials and privacy"><p>Current API keys are never shown. Authorized users can replace a provider key from API keys; saved replacements are encrypted.</p><p>Changes to users, permissions and provider configuration use the existing protected services.</p></PanelCard></div>;
}
