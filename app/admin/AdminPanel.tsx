"use client";

import { AlertTriangle, ArrowUpDown, CheckCircle2, CreditCard, ExternalLink, KeyRound, Link2, RefreshCcw, Rocket, Save, Server, Settings, ShieldCheck, Trash2, Unplug, UserPlus, Users, WandSparkles, X } from "lucide-react";
import { Fragment, useState } from "react";
import FinanceManagement from "./FinanceManagement";
import type { Asset, BillingCheckoutOrder, BillingCreditPackage, BillingLedgerEntry, BillingPlan, BillingPricingAlert, BillingPricingSyncRun, BillingProviderMapping, BillingRateCard, BillingSettings, BillingStripeCatalogueMapping, BillingStripeCatalogueRevision, BillingStripeConnection, BillingStripeEvent, BillingStripeLaunchControl, BillingStripeLaunchReport, BillingStripeSubscriptionMigration, BillingSubscriptionState, BrandKit, Brief, Competitor, CompetitorResult, Opportunity, PersonaProfile, Platform, PromptTemplates, PublishItem, SocialAudit, StripeMode, Workspace } from "@/lib/types";

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

export type AdminBillingData = {
  settings: BillingSettings;
  workspaceBalances: {
    workspaceId: string;
    workspaceName: string;
    plan: string;
    credits: number;
    available: number;
    reserved: number;
    lifetimeGranted: number;
    lifetimeUsed: number;
  }[];
  users: {
    id: string;
    email: string;
    name: string;
    role: string;
    workspaceId: string;
    workspaceName: string;
    credits: number;
  }[];
  plans: BillingPlan[];
  creditPackages: BillingCreditPackage[];
  rateCards: BillingRateCard[];
  providerMappings: BillingProviderMapping[];
  pricingSyncRuns: BillingPricingSyncRun[];
  pricingAlerts: BillingPricingAlert[];
  stripeSubscriptions: BillingSubscriptionState[];
  stripeEvents: BillingStripeEvent[];
  stripeConnections: BillingStripeConnection[];
  stripeCatalogueMappings: BillingStripeCatalogueMapping[];
  stripeCatalogueRevisions: BillingStripeCatalogueRevision[];
  stripeCheckoutOrders: BillingCheckoutOrder[];
  stripeSubscriptionMigrations: BillingStripeSubscriptionMigration[];
  stripeLiveLaunchControl: BillingStripeLaunchControl;
  stripeLiveLaunchReports: BillingStripeLaunchReport[];
  stripeLiveCatalogueComparison: {
    itemKind: "plan" | "package";
    itemId: string;
    name: string;
    priceUsd: number;
    interval?: "month";
    baseCredits: number;
    bonusCredits: number;
    totalCredits: number;
    testPriceId?: string;
    testStatus: string;
    liveProductId?: string;
    livePriceId?: string;
    liveStatus: string;
    matches: boolean;
  }[];
  stripePermissions: string[];
  stripeLiveSetupLocked: boolean;
  ledger: BillingLedgerEntry[];
};

type RunAction = (a: string, p?: Record<string, unknown>, m?: string) => Promise<unknown>;
type RunAdminAction = (method: "POST" | "PATCH", payload: Record<string, unknown>, message?: string) => Promise<unknown>;
type RunBillingAction = (method: "POST" | "PATCH", payload: Record<string, unknown>, message?: string) => Promise<unknown>;
type RunStripeAction = (payload: Record<string, unknown>, message?: string) => Promise<unknown>;
type AdminTab = "users" | "permissions" | "prompts" | "keys" | "billing" | "system";
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
          <div className="prompt-module-head"><div><b>UGC Video Template</b><span>Controls storyboard planning and every Seedance scene prompt.</span></div></div>
          <label><span className="prompt-step">UGC storyboard generator</span><textarea name="ugcStoryboard" defaultValue={data.promptTemplates.ugcStoryboard} /></label>
          <label><span className="prompt-step">UGC scene generation guardrails</span><textarea name="ugcSceneGeneration" defaultValue={data.promptTemplates.ugcSceneGeneration} /></label>
          <p className="muted compact">Product facts and project settings are appended by the server. Keep product-accuracy and no-generated-text rules in these templates.</p>
        </section>
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
          <label><span className="prompt-step">Video generation guardrails</span><textarea name="videoGenerationGuardrails" defaultValue={data.promptTemplates.videoGenerationGuardrails} /></label>
          <p className="muted compact">Appended to every provider video prompt. Use this to prevent generated text and reserve captions for post-production.</p>
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
                  <small>Env: {item.envConfigured ? "configured" : "missing"}  |  Backend override: {item.overrideConfigured ? `saved ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ""}` : "not set"}</small>
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
          <div><b>Stripe</b><span>Managed from Billing, under Stripe Connection, with isolated test and live credentials.</span></div>
          <div><b>Display policy</b><span>Raw API keys are accepted for replacement only and are never returned to the browser.</span></div>
        </div>
      </PanelCard>
    </div>
  );
}
function formatCredits(value: number) {
  return `${Math.round(value || 0).toLocaleString()} credits`;
}

function formatUsd(value: number) {
  return `$${Number(value || 0).toFixed(4).replace(/\.?0+$/, "")}`;
}

