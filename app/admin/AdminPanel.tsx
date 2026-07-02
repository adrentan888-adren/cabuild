"use client";

import { KeyRound, Mail, Save, Settings, UserPlus } from "lucide-react";
import type { BrandKit, Competitor, CompetitorResult, Opportunity, Platform, PromptTemplates, PublishItem, SocialAudit, Workspace, Asset, Brief, PersonaProfile } from "@/lib/types";

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

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="card"><h3>{title}</h3>{children}</article>;
}

function PromptAdminCard({ data, run }: { data: AdminAppData; run: RunAction }) {
  return (
    <PanelCard title="Prompt admin">
      <form className="brand-form prompt-admin-form" action={async (form) => { await run("updatePromptTemplates", Object.fromEntries(form.entries()), "Prompt templates saved"); }}>
        <div className="modal-grid">
          <label>Username<input name="adminUsername" defaultValue="admin" autoComplete="username" /></label>
          <label>Password<input name="adminPassword" type="password" defaultValue="admin" autoComplete="current-password" /></label>
        </div>
        <p className="muted">These templates power Research result to Generate Content. The video flow stays two-stage internally because Step 2 runs after the user edits the modal fields and uploads logo/person/audio references.</p>
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
    <PanelCard title="User management">
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
              <span>{user.name} · {user.workspaceName}</span>
              <small>Created {user.createdAt ? new Date(user.createdAt).toLocaleString() : "unknown"}{user.lastLoginAt ? ` · Last login ${new Date(user.lastLoginAt).toLocaleString()}` : ""}</small>
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

export default function AdminPanel({ data, run, runAdmin, integrations, adminData }: { data: AdminAppData; run: RunAction; runAdmin: RunAdminAction; integrations: IntegrationData | null; adminData: AdminUserData | null }) {
  return (
    <div className="admin-page">
      <section className="plan-hero">
        <div>
          <div className="clbl">Backend</div>
          <h2>Backend controls</h2>
          <p>Edit generation prompt templates and inspect runtime provider status. Admin template changes are saved to the same cloud data store used by the app.</p>
        </div>
        <div className="plan-count-pill"><strong>admin</strong><span>Protected route</span></div>
      </section>
      <UserManagementCard adminData={adminData} runAdmin={runAdmin} />
      <div className="grid two">
        <PromptAdminCard data={data} run={run} />
        <PanelCard title="Provider status">
          <div className="provider-list">{Object.entries(integrations || {}).map(([name, value]) => <div className="provider-row" key={name}><b>{name}</b><span className={value.ok || value.configured ? "good" : "bad"}>{value.ok ? "verified" : value.configured ? "configured" : "missing"}</span>{value.status && <small>HTTP {value.status}</small>}{value.error && <small>{value.error}</small>}</div>)}</div>
        </PanelCard>
        <PanelCard title="Backend credentials">
          <p className="muted">Phase 2 adds user lifecycle controls here. Keep default demo credentials only for testing, then create named admin users and rotate passwords.</p>
          <code>username: admin</code>
          <code>password: admin</code>
        </PanelCard>
        <PanelCard title="Cloud backend">
          <p>Production and staging currently serve frontend and backend API routes from the same Next.js service. Admin UI is split by route first, service split comes later.</p>
          <code>/api</code>
        </PanelCard>
      </div>
    </div>
  );
}
