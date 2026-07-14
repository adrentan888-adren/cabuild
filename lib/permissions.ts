import { allRoles, defaultRolePermissions } from "./store";
import type { Database, PermissionKey, RolePermissions, User, UserRole } from "./types";

export const permissionCatalog: { key: PermissionKey; label: string; group: string; description: string }[] = [
  { key: "admin.access", label: "Open admin", group: "Admin", description: "Access the backend admin surface." },
  { key: "users.view", label: "View users", group: "Users", description: "See the user table and user details." },
  { key: "users.create", label: "Create users", group: "Users", description: "Create new user accounts." },
  { key: "users.edit", label: "Edit users", group: "Users", description: "Edit names, roles, and account status." },
  { key: "users.delete", label: "Delete users", group: "Users", description: "Permanently remove user accounts." },
  { key: "users.disable", label: "Disable users", group: "Users", description: "Disable or reactivate user accounts." },
  { key: "users.resetPassword", label: "Reset passwords", group: "Users", description: "Set a new password for another user." },
  { key: "users.assignRole", label: "Assign roles", group: "Users", description: "Change a user's role." },
  { key: "permissions.view", label: "View permissions", group: "Permissions", description: "View role permission settings." },
  { key: "permissions.manage", label: "Manage permissions", group: "Permissions", description: "Edit what each role can do." },
  { key: "prompts.view", label: "View prompts", group: "Prompts", description: "View backend prompt templates." },
  { key: "prompts.edit", label: "Edit prompts", group: "Prompts", description: "Save backend prompt template changes." },
  { key: "apiKeys.view", label: "View API key status", group: "API keys", description: "View provider configuration status without raw secrets." },
  { key: "apiKeys.edit", label: "Edit API keys", group: "API keys", description: "Replace provider API keys used by the app runtime." },
  { key: "billing.view", label: "View billing", group: "Billing", description: "View credit balances, billing plans, rate cards, and credit ledger." },
  { key: "billing.manage", label: "Manage billing", group: "Billing", description: "Adjust credits and manage billing configuration." },
  { key: "stripe.view", label: "View Stripe", group: "Stripe", description: "View Stripe connection and catalogue status without secrets." },
  { key: "stripe.connectTest", label: "Connect test Stripe", group: "Stripe", description: "Connect or replace the Stripe test account." },
  { key: "stripe.manageTestCatalogue", label: "Manage test catalogue", group: "Stripe", description: "Create and synchronize test Stripe products and prices." },
  { key: "stripe.connectLive", label: "Connect live Stripe", group: "Stripe", description: "Connect or replace the live Stripe account." },
  { key: "stripe.manageLiveCatalogue", label: "Manage live catalogue", group: "Stripe", description: "Create and synchronize live Stripe products and prices." },
  { key: "stripe.migrateSubscriptions", label: "Migrate subscriptions", group: "Stripe", description: "Move existing subscriptions between Stripe prices." },
  { key: "stripe.disconnect", label: "Disconnect Stripe", group: "Stripe", description: "Disconnect a Stripe mode after explicit confirmation." },
  { key: "stripe.viewEvents", label: "View Stripe events", group: "Stripe", description: "View webhook and checkout processing diagnostics." },
  { key: "system.view", label: "View system", group: "System", description: "View cloud/backend system information." },
  { key: "logs.view", label: "View logs", group: "Debug", description: "View operational and debug logs." },
  { key: "settings.view", label: "View settings", group: "Settings", description: "View workspace/application settings." },
  { key: "settings.edit", label: "Edit settings", group: "Settings", description: "Edit workspace/application settings." }
];

export function normalizedRolePermissions(input?: Partial<RolePermissions>): RolePermissions {
  const valid = new Set(permissionCatalog.map((item) => item.key));
  return allRoles.reduce((acc, role) => {
    const base = defaultRolePermissions[role] || [];
    const source = role === "owner" || role === "super_admin" ? permissionCatalog.map((item) => item.key) : Array.isArray(input?.[role]) ? input?.[role] || [] : base;
    acc[role] = Array.from(new Set(source)).filter((item): item is PermissionKey => valid.has(item as PermissionKey));
    return acc;
  }, {} as RolePermissions);
}

export function hasPermission(db: Pick<Database, "rolePermissions">, user: Pick<User, "role">, permission: PermissionKey) {
  if (user.role === "super_admin" || user.role === "owner") return true;
  return Boolean(db.rolePermissions?.[user.role as UserRole]?.includes(permission));
}
