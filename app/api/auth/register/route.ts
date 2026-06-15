import { NextResponse } from "next/server";
import { hashPassword, id, mutateDb } from "@/lib/store";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  const { name, email, password, workspaceName, niche } = await req.json();
  if (!email || !password || String(password).length < 8) {
    return NextResponse.json({ error: "Use a valid email and an 8+ character password." }, { status: 400 });
  }
  const result = await mutateDb((db) => {
    if (db.users.some((user) => user.email.toLowerCase() === String(email).toLowerCase())) {
      return { error: "Email already exists" };
    }
    const workspaceId = id("ws");
    const userId = id("usr");
    db.workspaces.push({ id: workspaceId, name: workspaceName || "My Social Workspace", niche: niche || "General SME", plan: "Starter", credits: 100, setup: 20 });
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
    db.users.push({ id: userId, email, name: name || "Owner", passwordHash: hashPassword(password), role: "owner", workspaceId });
    db.activity.push({ id: id("act"), workspaceId, message: "Workspace created.", createdAt: new Date().toISOString() });
    return { userId };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  const res = NextResponse.json({ ok: true });
  setSession(res, result.userId);
  return res;
}
