import { NextResponse } from "next/server";
import { defaultPersonaProfile, hashPassword, id, mutateDb } from "@/lib/store";
import { createVerificationCode, hashVerificationCode, verificationExpiry } from "@/lib/emailVerification";
import { sendVerificationEmail } from "@/lib/providers/brevo";

export async function POST(req: Request) {
  const { email, password, confirmPassword } = await req.json();
  if (!email || !password || String(password).length < 8) {
    return NextResponse.json({ error: "Use a valid email and an 8+ character password." }, { status: 400 });
  }
  if (String(password) !== String(confirmPassword)) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }
  const code = createVerificationCode();
  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await mutateDb((db) => {
    const existingUser = db.users.find((user) => user.email.toLowerCase() === normalizedEmail);
    if (existingUser?.emailVerified === false) {
      existingUser.emailVerificationCodeHash = hashVerificationCode(code);
      existingUser.emailVerificationExpiresAt = verificationExpiry();
      return { userId: existingUser.id, workspaceId: existingUser.workspaceId, existingUnverified: true };
    }
    if (existingUser) {
      return { error: "Email already exists" };
    }
    const workspaceId = id("ws");
    const userId = id("usr");
    db.workspaces.push({ id: workspaceId, name: "My Workspace", niche: "General", plan: "Starter", credits: 100, setup: 20 });
    db.brandKits.push({
      workspaceId,
      primary: "#1a1a1a",
      secondary: "#f5f4ee",
      accent: "#378add",
      headingFont: "Inter",
      bodyFont: "System",
      voice: "Clear, practical, and useful.",
      watermark: true
    });
    db.personaProfiles ||= [];
    db.personaProfiles.push(defaultPersonaProfile(workspaceId));
    db.users.push({
      id: userId,
      email: normalizedEmail,
      name: normalizedEmail.split("@")[0] || "User",
      passwordHash: hashPassword(password),
      role: "user",
      workspaceId,
      emailVerified: false,
      emailVerificationCodeHash: hashVerificationCode(code),
      emailVerificationExpiresAt: verificationExpiry(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    db.activity.push({ id: id("act"), workspaceId, message: "Workspace created.", createdAt: new Date().toISOString() });
    return { userId, workspaceId };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  try {
    await sendVerificationEmail({ email: normalizedEmail, code });
  } catch (error) {
    if (!("existingUnverified" in result)) {
      await mutateDb((db) => {
        db.users = db.users.filter((user) => user.id !== result.userId);
        db.workspaces = db.workspaces.filter((workspace) => workspace.id !== result.workspaceId);
        db.brandKits = db.brandKits.filter((kit) => kit.workspaceId !== result.workspaceId);
        db.personaProfiles = db.personaProfiles.filter((profile) => profile.workspaceId !== result.workspaceId);
        db.activity = db.activity.filter((item) => item.workspaceId !== result.workspaceId);
      });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send verification email." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, verificationRequired: true, email: normalizedEmail });
}
