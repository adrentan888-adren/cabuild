"use client";

import { ArrowUpDown, KeyRound, Save, Server, Settings, ShieldCheck, Trash2, UserPlus, Users, WandSparkles, X } from "lucide-react";
import { Fragment, useState } from "react";
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
type AdminTab = "users" | "permissions" | "prompts" | "keys" | "system";
type AdminUser = AdminUserData["users"][number];
type UserSortKey = "name" | "username" | "email" | "role" | "status" | "createdAt";

function PanelCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <article className="card admin-card">
      <div className="admin-card-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </article>
  );
}

function PromptAdminCard({ data, run }: { data: AdminAppData; run: RunAction }) {
  return (
    <PanelCard title="Prompt management">
      <form className="brand-form prompt-admin-form" action={async (form) => { await run("updatePromptTemplates", Object.fromEntries(form.entries()), "Prompt templates saved"); }}>
        <div className="modal-grid">
          <label>Username<input name="adminUsername" defaultValue="admin" autoComplete="username" /></label>
          <label>Password<input name="adminPassword" type="password" defaultValue="admin" autoComplete="current-password" /></label>
        </div>
        <p className="muted">These templates power Research result to Generate Content. Video stays two-stage internally because Step 2 runs after the user edits modal fields and uploads logo/person/audio references.</p>
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
        <button className="primary"><Settings size={14} />Save prompt templates</button>
      </form>
    </PanelCard>
  );
}

