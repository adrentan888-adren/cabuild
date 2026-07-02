import { NextResponse } from "next/server";
import { currentUser, isAdminRole } from "@/lib/session";
import { createVerificationCode, hashVerificationCode, verificationExpiry } from "@/lib/emailVerification";
import { sendVerificationEmail } from "@/lib/providers/brevo";
import { hashPassword, id, mutateDb, readDb } from "@/lib/store";
import type { Database, User } from "@/lib/types";

const roles = ["super_admin", "admin", "owner", "manager", "creator", "client", "user"] as const;
const adminAssignableRoles = ["admin", "manager", "creator", "client", "user"] as const;

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
  if (user.disabledAt || !isAdminRole(user.role)) return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  return { user };
}

function defaultWorkspaceId(db: Database) {
  return db.workspaces.find((workspace) => workspace.id === "ws_demo")?.id || db.workspaces[0]?.id || "";
}

function canAssignRole(actor: User, role: string) {
  if (!roles.includes(role as typeof roles[number])) return false;
  if (actor.role === "super_admin" || actor.role === "owner") return true;
  return adminAssignableRoles.includes(role as typeof adminAssignableRoles[number]);
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const db = await readDb();
  return NextResponse.json({
    users: db.users.map((user) => safeUser(user, db)).sort((a, b) => a.email.localeCompare(b.email))
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await req.json() as Record<string, unknown>;
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = String(body.role || "user");
  const name = String(body.name || email.split("@")[0] || "User").trim();
  const verified = body.emailVerified !== false;
  if (!email.includes("@") || password.length < 8) return NextResponse.json({ error: "Use a valid email and an 8+ character password." }, { status: 400 });
  if (!canAssignRole(auth.user, role)) return NextResponse.json({ error: "You cannot assign that role." }, { status: 403 });

  const code = createVerificationCode();
  const result = await mutateDb((db) => {
    if (db.users.some((user) => user.email.toLowerCase() === email)) return { error: "Email already exists", status: 409 as const };
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
      return NextResponse.json({ error: error instanceof Error ? error.message : "User created, but verification email could not be sent." }, { status: 502 });
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
  if (!userId) return NextResponse.json({ error: "User is required." }, { status: 400 });

  const code = createVerificationCode();
  const result = await mutateDb((db) => {
    const target = db.users.find((user) => user.id === userId);
    if (!target) return { error: "User not found.", status: 404 as const };
    if (target.id === auth.user.id && (operation === "disable" || operation === "update")) {
      const nextRole = typeof body.role === "string" ? body.role : target.role;
      const disablingSelf = operation === "disable" || body.disabled === true;
      if (disablingSelf || nextRole !== target.role) {
        return { error: "You cannot disable or demote your own admin account.", status: 400 as const };
      }
    }

    if (operation === "resetPassword") {
      const password = String(body.password || "");
      if (password.length < 8) return { error: "Use an 8+ character password.", status: 400 as const };
      target.passwordHash = hashPassword(password);
      target.updatedAt = new Date().toISOString();
      return { user: safeUser(target, db) };
    }

    if (operation === "resendVerification") {
      if (target.emailVerified) return { error: "User is already verified.", status: 400 as const };
      target.emailVerificationCodeHash = hashVerificationCode(code);
      target.emailVerificationExpiresAt = verificationExpiry();
      target.updatedAt = new Date().toISOString();
      return { user: safeUser(target, db), resendEmail: target.email };
    }

    const role = typeof body.role === "string" ? body.role : target.role;
    if (!canAssignRole(auth.user, role)) return { error: "You cannot assign that role.", status: 403 as const };
    if (typeof body.name === "string") target.name = body.name.trim() || target.name;
    target.role = role as User["role"];
    if (typeof body.emailVerified === "boolean") {
      target.emailVerified = body.emailVerified;
      if (body.emailVerified) {
        delete target.emailVerificationCodeHash;
        delete target.emailVerificationExpiresAt;
      }
    }
    if (typeof body.disabled === "boolean") target.disabledAt = body.disabled ? (target.disabledAt || new Date().toISOString()) : undefined;
    target.updatedAt = new Date().toISOString();
    return { user: safeUser(target, db) };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  if ("resendEmail" in result && result.resendEmail) {
    try {
      await sendVerificationEmail({ email: result.resendEmail, code });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Verification email could not be sent." }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true, user: result.user });
}
