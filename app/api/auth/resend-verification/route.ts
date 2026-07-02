import { NextResponse } from "next/server";
import { createVerificationCode, hashVerificationCode, verificationExpiry } from "@/lib/emailVerification";
import { mutateDb } from "@/lib/store";
import { sendVerificationEmail } from "@/lib/providers/brevo";

export async function POST(req: Request) {
  const { email } = await req.json();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return NextResponse.json({ error: "Email is required." }, { status: 400 });
  const code = createVerificationCode();
  const result = await mutateDb((db) => {
    const user = db.users.find((item) => item.email.toLowerCase() === normalizedEmail);
    if (!user) return { error: "Account not found.", status: 404 };
    if (user.emailVerified) return { verified: true };
    user.emailVerificationCodeHash = hashVerificationCode(code);
    user.emailVerificationExpiresAt = verificationExpiry();
    return { email: user.email };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  if ("verified" in result) return NextResponse.json({ ok: true, alreadyVerified: true });
  await sendVerificationEmail({ email: normalizedEmail, code });
  return NextResponse.json({ ok: true });
}
