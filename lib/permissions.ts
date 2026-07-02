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
  { key: "system.view", label: "View system", group: "System", description: "View cloud/backend system information." },
  { key: "logs.view", label: "View logs", group: "Debug", description: "View operational and debug logs." },
  { key: "settings.view", label: "View settings", group: "Settings", description: "View workspace/application settings." },
  { key: "settings.edit", label: "Edit settings", group: "Settings", description: "Edit workspace/application settings." }
];

export function normalizedRolePermissions(input?: Partial<RolePermissions>): RolePermissions {
  const valid = new Set(permissionCatalog.map((item) => item.key));
  return allRoles.reduce((acc, role) => {
    const base = defaultRolePermissions[role] || [];
    const source = Array.isArray(input?.[role]) ? input?.[role] || [] : base;
    acc[role] = Array.from(new Set(source)).filter((item): item is PermissionKey => valid.has(item as PermissionKey));
    return acc;
  }, {} as RolePermissions);
}

export function hasPermission(db: Pick<Database, "rolePermissions">, user: Pick<User, "role">, permission: PermissionKey) {
  if (user.role === "super_admin" || user.role === "owner") return true;
  return Boolean(db.rolePermissions?.[user.role as UserRole]?.includes(permission));
}
