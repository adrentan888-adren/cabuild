import { NextResponse } from "next/server";
import { mutateDb, verifyPassword } from "@/lib/store";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const result = await mutateDb((db) => {
    const user = db.users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
    if (!user || !verifyPassword(String(password), user.passwordHash)) return { error: "Invalid email or password", status: 401 as const };
    if (user.disabledAt) return { error: "This account has been disabled. Contact an administrator.", status: 403 as const };
    if (user.emailVerified === false) {
      return { error: "Please verify your email before signing in.", status: 403 as const, verificationRequired: true, email: user.email };
    }
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = user.updatedAt || user.lastLoginAt;
    return { userId: user.id };
  });
  if ("error" in result) {
    if (result.verificationRequired) return NextResponse.json({ error: result.error, verificationRequired: true, email: result.email }, { status: result.status });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const res = NextResponse.json({ ok: true });
  setSession(res, result.userId);
  return res;
}
