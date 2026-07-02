"use client";

import { KeyRound, Mail, Save, Server, Settings, UserPlus, Users, WandSparkles } from "lucide-react";
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
  workspaces: { id: string; name: string; niche: string; plan: string; credits: number }[];
};

type RunAction = (a: string, p?: Record<string, unknown>, m?: string) => Promise<unknown>;
type RunAdminAction = (method: "POST" | "PATCH", payload: Record<string, unknown>, message?: string) => Promise<unknown>;
type AdminTab = "users" | "prompts" | "keys" | "system";

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
  return (
    <PanelCard title="User management" action={<span className="admin-pill">{adminData?.users.length || 0} users</span>}>
      <form className="admin-create-user" action={async (form) => {
        await runAdmin("POST", { ...Object.fromEntries(form.entries()), emailVerified: form.get("emailVerified") === "true" }, "User created");
        (document.activeElement as HTMLElement | null)?.blur();
      }}>
        <div className="admin-section-title">
          <b>Create user</b>
          <span>Admin-created users can be verified immediately or sent a verification email.</span>
        </div>
        <div className="modal-grid">
          <label>Email<input name="email" type="email" required autoComplete="off" /></label>
          <label>Temporary password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
          <label>Name<input name="name" placeholder="Optional display name" /></label>
          <label>Role<select name="role" defaultValue="user">{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
          <label>Workspace mode<select name="workspaceMode" defaultValue="new"><option value="new">Create new workspace</option><option value="existing">Assign existing workspace</option></select></label>
          <label>Existing workspace<select name="workspaceId">{(adminData?.workspaces || []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
          <label>New workspace name<input name="workspaceName" placeholder="My Workspace" /></label>
          <label>New workspace niche<input name="workspaceNiche" placeholder="General" /></label>
        </div>
        <label className="inline-check"><input name="emailVerified" type="checkbox" value="true" defaultChecked /> Mark email verified immediately</label>
        <button className="primary"><UserPlus size={14} />Create user</button>
      </form>

      <div className="admin-user-list">
        {(adminData?.users || []).map((user) => (
          <article className={`admin-user-row ${user.disabled ? "disabled" : ""}`} key={user.id}>
            <div className="admin-user-main">
              <b>{user.email}</b>
              <span>{user.name} / {user.workspaceName}</span>
              <small>Created {user.createdAt ? new Date(user.createdAt).toLocaleString() : "unknown"}{user.lastLoginAt ? ` / Last login ${new Date(user.lastLoginAt).toLocaleString()}` : ""}</small>
            </div>
            <form className="admin-user-edit" action={async (form) => {
              await runAdmin("PATCH", { operation: "update", userId: user.id, ...Object.fromEntries(form.entries()), disabled: form.get("disabled") === "true", emailVerified: form.get("emailVerified") === "true" }, "User updated");
            }}>
              <label>Name<input name="name" defaultValue={user.name} /></label>
              <label>Role<select name="role" defaultValue={user.role}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
              <label>Workspace<select name="workspaceId" defaultValue={user.workspaceId}>{(adminData?.workspaces || []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
              <label>Status<select name="disabled" defaultValue={String(user.disabled)}><option value="false">Active</option><option value="true">Disabled</option></select></label>
              <label>Email<select name="emailVerified" defaultValue={String(user.emailVerified)}><option value="true">Verified</option><option value="false">Unverified</option></select></label>
              <button><Save size={14} />Save</button>
            </form>
            <form className="admin-user-actions" action={async (form) => {
              const password = String(form.get("password") || "");
              if (!password) return;
              await runAdmin("PATCH", { operation: "resetPassword", userId: user.id, password }, "Password reset");
            }}>
              <input name="password" type="password" placeholder="New password" minLength={8} />
              <button><KeyRound size={14} />Reset password</button>
              {!user.emailVerified && <button type="button" onClick={() => runAdmin("PATCH", { operation: "resendVerification", userId: user.id }, "Verification resent")}><Mail size={14} />Resend code</button>}
              <span className={`status ${user.disabled ? "failed" : "done"}`}>{user.disabled ? "disabled" : "active"}</span>
            </form>
          </article>
        ))}
      </div>
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
