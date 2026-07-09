import { NextResponse } from "next/server";
import { mutateDb, verifyPassword } from "@/lib/store";
import { setSession } from "@/lib/session";

const diagnosticToken = "phase7-deep-health-20260709";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const result = await mutateDb((db) => {
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
    if ("error" in result) {
      if (result.verificationRequired) return NextResponse.json({ error: result.error, verificationRequired: true, email: result.email }, { status: result.status });
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const res = NextResponse.json({ ok: true });
    setSession(res, result.userId);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.env.POSTGRES_STATE_ID === "staging" && req.headers.get("x-ca-diagnostic") === diagnosticToken) {
      return NextResponse.json({ error: "Login diagnostic failure", detail: message }, { status: 500 });
    }
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
