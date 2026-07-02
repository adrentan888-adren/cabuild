import { NextResponse } from "next/server";
import { hashVerificationCode, verificationExpired } from "@/lib/emailVerification";
import { mutateDb } from "@/lib/store";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  const { email, code } = await req.json();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedCode = String(code || "").trim();
  if (!normalizedEmail || !/^\d{6}$/.test(normalizedCode)) {
    return NextResponse.json({ error: "Enter the 6-digit verification code." }, { status: 400 });
  }
  const result = await mutateDb((db) => {
    const user = db.users.find((item) => item.email.toLowerCase() === normalizedEmail);
    if (!user) return { error: "Account not found.", status: 404 };
    if (user.emailVerified) return { userId: user.id };
    if (verificationExpired(user.emailVerificationExpiresAt)) return { error: "Verification code expired. Please request a new code.", status: 410 };
    if (user.emailVerificationCodeHash !== hashVerificationCode(normalizedCode)) return { error: "Invalid verification code.", status: 401 };
    user.emailVerified = true;
    delete user.emailVerificationCodeHash;
    delete user.emailVerificationExpiresAt;
    return { userId: user.id };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const res = NextResponse.json({ ok: true });
  setSession(res, result.userId);
  return res;
}
