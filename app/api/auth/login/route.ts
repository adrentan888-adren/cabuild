import { NextResponse } from "next/server";
import { mutateDb, verifyPassword } from "@/lib/store";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  let payload: { email?: string; password?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid login request." }, { status: 400 });
  }

  const { email, password } = payload;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  let result: { userId: string } | { error: string; status: 401 | 403; verificationRequired?: boolean; email?: string };
  try {
    result = await mutateDb((db) => {
      const user = db.users.find((item) => String(item.email || "").toLowerCase() === normalizedEmail);
      if (!user || !user.passwordHash || !verifyPassword(String(password), user.passwordHash)) return { error: "Invalid email or password", status: 401 as const };
      if (user.disabledAt) return { error: "This account has been disabled. Contact an administrator.", status: 403 as const };
      if (user.emailVerified === false) {
        return { error: "Please verify your email before signing in.", status: 403 as const, verificationRequired: true, email: user.email };
      }
      user.lastLoginAt = new Date().toISOString();
      user.updatedAt = user.updatedAt || user.lastLoginAt;
      return { userId: user.id };
    });
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }

  if ("error" in result) {
    if (result.verificationRequired) return NextResponse.json({ error: result.error, verificationRequired: true, email: result.email }, { status: result.status });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const res = NextResponse.json({ ok: true });
  setSession(res, result.userId);
  return res;
}