function BillingManagementCard({ billingData, runBilling, runStripe }: { billingData: AdminBillingData | null; runBilling: RunBillingAction; runStripe: RunStripeAction }) {
  const [activeBillingTab, setActiveBillingTab] = useState("plans");
  const [quoteResult, setQuoteResult] = useState<Record<string, unknown> | null>(null);
  const [ledgerModule, setLedgerModule] = useState("");
  const [ledgerProvider, setLedgerProvider] = useState("");
  const [ledgerUser, setLedgerUser] = useState("");
  const [rateProvider, setRateProvider] = useState("");
  const [rateAction, setRateAction] = useState("");
  const [stripeMessage, setStripeMessage] = useState("");
  const [stripeBusy, setStripeBusy] = useState("");
  const [stripeViewMode, setStripeViewMode] = useState<StripeMode>("test");
  const [pricingMessage, setPricingMessage] = useState("");
  const [syncingProvider, setSyncingProvider] = useState("");
  const firstUser = billingData?.users[0];
  const providerOptions = ["kie", "apify", "upload-post", "brevo", "stripe", "local", "custom"];
  const actionOptions = ["video_generation", "image_generation", "text_generation", "scrape", "persona_crawl", "publish", "automation_run", "ai_assist"];
  const unitOptions = ["per_action", "per_second", "per_image", "per_1k_tokens", "per_1k_results", "per_post"];
  const billingTabs = [
    ["plans", "Billing Plans"],
    ["packages", "Credit Packages"],
    ["rates", "Rate Cards"],
    ["mapping", "Provider Mapping"],
    ["stripe", "Stripe Connection"],
    ["launch", "Live Launch"],
    ["finance", "Finance"],
    ["ledger", "Credit Ledger"],
    ["users", "User Billing"],
    ["rules", "Billing Rules"],
    ["alerts", "Pricing Alerts"]
  ];
  const userById = new Map((billingData?.users || []).map((user) => [user.id, user]));
  const ledger = (billingData?.ledger || []).filter((entry) => {
    if (ledgerModule && entry.module !== ledgerModule) return false;
    if (ledgerProvider && entry.provider !== ledgerProvider) return false;
    if (ledgerUser && entry.userId !== ledgerUser) return false;
    return true;
  });
  const filteredRates = (billingData?.rateCards || []).filter((card) => {
    if (rateProvider && card.provider !== rateProvider) return false;
    if (rateAction && card.actionType !== rateAction) return false;
    return true;
  });
  const pricingAlerts = [...(billingData?.pricingAlerts || [])].sort((a, b) => {
    const priority = (alert: BillingPricingAlert) => alert.status === "pending_review" ? 0 : alert.status === "manual_required" ? 1 : 2;
    const priorityDiff = priority(a) - priority(b);
    if (priorityDiff) return priorityDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const pricingRuns = billingData?.pricingSyncRuns || [];
  const stripePermissions = new Set(billingData?.stripePermissions || []);
  const stripeCan = (permission: string) => stripePermissions.has(permission);
  const stripeOffers = billingData ? [
    ...billingData.plans.map((item) => ({ id: item.id, name: item.name, kind: "plan" as const, priceUsd: item.priceUsd, totalCredits: item.totalCredits })),
    ...billingData.creditPackages.map((item) => ({ id: item.id, name: item.name, kind: "package" as const, priceUsd: item.priceUsd, totalCredits: item.totalCredits }))
  ] : [];
  const activeStripeMappings = (billingData?.stripeCatalogueMappings || []).filter((item) => item.active);
  const latestLiveReport = billingData?.stripeLiveLaunchReports?.[0];

  async function adjustCredits(form: FormData) {
    await runBilling("PATCH", {
      operation: "adjustCredits",
      userId: form.get("userId"),
      credits: form.get("credits"),
      description: form.get("description"),
      expiresAt: form.get("expiresAt")
    }, "Credit adjustment saved");
  }
  async function saveSettings(form: FormData) {
    await runBilling("PATCH", {
      operation: "updateSettings",
      defaultMarkupMultiplier: form.get("defaultMarkupMultiplier"),
      lowCreditThreshold: form.get("lowCreditThreshold"),
      automationMinimumBalance: form.get("automationMinimumBalance"),
      automationDefaultRunCap: form.get("automationDefaultRunCap"),
      automationDefaultMonthlyCap: form.get("automationDefaultMonthlyCap"),
      dailySpendLimitCredits: form.get("dailySpendLimitCredits"),
      monthlySpendLimitCredits: form.get("monthlySpendLimitCredits"),
      maxConcurrentGenerations: form.get("maxConcurrentGenerations"),
      failedGenerationRefundPolicy: form.get("failedGenerationRefundPolicy"),
      stripeMode: form.get("stripeMode")
    }, "Billing rules saved");
  }
  async function quote(form: FormData) {
    const result = await runBilling("POST", {
      action: form.get("action"),
      module: form.get("module"),
      provider: form.get("provider"),
      model: form.get("model"),
      generationType: form.get("generationType"),
      duration: form.get("duration"),
      maxResults: form.get("maxResults"),
      platform: form.get("platform")
    }, "Quote calculated") as { quote?: Record<string, unknown> } | null;
    if (result?.quote) setQuoteResult(result.quote);
  }
  async function saveRateCard(form: FormData) {
    await runBilling("PATCH", {
      operation: "updateRateCard",
      id: form.get("id"),
      label: form.get("label"),
      provider: form.get("provider"),
      actionType: form.get("actionType"),
      modelOrActorId: form.get("modelOrActorId"),
      unit: form.get("unit"),
      baseCostUsd: form.get("baseCostUsd"),
      markupMultiplier: form.get("markupMultiplier"),
      minimumChargeCredits: form.get("minimumChargeCredits"),
      active: form.get("active") === "on"
    }, "Rate card saved");
  }
  async function saveMapping(form: FormData) {
    await runBilling("PATCH", {
      operation: "updateProviderMapping",
      id: form.get("id"),
      label: form.get("label"),
      uiKey: form.get("uiKey"),
      provider: form.get("provider"),
      providerModelOrActorId: form.get("providerModelOrActorId"),
      actionType: form.get("actionType"),
      active: form.get("active") === "on"
    }, "Provider mapping saved");
  }
  async function savePlan(form: FormData) {
    await runBilling("PATCH", {
      operation: "updatePlan",
      id: form.get("id"),
      name: form.get("name"),
      priceUsd: form.get("priceUsd"),
      baseCredits: form.get("baseCredits"),
      bonusPercent: form.get("bonusPercent"),
      expiryDays: form.get("expiryDays"),
      active: form.get("active") === "on",
      automationAllowed: form.get("automationAllowed") === "on",
      maxConcurrentGenerations: form.get("maxConcurrentGenerations"),
      monthlyUsageLimitCredits: form.get("monthlyUsageLimitCredits")
    }, "Billing plan saved");
  }
  async function savePackage(form: FormData) {
    await runBilling("PATCH", {
      operation: "updateCreditPackage",
      id: form.get("id"),
      name: form.get("name"),
      priceUsd: form.get("priceUsd"),
      baseCredits: form.get("baseCredits"),
      bonusPercent: form.get("bonusPercent"),
      bonusCredits: form.get("bonusCredits"),
      active: form.get("active") === "on",
      expiresAfterDays: form.get("expiresAfterDays"),
      maxPurchasesPerMonth: form.get("maxPurchasesPerMonth")
    }, "Credit package saved");
  }
  async function stripeAction(key: string, payload: Record<string, unknown>, success: string) {
    setStripeMessage("");
    setStripeBusy(key);
    const result = await runStripe(payload, success) as { message?: string; error?: string } | null;
    setStripeMessage(result?.message || (result ? success : "Stripe action failed. Review the notification or logs."));
    setStripeBusy("");
  }
  async function saveLiveReadiness(form: FormData) {
    if (!billingData) return;
    const readiness = billingData.stripeLiveLaunchControl.readiness.map((item) => ({
      key: item.key,
      confirmed: form.get(`ready:${item.key}`) === "on",
      note: form.get(`note:${item.key}`)
    }));
    await stripeAction("live-readiness", { operation: "updateLiveReadiness", mode: "live", readiness }, "Live-readiness checklist saved");
  }
  async function approveLiveReadiness() {
    const confirmation = window.prompt("Type APPROVE LIVE READINESS to confirm every prerequisite.");
    if (!confirmation) return;
    await stripeAction("approve-live-readiness", { operation: "approveLiveReadiness", mode: "live", confirmation }, "Live readiness approved");
  }
  async function saveLiveRollout(form: FormData) {
    if (!billingData) return;
    const allowlistedUserIds = billingData.users.filter((user) => form.get(`allow:${user.id}`) === "on").map((user) => user.id);
    await stripeAction("live-rollout", { operation: "updateLiveRollout", mode: "live", stage: form.get("stage"), allowlistedUserIds }, "Live rollout saved");
  }
  async function saveLiveReport(form: FormData) {
    if (!billingData) return;
    const checks = Object.fromEntries(["topUpCreditsCorrect", "subscriptionCreditsCorrect", "receiptConfirmed", "portalConfirmed", "cancellationConfirmed", "refundConfirmed", "duplicateWebhookConfirmed"].map((key) => [key, form.get(key) === "on"]));
    await stripeAction("live-report", {
      operation: "saveLiveLaunchReport",
      mode: "live",
      reportId: form.get("reportId"),
      topUpOrderId: form.get("topUpOrderId"),
      subscriptionOrderId: form.get("subscriptionOrderId"),
      stripePaymentIntentId: form.get("stripePaymentIntentId"),
      stripeSubscriptionId: form.get("stripeSubscriptionId"),
      ledgerEntryIds: form.get("ledgerEntryIds"),
      checks,
      notes: form.get("notes")
    }, "Live smoke-test report saved");
  }
  async function syncProviderPricing(provider: string) {
    setPricingMessage("");
    setSyncingProvider(provider);
    try {
      await runBilling("PATCH", { operation: "syncProviderPricing", provider }, `${provider} pricing sync completed`);
      setPricingMessage(`${provider} pricing sync completed. Review any new alerts below.`);
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : "Pricing sync failed.");
    } finally {
      setSyncingProvider("");
    }
  }
  async function decidePricingAlert(alertId: string, operation: "approvePricingAlert" | "rejectPricingAlert" | "keepManualPricingAlert") {
    setPricingMessage("");
    try {
      await runBilling("PATCH", { operation, alertId }, "Pricing alert updated");
      setPricingMessage("Pricing alert updated.");
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : "Could not update pricing alert.");
    }
  }

  if (!billingData) {
    return <PanelCard title="Billing management"><p className="muted">Loading billing data...</p></PanelCard>;
  }

  return (
    <div className="admin-billing-page">
      <div className="admin-billing-tabs" aria-label="Billing admin modules">
        {billingTabs.map(([id, label]) => (
          <button key={id} className={activeBillingTab === id ? "on" : ""} onClick={() => setActiveBillingTab(id)}>{label}</button>
        ))}
      </div>

      {activeBillingTab === "plans" && (
        <PanelCard title="Billing plans" action={<span className="admin-pill">{billingData.plans.length} plans</span>}>
          <div className="billing-admin-list">
            {billingData.plans.map((plan) => (
              <form className="billing-admin-card" key={plan.id} action={savePlan}>
                <input type="hidden" name="id" value={plan.id} />
                <div className="billing-admin-card-head">
                  <div><b>{plan.name}</b><span>{formatUsd(plan.priceUsd)} / month | {formatCredits(plan.totalCredits)}</span></div>
                  <label className="checkline"><input name="active" type="checkbox" defaultChecked={plan.active} />Active</label>
                </div>
                <div className="modal-grid">
                  <label>Name<input name="name" defaultValue={plan.name} /></label>
                  <label>Monthly price USD<input name="priceUsd" type="number" step="0.01" defaultValue={plan.priceUsd} /></label>
                  <label>Base credits<input name="baseCredits" type="number" step="1" defaultValue={plan.baseCredits} /></label>
                  <label>Bonus %<input name="bonusPercent" type="number" step="0.1" defaultValue={plan.bonusPercent} /></label>
                  <label>Credit expiry days<input name="expiryDays" type="number" step="1" defaultValue={plan.expiryDays} /></label>
                  <label>Monthly usage limit<input name="monthlyUsageLimitCredits" type="number" step="1" defaultValue={plan.monthlyUsageLimitCredits || ""} placeholder="Optional" /></label>
                  <label>Max concurrent generations<input name="maxConcurrentGenerations" type="number" step="1" defaultValue={plan.maxConcurrentGenerations || 1} /></label>
                </div>
                <div className="row-actions">
                  <label className="checkline"><input name="automationAllowed" type="checkbox" defaultChecked={Boolean(plan.automationAllowed)} />Automation allowed</label>
                  <button><Save size={14} />Save plan</button>
                </div>
              </form>
            ))}
          </div>
        </PanelCard>
      )}

      {activeBillingTab === "finance" && <FinanceManagement settings={billingData.settings} />}

      {activeBillingTab === "packages" && (
        <PanelCard title="Credit packages" action={<span className="admin-pill">{billingData.creditPackages.length} packages</span>}>
          <div className="billing-admin-list">
            {billingData.creditPackages.map((pkg) => (
              <form className="billing-admin-card" key={pkg.id} action={savePackage}>
                <input type="hidden" name="id" value={pkg.id} />
                <div className="billing-admin-card-head">
                  <div><b>{pkg.name}</b><span>{formatUsd(pkg.priceUsd)} | {formatCredits(pkg.totalCredits)}</span></div>
                  <label className="checkline"><input name="active" type="checkbox" defaultChecked={pkg.active} />Active</label>
                </div>
                <div className="modal-grid">
                  <label>Name<input name="name" defaultValue={pkg.name} /></label>
                  <label>Price USD<input name="priceUsd" type="number" step="0.01" defaultValue={pkg.priceUsd} /></label>
                  <label>Base credits<input name="baseCredits" type="number" step="1" defaultValue={pkg.baseCredits} /></label>
                  <label>Bonus %<input name="bonusPercent" type="number" step="0.1" defaultValue={pkg.bonusPercent} /></label>
                  <label>Bonus credits<input name="bonusCredits" type="number" step="1" defaultValue={pkg.bonusCredits} /></label>
                  <label>Expires after days<input name="expiresAfterDays" type="number" step="1" defaultValue={pkg.expiresAfterDays || ""} placeholder="No expiry" /></label>
                  <label>Max purchases / month<input name="maxPurchasesPerMonth" type="number" step="1" defaultValue={pkg.maxPurchasesPerMonth || ""} placeholder="Unlimited" /></label>
                </div>
                <button><Save size={14} />Save package</button>
              </form>
            ))}
          </div>
        </PanelCard>
      )}

      {activeBillingTab === "rates" && (
        <PanelCard title="Rate cards" action={<span className="admin-pill">{filteredRates.length} shown</span>}>
          <div className="billing-admin-filters">
            <label>Provider<select value={rateProvider} onChange={(event) => setRateProvider(event.target.value)}><option value="">All providers</option>{providerOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
            <label>Action<select value={rateAction} onChange={(event) => setRateAction(event.target.value)}><option value="">All actions</option>{actionOptions.map((action) => <option key={action} value={action}>{action}</option>)}</select></label>
          </div>
          <div className="billing-admin-list">
            {filteredRates.map((card) => (
              <form className="billing-admin-card" key={card.id} action={saveRateCard}>
                <input type="hidden" name="id" value={card.id} />
                <div className="billing-admin-card-head">
                  <div><b>{card.label}</b><span>{card.provider} | {card.actionType} | {card.modelOrActorId}</span></div>
                  <label className="checkline"><input name="active" type="checkbox" defaultChecked={card.active} />Active</label>
                </div>
                <div className="billing-rate-grid">
                  <label>Label<input name="label" defaultValue={card.label} /></label>
                  <label>Provider<select name="provider" defaultValue={card.provider}>{providerOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
                  <label>Action<select name="actionType" defaultValue={card.actionType}>{actionOptions.map((action) => <option key={action} value={action}>{action}</option>)}</select></label>
                  <label>Provider model / actor<input name="modelOrActorId" defaultValue={card.modelOrActorId} /></label>
                  <label>Unit<select name="unit" defaultValue={card.unit}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
                  <label>Base cost USD<input name="baseCostUsd" type="number" step="0.000001" defaultValue={card.baseCostUsd} /></label>
                  <label>Markup<input name="markupMultiplier" type="number" step="0.1" defaultValue={card.markupMultiplier} /></label>
                  <label>Minimum credits<input name="minimumChargeCredits" type="number" step="1" defaultValue={card.minimumChargeCredits} /></label>
                </div>
                <div className="row-actions">
                  <span className="admin-pill">{card.source}{card.lastSyncedAt ? ` | synced ${new Date(card.lastSyncedAt).toLocaleString()}` : ""}</span>
                  <button><Save size={14} />Save rate</button>
                </div>
              </form>
            ))}
          </div>
        </PanelCard>
      )}

      {activeBillingTab === "mapping" && (
        <PanelCard title="Provider mapping" action={<span className="admin-pill">{billingData.providerMappings.length} mappings</span>}>
          <div className="billing-admin-list">
            {billingData.providerMappings.map((mapping) => (
              <form className="billing-admin-card compact" key={mapping.id} action={saveMapping}>
                <input type="hidden" name="id" value={mapping.id} />
                <div className="billing-rate-grid">
                  <label>UI key<input name="uiKey" defaultValue={mapping.uiKey} /></label>
                  <label>Label<input name="label" defaultValue={mapping.label} /></label>
                  <label>Provider<select name="provider" defaultValue={mapping.provider}>{providerOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
                  <label>Action<select name="actionType" defaultValue={mapping.actionType}>{actionOptions.map((action) => <option key={action} value={action}>{action}</option>)}</select></label>
                  <label>Provider model / actor<input name="providerModelOrActorId" defaultValue={mapping.providerModelOrActorId} /></label>
                </div>
                <div className="row-actions">
                  <label className="checkline"><input name="active" type="checkbox" defaultChecked={mapping.active} />Active</label>
                  <button><Save size={14} />Save mapping</button>
                </div>
              </form>
            ))}
          </div>
        </PanelCard>
      )}

      {activeBillingTab === "launch" && (
        <div className="stripe-admin-stack live-launch-stack">
          {stripeMessage && <div className="provider-error inline">{stripeMessage}</div>}
          <PanelCard title="Phase 11 readiness" action={<span className={`status ${billingData.stripeLiveLaunchControl.readinessApprovedAt ? "done" : "pending"}`}>{billingData.stripeLiveLaunchControl.readinessApprovedAt ? "Approved" : `${billingData.stripeLiveLaunchControl.readiness.filter((item) => item.confirmed).length}/${billingData.stripeLiveLaunchControl.readiness.length}`}</span>}>
            <p className="muted compact">Confirm operational, legal, tax, backup, and security prerequisites before the live Stripe key can be connected. Editing this checklist clears its approval.</p>
            <form className="brand-form" action={saveLiveReadiness}>
              <div className="live-readiness-list">
                {billingData.stripeLiveLaunchControl.readiness.map((item) => (
                  <div className="live-readiness-row" key={item.key}>
                    <label className="checkline"><input name={`ready:${item.key}`} type="checkbox" defaultChecked={item.confirmed} /><span><b>{item.label}</b><small>{item.description}</small></span></label>
                    <input name={`note:${item.key}`} defaultValue={item.note || ""} placeholder="Evidence or decision note" />
                  </div>
                ))}
              </div>
              <div className="row-actions">
                <button disabled={!stripeCan("stripe.approveLiveLaunch") || Boolean(stripeBusy)}><Save size={14} />Save checklist</button>
                <button className="primary" type="button" disabled={!stripeCan("stripe.approveLiveLaunch") || Boolean(stripeBusy) || billingData.stripeLiveLaunchControl.readiness.some((item) => !item.confirmed)} onClick={approveLiveReadiness}><ShieldCheck size={14} />Approve readiness</button>
              </div>
            </form>
          </PanelCard>

          <PanelCard title="Test and live catalogue comparison" action={<span className={`status ${billingData.stripeLiveCatalogueComparison.every((item) => item.matches) ? "done" : "pending"}`}>{billingData.stripeLiveCatalogueComparison.filter((item) => item.matches).length}/{billingData.stripeLiveCatalogueComparison.length} match</span>}>
            <div className="admin-user-table-wrap">
              <table className="admin-user-table billing-table">
                <thead><tr><th><span>Offer</span></th><th><span>Backend</span></th><th><span>Test Price</span></th><th><span>Live Price</span></th><th><span>Match</span></th></tr></thead>
                <tbody>{billingData.stripeLiveCatalogueComparison.map((item) => <tr key={`${item.itemKind}:${item.itemId}`}><td><b>{item.name}</b><small>{item.itemKind === "plan" ? "Monthly" : "Top-up"}</small></td><td>{formatUsd(item.priceUsd)}<small>{formatCredits(item.totalCredits)} | bonus {formatCredits(item.bonusCredits)}</small></td><td><code>{item.testPriceId || "Not synced"}</code></td><td><code>{item.livePriceId || "Not synced"}</code></td><td><span className={`status ${item.matches ? "done" : "pending"}`}>{item.matches ? "Match" : "Pending"}</span></td></tr>)}</tbody>
              </table>
            </div>
            <div className="row-actions">
              <button type="button" disabled={Boolean(stripeBusy)} onClick={() => stripeAction("live-preflight", { operation: "runLivePreflight", mode: "live" }, "Live preflight completed")}><RefreshCcw size={14} />Run preflight</button>
              <button className="primary" type="button" disabled={!stripeCan("stripe.approveLiveLaunch") || Boolean(stripeBusy) || billingData.stripeLiveCatalogueComparison.some((item) => !item.matches)} onClick={async () => {
                const confirmation = window.prompt("Type APPROVE LIVE CATALOGUE to approve the current real-payment prices and credits.");
                if (!confirmation) return;
                await stripeAction("approve-live-catalogue", { operation: "approveLiveCatalogue", mode: "live", confirmation }, "Live catalogue approved");
              }}><CheckCircle2 size={14} />Approve live catalogue</button>
            </div>
            {billingData.stripeLiveLaunchControl.lastPreflightChecks && <div className="preflight-grid">{billingData.stripeLiveLaunchControl.lastPreflightChecks.map((check) => <div className={check.passed ? "pass" : "fail"} key={check.key}><span>{check.passed ? "Pass" : "Action"}</span><b>{check.label}</b><small>{check.detail}</small></div>)}</div>}
          </PanelCard>

          <PanelCard title="Controlled rollout" action={<span className={`status ${billingData.stripeLiveLaunchControl.checkoutKillSwitch ? "pending" : "done"}`}>{billingData.stripeLiveLaunchControl.checkoutKillSwitch ? "Checkout blocked" : "Checkout open"}</span>}>
            <form className="brand-form" action={saveLiveRollout}>
              <label>Rollout stage<select name="stage" defaultValue={billingData.stripeLiveLaunchControl.rolloutStage}><option value="disabled">Disabled</option><option value="owner_only">Owner only</option><option value="internal">Internal admins</option><option value="allowlist">Selected users</option><option value="all_verified">All verified users</option></select></label>
              <div className="live-allowlist">
                <b>User allowlist</b>
                <div>{billingData.users.map((user) => <label className="checkline" key={user.id}><input name={`allow:${user.id}`} type="checkbox" defaultChecked={billingData.stripeLiveLaunchControl.allowlistedUserIds.includes(user.id)} /><span>{user.name}<small>{user.email} | {user.role}</small></span></label>)}</div>
              </div>
              <button disabled={!stripeCan("stripe.manageLiveRollout") || Boolean(stripeBusy)}><Save size={14} />Save rollout</button>
            </form>
            <p className="muted compact">Owner-only can be used for the first real top-up and subscription. Expanding to internal, allowlisted, or all verified users requires an approved smoke-test report.</p>
          </PanelCard>

          <PanelCard title="Owner live smoke-test report" action={<span className={`status ${latestLiveReport?.status === "approved" ? "done" : "pending"}`}>{latestLiveReport?.status || "Not started"}</span>}>
            <form className="brand-form" action={saveLiveReport}>
              <input type="hidden" name="reportId" value={latestLiveReport?.id || ""} />
              <div className="modal-grid">
                <label>$5 top-up order ID<input name="topUpOrderId" defaultValue={latestLiveReport?.topUpOrderId || ""} placeholder="order_..." /></label>
                <label>$20 subscription order ID<input name="subscriptionOrderId" defaultValue={latestLiveReport?.subscriptionOrderId || ""} placeholder="order_..." /></label>
                <label>Stripe PaymentIntent ID<input name="stripePaymentIntentId" defaultValue={latestLiveReport?.stripePaymentIntentId || ""} placeholder="pi_..." /></label>
                <label>Stripe subscription ID<input name="stripeSubscriptionId" defaultValue={latestLiveReport?.stripeSubscriptionId || ""} placeholder="sub_..." /></label>
                <label className="span-2">Content Agent ledger IDs<input name="ledgerEntryIds" defaultValue={latestLiveReport?.ledgerEntryIds.join(", ") || ""} placeholder="cred_..., cred_..." /></label>
              </div>
              <div className="live-report-checks">
                {[
                  ["topUpCreditsCorrect", "Top-up credits exactly once"], ["subscriptionCreditsCorrect", "Subscription credits exactly once"], ["receiptConfirmed", "Charge and receipt confirmed"], ["portalConfirmed", "Customer Portal opened"], ["cancellationConfirmed", "Cancellation recorded"], ["refundConfirmed", "Refund and credit reversal reconciled"], ["duplicateWebhookConfirmed", "Duplicate webhook caused no duplicate grant"]
                ].map(([key, label]) => <label className="checkline" key={key}><input name={key} type="checkbox" defaultChecked={Boolean(latestLiveReport?.checks[key as keyof BillingStripeLaunchReport["checks"]])} />{label}</label>)}
              </div>
              <label>Redacted launch notes<textarea name="notes" defaultValue={latestLiveReport?.notes || ""} placeholder="Record outcomes and redacted object references. Never enter card details or API keys." /></label>
              <div className="row-actions">
                <button disabled={!stripeCan("stripe.manageLiveRollout") || Boolean(stripeBusy)}><Save size={14} />Save report</button>
                <button className="primary" type="button" disabled={!latestLiveReport || latestLiveReport.status === "approved" || !stripeCan("stripe.approveLiveLaunch") || Boolean(stripeBusy)} onClick={async () => {
                  const confirmation = window.prompt("Type APPROVE LIVE SMOKE TEST to permit wider rollout.");
                  if (!confirmation || !latestLiveReport) return;
                  await stripeAction("approve-live-report", { operation: "approveLiveLaunchReport", mode: "live", reportId: latestLiveReport.id, confirmation }, "Live smoke-test report approved");
                }}><Rocket size={14} />Approve smoke test</button>
              </div>
            </form>
          </PanelCard>

          <PanelCard title="Emergency rollback">
            <div className="provider-error inline"><AlertTriangle size={15} />This blocks new live Checkout sessions immediately. Webhooks remain enabled so existing payments, subscriptions, refunds, and retries continue to be recorded.</div>
            <button className="danger-btn" type="button" disabled={!stripeCan("stripe.emergencyStop") || Boolean(stripeBusy)} onClick={async () => {
              const reason = window.prompt("Enter the incident or rollback reason.");
              if (!reason) return;
              const confirmation = window.prompt("Type STOP LIVE CHECKOUT to confirm the emergency stop.");
              if (!confirmation) return;
              await stripeAction("emergency-live-stop", { operation: "emergencyStopLive", mode: "live", reason, confirmation }, "Live Checkout stopped; webhooks remain active");
            }}><AlertTriangle size={14} />Stop live Checkout</button>
            {billingData.stripeLiveLaunchControl.emergencyStoppedAt && <p className="muted compact">Last stopped {new Date(billingData.stripeLiveLaunchControl.emergencyStoppedAt).toLocaleString()}: {billingData.stripeLiveLaunchControl.emergencyReason}</p>}
          </PanelCard>
        </div>
      )}

      {activeBillingTab === "stripe" && (
        <div className="stripe-admin-stack">
          {stripeMessage && <div className="provider-error inline">{stripeMessage}</div>}
          <PanelCard title="Payment environment" action={<span className={`status ${billingData.settings.stripeMode === "live" ? "pending" : "done"}`}>{billingData.settings.stripeMode === "live" ? "LIVE" : "TEST"}</span>}>
            <form className="stripe-mode-row" action={saveSettings}>
              <label>Frontend Checkout environment
                <select name="stripeMode" defaultValue={billingData.settings.stripeMode || "test"}>
                  <option value="test">Test mode</option>
                  <option value="live" disabled={billingData.stripeLiveSetupLocked}>Live mode{billingData.stripeLiveSetupLocked ? " - Phase 11 locked" : ""}</option>
                </select>
              </label>
              <input type="hidden" name="defaultMarkupMultiplier" value={billingData.settings.defaultMarkupMultiplier} />
              <input type="hidden" name="lowCreditThreshold" value={billingData.settings.lowCreditThreshold} />
              <input type="hidden" name="automationMinimumBalance" value={billingData.settings.automationMinimumBalance} />
              <input type="hidden" name="automationDefaultRunCap" value={billingData.settings.automationDefaultRunCap} />
              <input type="hidden" name="automationDefaultMonthlyCap" value={billingData.settings.automationDefaultMonthlyCap} />
              <input type="hidden" name="dailySpendLimitCredits" value={billingData.settings.dailySpendLimitCredits || 0} />
              <input type="hidden" name="monthlySpendLimitCredits" value={billingData.settings.monthlySpendLimitCredits || 0} />
              <input type="hidden" name="maxConcurrentGenerations" value={billingData.settings.maxConcurrentGenerations || 1} />
              <input type="hidden" name="failedGenerationRefundPolicy" value={billingData.settings.failedGenerationRefundPolicy || "refund_if_provider_failed"} />
              <button><Save size={14} />Save environment</button>
            </form>
            <p className="muted compact">Test and live credentials, webhooks, customers, and Price mappings are isolated. Live setup stays locked until the Phase 10.5 test acceptance gate passes.</p>
          </PanelCard>

          <div className="stripe-connection-grid">
            {(["test", "live"] as StripeMode[]).map((mode) => {
              const connection = billingData.stripeConnections.find((item) => item.mode === mode) || { mode, status: "disconnected", checkoutEnabled: false, webhookStatus: "missing" as const };
              const locked = mode === "live" && (billingData.stripeLiveSetupLocked || !billingData.stripeLiveLaunchControl.readinessApprovedAt);
              const canConnect = stripeCan(mode === "test" ? "stripe.connectTest" : "stripe.connectLive");
              const canSync = stripeCan(mode === "test" ? "stripe.manageTestCatalogue" : "stripe.manageLiveCatalogue");
              const connectForm = (
                <form className="stripe-connect-form" action={async (form) => {
                  const confirmation = mode === "live" ? window.prompt("Type CONNECT LIVE STRIPE to connect the real-payment account.") : "";
                  if (mode === "live" && !confirmation) return;
                  await stripeAction(`connect:${mode}`, {
                    operation: "connect",
                    mode,
                    secretKey: form.get("secretKey"),
                    publishableKey: form.get("publishableKey"),
                    confirmation
                  }, `Stripe ${mode} account connected`);
                }}>
                  <label>Secret or restricted key<input name="secretKey" type="password" required placeholder={mode === "test" ? "sk_test_... or rk_test_..." : "sk_live_... or rk_live_..."} autoComplete="off" disabled={locked || !canConnect || Boolean(stripeBusy)} /></label>
                  <label>Publishable key <span>optional</span><input name="publishableKey" type="password" placeholder={mode === "test" ? "pk_test_..." : "pk_live_..."} autoComplete="off" disabled={locked || !canConnect || Boolean(stripeBusy)} /></label>
                  <button className="primary" disabled={locked || !canConnect || Boolean(stripeBusy)}><Link2 size={14} />{stripeBusy === `connect:${mode}` ? "Connecting..." : connection.status === "connected" ? "Replace connection" : "Connect Stripe"}</button>
                </form>
              );
              return (
                <section className={`stripe-connection-panel ${mode}`} key={mode}>
                  <div className="stripe-connection-head">
                    <div><span className="stripe-mode-label">{mode}</span><h3>{mode === "test" ? "Test account" : "Live account"}</h3></div>
                    <span className={`status ${connection.status === "connected" ? "done" : connection.status === "error" ? "failed" : "pending"}`}>{locked ? "Locked" : connection.status}</span>
                  </div>
                  {connection.status === "connected" ? (
                    <>
                      <div className="stripe-account-summary">
                        <div><span>Account</span><b>{connection.accountName || connection.accountId}</b><small>{connection.accountId}</small></div>
                        <div><span>Region</span><b>{connection.country || "Unknown"}</b><small>{(connection.defaultCurrency || "usd").toUpperCase()}</small></div>
                        <div><span>Webhook</span><b>{connection.webhookStatus || "missing"}</b><small>{connection.lastWebhookAt ? `Last event ${new Date(connection.lastWebhookAt).toLocaleString()}` : "No event received yet"}</small></div>
                        <div><span>Checkout</span><b>{connection.checkoutEnabled ? "Enabled" : "Disabled"}</b><small>{connection.catalogSyncedAt ? `Synced ${new Date(connection.catalogSyncedAt).toLocaleString()}` : "Catalogue not synced"}</small></div>
                      </div>
                      {connection.error && <div className="provider-error inline">{connection.error}</div>}
                      <div className="row-actions stripe-actions">
                        <a className="asset-link" href={mode === "test" ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com"} target="_blank" rel="noreferrer"><ExternalLink size={13} />Stripe Dashboard</a>
                        <button type="button" disabled={Boolean(stripeBusy)} onClick={() => stripeAction(`validate:${mode}`, { operation: "validate", mode }, `Stripe ${mode} validated`)}><CheckCircle2 size={14} />{stripeBusy === `validate:${mode}` ? "Validating..." : "Validate"}</button>
                        <button type="button" disabled={locked || !canSync || Boolean(stripeBusy)} onClick={async () => {
                          const confirmation = mode === "live" ? window.prompt("Type SYNC LIVE CATALOGUE to create or update real Stripe products and prices.") : "";
                          if (mode === "live" && !confirmation) return;
                          await stripeAction(`sync:${mode}`, { operation: "syncCatalogue", mode, subscriptionPolicy: "new_customers_only", reason: "Admin synchronized Content Agent billing offers.", confirmation }, `Stripe ${mode} catalogue synchronized`);
                        }}><RefreshCcw size={14} />{stripeBusy === `sync:${mode}` ? "Synchronizing..." : "Sync catalogue"}</button>
                        <button className={connection.checkoutEnabled ? "danger-btn" : "primary"} type="button" disabled={locked || !canSync || Boolean(stripeBusy)} onClick={async () => {
                          const enablingLive = mode === "live" && !connection.checkoutEnabled;
                          const confirmation = enablingLive ? window.prompt("Type ENABLE LIVE CHECKOUT to allow real payments for the selected rollout stage.") : "";
                          if (enablingLive && !confirmation) return;
                          await stripeAction(`checkout:${mode}`, { operation: "toggleCheckout", mode, enabled: !connection.checkoutEnabled, confirmation }, `${mode} Checkout ${connection.checkoutEnabled ? "disabled" : "enabled"}`);
                        }}>{connection.checkoutEnabled ? "Disable Checkout" : "Enable Checkout"}</button>
                      </div>
                      {canConnect && <details className="stripe-replace"><summary>Replace account credentials</summary>{connectForm}</details>}
                      {stripeCan("stripe.disconnect") && <button className="stripe-disconnect" type="button" disabled={Boolean(stripeBusy)} onClick={() => {
                        const required = mode === "live" ? "DISCONNECT LIVE STRIPE" : "DISCONNECT TEST STRIPE";
                        const confirmation = window.prompt(`Type ${required} to disconnect. Financial history will be retained.`);
                        if (confirmation) stripeAction(`disconnect:${mode}`, { operation: "disconnect", mode, confirmation }, `Stripe ${mode} disconnected`);
                      }}><Unplug size={13} />Disconnect {mode}</button>}
                    </>
                  ) : (
                    <>
                      <p className="muted">{locked ? billingData.stripeLiveSetupLocked ? "Live setup is disabled by the deployment environment." : "Approve every item in Live Launch before connecting the live account." : "Enter the Stripe secret key. Content Agent validates the account and creates the signed webhook automatically."}</p>
                      {connectForm}
                    </>
                  )}
                </section>
              );
            })}
          </div>

          <PanelCard title="Stripe catalogue" action={<div className="stripe-segmented"><button className={stripeViewMode === "test" ? "on" : ""} onClick={() => setStripeViewMode("test")}>Test</button><button className={stripeViewMode === "live" ? "on" : ""} onClick={() => setStripeViewMode("live")}>Live</button></div>}>
            <div className="admin-user-table-wrap">
              <table className="admin-user-table billing-table">
                <thead><tr><th><span>Offer</span></th><th><span>Type</span></th><th><span>Content Agent</span></th><th><span>Stripe status</span></th><th><span>Price ID</span></th></tr></thead>
                <tbody>{stripeOffers.map((offer) => {
                  const mapping = activeStripeMappings.find((item) => item.mode === stripeViewMode && item.itemKind === offer.kind && item.itemId === offer.id);
                  return <tr key={`${offer.kind}:${offer.id}`}><td><b>{offer.name}</b></td><td>{offer.kind === "plan" ? "Monthly" : "Top-up"}</td><td>{formatUsd(offer.priceUsd)} | {formatCredits(offer.totalCredits)}</td><td><span className={`status ${mapping?.status === "synced" ? "done" : mapping?.status === "error" ? "failed" : "pending"}`}>{mapping?.status || "not synced"}</span></td><td><code>{mapping?.priceId || "Created during sync"}</code></td></tr>;
                })}</tbody>
              </table>
            </div>
            <p className="muted compact">Saving a changed plan or package marks its Stripe mapping out of sync. Syncing creates a new immutable Stripe Price and keeps the previous revision for audit.</p>
          </PanelCard>

          <PanelCard title="Checkout orders" action={<span className="admin-pill">{billingData.stripeCheckoutOrders.length} recent</span>}>
            <div className="admin-user-table-wrap">
              <table className="admin-user-table billing-table">
                <thead><tr><th><span>Created</span></th><th><span>Mode</span></th><th><span>Offer</span></th><th><span>Promised</span></th><th><span>Status</span></th><th><span>Order</span></th></tr></thead>
                <tbody>{billingData.stripeCheckoutOrders.slice(0, 20).map((order) => <tr key={order.id}><td>{new Date(order.createdAt).toLocaleString()}</td><td>{order.mode}</td><td>{order.itemName}<small>{formatUsd(order.amountUsd)}</small></td><td>{formatCredits(order.creditsPromised)}</td><td><span className={`status ${order.status === "paid" ? "done" : order.status === "failed" ? "failed" : "pending"}`}>{order.status}</span></td><td><code>{order.id}</code></td></tr>)}
                  {billingData.stripeCheckoutOrders.length === 0 && <tr><td colSpan={6}>No Stripe Checkout orders recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </PanelCard>

          <PanelCard title="Stripe subscriptions">
            <div className="admin-user-table-wrap">
              <table className="admin-user-table billing-table">
                <thead><tr><th><span>User</span></th><th><span>Plan</span></th><th><span>Status</span></th><th><span>Period end</span></th><th><span>Subscription</span></th></tr></thead>
                <tbody>
                  {(billingData.stripeSubscriptions || []).map((sub) => {
                    const user = billingData.users.find((item) => item.id === sub.userId);
                    const plan = billingData.plans.find((item) => item.id === sub.planId);
                    return <tr key={sub.id}><td>{user?.email || sub.userId}</td><td>{plan?.name || sub.planId}</td><td>{sub.status}{sub.cancelAtPeriodEnd ? " (canceling)" : ""}</td><td>{sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleString() : "N/A"}</td><td>{sub.stripeSubscriptionId}</td></tr>;
                  })}
                  {(!billingData.stripeSubscriptions || billingData.stripeSubscriptions.length === 0) && <tr><td colSpan={5}>No Stripe subscriptions recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </PanelCard>
          <PanelCard title="Stripe webhook events">
            <div className="admin-user-table-wrap">
              <table className="admin-user-table billing-table">
                <thead><tr><th><span>Processed</span></th><th><span>Type</span></th><th><span>Status</span></th><th><span>Mode</span></th><th><span>Event ID</span></th></tr></thead>
                <tbody>
                  {(billingData.stripeEvents || []).slice(0, 20).map((event) => (
                    <tr key={event.id}><td>{new Date(event.processedAt).toLocaleString()}</td><td>{event.type}</td><td>{event.status}{event.error ? ` - ${event.error}` : ""}</td><td>{event.livemode ? "live" : "test"}</td><td>{event.stripeEventId}</td></tr>
                  ))}
                  {(!billingData.stripeEvents || billingData.stripeEvents.length === 0) && <tr><td colSpan={5}>No Stripe webhook events recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </PanelCard>
        </div>
      )}

      {activeBillingTab === "ledger" && (
        <PanelCard title="Credit ledger" action={<span className="admin-pill">{ledger.length} rows</span>}>
          <div className="billing-admin-filters three">
            <label>Module<select value={ledgerModule} onChange={(event) => setLedgerModule(event.target.value)}><option value="">All modules</option>{Array.from(new Set(billingData.ledger.map((entry) => entry.module))).map((module) => <option key={module} value={module}>{module}</option>)}</select></label>
            <label>Provider<select value={ledgerProvider} onChange={(event) => setLedgerProvider(event.target.value)}><option value="">All providers</option>{Array.from(new Set(billingData.ledger.map((entry) => entry.provider))).map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
            <label>User<select value={ledgerUser} onChange={(event) => setLedgerUser(event.target.value)}><option value="">All users/workspaces</option>{billingData.users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>
          </div>
          <div className="admin-user-table-wrap">
            <table className="admin-user-table billing-table">
              <thead><tr><th><span>Date</span></th><th><span>User</span></th><th><span>Type</span></th><th><span>Module</span></th><th><span>Provider</span></th><th><span>Action</span></th><th><span>Credits</span></th><th><span>Status</span></th><th><span>Description</span></th></tr></thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>{entry.userId ? userById.get(entry.userId)?.email || entry.userId : "Workspace"}</td>
                    <td>{entry.type}</td>
                    <td>{entry.module}</td>
                    <td>{entry.provider}</td>
                    <td>{entry.action}</td>
                    <td>{formatCredits(entry.credits)}</td>
                    <td>{entry.status}</td>
                    <td>{entry.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      )}

      {activeBillingTab === "users" && (
        <div className="admin-tab-grid billing-grid">
          <PanelCard title="User billing" action={<span className="admin-pill">{billingData.users.length} users</span>}>
            <div className="admin-user-table-wrap">
              <table className="admin-user-table billing-table">
                <thead><tr><th><span>Name</span></th><th><span>Email</span></th><th><span>Role</span></th><th><span>Workspace</span></th><th><span>Balance</span></th></tr></thead>
                <tbody>
                  {billingData.users.map((user) => (
                    <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.role}</td><td>{user.workspaceName}</td><td>{formatCredits(user.credits)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PanelCard>
          <PanelCard title="Adjust user credits">
            <form className="brand-form" action={adjustCredits}>
              <label>User<select name="userId" defaultValue={firstUser?.id || ""} required>{billingData.users.map((user) => <option key={user.id} value={user.id}>{user.email} - {formatCredits(user.credits)}</option>)}</select></label>
              <label>Credits<input name="credits" type="number" step="1" placeholder="5000 or -5000" required /></label>
              <label>Description<input name="description" placeholder="Bonus, refund, correction, or removal reason" /></label>
              <label>Expiry date<input name="expiresAt" type="datetime-local" /></label>
              <button className="primary"><Save size={14} />Save adjustment</button>
              <button type="button" disabled title="Stripe cancellation starts in Phase 10">Cancel subscription</button>
            </form>
          </PanelCard>
        </div>
      )}

      {activeBillingTab === "rules" && (
        <div className="admin-tab-grid billing-grid">
          <PanelCard title="Billing rules">
            <form className="brand-form" action={saveSettings}>
              <div className="modal-grid">
                <label>Default markup multiplier<input name="defaultMarkupMultiplier" type="number" step="0.1" defaultValue={billingData.settings.defaultMarkupMultiplier} /></label>
                <label>Low credit threshold<input name="lowCreditThreshold" type="number" step="1" defaultValue={billingData.settings.lowCreditThreshold} /></label>
                <label>Daily spend limit<input name="dailySpendLimitCredits" type="number" step="1" defaultValue={billingData.settings.dailySpendLimitCredits || 0} /></label>
                <label>Monthly spend limit<input name="monthlySpendLimitCredits" type="number" step="1" defaultValue={billingData.settings.monthlySpendLimitCredits || 0} /></label>
                <label>Max concurrent generations<input name="maxConcurrentGenerations" type="number" step="1" defaultValue={billingData.settings.maxConcurrentGenerations || 1} /></label>
                <label>Failed-generation refund policy<select name="failedGenerationRefundPolicy" defaultValue={billingData.settings.failedGenerationRefundPolicy || "refund_if_provider_failed"}><option value="refund_if_provider_failed">Refund if provider failed</option><option value="release_only">Release only if not charged</option><option value="manual_review">Manual review</option></select></label>
                <label>Automation minimum balance<input name="automationMinimumBalance" type="number" step="1" defaultValue={billingData.settings.automationMinimumBalance} /></label>
                <label>Automation default run cap<input name="automationDefaultRunCap" type="number" step="1" defaultValue={billingData.settings.automationDefaultRunCap} /></label>
                <label>Automation monthly cap<input name="automationDefaultMonthlyCap" type="number" step="1" defaultValue={billingData.settings.automationDefaultMonthlyCap} /></label>
                <label>Stripe mode<select name="stripeMode" defaultValue={billingData.settings.stripeMode || "test"}><option value="test">Test</option><option value="live">Live</option></select></label>
              </div>
              <button className="primary"><Save size={14} />Save rules</button>
            </form>
          </PanelCard>
          <PanelCard title="Quote tester">
            <form className="brand-form" action={quote}>
              <div className="modal-grid">
                <label>Action<input name="action" defaultValue="create_content.generate" /></label>
                <label>Module<input name="module" defaultValue="create_content" /></label>
                <label>Provider<select name="provider" defaultValue="kie"><option value="kie">Kie</option><option value="apify">Apify</option><option value="upload-post">Upload-Post</option></select></label>
                <label>Model / actor<input name="model" defaultValue="seedance-2.0-mini" /></label>
                <label>Generation type<select name="generationType" defaultValue="video"><option value="video">Video</option><option value="image">Image</option><option value="text">Text</option><option value="">N/A</option></select></label>
                <label>Duration<input name="duration" type="number" defaultValue="8" /></label>
                <label>Platform<input name="platform" placeholder="Instagram" /></label>
                <label>Max results<input name="maxResults" type="number" defaultValue="100" /></label>
              </div>
              <button><CreditCard size={14} />Calculate quote</button>
            </form>
            {quoteResult && <div className="provider-error inline">Quote: <b>{String(quoteResult.label || "")}</b> | Cost {formatUsd(Number(quoteResult.costUsd || 0))} | Charge {formatUsd(Number(quoteResult.chargeUsd || 0))}</div>}
          </PanelCard>
        </div>
      )}

      {activeBillingTab === "alerts" && (
        <div className="admin-tab-grid billing-grid">
          <PanelCard title="Provider pricing sync">
            <p className="muted compact">Sync checks provider pricing sources and creates review alerts. Active rate cards do not change until an admin approves an alert.</p>
            {pricingMessage && <div className="provider-error inline">{pricingMessage}</div>}
            <div className="pricing-sync-actions">
              <button className="primary" type="button" disabled={Boolean(syncingProvider)} onClick={() => syncProviderPricing("kie")}>{syncingProvider === "kie" ? "Syncing Kie..." : "Sync Kie pricing"}</button>
              <button type="button" disabled={Boolean(syncingProvider)} onClick={() => syncProviderPricing("apify")}>{syncingProvider === "apify" ? "Syncing Apify..." : "Sync Apify pricing"}</button>
            </div>
            <div className="pricing-run-list">
              {pricingRuns.length === 0 ? <div className="empty-state compact">No pricing sync runs yet.</div> : pricingRuns.slice(0, 6).map((run) => (
                <div className="pricing-run-row" key={run.id}>
                  <div>
                    <b>{run.provider}</b>
                    <span>{new Date(run.startedAt).toLocaleString()} | scanned {run.scannedCount} | alerts {run.alertCount} | manual {run.manualRequiredCount}</span>
                    {run.error && <small>{run.error}</small>}
                  </div>
                  <span className={`status ${run.status === "failed" ? "failed" : "done"}`}>{run.status}</span>
                </div>
              ))}
            </div>
          </PanelCard>
          <PanelCard title="Pricing review queue" action={<span className="admin-pill">{pricingAlerts.length} alerts</span>}>
            {pricingAlerts.length === 0 ? (
              <div className="empty-state compact">No pricing alerts are waiting for review.</div>
            ) : (
              <div className="billing-admin-list">
                {pricingAlerts.map((alert) => {
                  const canApprove = alert.status === "pending_review" && typeof alert.newBaseCostUsd === "number";
                  const decided = !["pending_review", "manual_required"].includes(alert.status);
                  return (
                    <div className="billing-admin-card compact pricing-alert-card" key={alert.id}>
                      <div className="billing-admin-card-head">
                        <div>
                          <b>{alert.label}</b>
                          <span>{alert.provider} | {alert.modelOrActorId} | {alert.source}</span>
                        </div>
                        <span className={`status ${alert.status === "approved" ? "done" : alert.status === "rejected" ? "failed" : ""}`}>{alert.status.replace(/_/g, " ")}</span>
                      </div>
                      <div className="pricing-change-grid">
                        <div><span>Current</span><b>{formatUsd(alert.oldBaseCostUsd)}</b><small>{alert.oldUnit}</small></div>
                        <div><span>Provider</span><b>{typeof alert.newBaseCostUsd === "number" ? formatUsd(alert.newBaseCostUsd) : "Manual review"}</b><small>{alert.newUnit || alert.oldUnit}</small></div>
                        <div><span>Change</span><b>{typeof alert.changePercent === "number" ? `${alert.changePercent > 0 ? "+" : ""}${alert.changePercent}%` : "N/A"}</b><small>{new Date(alert.createdAt).toLocaleString()}</small></div>
                      </div>
                      <p className="muted compact">{alert.reason}</p>
                      <div className="row-actions">
                        {canApprove && <button className="primary" type="button" onClick={() => decidePricingAlert(alert.id, "approvePricingAlert")}>Approve</button>}
                        {!decided && <button type="button" onClick={() => decidePricingAlert(alert.id, "keepManualPricingAlert")}>Keep manual</button>}
                        {!decided && <button type="button" onClick={() => decidePricingAlert(alert.id, "rejectPricingAlert")}>Reject</button>}
                        {decided && <span className="admin-pill">Decided {alert.decidedAt ? new Date(alert.decidedAt).toLocaleString() : ""}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </PanelCard>
        </div>
      )}
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

export default function AdminPanel({ data, run, runAdmin, runBilling, runStripe, integrations, adminData, billingData }: { data: AdminAppData; run: RunAction; runAdmin: RunAdminAction; runBilling: RunBillingAction; runStripe: RunStripeAction; integrations: IntegrationData | null; adminData: AdminUserData | null; billingData: AdminBillingData | null }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const tabs = [
    { id: "users", label: "User Management", icon: Users },
    { id: "permissions", label: "Permission", icon: ShieldCheck },
    { id: "prompts", label: "Prompt Management", icon: WandSparkles },
    { id: "keys", label: "API Key Management", icon: KeyRound },
    { id: "billing", label: "Billing", icon: CreditCard },
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
        {activeTab === "billing" && <BillingManagementCard billingData={billingData} runBilling={runBilling} runStripe={runStripe} />}
        {activeTab === "system" && <SystemCard />}
      </section>
    </div>
  );
}
