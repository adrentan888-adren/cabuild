import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { createVerificationCode, hashVerificationCode, verificationExpiry } from "@/lib/emailVerification";
import { sendVerificationEmail } from "@/lib/providers/brevo";
import { hashPassword, id, mutateDb, readDb } from "@/lib/store";
import { hasPermission, permissionCatalog } from "@/lib/permissions";
import { applicationRoles, assignableRoles, canManageRole, roleIds } from "@/lib/role-catalog";
import type { Database, PermissionKey, RolePermissions, User, UserRole } from "@/lib/types";



function safeUser(user: User, db: Database) {
  const workspace = db.workspaces.find((item) => item.id === user.workspaceId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    workspaceId: user.workspaceId,
    workspaceName: workspace?.name || "Missing workspace",
    emailVerified: user.emailVerified !== false,
    disabled: Boolean(user.disabledAt),
    disabledAt: user.disabledAt || "",
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || "",
    lastLoginAt: user.lastLoginAt || ""
  };
}

async function requireAdmin() {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const db = await readDb();
  if (user.disabledAt || !hasPermission(db, user, "admin.access")) return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  return { user, db };
}

function defaultWorkspaceId(db: Database) {
  return db.workspaces.find((workspace) => workspace.id === "ws_demo")?.id || db.workspaces[0]?.id || "";
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const db = auth.db;
  if (!hasPermission(db, auth.user, "users.view")) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  const actorPermissions = auth.user.role === "owner" || auth.user.role === "super_admin"
    ? permissionCatalog.map((item) => item.key)
    : db.rolePermissions[auth.user.role as UserRole] || [];
  return NextResponse.json({
    users: db.users.map((user) => safeUser(user, db)).sort((a, b) => a.email.localeCompare(b.email)),
    roles:roleIds(db),
    roleDefinitions:applicationRoles(db),
    assignableRoles:assignableRoles(db,auth.user),
    manageableRoles:roleIds(db).filter(role=>canManageRole(db,auth.user,role)),
    permissions: db.rolePermissions,
    permissionCatalog,
    actorPermissions
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await req.json() as Record<string, unknown>;
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = String(body.role || "developer");
  const name = String(body.name || email.split("@")[0] || "User").trim();
  const verified = body.emailVerified !== false;
  if (!email.includes("@") || password.length < 8) return NextResponse.json({ error: "Use a valid email and an 8+ character password." }, { status: 400 });
  if (!hasPermission(auth.db, auth.user, "users.create")) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  if (!canManageRole(auth.db, auth.user, role)) return NextResponse.json({ error: "You cannot assign that role." }, { status: 403 });

  const code = createVerificationCode();
  const result = await mutateDb((db) => {
    if (db.users.some((user) => user.email.toLowerCase() === email)) return { error: "Email already exists", status: 409 as const };
    if (!hasPermission(db,auth.user,"users.create") || !canManageRole(db,auth.user,role)) return {error:"Permission denied.",status:403 as const};
    const workspaceId = defaultWorkspaceId(db);
    if (!workspaceId) return { error: "Default workspace is missing.", status: 500 as const };
    const now = new Date().toISOString();
    const user: User = {
      id: id("usr"),
      email,
      name: name || email.split("@")[0] || "User",
      passwordHash: hashPassword(password),
      role: role as User["role"],
      workspaceId,
      emailVerified: verified,
      createdAt: now,
      updatedAt: now
    };
    if (!verified) {
      user.emailVerificationCodeHash = hashVerificationCode(code);
      user.emailVerificationExpiresAt = verificationExpiry();
    }
    db.users.push(user);
    db.activity.push({ id: id("act"), workspaceId, message: `Admin created user ${email}.`, createdAt: now });
    return { user: safeUser(user, db), email: user.email, unverified: !verified };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.unverified) {
    try {
      await sendVerificationEmail({ email: result.email, code });
    } catch (error) {
      return NextResponse.json({ userCreated:true, user:result.user, error:"Account created, but the verification email could not be sent. Resend it from Manage person." }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true, user: result.user });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await req.json() as Record<string, unknown>;
  const operation = String(body.operation || "update");
  const userId = String(body.userId || "");
  if (!["update", "resetPassword", "resendVerification", "delete", "updateRolePermissions", "createRole", "editRole"].includes(operation)) return NextResponse.json({error:"Unknown operation."},{status:400});
  if (!["updateRolePermissions","createRole","editRole"].includes(operation) && !userId) return NextResponse.json({ error: "User is required." }, { status: 400 });

  const code = createVerificationCode();
  const result = await mutateDb((db) => {
    const roles=roleIds(db);
    if (operation === "createRole" || operation === "editRole") {
      if (!hasPermission(db,auth.user,"permissions.manage")) return {error:"Permission denied.",status:403 as const};
      const definitions=applicationRoles(db), roleId=String(body.roleId||"");
      const existing=operation==='editRole'?definitions.find(role=>role.id===roleId):undefined;
      if(operation==='editRole'&&!existing)return {error:"Role not found.",status:404 as const};
      const name=String(body.name||'').trim(),description=String(body.description||'').trim();
      if(name.length<2||name.length>50||description.length>240)return {error:"Use a role name of 2–50 characters and a description of up to 240 characters.",status:400 as const};
      const reserved=['owner','super admin','admin','support admin','manager','creator','client','user'];
      if(reserved.includes(name.toLowerCase().replaceAll('_',' '))||definitions.some(role=>role.id!==existing?.id&&role.name.toLowerCase()===name.toLowerCase()))return {error:"That role name is already in use or reserved.",status:409 as const};
      const valid=new Set(permissionCatalog.map(p=>p.key));
      if(!Array.isArray(body.permissions)||body.permissions.some(key=>!valid.has(key as PermissionKey)))return {error:"Invalid role permissions.",status:400 as const};
      const permissions=Array.from(new Set(body.permissions)) as PermissionKey[];
      if(existing&&(body.expectedUpdatedAt!==existing.updatedAt||JSON.stringify([...(db.rolePermissions[roleId]||[])].sort())!==JSON.stringify(Array.isArray(body.expectedPermissions)?[...body.expectedPermissions].sort():null)))return {error:"This role changed since you opened it. Refresh before saving again.",status:409 as const};
      const role={id:existing?.id||id('custom'),name,description,updatedAt:new Date().toISOString()};
      db.applicationRoles=existing?definitions.map(item=>item.id===role.id?role:item):[...definitions,role];
      db.rolePermissions[role.id]=permissions;
      return {role,roleDefinitions:db.applicationRoles,permissions:db.rolePermissions};
    }
    if (operation === "updateRolePermissions") {
      if (!hasPermission(db, auth.user, "permissions.manage")) return { error: "Permission denied.", status: 403 as const };
      const submitted = body.permissions as Partial<RolePermissions> | undefined;
      if (!submitted || typeof submitted !== "object") return { error: "Permissions payload is required.", status: 400 as const };
      const valid = new Set(permissionCatalog.map((item) => item.key));
      if (Array.isArray(submitted) || Object.keys(submitted).some(role=>!roles.includes(role as UserRole))) return {error:"Unknown role.",status:400 as const};
      const expected=body.expectedPermissions as Partial<RolePermissions>|undefined;
      const same=(a:unknown,b:unknown)=>JSON.stringify(Array.isArray(a)?[...a].sort():[])===JSON.stringify(Array.isArray(b)?[...b].sort():[]);
      for (const [role,selected] of Object.entries(submitted)) {
        if (!Array.isArray(selected)||selected.some(key=>!valid.has(key as PermissionKey))) return {error:"Invalid role permissions.",status:400 as const};
        if (role!=="owner"&&role!=="super_admin"&&expected&&Object.prototype.hasOwnProperty.call(expected,role)&&!same(expected[role as UserRole],db.rolePermissions[role as UserRole])) return {error:"This role changed since you opened it. Refresh before saving again.",status:409 as const};
      }
      const next = { ...db.rolePermissions };
      for (const role of roles) {
        if (role === "super_admin" || role === "owner") {
          next[role] = permissionCatalog.map((item) => item.key);
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(submitted,role)) continue;
        const selected = submitted[role] || [];
        next[role] = Array.from(new Set(selected)).filter((item): item is PermissionKey => valid.has(item as PermissionKey));
      }
      db.rolePermissions = next;
      return { permissions: db.rolePermissions };
    }
    const target = db.users.find((user) => user.id === userId);
    if (!target) return { error: "User not found.", status: 404 as const };
    if ((target.role === "owner" || target.role === "super_admin") && auth.user.role !== "owner" && auth.user.role !== "super_admin") return { error: "Only owners and super admins can change this account.", status: 403 as const };
    if (!canManageRole(db,auth.user,target.role)) return {error:"You cannot manage an account with permissions above your own.",status:403 as const};
    if (target.id === auth.user.id && (operation === "disable" || operation === "update")) {
      const nextRole = typeof body.role === "string" ? body.role : target.role;
      const disablingSelf = operation === "disable" || body.disabled === true;
      if (disablingSelf || nextRole !== target.role) {
        return { error: "You cannot disable or demote your own admin account.", status: 400 as const };
      }
    }

    if (operation === "resetPassword") {
      if (!hasPermission(db, auth.user, "users.resetPassword")) return { error: "Permission denied.", status: 403 as const };
      const password = String(body.password || "");
      if (password.length < 8) return { error: "Use an 8+ character password.", status: 400 as const };
      target.passwordHash = hashPassword(password);
      target.updatedAt = new Date().toISOString();
      return { user: safeUser(target, db) };
    }

    if (operation === "resendVerification") {
      if (!hasPermission(db, auth.user, "users.edit")) return { error: "Permission denied.", status: 403 as const };
      if (target.emailVerified) return { error: "User is already verified.", status: 400 as const };
      target.emailVerificationCodeHash = hashVerificationCode(code);
      target.emailVerificationExpiresAt = verificationExpiry();
      target.updatedAt = new Date().toISOString();
      return { user: safeUser(target, db), resendEmail: target.email };
    }

    if (operation === "delete") {
      if (!hasPermission(db, auth.user, "users.delete")) return { error: "Permission denied.", status: 403 as const };
      if (target.id === auth.user.id) return { error: "You cannot delete your own account.", status: 400 as const };
      if ((target.role === "owner" || target.role === "super_admin") && !(auth.user.role === "owner" || auth.user.role === "super_admin")) {
        return { error: "Only owner or super admin can delete owner/super admin accounts.", status: 403 as const };
      }
      db.users = db.users.filter((user) => user.id !== target.id);
      db.activity.push({ id: id("act"), workspaceId: target.workspaceId, message: `Admin deleted user ${target.email}.`, createdAt: new Date().toISOString() });
      return { deleted: true };
    }

    if (!hasPermission(db, auth.user, "users.edit")) return { error: "Permission denied.", status: 403 as const };
    const role = typeof body.role === "string" ? body.role : target.role;
    if (role !== target.role && !hasPermission(db, auth.user, "users.assignRole")) return { error: "Permission denied.", status: 403 as const };
    if (!canManageRole(db, auth.user, role)) return { error: "You cannot assign that role.", status: 403 as const };
    if (typeof body.disabled === "boolean" && body.disabled !== Boolean(target.disabledAt) && !hasPermission(db,auth.user,"users.disable")) return {error:"Permission denied.",status:403 as const};
    if (typeof body.name === "string") target.name = body.name.trim() || target.name;
    target.role = role as User["role"];
    if (typeof body.emailVerified === "boolean") {
      target.emailVerified = body.emailVerified;
      if (body.emailVerified) {
        delete target.emailVerificationCodeHash;
        delete target.emailVerificationExpiresAt;
      }
    }
    if (typeof body.disabled === "boolean" && body.disabled !== Boolean(target.disabledAt)) {
      if (!hasPermission(db, auth.user, "users.disable")) return { error: "Permission denied.", status: 403 as const };
      target.disabledAt = body.disabled ? (target.disabledAt || new Date().toISOString()) : undefined;
    }
    target.updatedAt = new Date().toISOString();
    return { user: safeUser(target, db) };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  if ("role" in result) return NextResponse.json({ok:true,...result});
  if ("permissions" in result) return NextResponse.json({ ok: true, permissions: result.permissions });
  if ("deleted" in result) return NextResponse.json({ ok: true, deleted: true });
  if ("resendEmail" in result && result.resendEmail) {
    try {
      await sendVerificationEmail({ email: result.resendEmail, code });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Verification email could not be sent." }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true, user: result.user });
}
