"use client";

import { ArrowUpDown, KeyRound, Save, Server, Settings, UserPlus, Users, WandSparkles, X } from "lucide-react";
import { useState } from "react";
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

export type IntegrationData = Record<string, { configured?: boolean; ok?: boolean; status?: number; error?: string; baseUrl?: string; actor?: string }>;

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
};

type RunAction = (a: string, p?: Record<string, unknown>, m?: string) => Promise<unknown>;
type RunAdminAction = (method: "POST" | "PATCH", payload: Record<string, unknown>, message?: string) => Promise<unknown>;
type AdminTab = "users" | "prompts" | "keys" | "system";
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
  const roles = ["super_admin", "admin", "owner", "manager", "creator", "client", "user"];
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
    await runAdmin("PATCH", {
      operation: "update",
      userId: editing.id,
      name: form.get("name"),
      role: form.get("role"),
      disabled: form.get("disabled") === "true",
      emailVerified: true
    }, "User updated");
    if (password) await runAdmin("PATCH", { operation: "resetPassword", userId: editing.id, password }, "Password reset");
    setEditing(null);
  }
  return (
    <PanelCard title="User management" action={<span className="admin-pill">{adminData?.users.length || 0} users</span>}>
      <form className="admin-create-user" action={async (form) => {
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
      </form>

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
                <label>Name<input name="name" defaultValue={editing.name} /></label>
                <label>Username<input value={username(editing)} readOnly /></label>
                <label>Email address<input value={editing.email} readOnly /></label>
                <label>Role<select name="role" defaultValue={editing.role}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                <label>Status<select name="disabled" defaultValue={String(editing.disabled)}><option value="false">Active</option><option value="true">Disabled</option></select></label>
                <label>Created date<input value={editing.createdAt ? new Date(editing.createdAt).toLocaleString() : "Unknown"} readOnly /></label>
              </div>
              <label>Reset password<input name="password" type="password" minLength={8} placeholder="Leave blank to keep current password" /></label>
              <div className="modal-actions">
                <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                <button className="primary"><Save size={14} />Save</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </PanelCard>
  );
}

function ApiKeyManagementCard({ integrations }: { integrations: IntegrationData | null }) {
  return (
    <div className="admin-tab-grid">
      <PanelCard title="API key management">
        <p className="muted">Provider keys are stored as environment variables or GitHub/GCP secrets. This page shows whether each provider is configured without exposing secret values.</p>
        <div className="provider-list">{Object.entries(integrations || {}).map(([name, value]) => <div className="provider-row" key={name}><b>{name}</b><span className={value.ok || value.configured ? "good" : "bad"}>{value.ok ? "verified" : value.configured ? "configured" : "missing"}</span>{value.status && <small>HTTP {value.status}</small>}{value.error && <small>{value.error}</small>}{value.baseUrl && <small>{value.baseUrl}</small>}{value.actor && <small>{value.actor}</small>}</div>)}</div>
      </PanelCard>
      <PanelCard title="Secret handling">
        <div className="admin-info-list">
          <div><b>Runtime keys</b><span>Configured through Cloud Run environment variables or GitHub Actions secrets.</span></div>
          <div><b>Display policy</b><span>Raw API keys are never shown in the browser. Only configured/missing/verified status is shown.</span></div>
          <div><b>Phase 3</b><span>Editable provider configuration should move into a database-backed admin model after Postgres is added.</span></div>
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
        {activeTab === "prompts" && <PromptAdminCard data={data} run={run} />}
        {activeTab === "keys" && <ApiKeyManagementCard integrations={integrations} />}
        {activeTab === "system" && <SystemCard />}
      </section>
    </div>
  );
}
