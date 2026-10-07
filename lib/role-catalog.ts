import type { ApplicationRole, Database, PermissionKey, RolePermissions, User, UserRole } from "./types";

export const allRoles: UserRole[] = ["super_admin", "admin", "support_admin", "owner", "manager", "creator", "client", "user", "developer"];

export const allPermissionKeys: PermissionKey[] = [
  "admin.access",
  "users.view",
  "users.create",
  "users.edit",
  "users.delete",
  "users.disable",
  "users.resetPassword",
  "users.assignRole",
  "permissions.view",
  "permissions.manage",
  "prompts.view",
  "prompts.edit",
  "apiKeys.view",
  "apiKeys.edit",
  "system.view",
  "logs.view",
  "settings.view",
  "settings.edit"
];

export const defaultRolePermissions: RolePermissions = {
  super_admin: allPermissionKeys,
  owner: allPermissionKeys,
  admin: [
    "admin.access",
    "users.view",
    "users.create",
    "users.edit",
    "users.disable",
    "users.resetPassword",
    "users.assignRole",
    "permissions.view",
    "prompts.view",
    "prompts.edit",
    "apiKeys.view",
    "apiKeys.edit",
    "system.view",
    "logs.view",
    "settings.view",
    "settings.edit"
  ],
  developer: ["admin.access", "users.view", "users.create", "users.edit", "users.disable", "users.resetPassword", "users.assignRole", "permissions.view", "prompts.view", "prompts.edit", "apiKeys.view", "apiKeys.edit", "system.view", "logs.view", "settings.view", "settings.edit"],
  support_admin: [
    "admin.access",
    "users.view",
    "permissions.view",
    "prompts.view",
    "apiKeys.view",
    "system.view",
    "logs.view",
    "settings.view"
  ],
  manager: ["settings.view", "logs.view"],
  creator: [],
  client: [],
  user: []
};

export function applicationRoles(db: Pick<Database,'applicationRoles'>): ApplicationRole[] {
 const saved=Array.isArray(db.applicationRoles)?db.applicationRoles:[];
 const developer=saved.find(role=>role.id==='developer')||{id:'developer',name:'Developer',description:'Manage users and content settings without managing roles.',updatedAt:''};
 const seen=new Set(['developer']);
 return [{...developer},...saved.filter(role=>/^custom_[a-zA-Z0-9_]+$/.test(role.id)&&!seen.has(role.id)&&Boolean(seen.add(role.id))).map(role=>({...role}))];
}
export function roleIds(db:Pick<Database,'applicationRoles'>): string[] { return [...allRoles,...applicationRoles(db).map(role=>role.id).filter(id=>!allRoles.includes(id as UserRole))]; }
export function canManageRole(db:Pick<Database,'rolePermissions'|'applicationRoles'>,actor:Pick<User,'role'>,role:string): boolean {
 if(!roleIds(db).includes(role))return false;
 if(actor.role==='owner'||actor.role==='super_admin')return true;
 if(role==='owner'||role==='super_admin')return false;
 const actorPermissions=db.rolePermissions[actor.role]||[];
 return (db.rolePermissions[role]||[]).every(permission=>actorPermissions.includes(permission));
}
export function assignableRoles(db:Pick<Database,'rolePermissions'|'applicationRoles'>,actor:Pick<User,'role'>): string[] { return applicationRoles(db).map(role=>role.id).filter(role=>canManageRole(db,actor,role)); }