function UserManagementCard({ adminData, runAdmin }: { adminData: AdminUserData | null; runAdmin: RunAdminAction }) {
  const roles = adminData?.roles || ["super_admin", "admin", "support_admin", "owner", "manager", "creator", "client", "user"];
  const canCreate = Boolean(adminData?.actorPermissions.includes("users.create"));
  const canEdit = Boolean(adminData?.actorPermissions.includes("users.edit"));
  const canDelete = Boolean(adminData?.actorPermissions.includes("users.delete"));
  const canReset = Boolean(adminData?.actorPermissions.includes("users.resetPassword"));
  const [sort, setSort] = useState<{ key: UserSortKey; direction: "asc" | "desc" }>({ key: "createdAt", direction: "desc" });
  const [editing, setEditing] = useState<AdminUser | null>(null);
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
  async function saveUser(form: FormData) {
    if (!editing) return;
    const password = String(form.get("password") || "");
    if (canEdit) {
      await runAdmin("PATCH", {
        operation: "update",
        userId: editing.id,
        name: form.get("name"),
        role: form.get("role"),
        disabled: form.get("disabled") === "true",
        emailVerified: true
      }, "User updated");
    }
    if (password) await runAdmin("PATCH", { operation: "resetPassword", userId: editing.id, password }, "Password reset");
    setEditing(null);
  }
  async function deleteUser() {
    if (!editing) return;
    const confirmed = window.confirm(`Delete ${editing.email}? This removes the user account but keeps shared workspace history.`);
    if (!confirmed) return;
    await runAdmin("PATCH", { operation: "delete", userId: editing.id }, "User deleted");
    setEditing(null);
  }
  return (
    <PanelCard title="User management" action={<span className="admin-pill">{adminData?.users.length || 0} users</span>}>
      {canCreate && <form className="admin-create-user" action={async (form) => {
        await runAdmin("POST", { ...Object.fromEntries(form.entries()), emailVerified: false }, "User created");
        (document.activeElement as HTMLElement | null)?.blur();
      }}>
        <div className="admin-section-title">
          <b>Create user</b>
          <span>New users are added to the hidden default workspace. Workspace support remains internal for future expansion.</span>
        </div>
        <div className="modal-grid">
          <label>Email<input name="email" type="email" required autoComplete="off" /></label>
          <label>Temporary password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
          <label>Name<input name="name" placeholder="Optional display name" /></label>
          <label>Role<select name="role" defaultValue="user">{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
        </div>
        <button className="primary"><UserPlus size={14} />Create user</button>
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
                <td>{user.name}</td>
                <td>{username(user)}</td>
                <td>{user.email}</td>
                <td><span className="admin-role-pill">{user.role}</span></td>
                <td><span className={`status ${user.disabled ? "failed" : "done"}`}>{status(user)}</span></td>
                <td>{user.createdAt ? new Date(user.createdAt).toLocaleString() : "Unknown"}</td>
                <td><button type="button" onClick={() => setEditing(user)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal-backdrop">
          <section className="generation-modal admin-user-modal">
            <div className="modal-head">
              <div>
                <h3>Edit user</h3>
                <p>{editing.email}</p>
              </div>
              <button className="icon-btn" type="button" onClick={() => setEditing(null)}><X size={15} /></button>
            </div>
            <form className="generation-form" action={saveUser}>
              <div className="modal-grid">
                <label>Name<input name="name" defaultValue={editing.name} readOnly={!canEdit} /></label>
                <label>Username<input value={username(editing)} readOnly /></label>
                <label>Email address<input value={editing.email} readOnly /></label>
                <label>Role<select name="role" defaultValue={editing.role} disabled={!canEdit}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                <label>Status<select name="disabled" defaultValue={String(editing.disabled)} disabled={!canEdit}><option value="false">Active</option><option value="true">Disabled</option></select></label>
                <label>Created date<input value={editing.createdAt ? new Date(editing.createdAt).toLocaleString() : "Unknown"} readOnly /></label>
              </div>
              {canReset && <label>Reset password<input name="password" type="password" minLength={8} placeholder="Leave blank to keep current password" /></label>}
              <div className="modal-actions split-actions">
                <div>{canDelete && <button className="danger-btn" type="button" onClick={deleteUser}><Trash2 size={14} />Delete</button>}</div>
                <div className="row-actions">
                  <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="primary" disabled={!canEdit && !canReset}><Save size={14} />Save</button>
                </div>
              </div>
            </form>
          </section>
        </div>
      )}
    </PanelCard>
  );
}

function PermissionCard({ adminData, runAdmin }: { adminData: AdminUserData | null; runAdmin: RunAdminAction }) {
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
                        <td key={role}>
                          <input
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

function ApiKeyManagementCard({ integrations, adminData, currentRole }: { integrations: IntegrationData | null; adminData: AdminUserData | null; currentRole: string }) {
  const [status, setStatus] = useState(integrations?.apiKeyOverrides || {});
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const canEdit = currentRole === "owner" || currentRole === "super_admin" || Boolean(adminData?.actorPermissions.includes("apiKeys.edit"));
  const providers = [
    { id: "kie", label: "Kie.ai", hint: "Used for Gemini/GPT prompt generation, Seedance, VEO, and image generation." },
    { id: "apify", label: "Apify primary", hint: "Used for Research, Source Watcher crawling, and persona crawling." },
    { id: "apifyBackup", label: "Apify backup", hint: "Used automatically when the primary Apify token hits quota/auth/rate-limit errors." },
    { id: "uploadPost", label: "Upload-Post", hint: "Used to connect social accounts and publish approved content." }
  ];
  async function saveKey(provider: string, form: FormData) {
    setMessage("");
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
      form.set("value", "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update API key.");
    } finally {
      setSaving("");
    }
  }
  return (
    <div className="admin-tab-grid">
      <PanelCard title="API key management">
        <p className="muted">Paste a new key to replace a provider at runtime. Stored overrides are encrypted in the app database and raw keys are never displayed after saving.</p>
        {message && <div className="provider-error inline">{message}</div>}
        <div className="api-key-editor-list">
          {providers.map((provider) => {
            const item = status?.[provider.id] || {};
            return (
              <form className="api-key-editor" key={provider.id} action={(form) => saveKey(provider.id, form)}>
                <div>
                  <b>{provider.label}</b>
                  <span>{provider.hint}</span>
                  <small>Env: {item.envConfigured ? "configured" : "missing"} · Backend override: {item.overrideConfigured ? `saved ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ""}` : "not set"}</small>
                </div>
                <input name="value" type="password" placeholder="Paste new API key" disabled={!canEdit || saving === provider.id} />
                <button className="primary" disabled={!canEdit || saving === provider.id}>{saving === provider.id ? "Saving..." : "Save key"}</button>
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

function SystemCard() {
  return (
    <div className="admin-tab-grid">
      <PanelCard title="Cloud backend">
        <p>Production and staging currently serve frontend and backend API routes from the same Next.js Cloud Run service. Admin UI is split by route first; service split comes later.</p>
        <code>/api</code>
      </PanelCard>
      <PanelCard title="Backend credentials">
        <p className="muted">Phase 2 adds user lifecycle controls here. Keep default demo credentials only for testing, then create named admin users and rotate passwords.</p>
        <code>username: admin</code>
        <code>password: admin</code>
      </PanelCard>
    </div>
  );
}

export default function AdminPanel({ data, run, runAdmin, integrations, adminData }: { data: AdminAppData; run: RunAction; runAdmin: RunAdminAction; integrations: IntegrationData | null; adminData: AdminUserData | null }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const tabs = [
    { id: "users", label: "User Management", icon: Users },
    { id: "permissions", label: "Permission", icon: ShieldCheck },
    { id: "prompts", label: "Prompt Management", icon: WandSparkles },
    { id: "keys", label: "API Key Management", icon: KeyRound },
    { id: "system", label: "System", icon: Server }
  ] as const;
  const totalUsers = adminData?.users.length || 0;
  const activeUsers = adminData?.users.filter((user) => !user.disabled).length || 0;
  const configuredProviders = Object.values(integrations || {}).filter((value) => value.ok || value.configured).length;

  return (
    <div className="admin-page">
      <section className="admin-hero">
        <div>
          <div className="clbl">Backend</div>
          <h2>Admin workspace</h2>
          <p>Manage users, generation prompts, provider configuration status, and backend operations from one protected surface.</p>
        </div>
        <div className="admin-hero-stats">
          <div><strong>{totalUsers}</strong><span>Users</span></div>
          <div><strong>{activeUsers}</strong><span>Active</span></div>
          <div><strong>{configuredProviders}</strong><span>Providers</span></div>
        </div>
      </section>

      <nav className="admin-tabs" aria-label="Admin modules">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.id} className={activeTab === tab.id ? "on" : ""} onClick={() => setActiveTab(tab.id)}><Icon size={15} />{tab.label}</button>;
        })}
      </nav>

      <section className="admin-tab-panel">
        {activeTab === "users" && <UserManagementCard adminData={adminData} runAdmin={runAdmin} />}
        {activeTab === "permissions" && <PermissionCard adminData={adminData} runAdmin={runAdmin} />}
        {activeTab === "prompts" && <PromptAdminCard data={data} run={run} />}
        {activeTab === "keys" && <ApiKeyManagementCard integrations={integrations} adminData={adminData} currentRole={data.user.role} />}
        {activeTab === "system" && <SystemCard />}
      </section>
    </div>
  );
}
